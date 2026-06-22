import express, { Request, Response, NextFunction } from "express";
import cron from "node-cron";
import path from "path";
import axios from "axios";
import prisma from "./db/index.js";
import { subDays, format } from "date-fns";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { getProductIntelligence } from "./server/services/product-intelligence.service.js";
import { getCreativeIntelligence } from "./server/services/creative-intelligence.service.js";
import { syncStoreData } from "./server/services/store-sync.service.js";
import { syncMetaHierarchy, ensureAdAccounts } from "./server/services/meta-hierarchy-sync.service.js";
import { aggregateData } from "./server/services/aggregation.service.js";
import { attributePurchases } from "./server/services/attribution.service.js";
import { getMetaToken, evaluateActivityStatus, syncSingleAccountAdData } from "./server/utils.js";
import { SyncCenter } from "./server/services/sync-center.service.js";





// -- SCHEDULE JOBS --
// Run daily aggregation at 2:00 AM
const syncSchedulerEnabled = process.env.ENABLE_SYNC_SCHEDULER === "true";

if (syncSchedulerEnabled) {
  cron.schedule("0 2 * * *", async () => {
    console.log("Triggering daily aggregation job via cron...");
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split("T")[0];
      await attributePurchases();
      await aggregateData(dateStr, dateStr);
    } catch (error) {
      console.error("Daily aggregation job failed:", error);
    }
  });
}

// Log available models on startup to debug the "undefined" error

// Log available models on startup to debug the "undefined" error
async function checkDb() {
  try {
    await prisma.$connect();
    console.log("📡 Connecting to Neon PostgreSQL database...");
    const models = Object.keys(prisma).filter(
      (key) => !key.startsWith("$") && !key.startsWith("_"),
    );
    console.log("📦 Available models in Prisma:", models);
    if (!models.includes("adInsight")) {
      console.error(
        "⚠️ CRITICAL: 'adInsight' model not found on prisma object!",
      );
    }

    console.log("[checkDb] Startup database check is read-only; no users, seed data, demo data, or fake data are created.");
    return;

    // Ensure we have at least one admin user
    const defaultEmail = process.env.VITE_ADMIN_ID || "admin";
    const defaultPass = process.env.VITE_ADMIN_SECRET || "123456";
    const hashedPass = await bcrypt.hash(defaultPass, 10);

    await prisma.user.upsert({
      where: { email: defaultEmail },
      update: { role: "admin", password: hashedPass }, 
      create: {
        email: defaultEmail,
        password: hashedPass,
        role: "admin"
      }
    });
    console.log(`👤 Verified/Restored admin user: ${defaultEmail}`);

    const users = await prisma.user.findMany();
    
    // Migration: hash any plain-text passwords
    for (const user of users) {
      if (user.password && !user.password.startsWith("$2a$") && !user.password.startsWith("$2b$")) {
        console.log(`🔐 Hashing plain-text password for user: ${user.email}`);
        const hashed = await bcrypt.hash(user.password, 10);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: hashed }
        });
      }
    }

    // Sandbox database seeding has been rolled back and disabled.
    console.log("🌱 [checkDb] Seeding is disabled. Running as empty local production sandbox.");

  } catch (err) {
    console.error("❌ Database connection failed:", err);
  }
}

// Global error handlers to prevent silent crashes
process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 UNHANDLED REJECTION:", reason);
});

const app = express();
app.use(express.json());

import routes from "./server/routes/index.js";
app.use("/api", routes);
export default app;
const PORT = 3000;

function getHealthPayload() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return {
    status: "ok",
    env: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
    dbUrlPrefix: dbUrl ? dbUrl.substring(0, 20) + "..." : null,
  };
}

// API route to check if server is running
app.get("/api/health", (req, res) => {
  res.json(getHealthPayload());
});

app.get("/health", (req, res) => {
  res.json(getHealthPayload());
});

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer as createMcpServer } from "./mcp/server.js";

// MCP Transport states
const mcpTransports = new Map<string, SSEServerTransport>();

app.get("/mcp/sse", async (req, res) => {
  try {
    const transport = new SSEServerTransport("/mcp/message", res);
    const sessionId = transport.sessionId;
    mcpTransports.set(sessionId, transport);
    
    // We already use the real database tokens inside the MCP tools.
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    
    res.on("close", () => {
      mcpTransports.delete(sessionId);
      mcpServer.close().catch(() => {});
    });
  } catch (e) {
    console.error("MCP SSE error", e);
    res.status(500).send("Failed to start SSE transport.");
  }
});

app.post("/mcp/message", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = mcpTransports.get(sessionId);
  if (!transport) {
    res.status(404).send("Session not found");
    return;
  }
  await transport.handlePostMessage(req, res);
});

// Helper to get Meta Access Token from DB or Env


// Helper to extract Meta Error Message


