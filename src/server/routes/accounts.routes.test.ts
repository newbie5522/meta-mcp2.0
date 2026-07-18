import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, axiosMock, getMetaTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    adAccount: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    accountMapping: { findFirst: vi.fn() },
    campaign: { findMany: vi.fn() },
    adSet: { findMany: vi.fn() },
    ad: { findMany: vi.fn() },
    factMetaPerformance: { findMany: vi.fn() },
    setting: { findUnique: vi.fn(), upsert: vi.fn() },
    syncLog: { create: vi.fn() },
    store: { findMany: vi.fn() }
  },
  axiosMock: { get: vi.fn() },
  getMetaTokenMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("axios", () => ({ default: axiosMock }));
vi.mock("../utils.js", () => ({
  getMetaToken: getMetaTokenMock,
  normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}`
}));

import router, { createAccountDetailsHandler, createAccountListHandler, normalizeDetailsLevel } from "./accounts.routes";

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

function routeHandler(method: string, path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  return layer?.route?.stack?.[0]?.handle;
}

async function invokeRoute(handler: any) {
  const response = responseMock();
  await handler({ body: {}, query: {}, params: {} }, response);
  return response;
}

function setupActiveListSync(limit = "2") {
  getMetaTokenMock.mockResolvedValue("token");
  prismaMock.setting.findUnique.mockImplementation(({ where }: any) => {
    if (where.key === "META_AD_ACCOUNTS_SYNC_LIMIT") return Promise.resolve({ value: limit });
    if (where.key === "META_AD_ACCOUNTS_ACTIVE_LAST_DAYS") return Promise.resolve({ value: "90" });
    return Promise.resolve(null);
  });
  prismaMock.setting.upsert.mockResolvedValue({});
  prismaMock.syncLog.create.mockResolvedValue({});
  prismaMock.adAccount.findUnique.mockResolvedValue(null);
  prismaMock.accountMapping.findFirst.mockResolvedValue(null);
  prismaMock.adAccount.upsert.mockResolvedValue({});
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

  it("maps hierarchy parent scope mismatch to 404", async () => {
    const error: any = new Error("campaign foreign-camp does not belong to the requested account scope");
    error.code = "HIERARCHY_PARENT_SCOPE_MISMATCH";
    error.statusCode = 404;
    getCanonicalAdHierarchy.mockRejectedValueOnce(error);

    const response = await invoke(handler, { accountId: "act_1" }, { level: "adsets", campaignId: "foreign-camp" });
    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({
      error: "HIERARCHY_PARENT_SCOPE_MISMATCH"
    });
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

  it("AD-LIST-01 default list only recentActivity90d", async () => {
    prismaMock.adAccount.findMany.mockResolvedValueOnce([
      { fb_account_id: "act_1", fb_account_name: "Recent", recentActivity90d: true }
    ]);
    const listHandler = createAccountListHandler({ prisma: prismaMock as any });
    const response = await invoke(listHandler, {}, {});

    expect(prismaMock.adAccount.findMany).toHaveBeenCalledWith({
      where: { recentActivity90d: true },
      orderBy: { updatedAt: "desc" }
    });
    expect(response.body).toEqual([
      { accountId: "act_1", accountName: "Recent", recentActivity90d: true }
    ]);
  });

  it("AD-LIST-02 includeHistorical true returns history", async () => {
    prismaMock.adAccount.findMany.mockResolvedValueOnce([
      { fb_account_id: "act_old", fb_account_name: "Old", recentActivity90d: false }
    ]);
    const listHandler = createAccountListHandler({ prisma: prismaMock as any });
    const response = await invoke(listHandler, {}, { includeHistorical: "true" });

    expect(prismaMock.adAccount.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { updatedAt: "desc" }
    });
    expect(response.body).toEqual([
      { accountId: "act_old", accountName: "Old", recentActivity90d: false }
    ]);
  });

  it("RC-07 marks PARTIAL_SUCCESS when fetched page overshoots sync limit", async () => {
    setupActiveListSync("2");
    axiosMock.get.mockImplementation((url: string) => {
      if (String(url).includes("/me/adaccounts")) {
        return Promise.resolve({ data: { data: [
          { id: "act_1", name: "A", account_status: 1 },
          { id: "act_2", name: "B", account_status: 1 },
          { id: "act_3", name: "C", account_status: 1 }
        ] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const response = await invokeRoute(routeHandler("post", "/active-list/sync"));

    expect(response.body.status).toBe("PARTIAL_SUCCESS");
    expect(response.body.truncated).toBe(true);
    expect(response.body.recordsFetched).toBe(2);
    expect(prismaMock.syncLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PARTIAL_SUCCESS" })
    }));
  });

  it("RC-07 marks PARTIAL_SUCCESS when next page exists at exact sync limit", async () => {
    setupActiveListSync("2");
    axiosMock.get.mockImplementation((url: string) => {
      if (String(url).includes("/me/adaccounts")) {
        return Promise.resolve({ data: { data: [
          { id: "act_1", name: "A", account_status: 1 },
          { id: "act_2", name: "B", account_status: 1 }
        ], paging: { next: "https://graph.facebook.com/next-page" } } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const response = await invokeRoute(routeHandler("post", "/active-list/sync"));

    expect(response.body.status).toBe("PARTIAL_SUCCESS");
    expect(response.body.truncated).toBe(true);
  });

  it("RC-07 keeps SUCCESS when result exactly equals sync limit with no next page", async () => {
    setupActiveListSync("2");
    axiosMock.get.mockImplementation((url: string) => {
      if (String(url).includes("/me/adaccounts")) {
        return Promise.resolve({ data: { data: [
          { id: "act_1", name: "A", account_status: 1 },
          { id: "act_2", name: "B", account_status: 1 }
        ] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const response = await invokeRoute(routeHandler("post", "/active-list/sync"));

    expect(response.body.status).toBe("SUCCESS");
    expect(response.body.truncated).toBe(false);
    expect(prismaMock.syncLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SUCCESS" })
    }));
  });

  it("RC-07 rate limit keeps response and SyncLog status in PARTIAL_SUCCESS", async () => {
    setupActiveListSync("2");
    axiosMock.get.mockImplementation((url: string) => {
      if (String(url).includes("/me/adaccounts")) {
        return Promise.resolve({ data: { data: [{ id: "act_1", name: "A", account_status: 1 }] } });
      }
      return Promise.reject({ response: { data: { error: { code: 17, message: "rate limit" } } } });
    });

    const response = await invokeRoute(routeHandler("post", "/active-list/sync"));

    expect(response.body.status).toBe("PARTIAL_SUCCESS");
    expect(response.body.rateLimited).toBe(true);
    expect(prismaMock.syncLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: response.body.status })
    }));
  });
});
