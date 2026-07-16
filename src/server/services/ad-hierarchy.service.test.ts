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
});
