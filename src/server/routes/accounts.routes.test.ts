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
vi.mock("../utils.js", () => ({
  getMetaToken: vi.fn(),
  normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}`
}));

import { createAccountDetailsHandler, normalizeDetailsLevel } from "./accounts.routes";

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

async function invoke(handler: any, params: any, query: any = {}) {
  const response = responseMock();
  await handler({ params, query }, response);
  return response;
}

describe("account details canonical hierarchy routing", () => {
  let getCanonicalAdHierarchy: any;
  let mapCanonicalHierarchyToAccountDetails: any;
  let handler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    getCanonicalAdHierarchy = vi.fn().mockResolvedValue({
      data: [{ id: "row-1" }],
      coverage: { status: "READY" },
      sourceCoverage: { status: "READY" },
      dataHealth: { status: "READY" },
      dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" },
      appliedFilters: { accountId: "act_1", campaignId: "all", adsetId: "all", adId: "all" }
    });
    mapCanonicalHierarchyToAccountDetails = vi.fn((_level, rows) => rows.map((row: any) => ({
      id: row.id,
      insights: { data: [{ spend: 1 }] }
    })));
    handler = createAccountDetailsHandler({ getCanonicalAdHierarchy, mapCanonicalHierarchyToAccountDetails });
  });

  it("normalizes legacy details level names to canonical hierarchy levels", () => {
    expect(normalizeDetailsLevel("campaigns")).toBe("campaign");
    expect(normalizeDetailsLevel("adsets")).toBe("adset");
    expect(normalizeDetailsLevel("ads")).toBe("ad");
    expect(normalizeDetailsLevel("unknown")).toBeNull();
  });

  it("routes a specific account campaign request to canonical current_account", async () => {
    const response = await invoke(handler, { accountId: "act_1" }, { level: "campaign", startDate: "2026-07-01", endDate: "2026-07-07" });

    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith(expect.objectContaining({
      level: "campaign",
      accountId: "act_1",
      scope: "current_account",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    }));
    expect(response.body).toMatchObject({ coverage: { status: "READY" } });
    expect(response.body).not.toHaveProperty("isFallbackCached");
  });

  it("normalizes numeric accounts before calling canonical service", async () => {
    await invoke(handler, { accountId: "123" }, { level: "campaigns" });
    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith(expect.objectContaining({ accountId: "act_123", scope: "current_account" }));
  });

  it("routes all campaign and all_active adset requests to all_accounts", async () => {
    await invoke(handler, { accountId: "all" }, { level: "campaigns" });
    await invoke(handler, { accountId: "all_active" }, { level: "adsets" });

    expect(getCanonicalAdHierarchy).toHaveBeenNthCalledWith(1, expect.objectContaining({ level: "campaign", accountId: "all", scope: "all_accounts" }));
    expect(getCanonicalAdHierarchy).toHaveBeenNthCalledWith(2, expect.objectContaining({ level: "adset", accountId: "all", scope: "all_accounts" }));
  });

  it("routes specific account ads and passes includeZeroSpend", async () => {
    await invoke(handler, { accountId: "act_1" }, { level: "ads", includeZeroSpend: "true" });
    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith(expect.objectContaining({
      level: "ad",
      includeZeroSpend: true
    }));
  });

  it("passes single campaignId, adsetId, and adId filters to canonical service", async () => {
    await invoke(handler, { accountId: "act_1" }, { level: "campaigns", campaignId: "camp-1" });
    await invoke(handler, { accountId: "act_1" }, { level: "adsets", adsetId: "set-1" });
    await invoke(handler, { accountId: "act_1" }, { level: "ads", adId: "ad-1" });

    expect(getCanonicalAdHierarchy).toHaveBeenNthCalledWith(1, expect.objectContaining({ campaignId: "camp-1" }));
    expect(getCanonicalAdHierarchy).toHaveBeenNthCalledWith(2, expect.objectContaining({ adsetId: "set-1" }));
    expect(getCanonicalAdHierarchy).toHaveBeenNthCalledWith(3, expect.objectContaining({ adId: "ad-1" }));
  });

  it("rejects comma-separated or array parent filters with MULTI_PARENT_FILTER_UNSUPPORTED", async () => {
    const comma = await invoke(handler, { accountId: "act_1" }, { level: "campaigns", campaignId: "camp-1,camp-2" });
    const array = await invoke(handler, { accountId: "act_1" }, { level: "adsets", adsetId: ["set-1", "set-2"] });

    expect(comma.statusCode).toBe(400);
    expect(array.statusCode).toBe(400);
    expect(comma.body.error).toBe("MULTI_PARENT_FILTER_UNSUPPORTED");
    expect(array.body.error).toBe("MULTI_PARENT_FILTER_UNSUPPORTED");
    expect(getCanonicalAdHierarchy).not.toHaveBeenCalled();
  });

  it("returns 400 for unknown level and 500 for true service errors", async () => {
    const badLevel = await invoke(handler, { accountId: "act_1" }, { level: "nope" });
    expect(badLevel.statusCode).toBe(400);

    getCanonicalAdHierarchy.mockRejectedValueOnce(new Error("boom"));
    const failed = await invoke(handler, { accountId: "act_1" }, { level: "campaigns" });
    expect(failed.statusCode).toBe(500);
    expect(failed.body.error).toBe("Failed to fetch account level details");
  });

  it("preserves coverage/sourceCoverage/dataHealth/dateRange and mapper legacy shape", async () => {
    const response = await invoke(handler, { accountId: "act_1" }, { level: "campaigns" });

    expect(mapCanonicalHierarchyToAccountDetails).toHaveBeenCalledWith("campaign", [{ id: "row-1" }]);
    expect(response.body).toMatchObject({
      data: [{ id: "row-1", insights: { data: [{ spend: 1 }] } }],
      coverage: { status: "READY" },
      sourceCoverage: { status: "READY" },
      dataHealth: { status: "READY" },
      dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" },
      appliedFilters: { accountId: "act_1", campaignId: "all", adsetId: "all", adId: "all" }
    });
    expect(response.body).not.toHaveProperty("isFallbackCached");
  });

  it("does not use route-local Prisma hierarchy aggregation", async () => {
    await invoke(handler, { accountId: "act_1" }, { level: "campaigns" });

    expect(prismaMock.campaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.adSet.findMany).not.toHaveBeenCalled();
    expect(prismaMock.ad.findMany).not.toHaveBeenCalled();
    expect(prismaMock.factMetaPerformance.findMany).not.toHaveBeenCalled();
  });
});
