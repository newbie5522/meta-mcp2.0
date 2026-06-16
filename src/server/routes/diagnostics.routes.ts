import { Router } from "express";
import { generateDiagnosticIssues } from "../services/rule-diagnostic-engine.service.js";

const router = Router();

/**
 * POST /api/diagnostics/issues
 */
router.post("/issues", async (req, res) => {
  try {
    const report = await generateDiagnosticIssues(req.body || {});
    res.json(report);
  } catch (error: any) {
    console.error("[POST /api/diagnostics/issues ERROR]", error);
    res.status(400).json({
      success: false,
      issues: [],
      error: "Failed to generate diagnostics/issues",
      details: error?.message || String(error)
    });
  }
});

export default router;
