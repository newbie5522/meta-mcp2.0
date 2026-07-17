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

import { createDataCenterHierarchyHandler } from "./data-center.routes";

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
