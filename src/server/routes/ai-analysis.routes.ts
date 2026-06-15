import { Router } from "express";
import { generateAIAnalysis } from "../services/ai-analysis-center.service.js";

const router = Router();

/**
 * POST /api/ai-analysis/generate
 * Dynamic systemic AI analysis generator for specific targets and dates
 */
router.post("/generate", async (req, res) => {
  const { type, entityType, entityId, startDate, endDate, storeId, accountId, includeRecommendations } = req.body;

  if (!type || !entityType || !entityId || !startDate || !endDate) {
    return res.status(400).json({
      error: "Missing required parameters: type, entityType, entityId, startDate, endDate are required."
    });
  }

  try {
    const report = await generateAIAnalysis({
      type,
      entityType,
      entityId,
      startDate,
      endDate,
      storeId: storeId ? Number(storeId) : undefined,
      accountId: accountId ? String(accountId) : undefined,
      includeRecommendations: !!includeRecommendations
    });

    res.json({
      success: true,
      report,
      dataSourceExplain: report.dataSourceExplain,
      limitations: report.limitations
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to generate AI analysis report",
      details: error.message
    });
  }
});

export default router;
