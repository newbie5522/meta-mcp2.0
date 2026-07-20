import { describe, expect, it } from "vitest";
import {
  buildCreativeAiPrompt,
  buildCreativeAnalysisRequest,
  buildCreativeDashboardRequestKey,
  buildCreativeSelectionScopeKey,
  compareNullable,
  isCreativeAiAllowed,
  resolveCreativeFilterCascade,
  resolveCreativeDashboardResponse
} from "./creative-dashboard-orchestrator";
import type { CreativeIntelligenceRow } from "../shared/creative-intelligence-contract";

function row(overrides: Partial<CreativeIntelligenceRow> = {}): CreativeIntelligenceRow {
  return {
    id: "act_1::asset",
    analysisEntityId: "act_1::asset",
    aggregationKey: "asset",
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
    accountName: "Account",
    storeId: 1,
    storeName: "Store",
    creativeName: "Creative",
    creativeNames: ["Creative"],
    type: "IMAGE",
    imageUrl: null,
    previewUrl: null,
    productLink: null,
    spend: 10,
    impressions: 1000,
    clicks: 10,
    purchases: 1,
    purchaseValue: 20,
    ctr: 1,
    cpc: 1,
    cpm: 10,
    cpa: 10,
    roas: 2,
    reach: null,
    addToCart: null,
    frequency: null,
    hookRate: null,
    availability: { frequency: false, reach: false, addToCart: false, hookRate: false, productLink: false },
    hasPerformanceFacts: true,
    factRowCount: 1,
    opsScore: null,
    opsBucket: "watching",
    opsBucketLabel: "Watch",
    recommendedAction: "Observe",
    diagnosisReason: "Facts",
    fatigueScore: null,
    riskLevel: "Rule risk",
    latestPerformanceDate: "2026-07-07",
    performanceSyncedAt: "2026-07-08T00:00:00Z",
    ...overrides
  };
}

describe("creative dashboard orchestrator", () => {
  it("CR-ORCH-01/02 rejects missing or mismatched dates", () => {
    expect(resolveCreativeDashboardResponse({ dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } }, "", "2026-07-07").performanceRows).toEqual([]);
    expect(resolveCreativeDashboardResponse({ dateRange: { startDate: "2026-06-01", endDate: "2026-06-07" } }, "2026-07-01", "2026-07-07").performanceRows).toEqual([]);
  });

  it("CR-ORCH-03/04 resolves ready and partial snapshots atomically", () => {
    const ready = resolveCreativeDashboardResponse({
      coverage: { status: "READY" },
      dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" },
      performanceRows: [row()],
      summary: { spend: 10 },
      filterOptions: { accountOptions: [{ accountId: "act_1" }] }
    }, "2026-07-01", "2026-07-07");
    expect(ready.performanceRows).toHaveLength(1);

    const partial = resolveCreativeDashboardResponse({
      coverage: { status: "PARTIAL_COVERAGE" },
      dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" },
      performanceRows: [row()]
    }, "2026-07-01", "2026-07-07");
    expect(partial.notice).toContain("Partial coverage");
  });

  it("CR-ORCH-05/06/07 applies unavailable coverage states", () => {
    expect(resolveCreativeDashboardResponse({ coverage: { status: "NOT_SYNCED" }, structureOnlyRows: [row({ hasPerformanceFacts: false })], dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } }, "2026-07-01", "2026-07-07").performanceRows).toEqual([]);
    expect(resolveCreativeDashboardResponse({ coverage: { status: "TRUE_EMPTY" }, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } }, "2026-07-01", "2026-07-07").summary).toMatchObject({
      performanceCount: 0,
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
    });
    expect(resolveCreativeDashboardResponse({ coverage: { status: "ERROR" }, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } }, "2026-07-01", "2026-07-07").structureOnlyRows).toEqual([]);
  });

  it("CR-ORCH-08~11 gates AI by facts and coverage", () => {
    expect(isCreativeAiAllowed(row(), { status: "READY" })).toMatchObject({ allowed: true, confidence: "full" });
    expect(isCreativeAiAllowed(row(), { status: "PARTIAL_COVERAGE" })).toMatchObject({ allowed: true, confidence: "partial" });
    expect(isCreativeAiAllowed(row({ hasPerformanceFacts: false }), { status: "READY" }).allowed).toBe(false);
    expect(isCreativeAiAllowed(row(), { status: "NOT_SYNCED" }).allowed).toBe(false);
  });

  it("CR-ORCH-12 builds scoped AI request and prompt with N/A for unavailable metrics", () => {
    const inputRow = row({ ctr: null, cpc: null, availability: { frequency: false, reach: false, addToCart: false, hookRate: false, productLink: false } });
    const request = buildCreativeAnalysisRequest(inputRow, { startDate: "2026-07-01", endDate: "2026-07-07" });
    expect(request).toMatchObject({
      analysisEntityId: "act_1::asset",
      accountId: "act_1",
      adIds: ["ad-1"],
      creativeIds: ["creative-1"]
    });
    const prompt = buildCreativeAiPrompt(inputRow, { coverage: { status: "READY" }, confidence: "full", startDate: "2026-07-01", endDate: "2026-07-07" });
    expect(prompt).toContain("CTR=N/A");
    expect(prompt).toContain("Reach=N/A");
  });

  it("request key excludes modal and local preview state", () => {
    const key = buildCreativeDashboardRequestKey({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      storeId: "all",
      accountId: "act_1",
      campaignId: "camp-1",
      adsetId: "set-1",
      page: 2,
      pageSize: 25
    });
    expect(key).toContain("adsetId:set-1");
    expect(key).not.toContain("modal");
    expect(key).not.toContain("preview");
  });

  it("PAGE-09~12 selection scope key changes only for business scope inputs", () => {
    const base = {
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      storeId: "all",
      accountId: "act_1",
      campaignId: "camp-1",
      adsetId: "set-1",
      type: "IMAGE",
      bucket: "watching",
      search: "hook"
    };
    const key = buildCreativeSelectionScopeKey(base);
    expect(buildCreativeSelectionScopeKey({ ...base, storeId: 2 })).not.toBe(key);
    expect(buildCreativeSelectionScopeKey({ ...base, campaignId: "camp-2" })).not.toBe(key);
    expect(buildCreativeSelectionScopeKey({ ...base, adsetId: "set-2" })).not.toBe(key);
    expect(key).not.toContain("pageNumber");
    expect(key).not.toContain("sortBy");
  });

  it("PAGE-13 filter cascade clears downstream selections", () => {
    expect(resolveCreativeFilterCascade({ changed: "store", nextValue: "2" })).toMatchObject({
      storeId: "2",
      accountId: "all",
      campaignId: "all",
      adsetId: "all",
      page: 1
    });
    expect(resolveCreativeFilterCascade({ changed: "account", nextValue: "act_2" })).toMatchObject({
      accountId: "act_2",
      campaignId: "all",
      adsetId: "all",
      page: 1
    });
    expect(resolveCreativeFilterCascade({ changed: "campaign", nextValue: "camp-2" })).toMatchObject({
      campaignId: "camp-2",
      adsetId: "all",
      page: 1
    });
  });

  it("PAGE-14 nullable sort keeps null last and treats zero as a real value", () => {
    expect(compareNullable(null, 0, "desc")).toBe(1);
    expect(compareNullable(0, null, "desc")).toBe(-1);
    expect(compareNullable(0, 2, "desc")).toBeGreaterThan(0);
    expect(compareNullable(0, 2, "asc")).toBeLessThan(0);
  });
});