// 1. 获取所有广告账户


// 2. 同步数据


// 2a. 同步店铺和订单数据 (和 Meta 广告同步分开)


// 2b. 同步创意和素材数据 (和 Meta 广告及店铺同步分开)


// --- CACHING LOGIC ---
const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // Increased to 10 minutes





// [NEW API] 单个账户层级详情 (Campaigns, AdSets, Ads)


// GET /api/accounts/:accountId/audience-insights


// [NEW API] 获取账户层级结构 (用于级联过滤)


// 3. 获取本地数据


// 4. 系统设置




// --- NEW ACCOUNT MAPPING ENDPOINTS ---

// 获取数据库中已保存的账户映射


// 批量保存/更新账户映射


// 获取本地已有的去重账户列表 (用于设置页面分配 - 只看近期 30 天内有消耗且未禁用的账户)


// --- NEW ACCOUNT MONITORING ENDPOINTS ---

// GET /api/monitoring/accounts - Detailed monitoring for all accounts


// POST /api/monitoring/accounts/:accountId/reset - Reset spend cap


// --- END MONITORING ENDPOINTS ---




// --- User Authentication and Management ---

// ---后台静默同步逻辑 (Background Auto-Sync) ---
async function runBackgroundSync() {
  const syncId = "auto-3d-" + Math.random().toString(36).substring(2, 8);
  console.log(`[Interval Auto-Sync | ${syncId}] 🔄 Starting bi-hourly 3-day Meta Insights auto-sync...`);
  try {
    const token = await getMetaToken();
    if (!token) {
      console.log(`[Interval Auto-Sync | ${syncId}] ⚠️ Skip: Meta Token missing`);
      return;
    }
    await SyncCenter.syncMetaInsights(syncId, "bihourly_scheduled_3d", null, 3);
    console.log(`[Interval Auto-Sync | ${syncId}] ✅ Completed bi-hourly 3-day sync.`);
  } catch (error: any) {
    console.error(`[Interval Auto-Sync | ${syncId}] ❌ Failed:`, error.message);
  }
}

// Run daily retroactive 30-day Meta Insights sync at 1:00 AM (attributions correction)
if (syncSchedulerEnabled) {
  cron.schedule("0 1 * * *", async () => {
  const syncId = "daily-30d-" + Math.random().toString(36).substring(2, 8);
  console.log(`[Retroactive Sync | ${syncId}] 🔄 Starting daily 30-day retroactive Meta Insights sync...`);
  try {
    const token = await getMetaToken();
    if (!token) {
      console.log(`[Retroactive Sync | ${syncId}] ⚠️ Skip: Meta Token missing`);
      return;
    }
    await SyncCenter.syncMetaInsights(syncId, "daily_scheduled_30d", null, 30);
    console.log(`[Retroactive Sync | ${syncId}] ✅ Completed retroactive 30-day sync.`);
  } catch (error: any) {
    console.error(`[Retroactive Sync | ${syncId}] ❌ Failed:`, error.message);
  }
  });
}

app.use("/api", (req, res) => {
  res
    .status(404)
    .json({ error: `API Route not found: ${req.method} ${req.url}` });
});

async function startServer() {
  try {
    console.log("🚀 Starting server startup sequence...");
    // Run database connection check asynchronously so the Express server binds and serves the app instantly
    checkDb().catch((err) => {
      console.error("❌ Asynchronous database check failed:", err);
    });
    if (process.env.NODE_ENV !== "production") {
      console.log("🛠️ Initializing Vite development middleware...");
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          host: "0.0.0.0",
          allowedHosts: true,
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      // Production mode - only serve static files if NOT on Vercel
      if (!process.env.VERCEL) {
        const distPath = path.join(process.cwd(), "dist");
        app.use(express.static(distPath));
        app.get("*", (req, res) => {
          res.sendFile(path.join(distPath, "index.html"));
        });
      }
    }

    // Only listen if not running as a Vercel Serverless Function
    if (!process.env.VERCEL) {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`✅ Server is ready on port ${PORT}`);
        console.log(`📍 Binding: http://0.0.0.0:${PORT}`);

        // --- 启动后台静默同步 ---
        // runBackgroundSync(); // Disable immediate run to prevent startup crashes
        if (syncSchedulerEnabled) {
          setInterval(runBackgroundSync, 2 * 60 * 60 * 1000);
          console.log("Sync scheduler enabled by env ENABLE_SYNC_SCHEDULER=true");
        } else {
          console.log("Sync scheduler disabled by default");
        }
      });
    }
  } catch (error) {
    console.error("❌ Critical error during server startup:", error);
    if (!process.env.VERCEL) process.exit(1);
  }
}

if (!process.env.VERCEL) {
  startServer();
} else {
  // Always trigger DB connection check on startup in serverless mode too
  checkDb();
}
