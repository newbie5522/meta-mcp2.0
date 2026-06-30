export const DATA_CONTRACT = {
  config: {
    metaTokenKey: "META_ACCESS_TOKEN",
    storeIdentityKey: "storeId",
    accountIdentityKey: "accountId"
  },

  date: {
    businessTimezone: "America/Los_Angeles",
    defaultClosedDayRule: "exclude_today",
    todayRealtimeOnly: true
  },

  dataCenter: {
    accountPerformance: {
      endpoint: "/api/data-center/accounts-performance",
      source: "DataCenterMetaAccountDaily",
      forbiddenSources: ["AdInsight", "DailySummary"]
    },
    storePerformance: {
      endpoint: "/api/data-center/stores",
      source: "DataCenterStoreDaily",
      forbiddenSources: ["Order.revenue line-sum direct page aggregation", "DailySummary"]
    },
    campaignStructure: {
      endpoint: "/api/data-center/campaigns",
      source: "FactMetaPerformance",
      allowedLevels: ["campaign", "adset", "ad"]
    },
    audience: {
      endpoint: "/api/data-center/audience",
      source: "FactAudienceBreakdown",
      allowedDimensions: ["country", "age", "gender", "publisher_platform"]
    },
    countries: {
      endpoint: "/api/data-center/countries",
      metaSource: "FactAudienceBreakdown.country",
      orderSource: "Order.shippingCountryCode / Order.billingCountryCode"
    },
    creatives: {
      endpoint: "/api/data-center/creative-insights",
      source: "FactMetaPerformance + Ad + AdCreative",
      requiredTraceSource: "FactMetaPerformance level=ad creative_id"
    }
  },

  sync: {
    metaRawFacts: {
      target: "FactMetaPerformance",
      endpoint: "/api/sync/meta-insights"
    },
    metaLedger: {
      target: "DataCenterMetaAccountDaily",
      endpoint: "/api/sync/data-center/refresh-meta"
    },
    storeOrders: {
      target: "Order",
      endpoint: "/api/sync/store-orders"
    },
    storeLedger: {
      target: "DataCenterStoreDaily",
      endpoint: "/api/sync/data-center/refresh-store"
    },
    audienceBreakdown: {
      target: "FactAudienceBreakdown",
      endpoint: "/api/sync/meta-audience-breakdown",
      autoLightRefreshAllowed: false
    },
    autoLightRefresh: {
      targets: ["DataCenterMetaAccountDaily", "DataCenterStoreDaily"],
      forbiddenTargets: ["FactAudienceBreakdown", "nonCanonicalPerformanceTables"]
    }
  }
} as const;
