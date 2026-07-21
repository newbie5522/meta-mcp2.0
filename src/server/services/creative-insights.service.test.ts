import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    factMetaPerformance: { count: vi.fn(), findMany: vi.fn() },
    ad: { findMany: vi.fn() },
    adCreative: { findMany: vi.fn() },
    store: { findMany: vi.fn() },
    accountMapping: { findMany: vi.fn() },
    adAccount: { findMany: vi.fn() }
  }
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({
  normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}`
}));

import { getAggregatedCreativeInsights } from "./creative-insights.service";

const ads = [
  { id: "ad-1", adsetId: "set-1", campaignId: "camp-1", accountId: "act_1", name: "Ad 1", creativeId: "creative-1", adSet: null },
  { id: "ad-2", adsetId: "set-2", campaignId: "camp-2", accountId: "act_1", name: "Ad 2", creativeId: "creative-2", adSet: null }
];

const creatives = [
  { creativeId: "creative-1", fbAccountId: "act_1", name: "Creative 1", mediaType: "IMAGE", landingUrl: null, storeId: 1 },
  { creativeId: "creative-2", fbAccountId: "act_1", name: "Creative 2", mediaType: "VIDEO", landingUrl: "https://example.test/product", storeId: 1 }
];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.factMetaPerformance.count.mockResolvedValue(0);
  prismaMock.factMetaPerformance.findMany.mockResolvedValue([]);
  prismaMock.ad.findMany.mockResolvedValue(ads);
  prismaMock.adCreative.findMany.mockResolvedValue(creatives);
  prismaMock.store.findMany.mockResolvedValue([{ id: 1, name: "Store 1" }]);
  prismaMock.accountMapping.findMany.mockResolvedValue([{ storeId: 1, fbAccountId: "act_1" }]);
  prismaMock.adAccount.findMany.mockResolvedValue([{ fb_account_id: "act_1", fb_account_name: "Account 1", storeId: 1 }]);
});

describe("Creative insight fact and structure separation", () => {
  it("keeps structure without facts out of performance rows and buckets", async () => {
    const result = await getAggregatedCreativeInsights({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      includeZeroSpend: true
    });

    expect(result.performanceRows).toEqual([]);
    expect(result.structureOnlyRows).toHaveLength(2);
    expect(result.structureOnlyRows[0]).toMatchObject({
      fatigueScore: null,
      riskLevel: "数据不足",
      opsBucket: null,
      reach: null,
      frequency: null,
      addToCart: null,
      performanceSyncedAt: null
    });
    expect(result.summary.performanceCount).toBe(0);
    expect(result.bucketSummary).toEqual({});
    expect(result.structureSummary).toEqual({
      totalStructureCount: 2,
      structureOnlyCount: 2,
      structureOnlyVisibleCount: 2,
      structureOnlyTotalCount: 2,
      structureOnlyTruncated: false
    });
  });

  it("uses the complete filtered fact set for weighted summary before pagination", async () => {
    prismaMock.factMetaPerformance.count.mockResolvedValue(2);
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      {
        date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: "camp-1", adset_id: "set-1",
        ad_id: "ad-1", entity_id: "ad-1", creative_id: "creative-1", spend: 10, impressions: 100,
        clicks: 10, purchases: 1, purchase_value: 20, raw_payload: null, synced_at: new Date("2026-07-02T00:00:00Z")
      },
      {
        date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: "camp-2", adset_id: "set-2",
        ad_id: "ad-2", entity_id: "ad-2", creative_id: "creative-2", spend: 30, impressions: 300,
        clicks: 15, purchases: 2, purchase_value: 30, raw_payload: null, synced_at: new Date("2026-07-02T00:00:00Z")
      }
    ]);

    const result = await getAggregatedCreativeInsights({
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      includeZeroSpend: true,
      page: 1,
      pageSize: 1
    });

    expect(result.performanceRows).toHaveLength(1);
    expect(result.pagination.total).toBe(2);
    expect(result.summary).toMatchObject({
      performanceCount: 2,
      spend: 40,
      impressions: 400,
      clicks: 25,
      purchases: 3,
      purchaseValue: 50,
      ctr: 6.25,
      cpc: 1.6,
      cpm: 100,
      roas: 1.25
    });
    expect(result.performanceRows[0]).toMatchObject({
      frequency: null,
      frequencyAvailable: false,
      reach: null,
      reachAvailable: false,
      addToCart: null,
      addToCartAvailable: false
    });
  });

  it("treats creativeType and opsBucket all sentinels as case-insensitive", async () => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      {
        date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: "camp-1", adset_id: "set-1",
        ad_id: "ad-1", entity_id: "ad-1", creative_id: "creative-1", spend: 10, impressions: 100,
        clicks: 10, purchases: 1, purchase_value: 20, raw_payload: null, synced_at: new Date("2026-07-02T00:00:00Z")
      }
    ]);

    const result = await getAggregatedCreativeInsights({
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      creativeType: "ALL",
      opsBucket: "all",
      includeZeroSpend: true
    });

    expect(result.performanceRows).toHaveLength(1);
    expect(result.summary).toMatchObject({
      performanceCount: 1,
      spend: 10,
      impressions: 100,
      clicks: 10,
      purchases: 1,
      purchaseValue: 20
    });
  });

  it("exports the complete filtered set and only uses a real landing URL", async () => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue(ads.map((ad, index) => ({
      date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: ad.campaignId, adset_id: ad.adsetId,
      ad_id: ad.id, entity_id: ad.id, creative_id: ad.creativeId, spend: 10 + index, impressions: 100,
      clicks: 10, purchases: 1, purchase_value: 20, raw_payload: null, synced_at: new Date("2026-07-02T00:00:00Z")
    })));

    const result = await getAggregatedCreativeInsights({
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      includeZeroSpend: true,
      pageSize: 1,
      export: true
    });

    expect(result.performanceRows).toHaveLength(2);
    const withoutLink = result.performanceRows.find(row => row.creativeId === "creative-1");
    const withLink = result.performanceRows.find(row => row.creativeId === "creative-2");
    expect(withoutLink).toMatchObject({ productLink: null, productLinkAvailable: false });
    expect(withLink).toMatchObject({ productLink: "https://example.test/product", productLinkAvailable: true });
    expect(result.export).toMatchObject({ requested: true, truncated: false });
  });

  it("does not expose reach for one creative aggregated from multiple ads", async () => {
    prismaMock.ad.findMany.mockResolvedValue([
      { id: "ad-1", adsetId: "set-1", campaignId: "camp-1", accountId: "act_1", name: "Ad 1", creativeId: "creative-1", adSet: null },
      { id: "ad-2", adsetId: "set-2", campaignId: "camp-2", accountId: "act_1", name: "Ad 2", creativeId: "creative-1", adSet: null }
    ]);
    prismaMock.adCreative.findMany.mockResolvedValue([
      { creativeId: "creative-1", fbAccountId: "act_1", name: "Creative 1", mediaType: "IMAGE", landingUrl: null, storeId: 1 }
    ]);
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      {
        date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: "camp-1", adset_id: "set-1",
        ad_id: "ad-1", entity_id: "ad-1", creative_id: "creative-1", spend: 10, impressions: 100,
        clicks: 10, purchases: 1, purchase_value: 20, raw_payload: JSON.stringify({ reach: 80 }), synced_at: new Date("2026-07-02T00:00:00Z")
      },
      {
        date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: "camp-2", adset_id: "set-2",
        ad_id: "ad-2", entity_id: "ad-2", creative_id: "creative-1", spend: 5, impressions: 50,
        clicks: 5, purchases: 0, purchase_value: 0, raw_payload: JSON.stringify({ reach: 40 }), synced_at: new Date("2026-07-02T00:00:00Z")
      }
    ]);

    const result = await getAggregatedCreativeInsights({
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      includeZeroSpend: true
    });

    expect(result.performanceRows).toHaveLength(1);
    expect(result.performanceRows[0]).toMatchObject({
      adCount: 2,
      reach: null,
      reachAvailable: false
    });
  });

  it("keeps bucket summary and filter options based on all matched rows before bucket filtering", async () => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      {
        date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: "camp-1", adset_id: "set-1",
        ad_id: "ad-1", entity_id: "ad-1", creative_id: "creative-1", spend: 40, impressions: 1000,
        clicks: 20, purchases: 2, purchase_value: 100, raw_payload: null, synced_at: new Date("2026-07-02T00:00:00Z")
      },
      {
        date: "2026-07-01", level: "ad", account_id: "act_1", campaign_id: "camp-2", adset_id: "set-2",
        ad_id: "ad-2", entity_id: "ad-2", creative_id: "creative-2", spend: 35, impressions: 1000,
        clicks: 5, purchases: 0, purchase_value: 0, raw_payload: null, synced_at: new Date("2026-07-02T00:00:00Z")
      }
    ]);

    const result = await getAggregatedCreativeInsights({
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      includeZeroSpend: true,
      opsBucket: "scale_candidate"
    });

    expect(result.performanceRows).toHaveLength(1);
    expect(result.performanceRows[0].opsBucket).toBe("scale_candidate");
    expect(result.summary.performanceCount).toBe(1);
    expect(result.bucketSummary).toMatchObject({
      scale_candidate: 1,
      inefficient_stop: 1
    });
    expect(result.filterOptions.accountOptions).toEqual([
      { accountId: "act_1", accountName: "Account 1", storeId: 1 }
    ]);
    expect(result.filterOptions.campaignOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ campaignId: "camp-1" }),
      expect.objectContaining({ campaignId: "camp-2" })
    ]));
  });
});
