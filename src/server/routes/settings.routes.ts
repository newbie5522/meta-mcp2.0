import { Router } from "express";
import prisma from "../../db/index.js";

const router = Router();

function isSensitiveSettingKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return (
    normalized.includes("TOKEN") ||
    normalized.includes("SECRET") ||
    normalized.includes("API_KEY") ||
    normalized.includes("ACCESS_KEY")
  );
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

router.get("/", async (req, res) => {
  try {
    const settings = await prisma.setting.findMany();
    const config: Record<string, string> = {};
    settings.forEach((s) => {
      config[s.key] = isSensitiveSettingKey(s.key) ? maskSecret(s.value) : s.value;
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
    
    return res.json({
      success: true,
      key,
      syncTriggered: false,
    });
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
