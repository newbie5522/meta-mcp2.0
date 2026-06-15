import { Router } from "express";
import { AIAnalysisCenterService } from "../services/ai-analysis-center.service.js";

const router = Router();

/**
 * POST /api/ai-analysis/generate
 * Dynamic systemic AI analysis generator for specific targets and dates
 */
router.post("/generate", async (req, res) => {
  const { type, entityType, entityId, startDate, endDate, storeId, accountId } = req.body;

  if (!type || !entityType || !entityId || !startDate || !endDate) {
    return res.status(400).json({
      error: "Missing required parameters: type, entityType, entityId, startDate, endDate are required."
    });
  }

  try {
    const report = await AIAnalysisCenterService.runAnalysis({
      type,
      entityType,
      entityId,
      startDate,
      endDate,
      storeId: storeId ? Number(storeId) : undefined,
      accountId: accountId ? String(accountId) : undefined
    });

    res.json(report);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to generate AI analysis report",
      details: error.message
    });
  }
});

export default router;
