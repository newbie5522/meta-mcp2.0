import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    campaign: { findMany: vi.fn() },
    adSet: { findMany: vi.fn() },
    ad: { findMany: vi.fn() },
    factMetaPerformance: { findMany: vi.fn() }
  }
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({ normalizeMetaAccountId: (value: string) => value }));

import { createCreativeAnalyzeHandler, createDataCenterHierarchyHandler } from "./data-center.routes";

function responseMock() {
  const response: any = {
    statusCode: 200,
    body: null,
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    })
  };
  return response;
}

async function invoke(handler: any, query: any) {
  const response = responseMock();
  await handler({ query }, response);
  return response;
}

describe("Data Center canonical hierarchy handlers", () => {
  let getCanonicalAdHierarchy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    getCanonicalAdHierarchy = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: "row-1" }],
      coverage: { status: "READY" }
    });
  });

  it("maps campaigns route params to canonical campaign level and returns service result unchanged", async () => {
    const handler = createDataCenterHierarchyHandler("campaign", { getCanonicalAdHierarchy });
    const response = await invoke(handler, {
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      includeZeroSpend: "true"
    });

    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith({
      level: "campaign",
      accountId: "act_1",
      scope: "current_account",
      campaignId: undefined,
      adsetId: undefined,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      includeZeroSpend: true
    });
    expect(response.body).toEqual({ success: true, data: [{ id: "row-1" }], coverage: { status: "READY" } });
  });

  it("maps adsets route campaignId and includeZeroSpend", async () => {
    const handler = createDataCenterHierarchyHandler("adset", { getCanonicalAdHierarchy });
    await invoke(handler, {
      accountId: "all",
      campaignId: "camp-1",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      includeZeroSpend: "false"
    });

    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith(expect.objectContaining({
      level: "adset",
      accountId: "all",
      scope: "all_accounts",
      campaignId: "camp-1",
      includeZeroSpend: false
    }));
  });

  it("maps ads route adsetId", async () => {
    const handler = createDataCenterHierarchyHandler("ad", { getCanonicalAdHierarchy });
    await invoke(handler, {
      accountId: "act_1",
      adsetId: "set-1",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith(expect.objectContaining({
      level: "ad",
      adsetId: "set-1"
    }));
  });

  it("returns 400 for missing required params and 500 for true errors", async () => {
    const adsets = createDataCenterHierarchyHandler("adset", { getCanonicalAdHierarchy });
    const missing = await invoke(adsets, { accountId: "act_1" });
    expect(missing.statusCode).toBe(400);

    getCanonicalAdHierarchy.mockRejectedValueOnce(new Error("boom"));
    const failed = await invoke(createDataCenterHierarchyHandler("campaign", { getCanonicalAdHierarchy }), { accountId: "act_1" });
    expect(failed.statusCode).toBe(500);
    expect(failed.body.error).toBe("HIERARCHY_CAMPAIGNS_QUERY_FAILED");
  });

  it("does not use route-local Prisma hierarchy aggregation", async () => {
    const handler = createDataCenterHierarchyHandler("campaign", { getCanonicalAdHierarchy });
    await invoke(handler, { accountId: "act_1" });

    expect(prismaMock.campaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.adSet.findMany).not.toHaveBeenCalled();
    expect(prismaMock.ad.findMany).not.toHaveBeenCalled();
    expect(prismaMock.factMetaPerformance.findMany).not.toHaveBeenCalled();
  });
});

describe("Data Center creative analyze handler", () => {
  async function invokeAnalyze(handler: any, body: any, params = { creativeId: "creative-1" }) {
    const response = responseMock();
    await handler({ params, body }, response);
    return response;
  }

  it("CR-ROUTE-06 analyze delegates service with exact scope", async () => {
    const analyzeCreativeScope = vi.fn().mockResolvedValue({
      success: true,
      confidence: "full",
      warnings: []
    });

    const response = await invokeAnalyze(createCreativeAnalyzeHandler({ analyzeCreativeScope }), {
      analysisEntityId: "act_1::asset-a",
      creativeIds: ["creative-1"],
      adIds: ["ad-1"],
      campaignIds: ["camp-1"],
      adsetIds: ["set-1"],
      accountId: "act_1",
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      onlyCached: "true"
    });

    expect(response.statusCode).toBe(200);
    expect(analyzeCreativeScope).toHaveBeenCalledWith({
      analysisEntityId: "act_1::asset-a",
      creativeId: "creative-1",
      creativeIds: ["creative-1"],
      adIds: ["ad-1"],
      campaignIds: ["camp-1"],
      adsetIds: ["set-1"],
      accountId: "act_1",
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      onlyCached: true,
      forceRefresh: false
    });
    expect(response.body).toEqual({ success: true, confidence: "full", warnings: [] });
  });

  it.each([
    ["CR-ROUTE-07 scope error 400", "INVALID_CREATIVE_ANALYSIS_SCOPE", 400],
    ["CR-ROUTE-08 not synced 409", "CREATIVE_ANALYSIS_NOT_SYNCED", 409],
    ["CR-ROUTE-09 no facts 404", "NO_CANONICAL_CREATIVE_FACTS", 404]
  ])("%s", async (_name, code, statusCode) => {
    const error: any = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    const analyzeCreativeScope = vi.fn().mockRejectedValue(error);

    const response = await invokeAnalyze(createCreativeAnalyzeHandler({ analyzeCreativeScope }), {
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.body.error).toBe(code);
  });

  it("CR-ROUTE-10 partial report warning is returned unchanged", async () => {
    const analyzeCreativeScope = vi.fn().mockResolvedValue({
      success: true,
      confidence: "partial",
      warnings: ["当前为部分覆盖，报告按已入库事实降级判断。"]
    });

    const response = await invokeAnalyze(createCreativeAnalyzeHandler({ analyzeCreativeScope }), {
      analysisEntityId: "act_1::asset-a",
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(response.body).toMatchObject({
      confidence: "partial",
      warnings: ["当前为部分覆盖，报告按已入库事实降级判断。"]
    });
  });
});
