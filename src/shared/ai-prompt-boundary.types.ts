export type PromptBoundaryScenario = "explain_issue" | "explain_dashboard" | "explain_review";

export type PromptBoundarySeverity = "critical" | "warning" | "info" | "healthy" | "unknown";

export type PromptBoundaryCategory =
  | "production_suggestion"
  | "data_health_notice"
  | "debug_invalid"
  | "review_template"
  | "dashboard_summary";

export type PromptAllowedInputField =
  | "issue.id"
  | "issue.category"
  | "issue.severity"
  | "issue.priorityScore"
  | "issue.confidenceScore"
  | "issue.impactScore"
  | "issue.urgencyScore"
  | "issue.oneLineReason"
  | "issue.diagnosisReason"
  | "issue.evidence"
  | "issue.suggestedActions"
  | "issue.validationMetrics"
  | "issue.limitations"
  | "issue.humanConfirmationRequired"
  | "issue.entityRefs"
  | "statusDetail.status"
  | "statusDetail.operatorNotes"
  | "context.dateRange"
  | "context.scope"
  | "context.filters"
  | "context.generatedAt";

export type PromptForbiddenAction =
  | "create_new_production_suggestion"
  | "modify_issue_category"
  | "modify_issue_severity"
  | "modify_scores"
  | "invent_metrics"
  | "invent_orders"
  | "invent_revenue"
  | "invent_roas"
  | "claim_action_executed"
  | "claim_budget_changed"
  | "claim_ad_paused"
  | "claim_meta_written"
  | "bypass_human_confirmation"
  | "turn_debug_invalid_into_action"
  | "use_external_data"
  | "use_model_prior_knowledge_as_fact"
  | "recommend_automatic_execution"
  | "write_database"
  | "call_meta_api"
  | "call_store_api";

export type PromptOutputField =
  | "summary"
  | "businessMeaning"
  | "evidenceExplanation"
  | "operatorActionPlan"
  | "riskNotes"
  | "validationPlan"
  | "limitations"
  | "modelBoundaryNotes"
  | "requiresHumanConfirmation"
  | "doNotDo";

export interface PromptBoundaryPackage {
  scenario: PromptBoundaryScenario;
  title: string;
  purpose: string;
  allowedInputFields: PromptAllowedInputField[];
  allowedOutputFields: PromptOutputField[];
  forbiddenActions: PromptForbiddenAction[];
  systemRules: string[];
  outputRules: string[];
  hallucinationGuards: string[];
  humanConfirmationRules: string[];
  debugInvalidRules: string[];
  productionSuggestionRules: string[];
  reviewRules: string[];
  dashboardRules: string[];
  modelBoundaryNotes: string;
  requiresHumanConfirmation: boolean;
}

export interface PromptBuildInput {
  scenario: PromptBoundaryScenario;
  issue?: Record<string, unknown> | unknown;
  statusDetail?: Record<string, unknown> | unknown;
  context?: Record<string, unknown> | unknown;
}

export interface PromptBuildResult {
  package: PromptBoundaryPackage;
  systemPrompt: string;
  userPrompt: string;
  outputContract: string;
  safetyChecklist: {
    noExternalData: boolean;
    noMetricInvention: boolean;
    noExecutionClaim: boolean;
    noMetaWriteClaim: boolean;
    noBudgetChangeClaim: boolean;
    noCategoryMutation: boolean;
    noSeverityMutation: boolean;
    noScoreMutation: boolean;
    humanConfirmationRequired: boolean;
    debugInvalidProtected: boolean;
  };
}
