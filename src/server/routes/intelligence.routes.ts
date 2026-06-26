// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";

const router = Router();

/**
 * GET /api/intelligence/suggestions
 * 获取 AI 推荐卡片 — 仅保留此读接口，其余旧接口已废弃
 * 
 * ⚠️ 注意：以下接口已于 2026-06-26 废弃，请使用新接口：
 *   - GET /api/intelligence/products       → GET /api/data-center/products
 *   - GET /api/intelligence/creatives      → GET /api/data-center/creatives
 *   - GET /api/intelligence/creatives/daily→ GET /api/data-center/creatives/daily
 *   - POST /api/intelligence/aggregate     → POST /api/sync/trigger { taskType: "sync_products" }
 *   - POST /api/intelligence/audit         → POST /api/ai/audit
 */
router.get("/suggestions", async (req, res) => {
  try {
    const suggestions = await prisma.aiActionSuggestion.findMany({
      include: {
        report: true
      },
      orderBy: {
        id: "desc"
      }
    });
    res.json(suggestions);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch AI suggestions", details: error.message });
  }
});

/**
 * POST /api/intelligence/suggestions/:id/status
 * 修改推荐执行状态 — 仅保留此写接口
 */
router.post("/suggestions/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status is required" });
  try {
    const updated = await prisma.aiActionSuggestion.update({
      where: { id: parseInt(id, 10) },
      data: { status }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to update suggestion status", details: error.message });
  }
});

/**
 * ❌ 以下端点已废弃，统一返回 410 Gone
 * 防止旧客户端静默读取旧数据源
 */
const DEPRECATED_ROUTES = [
  { method: "get",  path: "/products" },
  { method: "get",  path: "/creatives" },
  { method: "get",  path: "/creatives/daily" },
  { method: "post", path: "/aggregate" },
  { method: "post", path: "/audit" },
  { method: "post", path: "/creatives/clear-metrics" },
];

for (const route of DEPRECATED_ROUTES) {
  (router as any)[route.method](route.path, (_req: any, res: any) => {
    res.status(410).json({
      error: "DEPRECATED",
      message: `This endpoint has been removed. See migration guide.`,
      migratedTo: {
        "/products":              "GET /api/data-center/products",
        "/creatives":             "GET /api/data-center/creatives",
        "/creatives/daily":       "GET /api/data-center/creatives/daily",
        "/aggregate":             "POST /api/sync/trigger",
        "/audit":                 "POST /api/ai/audit",
        "/creatives/clear-metrics": "POST /api/data-center/creatives/clear-metrics",
      }
    });
  });
}

export default router;
