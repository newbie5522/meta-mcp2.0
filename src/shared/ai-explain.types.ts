export interface UniformIssueLike {
  issueId: string;
  issueType: string;
  category: string;
  severity: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  title: string;
  oneLineReason?: string;
  diagnosisReason?: string;
  actionVerb?: string;
  actionTarget?: string;
  route?: string;
  humanConfirmationRequired?: boolean;
  problemStage?: string;
  optimizationArea?: string;
  funnelStage?: string;
  priorityScore?: number;
  confidenceScore?: number;
  impactScore?: number;
  urgencyScore?: number;
  suggestedActions?: string[];
  validationMetrics?: string[];
  limitations?: string[];
  evidence?: {
    funnelSnapshot?: any;
    missingMetrics?: string[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface SuggestionStatusDetailLike {
  status: string;
  acceptedAt?: string;
  ignoredAt?: string;
  executedAt?: string;
  ignoreReason?: string;
  operatorNotes?: string;
  review3dStatus?: string;
  review7dStatus?: string;
  review14dStatus?: string;
  [key: string]: any;
}

export interface AIExplainInput {
  issue: UniformIssueLike;
  statusDetail?: SuggestionStatusDetailLike | null;
  context: {
    dateRange: {
      startDate: string;
      endDate: string;
    };
    currentPage:
      | "diagnosis_overview"
      | "prescription_center"
      | "prescription_review"
      | "product_diagnosis"
      | "creative_diagnosis";
    userRole?: "admin" | "operator" | "viewer";
    targetLanguage?: "zh-CN" | "en-US";
    provider?: "gemini" | "openai" | "claude" | "deepseek" | "qwen" | "local" | "auto";
    model?: string;
  };
}

export interface AIExplainOutput {
  executiveSummary: string;
  rootCauseAnalysis: string;
  operatorActionPlan: string[];
  riskNotes: string[];
  validationPlan: {
    day3: string;
    day7: string;
    day14: string;
  };
  confidenceExplanation: string;
  doNotDo: string[];
  requiresHumanConfirmation: true;
  modelBoundaryNotes: string;
}
