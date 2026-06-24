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
    const config: Record<string, any> = {};
    settings.forEach((s) => {
      if (s.key !== "META_ACCESS_TOKEN" && s.key !== "meta_token") {
        config[s.key] = isSensitiveSettingKey(s.key) ? maskSecret(s.value) : s.value;
      }
    });

    const metaTokenDb = settings.find(s => s.key === "META_ACCESS_TOKEN");
    const legacyTokenDb = settings.find(s => s.key === "meta_token");
    const envVal = process.env.META_ACCESS_TOKEN || process.env.meta_token;
    const dbVal = metaTokenDb?.value || legacyTokenDb?.value || "";
    const activeToken = dbVal || envVal || "";

    config["hasMetaAccessToken"] = activeToken ? true : false;
    config["metaTokenMasked"] = activeToken ? maskSecret(activeToken) : "";

    // Explicitly delete to make sure they are not in response
    delete config["META_ACCESS_TOKEN"];
    delete config["meta_token"];

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.post("/", async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: "Key is required" });

  const normalizedKey = String(key).trim();

  if (normalizedKey === "meta_token") {
    return res.status(400).json({
      success: false,
      error: "LEGACY_META_TOKEN_WRITE_FORBIDDEN",
      details: "meta_token is read-only legacy fallback. Use META_ACCESS_TOKEN."
    });
  }

  try {
    if (normalizedKey === "META_ACCESS_TOKEN") {
      const token = String(value || "").trim();

      if (!token) {
        return res.status(400).json({ success: false, error: "TOKEN_REQUIRED" });
      }

      if (token.includes("...")) {
        return res.status(400).json({ success: false, error: "MASKED_TOKEN_REJECTED" });
      }

      if (token.length < 20) {
        return res.status(400).json({ success: false, error: "TOKEN_TOO_SHORT" });
      }

      const updatedAt = new Date().toISOString();

      await prisma.$transaction([
        prisma.setting.upsert({
          where: { key: "META_ACCESS_TOKEN" },
          update: { value: token },
          create: { key: "META_ACCESS_TOKEN", value: token }
        }),
        prisma.setting.upsert({
          where: { key: "META_TOKEN_UPDATED_AT" },
          update: { value: updatedAt },
          create: { key: "META_TOKEN_UPDATED_AT", value: updatedAt }
        })
      ]);

      const saved = await prisma.setting.findUnique({
        where: { key: "META_ACCESS_TOKEN" }
      });

      if (!saved?.value || saved.value.includes("...")) {
        return res.status(500).json({
          success: false,
          error: "TOKEN_SAVE_READBACK_FAILED"
        });
      }

      return res.json({
        success: true,
        key: "META_ACCESS_TOKEN",
        hasMetaAccessToken: true,
        metaTokenMasked: maskSecret(saved.value),
        updatedAt
      });
    }

    await prisma.setting.upsert({
      where: { key: normalizedKey },
      update: { value: String(value ?? "") },
      create: { key: normalizedKey, value: String(value ?? "") }
    });

    return res.json({
      success: true,
      key: normalizedKey
    });
  } catch (err: any) {
    console.error("[Save Token Error]:", err);
    if (
      err.name === "PrismaClientInitializationError" ||
      err.message?.includes("Authentication failed")
    ) {
      return res
        .status(500)
        .json({
          error:
            "数据库连接失败，请检查环境变量 DATABASE_URL 是否正确或密码是否已过期。",
        });
    } else {
      return res
        .status(500)
        .json({
          error: "Failed to save setting",
          details: err instanceof Error ? err.message : String(err),
        });
    }
  }
});

export default router;
