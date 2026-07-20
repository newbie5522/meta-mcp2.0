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

function mockNoMetaCreativeFacts() {
  prismaMock.factMetaPerformance.count.mockResolvedValue(0);
  prismaMock.factMetaPerformance.findFirst.mockResolvedValue(null);
}

function mockCompleteZeroReceipt(factLevel: "campaign" | "adset" | "ad", levelCounts: Record<string, number>) {
  prismaMock.syncLog.findMany.mockResolvedValue([{
    id: `log-${factLevel}-zero`,
    taskType: "sync_meta_insights",
    status: "success",
    rangeStart: "2026-07-01",
    rangeEnd: "2026-07-07",
    recordsFetched: 0,
    recordsSaved: 0,
    finishedAt: new Date("2026-07-08T00:00:00Z"),
    metadata: JSON.stringify({
      scopeKey: buildCoverageScopeKey({ factLevel }),
      coverageComplete: true,
      levelCounts
    })
  }]);
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
  }, 15000);

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

  it("CARRY-COV-01 campaign:0 proves campaign level executed", async () => {
    mockNoMetaCreativeFacts();
    mockCompleteZeroReceipt("campaign", { campaign: 0 });

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "campaign"
    });

    expect(coverage.status).toBe("TRUE_EMPTY");
    expect(coverage.coverageComplete).toBe(true);
  });

  it("CARRY-COV-02 adset:0 proves adset level executed", async () => {
    mockNoMetaCreativeFacts();
    mockCompleteZeroReceipt("adset", { adset: 0 });

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "adset"
    });

    expect(coverage.status).toBe("TRUE_EMPTY");
    expect(coverage.coverageComplete).toBe(true);
  });

  it("CARRY-COV-03 ad:0 proves ad level executed", async () => {
    mockNoMetaCreativeFacts();
    mockCompleteZeroReceipt("ad", { ad: 0 });

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "ad"
    });

    expect(coverage.status).toBe("TRUE_EMPTY");
    expect(coverage.coverageComplete).toBe(true);
  });

  it("CARRY-COV-04 exact complete zero receipt resolves TRUE_EMPTY", async () => {
    mockNoMetaCreativeFacts();
    mockCompleteZeroReceipt("campaign", { account: 12, campaign: 0, adset: 3, ad: 9 });

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "campaign"
    });

    expect(coverage).toMatchObject({
      status: "TRUE_EMPTY",
      coverageBasis: "EXACT_EMPTY_SYNC_RECEIPT",
      rangeRowCount: 0
    });
  });

  it("CARRY-COV-05 missing level key cannot prove readiness", async () => {
    mockNoMetaCreativeFacts();
    prismaMock.syncLog.findMany.mockResolvedValue([{
      id: "log-missing-campaign-zero",
      taskType: "sync_meta_insights",
      status: "success",
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-07",
      recordsFetched: 0,
      recordsSaved: 0,
      finishedAt: new Date("2026-07-08T00:00:00Z"),
      metadata: JSON.stringify({
        scopeKey: buildCoverageScopeKey({}),
        coverageComplete: true,
        levelCounts: { ad: 0 }
      })
    }]);

    const coverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      factLevel: "campaign"
    });

    expect(coverage.status).toBe("NOT_SYNCED");
    expect(coverage.coverageComplete).toBe(false);
  });
});
