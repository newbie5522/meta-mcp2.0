import { Router, Request, Response } from "express";
import { validateAIExplainOutput } from "../../shared/ai-output-validator";

const router = Router();

// Constant boundary notice text of the AI Explanation Layer
const BOUNDARY_NOTICE = "该模型解释仅基于系统传入的结构化诊断字段生成，不拥有自动读取账户、修改广告或执行操作的权限";

/**
 * POST /api/ai/explain-issue
 * Generates an explanation for a single issue in dry run mode.
 */
router.post("/explain-issue", (req: Request, res: Response): void => {
  const { issue, context, statusDetail } = req.body;

  // 1. Validate required fields
  if (!issue) {
    res.status(400).json({
      success: false,
      error: "Missing required parameter: issue",
      boundaryNotice: BOUNDARY_NOTICE
    });
    return;
  }

  if (!context) {
    res.status(400).json({
      success: false,
      error: "Missing required parameter: context",
      boundaryNotice: BOUNDARY_NOTICE
    });
    return;
  }

  // Under dry run scope, we can optionally demonstrate importing and defining validator usage 
  // on hypothetical output for verification purposes
  const dummyOutput = null; 

  res.json({
    success: false,
    mode: "dry_run",
    enabled: false,
    explanation: null,
    error: "AI explanation gateway is not enabled in STEP 13-AI-R1-Backend-Gateway.",
    boundaryNotice: BOUNDARY_NOTICE
  });
});

/**
 * POST /api/ai/explain-dashboard
 * Summarizes current multiple issues on dashboard overview in dry run mode.
 */
router.post("/explain-dashboard", (req: Request, res: Response): void => {
  const { issues, context } = req.body;

  // 1. Validate required fields
  if (!issues || !Array.isArray(issues)) {
    res.status(400).json({
      success: false,
      error: "Missing or invalid parameter: issues (must be an array of diagnostic issues)",
      boundaryNotice: BOUNDARY_NOTICE
    });
    return;
  }

  if (!context) {
    res.status(400).json({
      success: false,
      error: "Missing required parameter: context",
      boundaryNotice: BOUNDARY_NOTICE
    });
    return;
  }

  res.json({
    success: false,
    mode: "dry_run",
    enabled: false,
    explanation: null,
    error: "AI explanation gateway is not enabled in STEP 13-AI-R1-Backend-Gateway.",
    boundaryNotice: BOUNDARY_NOTICE
  });
});

/**
 * POST /api/ai/explain-review
 * Generates structured review explanations on adopted suggestions.
 */
router.post("/explain-review", (req: Request, res: Response): void => {
  const { issue, statusDetail, context } = req.body;

  // 1. Validate required fields
  if (!issue) {
    res.status(400).json({
      success: false,
      error: "Missing required parameter: issue",
      boundaryNotice: BOUNDARY_NOTICE
    });
    return;
  }

  if (!statusDetail) {
    res.status(400).json({
      success: false,
      error: "Missing required parameter: statusDetail",
      boundaryNotice: BOUNDARY_NOTICE
    });
    return;
  }

  if (!context) {
    res.status(400).json({
      success: false,
      error: "Missing required parameter: context",
      boundaryNotice: BOUNDARY_NOTICE
    });
    return;
  }

  res.json({
    success: false,
    mode: "dry_run",
    enabled: false,
    explanation: null,
    error: "AI explanation gateway is not enabled in STEP 13-AI-R1-Backend-Gateway.",
    boundaryNotice: BOUNDARY_NOTICE
  });
});

export default router;
