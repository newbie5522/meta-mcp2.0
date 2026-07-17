import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, coverageMock } = vi.hoisted(() => ({
  prismaMock: {
    factMetaPerformance: { findMany: vi.fn() },
    campaign: { findMany: vi.fn(), findUnique: vi.fn() },
    adSet: { findMany: vi.fn(), findUnique: vi.fn() },
    ad: { findMany: vi.fn() }
  },
  coverageMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({
  normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}`
}));
vi.mock("./data-coverage.service.js", () => ({ getDataSourceCoverage: coverageMock }));

import { getCanonicalAdHierarchy, mapCanonicalHierarchyToAccountDetails } from "./ad-hierarchy.service";

beforeEach(() => {
  vi.clearAllMocks();
  coverageMock.mockResolvedValue({ status: "READY" });
  prismaMock.factMetaPerformance.findMany.mockResolvedValue([]);
  prismaMock.campaign.findMany.mockResolvedValue([]);
  prismaMock.campaign.findUnique.mockResolvedValue(null);
  prismaMock.adSet.findMany.mockResolvedValue([]);
  prismaMock.adSet.findUnique.mockResolvedValue(null);
  prismaMock.ad.findMany.mockResolvedValue([]);
});

describe("canonical ad hierarchy service", () => {
  it("returns structure-only campaigns with null performance metrics", async () => {
    prismaMock.campaign.findMany.mockResolvedValue([
      { id: "camp-1", name: "Campaign 1", status: "PAUSED" }
    ]);

    const result = await getCanonicalAdHierarchy({
      level: "campaign",
      accountId: "1",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      includeZeroSpend: true
    });

    expect(prismaMock.factMetaPerformance.findMany).toHaveBeenCalledWith({
      where: {
        level: "campaign",
        account_id: { in: ["act_1", "1"] },
        date: { gte: "2026-07-01", lte: "2026-07-03" }
      }
    });
    expect(result.data).toEqual([expect.objectContaining({
      id: "camp-1",
      hasPerformanceFacts: false,
      spend: null,
      impressions: null,
      ctr: null
    })]);
    expect(result.dataHealth).toMatchObject({
      level: "campaign",
      factRows: 0,
      structureRows: 1
    });
  });

  it("maps canonical rows back to the legacy account details response shape", () => {
    const rows = [{
      id: "ad-1",
      campaignId: "camp-1",
      adsetId: "set-1",
      name: "Ad 1",
      creativeId: "creative-1",
      status: "UNKNOWN",
      hasPerformanceFacts: true,
      spend: 10,
      impressions: 100,
      clicks: 5,
      purchases: 1,
      purchase_value: 30
    }];

    expect(mapCanonicalHierarchyToAccountDetails("ad", rows)).toEqual([expect.objectContaining({
      id: "ad-1",
      campaign_id: "camp-1",
      adset_id: "set-1",
      creative_id: "creative-1",
      hasPerformanceFacts: true,
      insights: {
        data: [expect.objectContaining({
          spend: 10,
          impressions: 100,
          clicks: 5,
          actions: [{ action_type: "purchase", value: "1" }]
        })]
      }
    })]);
  });

  it("keeps real zero-spend fact rows as performance facts when includeZeroSpend is true", async () => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      {
        level: "campaign",
        account_id: "act_1",
        campaign_id: "camp-zero",
        entity_id: "camp-zero",
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0
      }
    ]);

    const result = await getCanonicalAdHierarchy({
      level: "campaign",
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      includeZeroSpend: true
    });

    expect(result.data).toEqual([expect.objectContaining({
      id: "camp-zero",
      unsynced: true,
      hasPerformanceFacts: true,
      spend: 0,
      impressions: 0
    })]);
  });

  it("hides zero-spend fact rows when includeZeroSpend is false", async () => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      {
        level: "campaign",
        account_id: "act_1",
        campaign_id: "camp-zero",
        entity_id: "camp-zero",
        spend: 0,
        impressions: 1,
        clicks: 0,
        purchases: 0,
        purchase_value: 0
      }
    ]);

    const result = await getCanonicalAdHierarchy({
      level: "campaign",
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      includeZeroSpend: false
    });

    expect(result.data).toEqual([]);
    expect(result.dataHealth.reason).toBe("FILTER_ZERO_SPEND_HIDDEN");
  });

  it("supports all_accounts without account filtering or fake act_all coverage", async () => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      { level: "campaign", account_id: "act_1", campaign_id: "shared", entity_id: "shared", spend: 10, impressions: 100, clicks: 5, purchases: 1, purchase_value: 20 },
      { level: "campaign", account_id: "act_2", campaign_id: "shared", entity_id: "shared", spend: 20, impressions: 200, clicks: 10, purchases: 2, purchase_value: 60 }
    ]);

    const result = await getCanonicalAdHierarchy({
      level: "campaign",
      accountId: "all",
      scope: "all_accounts",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      includeZeroSpend: true
    });

    expect(prismaMock.factMetaPerformance.findMany).toHaveBeenCalledWith({
      where: {
        level: "campaign",
        date: { gte: "2026-07-01", lte: "2026-07-03" }
      }
    });
    expect(coverageMock).toHaveBeenCalledWith(expect.not.objectContaining({ accountId: "act_all" }));
    expect(result.appliedFilters.accountId).toBe("all");
    expect(result.dataHealth.queryDebug.scope).toBe("all_accounts");
    expect(result.data).toHaveLength(2);
    expect(result.data.map((row: any) => row.accountId).sort()).toEqual(["act_1", "act_2"]);
  });

  it("supports adset level with parent campaign filter and current account act/numeric compatibility", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({ id: "camp-1", name: "Campaign 1" });
    prismaMock.adSet.findMany.mockResolvedValue([
      { id: "set-1", name: "Set 1", campaignId: "camp-1", campaign: { id: "camp-1", accountId: "act_1" } }
    ]);
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      { level: "adset", account_id: "1", campaign_id: "camp-1", adset_id: "set-1", entity_id: "set-1", spend: 10, impressions: 100, clicks: 4, purchases: 1, purchase_value: 30 }
    ]);

    const result = await getCanonicalAdHierarchy({
      level: "adset",
      accountId: "1",
      campaignId: "camp-1",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      includeZeroSpend: true
    });

    expect(prismaMock.factMetaPerformance.findMany).toHaveBeenCalledWith({
      where: {
        level: "adset",
        account_id: { in: ["act_1", "1"] },
        campaign_id: "camp-1",
        date: { gte: "2026-07-01", lte: "2026-07-03" }
      }
    });
    expect(result.data[0]).toMatchObject({
      id: "set-1",
      campaignId: "camp-1",
      campaignName: "Campaign 1",
      hasPerformanceFacts: true
    });
  });

  it("supports ad level with parent adset filter and coverage args", async () => {
    prismaMock.adSet.findUnique.mockResolvedValue({ id: "set-1", name: "Set 1", campaign: { id: "camp-1", name: "Campaign 1", accountId: "act_1" } });
    prismaMock.ad.findMany.mockResolvedValue([
      { id: "ad-1", name: "Ad 1", adsetId: "set-1", creativeId: "creative-1", adSet: { id: "set-1", name: "Set 1", campaign: { id: "camp-1", name: "Campaign 1", accountId: "act_1" } } }
    ]);
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([
      { level: "ad", account_id: "act_1", adset_id: "set-1", ad_id: "ad-1", entity_id: "ad-1", creative_id: "creative-1", spend: 5, impressions: 50, clicks: 2, purchases: 0, purchase_value: 0 }
    ]);

    const result = await getCanonicalAdHierarchy({
      level: "ad",
      accountId: "act_1",
      adsetId: "set-1",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      includeZeroSpend: true
    });

    expect(coverageMock).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "act_1",
      factLevel: "ad",
      adsetId: "set-1"
    }));
    expect(result.data[0]).toMatchObject({
      id: "ad-1",
      adsetId: "set-1",
      adsetName: "Set 1",
      campaignName: "Campaign 1",
      creativeId: "creative-1"
    });
  });
});
