export type AiDeepDiagnosisMode =
  | "account_overview"
  | "store_overview"
  | "campaign_diagnosis"
  | "adset_diagnosis"
  | "ad_diagnosis"
  | "creative_fatigue"
  | "product_performance"
  | "funnel_breakdown"
  | "data_quality"
  | "cross_channel_attribution";

export interface AiDiagnosisTimeWindow {
  label: string;
  startDate: string;
  endDate: string;
  days: number;
  comparisonWindow: string | null;
}

export interface AiDiagnosisScope {
  storeId?: string | null;
  storeName?: string | null;
  platform?: string | null;
  adAccountId?: string | null;
  adAccountName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adSetId?: string | null;
  adSetName?: string | null;
  adId?: string | null;
  adName?: string | null;
  creativeId?: string | null;
  creativeName?: string | null;
  productId?: string | null;
  productName?: string | null;
  country?: string | null;
  currency?: string | null;
}

export interface AiMetricSnapshot {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  roas: number | null;
  cpa: number | null;
  addToCart: number | null;
  initiateCheckout: number | null;
  conversionRate: number | null;
  orders: number | null;
  revenue: number | null;
  aov: number | null;
  refundAmount: number | null;
  refundRate: number | null;
}

export interface AiMetricComparison {
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPercent: number | null;
  trend: "up" | "down" | "flat" | "unknown";
}

export type AiEntityType =
  | "store"
  | "ad_account"
  | "campaign"
  | "adset"
  | "ad"
  | "creative"
  | "product";

export interface AiEntityPerformanceNode {
  entityType: AiEntityType;
  entityId: string;
  entityName: string;
  parentEntityId?: string | null;
  metrics: AiMetricSnapshot;
  comparisons?: Record<string, AiMetricComparison> | null;
  issues?: string[] | null;
  dataQualityNotes?: string[] | null;
}

export interface AiFunnelBreakdown {
  impressions: number | null;
  clicks: number | null;
  viewContent: number | null;
  addToCart: number | null;
  initiateCheckout: number | null;
  purchases: number | null;
  orders: number | null;
  dropOffNotes: string[];
  suspectedBottlenecks: string[];
}

export interface AiCreativeSignal {
  creativeId: string;
  creativeName: string;
  creativeType: string;
  firstSeenAt: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpm: number | null;
  frequency: number | null;
  purchases: number | null;
  roas: number | null;
  fatigueSignals: string[];
  performanceNotes: string[];
}

export interface AiTopProductNode {
  productId: string;
  productName: string;
  orders: number;
  revenue: number;
}

export interface AiOrderSignal {
  orderCount: number | null;
  revenue: number | null;
  aov: number | null;
  topProducts: AiTopProductNode[];
  countryBreakdown: Record<string, number>;
  refundSignals: string[];
  delayedAttributionNotes: string[];
}

export interface AiRuleIssueInput {
  id: string;
  category: string;
  severity: string;
  priorityScore: number;
  confidenceScore: number;
  oneLineReason: string;
  diagnosisReason: string;
  evidence: string;
  suggestedActions: string[];
  humanConfirmationRequired: boolean;
  limitations: string[];
  entityRefs: string[];
}

export type AiConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface AiDataQualityReport {
  missingFields: string[];
  staleDataWarnings: string[];
  mappingWarnings: string[];
  attributionWarnings: string[];
  syncWarnings: string[];
  confidenceLevel: AiConfidenceLevel;
}

export type AiAllowedAnalysisTask =
  | "summarize_performance"
  | "compare_time_windows"
  | "identify_metric_shift"
  | "rank_possible_causes"
  | "explain_funnel_dropoff"
  | "identify_creative_fatigue"
  | "identify_data_quality_issue"
  | "suggest_manual_validation_steps"
  | "prioritize_operator_attention";

export type AiForbiddenAnalysisTask =
  | "invent_missing_metrics"
  | "claim_budget_changed"
  | "claim_ad_paused"
  | "claim_meta_written"
  | "auto_optimize_campaign"
  | "write_database"
  | "call_external_api"
  | "override_rule_engine"
  | "ignore_data_quality_limits"
  | "generate_fake_orders"
  | "generate_fake_roas";

export interface AiDeepDiagnosisInput {
  mode: AiDeepDiagnosisMode;
  scope: AiDiagnosisScope;
  timeWindow: AiDiagnosisTimeWindow;
  primaryEntity: AiEntityPerformanceNode | null;
  relatedEntities: AiEntityPerformanceNode[];
  funnel: AiFunnelBreakdown | null;
  creativeSignals: AiCreativeSignal[];
  orderSignals: AiOrderSignal | null;
  ruleIssues: AiRuleIssueInput[];
  dataQuality: AiDataQualityReport;
  limitations: string[];
  allowedAnalysisTasks: AiAllowedAnalysisTask[];
  forbiddenAnalysisTasks: AiForbiddenAnalysisTask[];
  humanReviewRequired: boolean;
}
