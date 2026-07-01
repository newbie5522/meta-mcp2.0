export const MENU_DATA_CONTRACT = {
  overview: {
    component: "OverviewDashboard",
    endpoints: ["/api/dashboard"],
    canonicalSources: ["DataCenterStoreDaily", "DataCenterMetaAccountDaily"],
    status: "WIRED"
  },
  "data-details": {
    component: "DataDetailsDashboard",
    endpoints: ["/api/data-center/accounts-performance"],
    canonicalSources: ["DataCenterMetaAccountDaily"],
    status: "WIRED"
  },
  "data-store": {
    component: "StoreDataDashboard",
    endpoints: ["/api/data-center/stores", "/api/data-center/stores/:storeId/reconciliation"],
    canonicalSources: ["DataCenterStoreDaily", "Order diagnostic only"],
    status: "WIRED"
  },
  "data-campaigns": {
    component: "CampaignStructureDashboard",
    endpoints: [
      "/api/data-center/ad-hierarchy/accounts",
      "/api/data-center/ad-hierarchy/campaigns",
      "/api/data-center/ad-hierarchy/adsets",
      "/api/data-center/ad-hierarchy/ads"
    ],
    canonicalSources: ["FactMetaPerformance", "Campaign", "AdSet", "Ad"],
    status: "WIRED"
  },
  "data-audiences": {
    component: "AudienceAnalysisDashboard",
    endpoints: ["/api/data-center/audience", "/api/data-center/countries"],
    canonicalSources: ["FactAudienceBreakdown", "Order country fields"],
    status: "WIRED"
  },
  "data-creatives": {
    component: "CreativeIntelligenceDashboard",
    endpoints: ["/api/data-center/creative-insights"],
    canonicalSources: ["FactMetaPerformance", "AdCreative"],
    status: "WIRED"
  },
  "data-products": {
    component: "ProductIntelligenceDashboard",
    endpoints: [],
    canonicalSources: ["Order", "Product"],
    status: "NOT_WIRED"
  },
  "diag-overview": {
    component: "DiagnosisOverviewPage",
    endpoints: [],
    canonicalSources: [],
    status: "NOT_WIRED"
  },
  "diag-ad": {
    component: "AdPerformanceDiagnosisPage",
    endpoints: [],
    canonicalSources: [],
    status: "NOT_WIRED"
  },
  "diag-funnel": {
    component: "FunnelDiagnosisPage",
    endpoints: [],
    canonicalSources: [],
    status: "NOT_WIRED"
  },
  "diag-store": {
    component: "StoreDiagnosisPage",
    endpoints: [],
    canonicalSources: [],
    status: "NOT_WIRED"
  },
  "diag-creative": {
    component: "CreativeFatigueDiagnosisPage",
    endpoints: [],
    canonicalSources: [],
    status: "NOT_WIRED"
  },
  "diag-product": {
    component: "ProductDiagnosisPage",
    endpoints: [],
    canonicalSources: [],
    status: "NOT_WIRED"
  },
  "diag-health": {
    component: "DataHealthDiagnosisPage",
    endpoints: ["/api/data-center/audit"],
    canonicalSources: ["DataCenter audit contract"],
    status: "WIRED"
  }
} as const;
