import type { Express } from "express";
import { currentAdmin, loginAdmin, logoutAdmin, requireAdmin, validateAdminCredentials } from "./session.js";

export function mountAdminRoutes(app: Express): void {
  app.get("/api/auth/me", (req, res) => {
    const admin = currentAdmin(req);
    res.json({
      data: {
        authenticated: Boolean(admin),
        username: admin?.username ?? null,
      },
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!validateAdminCredentials(username, password)) {
      res.status(401).json({ error: "invalid_admin_credentials", message: "账号或密码错误" });
      return;
    }
    loginAdmin(res, username);
    res.json({ data: { authenticated: true, username } });
  });

  app.post("/api/auth/logout", requireAdmin, (_req, res) => {
    logoutAdmin(res);
    res.json({ data: { authenticated: false } });
  });
}
