import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosGet, prismaMock } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  prismaMock: {
    order: { count: vi.fn() },
    syncLog: { findFirst: vi.fn() }
  }
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));
vi.mock("../../db/index.js", () => ({ default: prismaMock }));

import { fetchPlatformStoreTimezone, resolveVerifiedStoreTimezone } from "./store-timezone.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.order.count.mockResolvedValue(0);
  prismaMock.syncLog.findFirst.mockResolvedValue(null);
});

describe("verified store timezone service", () => {
  it("reads Shopify timezone with Shopify headers only", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { shop: { iana_timezone: "America/New_York" } } });

    const result = await fetchPlatformStoreTimezone({
      platform: "shopify",
      domain: "shop.example.com",
      shopify_token: "shopify-token"
    });

    expect(result?.timezone).toBe("America/New_York");
    expect(axiosGet).toHaveBeenCalledWith(
      "https://shop.example.com/admin/api/2024-01/shop.json",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Shopify-Access-Token": "shopify-token" })
      })
    );
    expect(axiosGet.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    expect(axiosGet.mock.calls[0][1].headers).not.toHaveProperty("Access-Token");
  });

  it("rejects changed platform timezone when existing orders would be affected", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { shop: { timezone: "America/New_York" } } });
    prismaMock.order.count.mockResolvedValue(5);

    await expect(resolveVerifiedStoreTimezone({
      id: 1,
      platform: "shopify",
      domain: "shop.example.com",
      timezone: "America/Los_Angeles",
      shopify_token: "shopify-token"
    })).rejects.toMatchObject({
      code: "STORE_TIMEZONE_CHANGED",
      details: expect.objectContaining({
        previousTimezone: "America/Los_Angeles",
        platformTimezone: "America/New_York",
        affectedOrderCount: 5
      })
    });
  });

  it("allows persisted timezone only with prior platform_shop_api sync evidence", async () => {
    axiosGet.mockRejectedValue(new Error("platform unavailable"));
    prismaMock.syncLog.findFirst.mockResolvedValue({
      startedAt: new Date("2026-07-01T00:00:00.000Z"),
      metadata: JSON.stringify({
        timezone: "America/Los_Angeles",
        timezoneSource: "platform_shop_api",
        timezoneVerifiedAt: "2026-07-01T00:00:00.000Z"
      })
    });

    const result = await resolveVerifiedStoreTimezone({
      id: 1,
      platform: "shopline",
      domain: "shop.example.com",
      timezone: "America/Los_Angeles",
      shopline_token: "shopline-token"
    });

    expect(result).toMatchObject({
      timezone: "America/Los_Angeles",
      timezoneSource: "persisted_verified"
    });
  });
});
