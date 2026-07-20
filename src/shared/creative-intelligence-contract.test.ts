import { describe, expect, it } from "vitest";
import type {
  CreativeAnalysisReport,
  CreativeIntelligenceRow,
  CreativeIntelligenceSummary
} from "./creative-intelligence-contract";

describe("creative intelligence shared contract", () => {
  it("CR-CONTRACT-01 supports account-asset rows, nullable ratios, and AI scope fields", () => {
    const row: CreativeIntelligenceRow = {
      id: "act_1::asset-1",
      analysisEntityId: "act_1::asset-1",
      aggregationKey: "asset-1",
      aggregationScope: "ACCOUNT_ASSET",
      creativeId: "creative-1",
      creativeIds: ["creative-1"],
      creativeCount: 1,
      adId: "ad-1",
      adIds: ["ad-1"],
      adCount: 1,
      adsetId: "set-1",
      adsetIds: ["set-1"],
      adsetCount: 1,
      campaignId: "camp-1",
      campaignIds: ["camp-1"],
      campaignCount: 1,
      accountId: "act_1",
      accountName: null,
      storeId: null,
      storeName: null,
      creativeName: null,
      creativeNames: [],
      type: "IMAGE",
      imageUrl: null,
      previewUrl: null,
      productLink: null,
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      roas: null,
      reach: null,
      addToCart: null,
      frequency: null,
      hookRate: null,
      availability: { frequency: false, reach: false, addToCart: false, hookRate: false, productLink: false },
      hasPerformanceFacts: true,
      factRowCount: 1,
      opsScore: null,
      opsBucket: null,
      opsBucketLabel: "N/A",
      recommendedAction: null,
      diagnosisReason: "N/A",
      fatigueScore: null,
      riskLevel: "N/A",
      latestPerformanceDate: null,
      performanceSyncedAt: null
    };
    const summary: CreativeIntelligenceSummary = {
      performanceCount: 1,
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      roas: null
    };
    const report: CreativeAnalysisReport = {
      success: true,
      cached: false,
      mode: "rule_diagnostic_engine",
      analysisEntityId: row.analysisEntityId,
      scopeHash: "hash",
      dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" },
      coverageStatus: "READY",
      confidence: "full",
      conclusionCategory: "INSUFFICIENT_DATA",
      conclusion: "Insufficient data",
      metrics: summary,
      facts: [],
      riskPoints: [],
      recommendedActions: [],
      warnings: [],
      dataBasis: {
        source: "FactMetaPerformance",
        factLevel: "ad",
        factRows: 1,
        accountId: "act_1",
        storeId: null,
        creativeIds: row.creativeIds,
        adIds: row.adIds,
        campaignIds: row.campaignIds,
        adsetIds: row.adsetIds,
        latestPerformanceDate: null
      }
    };

    expect(report.dataBasis.factLevel).toBe("ad");
    expect(row.aggregationScope).toBe("ACCOUNT_ASSET");
    expect(summary.ctr).toBeNull();
  });
});
