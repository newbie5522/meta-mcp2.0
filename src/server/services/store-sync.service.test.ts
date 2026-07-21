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
