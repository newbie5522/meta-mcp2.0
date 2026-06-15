import { Router } from "express";
import { generateDiagnosticIssues } from "../services/rule-diagnostic-engine.service.js";

const router = Router();

/**
 * POST /api/diagnostics/issues
 * Dynamic Rule Diagnostic Engine generator for systemic issues without LLM participation
 */
router.post("/issues", async (req, res) => {
  try {
    const { startDate, endDate, scope, accountId, storeId, includeDebug } = req.body;

    if (!startDate || !endDate) {
      return res.status(200).json({
        success: false,
        error: "Missing required parameters: startDate and endDate are required.",
        issues: [],
        summary: {
          productionCount: 0,
          noticeCount: 0,
          debugInvalidCount: 0,
          activeAccountCount: 0,
          dataHealthNoticeCount: 0
        }
      });
    }

    const report = await generateDiagnosticIssues({
      startDate,
      endDate,
      scope: scope ? String(scope) : undefined,
      accountId: accountId ? String(accountId) : undefined,
      storeId: storeId ? Number(storeId) : undefined,
      includeDebug: includeDebug === true
    });

    res.json(report);
  } catch (error: any) {
    console.error("[POST /api/diagnostics/issues ERROR]", error);
    res.status(200).json({
      success: false,
      error: error.message || "Failed to process diagnostic rules.",
      issues: [],
      summary: {
        productionCount: 0,
        noticeCount: 0,
        debugInvalidCount: 0,
        activeAccountCount: 0,
        dataHealthNoticeCount: 0
      }
    });
  }
});

export default router;
