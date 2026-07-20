import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, coverageMock } = vi.hoisted(() => ({
  prismaMock: {
    factMetaPerformance: { findMany: vi.fn() },
    aiAnalysisReport: { findFirst: vi.fn(), create: vi.fn() }
  },
  coverageMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({
  normalizeMetaAccountId: (value: string) => value?.startsWith("act_") ? value : `act_${value}`
}));
vi.mock("./data-coverage.service.js", () => ({
  getDataSourceCoverage: coverageMock
}));

import { analyzeCreativeScope, buildCreativeAnalysisScopeHash } from "./creative-analysis.service";

const baseRequest = {
  analysisEntityId: "act_1::asset-a",
  creativeId: "creative-1",
  creativeIds: ["creative-1"],
  adIds: ["ad-1"],
  campaignIds: ["camp-1"],
  adsetIds: ["set-1"],
  accountId: "1",
  storeId: 1,
  startDate: "2026-07-01",
  endDate: "2026-07-07"
};

const fact = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-07-02",
  level: "ad",
  account_id: "act_1",
  campaign_id: "camp-1",
  adset_id: "set-1",
  ad_id: "ad-1",
  entity_id: "ad-1",
  creative_id: "creative-1",
  spend: 20,
  impressions: 1000,
  clicks: 50,
  purchases: 2,
  purchase_value: 40,
  synced_at: new Date("2026-07-08T00:00:00Z"),
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  coverageMock.mockResolvedValue({ status: "READY" });
  prismaMock.factMetaPerformance.findMany.mockResolvedValue([fact()]);
  prismaMock.aiAnalysisReport.findFirst.mockResolvedValue(null);
  prismaMock.aiAnalysisReport.create.mockResolvedValue({});
});

