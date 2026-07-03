import { Router } from "express";
import prisma from "../../db/index.js";
import { generateAIAnalysis } from "../services/ai-analysis-center.service.js";

const router = Router();

/**
 * POST /api/ai-analysis/generate
 * Dynamic systemic AI analysis generator for specific targets and dates
 */

/**
 * GET /api/ai-analysis/suggestions
 * Reads AI action suggestions from the canonical AiActionSuggestion table.
 */
router.get("/suggestions", async (_req, res) => {
  try {
    const suggestions = await prisma.aiActionSuggestion.findMany({
      include: {
        report: true
      },
      orderBy: {
        id: "desc"
      }
    });

    return res.json(suggestions);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to fetch AI suggestions",
      details: error.message
    });
  }
});

/**
 * POST /api/ai-analysis/suggestions/:id/status
 * Updates suggestion execution status.
 */
router.post("/suggestions/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    const updated = await prisma.aiActionSuggestion.update({
      where: { id },
      data: { status }
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to update suggestion status",
      details: error.message
    });
  }
});

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
