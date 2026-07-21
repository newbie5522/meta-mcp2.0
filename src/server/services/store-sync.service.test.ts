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
    expect(result[1].failedCount).toBe(0);
    expect(result[1].errorMessage).toBe("STORE_TIMEZONE_UNVERIFIED");
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
});
