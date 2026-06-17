import { Router, Request, Response } from "express";
import { validateAIExplainOutput } from "../../shared/ai-output-validator";
import { AIExplainInput } from "../../shared/ai-explain.types";
import { DEFAULT_AI_PROVIDERS } from "../../shared/ai-provider-config";

const router = Router();

// Constant boundary notice text of the AI Explanation Layer
const BOUNDARY_NOTICE = "该模型解释仅基于系统传入的结构化诊断字段生成，不拥有自动读取账户、修改广告或执行操作的权限";

/**
 * Validator helper that calls the validateAIExplainOutput if an output is present
 */
function validateModelOutputIfPresent(input: AIExplainInput, output: unknown) {
  if (!output) {
    return null;
  }
  return validateAIExplainOutput(input, output);
}

/**
 * POST /api/ai/explain-issue
 * Generates an explanation for a single issue in dry run mode.
 */
router.post("/explain-issue", (req: Request, res: Response): void => {
  const body = req.body || {};
  const { issue, context, statusDetail } = body;

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

  // Construct dry run input shape
  const aiInput: AIExplainInput = {
    issue,
    statusDetail: statusDetail || null,
    context: {
      ...context,
      provider: body.provider,
      model: body.model
    }
  };

  // Dry run link to future validator - validationResult is null
  const validationResult = validateModelOutputIfPresent(aiInput, null);

  res.json({
    success: false,
    mode: "dry_run",
    enabled: false,
    explanation: null,
    error: "AI 辅助解读服务未启用。",
    boundaryNotice: BOUNDARY_NOTICE
  });
});

/**
 * POST /api/ai/explain-dashboard
 * Summarizes current multiple issues on dashboard overview in dry run mode.
 */
router.post("/explain-dashboard", (req: Request, res: Response): void => {
  const body = req.body || {};
  const { issues, context } = body;

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
    error: "AI 辅助解读服务未启用。",
    boundaryNotice: BOUNDARY_NOTICE
  });
});

/**
 * POST /api/ai/explain-review
 * Generates structured review explanations on adopted suggestions.
 */
router.post("/explain-review", (req: Request, res: Response): void => {
  const body = req.body || {};
  const { issue, statusDetail, context } = body;

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
    error: "AI 辅助解读服务未启用。",
    boundaryNotice: BOUNDARY_NOTICE
  });
});

/**
 * GET /api/ai/providers
 * Returns the placeholder static providers configuration list.
 */
router.get("/providers", (req: Request, res: Response): void => {
  res.json({
    success: true,
    providers: DEFAULT_AI_PROVIDERS
  });
});

export default router;
