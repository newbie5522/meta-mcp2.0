import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, resolveVerifiedStoreTimezoneMock, fetchStoreOrdersCanonicalMock, saveCanonicalOrdersToDbMock } = vi.hoisted(() => ({
  prismaMock: {
    store: { findMany: vi.fn() }
  },
  resolveVerifiedStoreTimezoneMock: vi.fn(),
  fetchStoreOrdersCanonicalMock: vi.fn(),
  saveCanonicalOrdersToDbMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("./store-timezone.service.js", () => ({
  resolveVerifiedStoreTimezone: resolveVerifiedStoreTimezoneMock
}));
vi.mock("./store-sync-core.js", () => ({
  fetchStoreOrdersCanonical: fetchStoreOrdersCanonicalMock,
  saveCanonicalOrdersToDb: saveCanonicalOrdersToDbMock
}));

import { syncStoreData } from "./store-sync.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findMany.mockResolvedValue([{
    id: 1,
    name: "Baslayer",
    platform: "shopline",
    domain: "shop.example.com",
    shopline_token: "shopline-token",
    timezone: "America/Los_Angeles"
  }]);
});

describe("store sync verified timezone gate", () => {
  it("does not request order API or write Orders when timezone is unverified", async () => {
    resolveVerifiedStoreTimezoneMock.mockRejectedValue(new Error("STORE_TIMEZONE_UNVERIFIED"));

    const result = await syncStoreData("2026-07-01", "2026-07-02", "1");

    expect(fetchStoreOrdersCanonicalMock).not.toHaveBeenCalled();
    expect(saveCanonicalOrdersToDbMock).not.toHaveBeenCalled();
    expect(result[1].failedCount).toBe(1);
    expect(result[1].errorMessage).toBe("STORE_TIMEZONE_UNVERIFIED");
    expect(result[1].coverageComplete).toBe(false);
  });

  it("passes verified timezone evidence into canonical order fetching", async () => {
    resolveVerifiedStoreTimezoneMock.mockResolvedValue({
      timezone: "America/Los_Angeles",
      timezoneSource: "platform_shop_api",
      timezoneVerifiedAt: "2026-07-01T00:00:00.000Z",
      platformTimezoneRaw: "America/Los_Angeles"
    });
    fetchStoreOrdersCanonicalMock.mockResolvedValue({
      orders: [],
      coverageComplete: true,
      truncated: false,
      failedSlices: [],
      diagnostics: {
        timezoneAfter: "America/Los_Angeles",
        requestStartAt: "2026-07-01T00:00:00-07:00",
        requestEndAt: "2026-07-02T23:59:59-07:00",
        requestUrlsSanitized: [],
        pagesFetched: 0,
        apiOrdersCount: 0,
        validOrdersCount: 0
      }
    });
    saveCanonicalOrdersToDbMock.mockResolvedValue({
      saved: 0,
      updated: 0,
      deletedRows: 0,
      orderRowsWritten: 0
    });

    await syncStoreData("2026-07-01", "2026-07-02", "1");

    expect(fetchStoreOrdersCanonicalMock).toHaveBeenCalledWith(expect.objectContaining({
      timezone: "America/Los_Angeles",
      timezoneSource: "platform_shop_api",
      timezoneVerifiedAt: "2026-07-01T00:00:00.000Z",
      platformTimezoneRaw: "America/Los_Angeles"
    }));
  });

  it("SHOPLAZZA-SYNC-01/02 passes manual_verified Shoplazza timezone into canonical fetching and records write diagnostics", async () => {
    prismaMock.store.findMany.mockResolvedValue([{
      id: 2,
      name: "Romanticed",
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      shoplazza_token: "shoplazza-token",
      timezone: "America/Los_Angeles"
    }]);
    resolveVerifiedStoreTimezoneMock.mockResolvedValue({
      timezone: "America/Los_Angeles",
      timezoneSource: "manual_verified",
      timezoneVerifiedAt: "2026-07-01T00:00:00.000Z",
      platformTimezoneRaw: null
    });
    fetchStoreOrdersCanonicalMock.mockResolvedValue({
      orders: [{ orderId: "slz-1", orderNumber: "R-1001", attributionTimeRaw: "2026-07-02T06:30:00Z", rawCreatedAt: "2026-07-02T06:30:00Z", storeLocalDate: "2026-07-01", orderTotal: 42.5, paymentStatus: "paid", fulfillmentStatus: "fulfilled" }],
      coverageComplete: true,
      truncated: false,
      failedSlices: [],
      diagnostics: {
        timezoneAfter: "America/Los_Angeles",
        requestStartAt: "2026-07-01T00:00:00-07:00",
        requestEndAt: "2026-07-01T23:59:59-07:00",
        requestUrlsSanitized: ["https://lachry.myshoplaza.com/openapi/2026-01/orders?page_size=250"],
        pagesFetched: 1,
        apiOrdersCount: 1,
        validOrdersCount: 1,
        selectedApiVersion: "2026-01",
        selectedEndpointPath: "/openapi/2026-01/orders"
      }
    });
    saveCanonicalOrdersToDbMock.mockResolvedValue({
      saved: 1,
      updated: 0,
      deletedRows: 0,
      orderRowsWritten: 1
    });

    const result = await syncStoreData("2026-07-01", "2026-07-01", "2");

    expect(fetchStoreOrdersCanonicalMock).toHaveBeenCalledWith(expect.objectContaining({
      platform: "shoplazza",
      timezone: "America/Los_Angeles",
      timezoneSource: "manual_verified",
      platformTimezoneRaw: null
    }));
    expect(saveCanonicalOrdersToDbMock).toHaveBeenCalled();
    expect(result[2].recordsSaved).toBe(1);
    expect(result[2].diagnostics).toMatchObject({
      timezoneSource: "manual_verified",
      recordsSaved: 1,
      recordsUpdated: 0,
      orderRowsWritten: 1
    });
  });

  it("SYNC-SLZ-TZ-01 persisted_configured calls Shoplazza Orders API", async () => {
    prismaMock.store.findMany.mockResolvedValue([{
      id: 2,
      name: "Romanticed",
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      shoplazza_token: "shoplazza-token",
      timezone: "America/Los_Angeles"
    }]);
    resolveVerifiedStoreTimezoneMock.mockResolvedValue({
      timezone: "America/Los_Angeles",
      timezoneSource: "persisted_configured",
      timezoneVerifiedAt: "2026-07-01T00:00:00.000Z",
      platformTimezoneRaw: null
    });
    fetchStoreOrdersCanonicalMock.mockResolvedValue({
      orders: [],
      coverageComplete: true,
      truncated: false,
      failedSlices: [],
      diagnostics: {
        timezoneAfter: "America/Los_Angeles",
        requestStartAt: "2026-07-01T00:00:00-07:00",
        requestEndAt: "2026-07-01T23:59:59-07:00",
        requestUrlsSanitized: ["https://lachry.myshoplaza.com/openapi/2026-01/orders?page_size=250"],
        pagesFetched: 1,
        apiOrdersCount: 0,
        validOrdersCount: 0,
        selectedApiVersion: "2026-01",
        selectedEndpointPath: "/openapi/2026-01/orders"
      }
    });
    saveCanonicalOrdersToDbMock.mockResolvedValue({ saved: 0, updated: 0, deletedRows: 0, orderRowsWritten: 0 });

    const result = await syncStoreData("2026-07-01", "2026-07-01", "2");

    expect(fetchStoreOrdersCanonicalMock).toHaveBeenCalledWith(expect.objectContaining({
      platform: "shoplazza",
      timezone: "America/Los_Angeles",
      timezoneSource: "persisted_configured"
    }));
    expect(saveCanonicalOrdersToDbMock).toHaveBeenCalled();
    expect(result[2].failedCount).toBe(0);
  });

  it("SYNC-SLZ-TZ-02/03 system_default calls Orders API and preserves America/Los_Angeles store_local_date writes", async () => {
    prismaMock.store.findMany.mockResolvedValue([{
      id: 2,
      name: "Romanticed",
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      shoplazza_token: "shoplazza-token",
      timezone: ""
    }]);
    resolveVerifiedStoreTimezoneMock.mockResolvedValue({
      timezone: "America/Los_Angeles",
      timezoneSource: "system_default",
      timezoneVerifiedAt: "2026-07-01T00:00:00.000Z",
      platformTimezoneRaw: null,
      temporaryTimezoneFallback: true,
      temporaryTimezoneReason: "SHOPLAZZA_TIMEZONE_UNAVAILABLE_USING_SYSTEM_TIMEZONE"
    });
    const canonicalOrder = {
      orderId: "slz-1",
      orderNumber: "R-1001",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      rawCreatedAt: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01",
      orderTotal: 42.5,
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled"
    };
    fetchStoreOrdersCanonicalMock.mockResolvedValue({
      orders: [canonicalOrder],
      coverageComplete: true,
      truncated: false,
      failedSlices: [],
      diagnostics: {
        timezoneAfter: "America/Los_Angeles",
        requestStartAt: "2026-07-01T00:00:00-07:00",
        requestEndAt: "2026-07-01T23:59:59-07:00",
        requestUrlsSanitized: ["https://lachry.myshoplaza.com/openapi/2026-01/orders?page_size=250"],
        pagesFetched: 1,
        apiOrdersCount: 1,
        validOrdersCount: 1,
        selectedApiVersion: "2026-01",
        selectedEndpointPath: "/openapi/2026-01/orders"
      }
    });
    saveCanonicalOrdersToDbMock.mockResolvedValue({ saved: 1, updated: 0, deletedRows: 0, orderRowsWritten: 1 });

    const result = await syncStoreData("2026-07-01", "2026-07-01", "2");

    expect(fetchStoreOrdersCanonicalMock).toHaveBeenCalledWith(expect.objectContaining({
      platform: "shoplazza",
      timezone: "America/Los_Angeles",
      timezoneSource: "system_default"
    }));
    expect(saveCanonicalOrdersToDbMock).toHaveBeenCalledWith([canonicalOrder], expect.objectContaining({
      storeId: 2,
      startDate: "2026-07-01",
      endDate: "2026-07-01"
    }));
    expect(result[2].recordsSaved).toBe(1);
    expect(result[2].orderItems[0].storeLocalDate).toBe("2026-07-01");
    expect(result[2].diagnostics).toMatchObject({
      timezone: "America/Los_Angeles",
      timezoneSource: "system_default",
      temporaryTimezoneFallback: true,
      temporaryTimezoneReason: "SHOPLAZZA_TIMEZONE_UNAVAILABLE_USING_SYSTEM_TIMEZONE"
    });
  });

  it("SYNC-SLZ-TZ-04 permission errors do not call Orders API", async () => {
    prismaMock.store.findMany.mockResolvedValue([{
      id: 2,
      name: "Romanticed",
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      shoplazza_token: "shoplazza-token",
      timezone: "America/Los_Angeles"
    }]);
    resolveVerifiedStoreTimezoneMock.mockRejectedValue(new Error("STORE_TIMEZONE_PERMISSION_DENIED"));

    const result = await syncStoreData("2026-07-01", "2026-07-01", "2");

    expect(fetchStoreOrdersCanonicalMock).not.toHaveBeenCalled();
    expect(saveCanonicalOrdersToDbMock).not.toHaveBeenCalled();
    expect(result[2]).toMatchObject({
      failedCount: 1,
      errorMessage: "STORE_TIMEZONE_PERMISSION_DENIED",
      coverageComplete: false
    });
  });

  it("returns a failed store result when the platform token is missing", async () => {
    prismaMock.store.findMany.mockResolvedValue([{
      id: 2,
      name: "Shopify Store",
      platform: "shopify",
      domain: "shop.example.com",
      shopify_token: null,
      timezone: "America/New_York"
    }]);

    const result = await syncStoreData("2026-07-01", "2026-07-02", "2");

    expect(resolveVerifiedStoreTimezoneMock).not.toHaveBeenCalled();
    expect(fetchStoreOrdersCanonicalMock).not.toHaveBeenCalled();
    expect(result[2]).toMatchObject({
      platform: "shopify",
      failedCount: 1,
      errorMessage: "STORE_TOKEN_MISSING:2",
      coverageComplete: false
    });
    expect(JSON.stringify(result[2])).not.toContain("GMT+8");
  });
});
