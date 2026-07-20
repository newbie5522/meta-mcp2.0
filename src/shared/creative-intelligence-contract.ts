export type CreativeMediaType =
  | "IMAGE"
  | "VIDEO"
  | "CAROUSEL"
  | "MIXED"
  | "UNKNOWN";

export interface CreativeMetricAvailability {
  frequency: boolean;
  reach: boolean;
  addToCart: boolean;
  hookRate: boolean;
  productLink: boolean;
}

export interface CreativeIntelligenceRow {
  id: string;
  analysisEntityId: string;
  aggregationKey: string;
  aggregationScope: "ACCOUNT_ASSET";
  creativeId: string;
  creativeIds: string[];
  creativeCount: number;
  adId: string;
  adIds: string[];
  adCount: number;
  adsetId: string;
  adsetIds: string[];
  adsetCount: number;
  campaignId: string;
  campaignIds: string[];
  campaignCount: number;
  accountId: string;
  accountName: string | null;
  storeId: number | null;
  storeName: string | null;
  creativeName: string | null;
  creativeNames: string[];
  type: CreativeMediaType;
  imageUrl: string | null;
  previewUrl: string | null;
  productLink: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
  reach: number | null;
  addToCart: number | null;
  frequency: number | null;
  hookRate: number | null;
  availability: CreativeMetricAvailability;
  hasPerformanceFacts: boolean;
  factRowCount: number;
  opsScore: number | null;
  opsBucket: string | null;
  opsBucketLabel: string;
  recommendedAction: string | null;
  diagnosisReason: string;
  fatigueScore: null;
  riskLevel: string;
  latestPerformanceDate: string | null;
  performanceSyncedAt: string | null;
}

export interface CreativeIntelligenceSummary {
  performanceCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
}

export type CreativeAiConclusion =
  | "SCALE"
  | "WATCH"
  | "REDUCE"
  | "STOP"
  | "INSUFFICIENT_DATA";

export type CreativeAiConfidence = "full" | "partial";

export interface CreativeAnalysisRequest {
  analysisEntityId: string;
  creativeId: string;
  creativeIds: string[];
  adIds: string[];
  campaignIds: string[];
  adsetIds: string[];
  accountId: string;
  storeId: number | null;
  startDate: string;
  endDate: string;
  onlyCached?: boolean;
  forceRefresh?: boolean;
}

export interface CreativeAnalysisReport {
  success: true;
  cached: boolean;
  mode: "rule_diagnostic_engine";
  analysisEntityId: string;
  scopeHash: string;
  dateRange: { startDate: string; endDate: string };
  coverageStatus: string;
  confidence: CreativeAiConfidence;
  conclusionCategory: CreativeAiConclusion;
  conclusion: string;
  metrics: {
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchaseValue: number;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
    cpa: number | null;
    roas: number | null;
  };
  facts: string[];
  riskPoints: string[];
  recommendedActions: string[];
  warnings: string[];
  dataBasis: {
    source: "FactMetaPerformance";
    factLevel: "ad";
    factRows: number;
    accountId: string;
    storeId: number | null;
    creativeIds: string[];
    adIds: string[];
    campaignIds: string[];
    adsetIds: string[];
    latestPerformanceDate: string | null;
  };
}
