// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";

const router = Router();

router.get("/ai-models", async (req, res) => {
  const { provider } = req.query;
  try {
    // Simulated model version fetcher component to select recent API iterations.
    if (provider === "gemini") {
      res.json({
        models: [
          { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
          { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
          { id: "gemini-2.0-pro-exp-02-05", name: "Gemini 2.0 Pro Experimental" },
          { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
          { id: "gemini-2.0-flash-lite-preview-02-05", name: "Gemini 2.0 Flash Lite" },
          { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
          { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
        ],
      });
    } else if (provider === "chatgpt") {
      res.json({
        models: [
          { id: "gpt-5.5", name: "GPT-5.5" },
          { id: "gpt-5.5-pro", name: "GPT-5.5 Pro" },
          { id: "gpt-5.4", name: "GPT-5.4" },
          { id: "gpt-5.4-pro", name: "GPT-5.4 Pro" },
          { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
          { id: "gpt-5.4-nano", name: "GPT-5.4 nano" },
          { id: "o3-mini", name: "o3-mini" },
          { id: "o1", name: "o1" },
          { id: "o1-mini", name: "o1-mini" },
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "gpt-4o-mini", name: "GPT-4o Mini" },
        ],
      });
    } else {
      res.status(400).json({ error: "Invalid provider" });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch AI models" });
  }
});

router.get("/", async (req, res) => {
  try {
    const settings = await prisma.setting.findMany();
    const config: Record<string, string> = {};
    settings.forEach((s) => {
      config[s.key] = s.value;
    });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.post("/", async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: "Key is required" });
  try {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    
    // Automatically trigger Sync Center Meta Pipeline on Meta Token configuration success
    if (key === "META_ACCESS_TOKEN" || key === "META_TOKEN") {
      try {
        const { SyncCenter } = await import("../services/sync-center.service.js");
        const chainId = await SyncCenter.triggerMetaConfigChain("auto_config_change");
        console.log(`[Settings Route] Automatically triggered integration sync chain: ${chainId}`);
      } catch (triggerErr) {
        console.error("[Settings Route] Failed to trigger background sync:", triggerErr);
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[Save Token Error]:", err);
    if (
      err.name === "PrismaClientInitializationError" ||
      err.message?.includes("Authentication failed")
    ) {
      res
        .status(500)
        .json({
          error:
            "数据库连接失败，请检查环境变量 DATABASE_URL 是否正确或密码是否已过期。",
        });
    } else {
      res
        .status(500)
        .json({
          error: "Failed to save setting",
          details: err instanceof Error ? err.message : String(err),
        });
    }
  }
});

export default router;