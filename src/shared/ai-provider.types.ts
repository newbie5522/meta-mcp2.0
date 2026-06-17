export type AIProviderId = "auto" | "openai" | "gemini" | "claude" | "deepseek" | "qwen" | "local";

export interface AIProviderConfig {
  provider: AIProviderId;
  model: string;
  enabled: boolean;
  displayName: string;
  status: "not_configured" | "configured" | "disabled" | string;
  description: string;
  safetyNotice: string;
  supportsIssueExplanation: boolean;
  supportsDashboardSummary: boolean;
  supportsReviewTemplate: boolean;
}
