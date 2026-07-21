import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, axiosGet } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  prismaMock: {
    syncLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    store: { findUnique: vi.fn(), update: vi.fn() },
    order: { count: vi.fn() },
    product: { count: vi.fn() },
    adAccount: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    campaign: { upsert: vi.fn() },
    adSet: { upsert: vi.fn(), findUnique: vi.fn() },
    ad: { upsert: vi.fn() },
    adCreative: { findUnique: vi.fn(), create: vi.fn() }
  }
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));
vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({
  getMetaToken: vi.fn().mockResolvedValue("token"),
  normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}`
}));
vi.mock("./meta-hierarchy-sync.service.js", () => ({ ensureAdAccounts: vi.fn() }));
vi.mock("./meta-insights.service.js", () => ({ syncMetaInsightsForActiveAccounts: vi.fn() }));
vi.mock("./meta-audience-breakdown-sync.service.js", () => ({ syncMetaAudienceBreakdown: vi.fn() }));
vi.mock("./store-sync.service.js", () => ({ syncStoreData: vi.fn() }));
vi.mock("./store-timezone.service.js", () => ({ resolveVerifiedStoreTimezone: vi.fn() }));
vi.mock("./metaFetchPatch.service.js", () => ({ extractMetaAssetHash: vi.fn() }));

import { SyncCenter } from "./sync-center.service";
import { syncStoreData } from "./store-sync.service";
import { resolveVerifiedStoreTimezone } from "./store-timezone.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.syncLog.findFirst.mockResolvedValue(null);
  prismaMock.syncLog.create.mockResolvedValue({});
  prismaMock.syncLog.update.mockResolvedValue({});
  prismaMock.store.findUnique.mockResolvedValue({
    id: 1,
    name: "Store 1",
    platform: "shoplazza",
    domain: "shop.example.com",
    timezone: "America/Los_Angeles",
    shopline_token: null,
    shopify_token: null,
    shoplazza_token: "shoplazza-token"
  });
  prismaMock.store.update.mockResolvedValue({});
  prismaMock.order.count.mockResolvedValue(0);
  prismaMock.product.count.mockResolvedValue(0);
  vi.mocked(resolveVerifiedStoreTimezone).mockResolvedValue({
    timezone: "America/Los_Angeles",
    timezoneSource: "platform_shop_api",
    timezoneVerifiedAt: "2026-07-01T00:00:00.000Z",
    platformTimezoneRaw: "America/Los_Angeles"
  });
  vi.mocked(syncStoreData).mockResolvedValue({
    1: {
      storeId: 1,
      storeName: "Store 1",
      platform: "shoplazza",
      timezone: "America/Los_Angeles",
      localStartDate: "2026-07-01",
      localEndDate: "2026-07-02",
      utcStartDate: "2026-07-01T00:00:00-07:00",
      utcEndDate: "2026-07-02T23:59:59-07:00",
      requestUrlSanitized: "https://shop.example.com/openapi/2026-01/orders",
      pageCount: 1,
      recordsFetched: 1,
      recordsSaved: 1,
      recordsSkipped: 0,
      skippedReasons: [],
      duplicateCount: 0,
      failedCount: 0,
      coverageComplete: true,
      truncated: false,
      failedSlices: [],
      orderItems: []
    }
  } as any);
});

describe("SyncCenter canonical receipts", () => {
  it("writes taskType, range columns, and scope evidence from the request", async () => {
    await SyncCenter.runTask(
      "sync_meta_insights",
      "meta",
      "test",
      "chain-1",
      null,
      null,
      "act_1",
      async () => ({ recordsFetched: 1, recordsSaved: 1 }),
      {
        rangeStart: "2026-07-01",
        rangeEnd: "2026-07-07",
        scopeKey: "account:act_1",
        coverageComplete: true
      }
    );

    expect(prismaMock.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskType: "sync_meta_insights",
        adAccountId: "act_1",
        rangeStart: expect.any(Date),
        rangeEnd: expect.any(Date)
      })
    });
    const createMetadata = JSON.parse(prismaMock.syncLog.create.mock.calls[0][0].data.metadata);
    expect(createMetadata).toMatchObject({
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-07",
      scopeKey: "account:act_1",
      coverageComplete: true
    });
  });

  it("records a single-account structure error in failedAccounts", async () => {
    prismaMock.adAccount.findMany.mockResolvedValue([{
      fb_account_id: "act_1",
      storeId: null,
      store: null,
      updatedAt: new Date()
    }]);
    axiosGet.mockRejectedValue(new Error("structure unavailable"));

    await SyncCenter.syncMetaStructure("chain-2", "test", null, { accountId: "act_1" });

    const updateData = prismaMock.syncLog.update.mock.calls.at(-1)[0].data;
    const metadata = JSON.parse(updateData.metadata);
    expect(updateData.status).toBe("failed");
    expect(metadata.status).toBe("FAILED");
    expect(metadata.failedAccounts).toEqual([
      { accountId: "act_1", message: "structure unavailable" }
    ]);
    expect(metadata.coverageComplete).toBe(false);
  });

  it("SC-01/02 syncStoreProfile uses verified timezone and fails when verification fails", async () => {
    await SyncCenter.syncStoreProfile(1, "chain-store", "test");

    expect(resolveVerifiedStoreTimezone).toHaveBeenCalled();
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ timezone: "America/Los_Angeles" })
    });

    vi.clearAllMocks();
    prismaMock.syncLog.findFirst.mockResolvedValue(null);
    prismaMock.syncLog.create.mockResolvedValue({});
    prismaMock.syncLog.update.mockResolvedValue({});
    prismaMock.store.findUnique.mockResolvedValue({
      id: 1,
      name: "Store 1",
      platform: "shopline",
      domain: "shop.example.com",
      timezone: null,
      shopline_token: "token"
    });
    vi.mocked(resolveVerifiedStoreTimezone).mockRejectedValue(new Error("STORE_TIMEZONE_UNVERIFIED"));

    await expect(SyncCenter.syncStoreProfile(1, "chain-store", "test")).rejects.toThrow("STORE_TIMEZONE_UNVERIFIED");
    expect(prismaMock.store.update).not.toHaveBeenCalled();
    expect(prismaMock.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" })
    }));
  });

  it("SC-03/04 syncStoreOrders token missing fails instead of fabricating GMT+8 no-data", async () => {
    prismaMock.store.findUnique.mockResolvedValue({
      id: 1,
      name: "Store 1",
      platform: "shopify",
      timezone: "America/New_York",
      shopify_token: null
    });

    await expect(SyncCenter.syncStoreOrders(1, "chain-store", "test", null, 2, "2026-07-01", "2026-07-02"))
      .rejects.toThrow("STORE_TOKEN_MISSING:1");

    expect(syncStoreData).not.toHaveBeenCalled();
    const updateData = prismaMock.syncLog.update.mock.calls.at(-1)[0].data;
    expect(updateData.status).toBe("failed");
    expect(JSON.stringify(updateData)).not.toContain("GMT+8");
  });

  it("SC-05 syncStoreOrders records the real platform sourceType", async () => {
    await SyncCenter.syncStoreOrders(1, "chain-store", "test", null, 2, "2026-07-01", "2026-07-02");

    expect(prismaMock.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskType: "sync_store_orders",
        sourceType: "shoplazza"
      })
    });
    const metadata = JSON.parse(prismaMock.syncLog.update.mock.calls.at(-1)[0].data.metadata);
    expect(metadata.coverageComplete).toBe(true);
    expect(metadata.truncated).toBe(false);
    expect(metadata.failedSlices).toEqual([]);
  });
});
