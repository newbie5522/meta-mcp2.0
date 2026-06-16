import { Router } from "express";
import { generateDiagnosticIssues } from "../services/rule-diagnostic-engine.service.js";

const router = Router();

/**
 * POST /api/diagnostics/issues
 */
router.post("/issues", async (req, res) => {
  const report = await generateDiagnosticIssues(req.body || {});
  res.json(report);
});

export default router;
