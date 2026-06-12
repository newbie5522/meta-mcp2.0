import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateApiKey, isApiKeyConfigured } from "../auth/api-key.js";
import { requestContext } from "../auth/token-store.js";
import { tokenManager } from "../auth/token-manager.js";
import { logger } from "../utils/logger.js";
import { isReadOnlyModeEnabled } from "../meta/client.js";
import { assertAdminConfig } from "../admin/session.js";
import { mountAdminRoutes } from "../admin/routes.js";
import { createApiRouter } from "../api/routes.js";
import { startSyncScheduler } from "../jobs/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWebRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "dist/apps/web"),
    path.resolve(process.cwd(), "apps/web"),
    path.resolve(__dirname, "../../../web"),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? candidates[0];
}

export function healthPayload(): { status: "ok"; readOnlyMode: boolean } {
  return {
    status: "ok",
    readOnlyMode: isReadOnlyModeEnabled(),
  };
}

function extractApiKey(req: express.Request): string | undefined {
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey) return xApiKey;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return undefined;
}

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!isApiKeyConfigured()) {
    if (process.env.NODE_ENV === "production") {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "MCP_API_KEY or API_KEY is required in production" },
        id: null,
      });
      return;
    }
    next();
    return;
  }

  const candidate = extractApiKey(req);
  if (candidate && validateApiKey(candidate)) {
    next();
    return;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Invalid API key" },
    id: null,
  });
}

function resolveMetaToken(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const headerToken = req.headers["x-meta-token"];
  if (typeof headerToken === "string" && headerToken) {
    requestContext.run({ accessToken: headerToken }, () => next());
    return;
  }

  const managerToken = tokenManager.getActiveToken();
  if (managerToken) {
    requestContext.run({ accessToken: managerToken }, () => next());
    return;
  }

  const envToken = process.env.META_ACCESS_TOKEN;
  if (envToken) {
    requestContext.run({ accessToken: envToken }, () => next());
    return;
  }

  res.status(500).json({
    jsonrpc: "2.0",
    error: {
      code: -32603,
      message: "No Meta token configured. Set META_ACCESS_TOKEN, META_TOKENS, or pass X-Meta-Token.",
    },
    id: null,
  });
}

export async function startHttpTransport(
  createServer: () => McpServer,
  port: number,
): Promise<void> {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";
  assertAdminConfig();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS?.trim() || "https://claude.ai")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsAllowedOrigins.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS must not contain *");
  }

  app.use(
    cors({
      origin: corsAllowedOrigins,
      credentials: false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Meta-Token", "Mcp-Session-Id"],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  if (isProduction) {
    app.use((req, res, next) => {
      if (req.path === "/health") {
        next();
        return;
      }
      if (req.header("x-forwarded-proto") !== "https" && process.env.ALLOW_INSECURE_LOCAL_HTTP !== "true") {
        res.redirect(301, `https://${req.header("host")}${req.originalUrl}`);
        return;
      }
      next();
    });
  }

  app.get("/health", (_req, res) => {
    res.json(healthPayload());
  });

  mountAdminRoutes(app);
  app.use("/api", createApiRouter());

  app.post("/mcp", requireApiKey, resolveMetaToken, async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (error) {
      logger.error({ error }, "Error handling MCP request");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Use POST /mcp." },
      id: null,
    });
  });

  const webRoot = resolveWebRoot();
  const indexHtml = path.join(webRoot, "index.html");
  app.use(express.static(webRoot, { index: false, maxAge: isProduction ? "1h" : 0 }));
  app.get(/^\/(?!api\/|mcp$|health$).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });

  app.listen(port, () => {
    logger.info(
      { port, corsAllowedOrigins, readOnlyMode: healthPayload().readOnlyMode },
      "Read-only Meta Ads MCP server listening",
    );
    startSyncScheduler();
  });
}
