import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    syncLog: { findMany: vi.fn() },
    accountMapping: { findMany: vi.fn() },
    adAccount: { findMany: vi.fn() },
    factMetaPerformance: {
      count: vi.fn(),
      findFirst: vi.fn()
    },
    dataCenterMetaAccountDaily: { count: vi.fn(), findFirst: vi.fn() },
    factAudienceBreakdown: { count: vi.fn(), findFirst: vi.fn() },
    dataCenterStoreDaily: { count: vi.fn(), findFirst: vi.fn() },
    order: { count: vi.fn(), findFirst: vi.fn() }
  }
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({
  normalizeMetaAccountId: (value: string) => value?.startsWith("act_") ? value : `act_${value}`
}));

import { buildCoverageScopeKey, getDataSourceCoverage } from "./data-coverage.service";

function mockMetaCreativeFacts() {
  prismaMock.factMetaPerformance.count.mockResolvedValue(1);
  prismaMock.factMetaPerformance.findFirst.mockImplementation((args: any) => {
    if (args.orderBy?.date === "asc") return Promise.resolve({ date: "2026-07-01" });
    if (args.orderBy?.date === "desc") return Promise.resolve({ date: "2026-07-07" });
    if (args.orderBy?.synced_at === "desc") return Promise.resolve({ synced_at: new Date("2026-07-08T00:00:00Z") });
    return Promise.resolve(null);
  });
}

describe("data coverage service factLevel receipt contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.syncLog.findMany.mockResolvedValue([]);
    prismaMock.accountMapping.findMany.mockResolvedValue([]);
    prismaMock.adAccount.findMany.mockResolvedValue([]);
    mockMetaCreativeFacts();
  });

  it("COV-SVC-01 buildCoverageScopeKey includes fact level", () => {
    expect(buildCoverageScopeKey({ factLevel: "campaign", campaignId: "camp-1" }))
      .toContain("level:campaign");
  });

  it("COV-SVC-02 ad-level receipt does not prove campaign-level readiness", async () => {
    prismaMock.syncLog.findMany.mockResolvedValue([{
      id: "log-ad",
      taskType: "sync_meta_insights",
      status: "success",
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-07",
      finishedAt: new Date("2026-07-08T00:00:00Z"),
      metadata: JSON.stringify({
        scopeKey: buildCoverageScopeKey({ factLevel: "ad" }),
        coverageComplete: true
      })
    }]);

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "campaign"
    });

    expect(coverage.status).toBe("PARTIAL_COVERAGE");
    expect(coverage.coverageComplete).toBe(false);
  });

  it("COV-SVC-03 matching factLevel receipt can prove READY", async () => {
    prismaMock.syncLog.findMany.mockResolvedValue([{
      id: "log-campaign",
      taskType: "sync_meta_insights",
      status: "success",
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-07",
      recordsFetched: 1,
      recordsSaved: 1,
      finishedAt: new Date("2026-07-08T00:00:00Z"),
      metadata: JSON.stringify({
        scopeKey: buildCoverageScopeKey({ factLevel: "campaign" }),
        coverageComplete: true,
        levelCounts: { campaign: 1 }
      })
    }]);

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "campaign"
    });

    expect(coverage.status).toBe("READY");
    expect(coverage.coverageComplete).toBe(true);
  });

  it("COV-SVC-04 missing factLevel evidence cannot prove concrete level READY", async () => {
    prismaMock.syncLog.findMany.mockResolvedValue([{
      id: "log-missing-level",
      taskType: "sync_meta_insights",
      status: "success",
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-07",
      finishedAt: new Date("2026-07-08T00:00:00Z"),
      metadata: JSON.stringify({
        coverageComplete: true
      })
    }]);

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "campaign"
    });

    expect(coverage.status).toBe("PARTIAL_COVERAGE");
  });
});