describe("creative analysis service", () => {
  it("CR-AI-SVC-01 exact Account only and CR-AI-SVC-02 exact Ad/Creative only", async () => {
    await analyzeCreativeScope(baseRequest);

    expect(coverageMock).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "act_1",
      storeId: 1,
      factLevel: "ad"
    }));
    expect(prismaMock.factMetaPerformance.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        level: "ad",
        account_id: { in: ["act_1", "1"] },
        OR: expect.arrayContaining([
          { ad_id: { in: ["ad-1"] } },
          { entity_id: { in: ["ad-1"] } },
          { creative_id: { in: ["creative-1"] } }
        ])
      })
    });
  });

  it("CR-AI-SVC-03 applies Campaign and AdSet restrictions", async () => {
    await analyzeCreativeScope(baseRequest);

    expect(prismaMock.factMetaPerformance.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        campaign_id: { in: ["camp-1"] },
        adset_id: { in: ["set-1"] }
      })
    });
  });

  it("CR-AI-SVC-04 READY produces full confidence report", async () => {
    const report = await analyzeCreativeScope(baseRequest);

    expect(report).toMatchObject({
      success: true,
      cached: false,
      confidence: "full",
      coverageStatus: "READY",
      dataBasis: { source: "FactMetaPerformance", factLevel: "ad", factRows: 1 }
    });
  });

  it("CR-AI-SVC-05 PARTIAL produces partial warning", async () => {
    coverageMock.mockResolvedValue({ status: "PARTIAL_COVERAGE" });

    const report = await analyzeCreativeScope(baseRequest);

    expect(report).toMatchObject({
      confidence: "partial",
      coverageStatus: "PARTIAL_COVERAGE"
    });
    expect("warnings" in report && report.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    ["CR-AI-SVC-06 NOT_SYNCED blocked", "NOT_SYNCED", "CREATIVE_ANALYSIS_NOT_SYNCED", 409],
    ["CR-AI-SVC-07 RUNNING blocked", "SYNC_RUNNING", "CREATIVE_ANALYSIS_SYNC_RUNNING", 409],
    ["CR-AI-SVC-08 TRUE_EMPTY no facts", "TRUE_EMPTY", "NO_CANONICAL_CREATIVE_FACTS", 404]
  ])("%s", async (_name, status, code, statusCode) => {
    coverageMock.mockResolvedValue({ status });
    if (status === "TRUE_EMPTY") prismaMock.factMetaPerformance.findMany.mockResolvedValue([]);

    await expect(analyzeCreativeScope(baseRequest)).rejects.toMatchObject({ code, statusCode });
  });

  it.each([
    ["CR-AI-SVC-09 real zero → INSUFFICIENT_DATA", fact({ spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0 }), "INSUFFICIENT_DATA"],
    ["CR-AI-SVC-10 SCALE", fact({ spend: 20, purchases: 1, purchase_value: 40 }), "SCALE"],
    ["CR-AI-SVC-11 STOP", fact({ spend: 30, purchases: 0, purchase_value: 0 }), "STOP"],
    ["CR-AI-SVC-12 REDUCE", fact({ spend: 20, purchases: 1, purchase_value: 10 }), "REDUCE"],
    ["CR-AI-SVC-13 WATCH", fact({ spend: 15, impressions: 1500, purchases: 0, purchase_value: 0 }), "WATCH"]
  ])("%s", async (_name, row, conclusionCategory) => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([row]);

    const report = await analyzeCreativeScope(baseRequest);

    expect(report).toMatchObject({ conclusionCategory });
  });

  it("CR-AI-SVC-14 exact scopeHash cache and CR-AI-SVC-15 old unscoped cache ignored", async () => {
    const matchingHash = buildCreativeAnalysisScopeHash({
      analysisEntityId: baseRequest.analysisEntityId,
      accountId: "act_1",
      storeId: 1,
      startDate: baseRequest.startDate,
      endDate: baseRequest.endDate,
      creativeIds: ["creative-1"],
      adIds: ["ad-1"],
      campaignIds: ["camp-1"],
      adsetIds: ["set-1"],
      latestPerformanceDate: "2026-07-02",
      latestSyncedAt: "2026-07-08T00:00:00.000Z",
      factRows: 1
    });
    prismaMock.aiAnalysisReport.findFirst.mockResolvedValueOnce({
      metadata: JSON.stringify({
        scopeHash: "old-unscoped",
        report: { success: true, cached: false, analysisEntityId: baseRequest.analysisEntityId }
      })
    });

    const generated = await analyzeCreativeScope({ ...baseRequest, onlyCached: true });
    expect(generated).toEqual({ success: true, cached: false, report: null });

    prismaMock.aiAnalysisReport.findFirst.mockResolvedValueOnce({
      metadata: JSON.stringify({
        scopeHash: matchingHash,
        report: { success: true, cached: false, analysisEntityId: baseRequest.analysisEntityId, scopeHash: matchingHash }
      })
    });

    const cached = await analyzeCreativeScope({ ...baseRequest, onlyCached: true });
    expect(cached).toMatchObject({ cached: true, scopeHash: matchingHash });
  });

  it("CR-AI-SVC-16 sync change invalidates cache", async () => {
    const staleHash = buildCreativeAnalysisScopeHash({
      analysisEntityId: baseRequest.analysisEntityId,
      accountId: "act_1",
      storeId: 1,
      startDate: baseRequest.startDate,
      endDate: baseRequest.endDate,
      creativeIds: ["creative-1"],
      adIds: ["ad-1"],
      campaignIds: ["camp-1"],
      adsetIds: ["set-1"],
      latestPerformanceDate: "2026-07-01",
      latestSyncedAt: "2026-07-08T00:00:00.000Z",
      factRows: 1
    });
    prismaMock.aiAnalysisReport.findFirst.mockResolvedValue({
      metadata: JSON.stringify({
        scopeHash: staleHash,
        report: { success: true, cached: false, scopeHash: staleHash }
      })
    });

    const report = await analyzeCreativeScope(baseRequest);

    expect(report).toMatchObject({ cached: false });
    expect(prismaMock.aiAnalysisReport.create).toHaveBeenCalled();
  });

  it("CR-AI-SVC-17 report has conclusion/facts/risks/actions", async () => {
    prismaMock.factMetaPerformance.findMany.mockResolvedValue([fact({ spend: 35, purchases: 0, purchase_value: 0 })]);

    const report = await analyzeCreativeScope(baseRequest);
    if ("report" in report) throw new Error("Expected generated report");

    expect(report.conclusion).toContain("STOP");
    expect(report.facts.length).toBeGreaterThan(0);
    expect(report.riskPoints.length).toBeGreaterThan(0);
    expect(report.recommendedActions).toEqual(expect.arrayContaining(["暂停观察"]));
  });
});
