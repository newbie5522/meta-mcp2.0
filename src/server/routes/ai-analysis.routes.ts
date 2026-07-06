import { Router } from "express";
import prisma from "../../db/index.js";
import { generateAIAnalysis } from "../services/ai-analysis-center.service.js";
import {
  getAiWorkbenchOverview,
  runAiCardFollowUp,
  runManualAiAnalysis
} from "../services/ai-workbench.service.js";

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

router.get("/workbench/overview", async (req, res) => {
  const { startDate, endDate, storeId, accountId } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: "startDate and endDate are required."
    });
  }

  try {
    const result = await getAiWorkbenchOverview({
      startDate: String(startDate),
      endDate: String(endDate),
      storeId: storeId ? Number(storeId) : undefined,
      accountId: accountId ? String(accountId) : undefined
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to load AI workbench overview"
    });
  }
});

router.post("/workbench/manual", async (req, res) => {
  const { analysisType, entityType, entityId, startDate, endDate, question } = req.body;

  if (!analysisType || !entityType || !entityId || !startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: "analysisType, entityType, entityId, startDate and endDate are required."
    });
  }

  try {
    const result = await runManualAiAnalysis({
      analysisType: String(analysisType),
      entityType: String(entityType) as any,
      entityId: String(entityId),
      startDate: String(startDate),
      endDate: String(endDate),
      question: question ? String(question) : undefined
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to run manual AI analysis"
    });
  }
});

router.post("/workbench/follow-up", async (req, res) => {
  const { card, question } = req.body;

  if (!card || !question) {
    return res.status(400).json({
      success: false,
      error: "card and question are required."
    });
  }

  try {
    const result = await runAiCardFollowUp({
      card,
      question: String(question)
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to run AI follow-up"
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
