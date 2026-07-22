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

  it("TZ-01/TZ-02 reads Shopline timezone from merchants data.iana_timezone", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { iana_timezone: "America/Los_Angeles" } } });

    const result = await fetchPlatformStoreTimezone({
      platform: "shopline",
      domain: "baslayer.myshopline.com/admin",
      shopline_token: "shopline-token"
    });

    expect(result?.timezone).toBe("America/Los_Angeles");
    expect(axiosGet).toHaveBeenCalledWith(
      "https://baslayer.myshopline.com/admin/openapi/v20260601/merchants/shop.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Authorization": "Bearer shopline-token",
          "Content-Type": "application/json; charset=utf-8",
          "Accept": "application/json"
        })
      })
    );
  });

  it("TZ-03 continues Shopline 404 to the next stable merchants version", async () => {
    axiosGet
      .mockRejectedValueOnce({ response: { status: 404, data: { error: "not found" } } })
      .mockResolvedValueOnce({ status: 200, data: { data: { timezone: "America/New_York" } } });

    const result = await fetchPlatformStoreTimezone({
      platform: "shopline",
      domain: "shop.example.com",
      shopline_token: "shopline-token"
    });

    expect(result?.timezone).toBe("America/New_York");
    expect(axiosGet.mock.calls[1][0]).toContain("/admin/openapi/v20250601/merchants/shop.json");
  });

  it("TZ-04 marks Shopline 403 as a permission error", async () => {
    axiosGet.mockRejectedValue({ response: { status: 403, data: { error: "forbidden" } } });

    await expect(fetchPlatformStoreTimezone({
      platform: "shopline",
      domain: "shop.example.com",
      shopline_token: "shopline-token"
    })).rejects.toMatchObject({ code: "STORE_TIMEZONE_PERMISSION_DENIED" });
  });

  it("TZ-05/TZ-07 reads Shoplazza 2026-01 data.shop.timezone using access-token", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { shop: { timezone: "Asia/Tokyo" } } } });

    const result = await fetchPlatformStoreTimezone({
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      shoplazza_token: "shoplazza-token"
    });

    expect(result?.timezone).toBe("Asia/Tokyo");
    expect(axiosGet).toHaveBeenCalledWith(
      "https://lachry.myshoplaza.com/openapi/2026-01/shop",
      expect.objectContaining({
        headers: expect.objectContaining({
          "access-token": "shoplazza-token",
          "Accept": "application/json"
        })
      })
    );
  });

  it("TZ-06 falls back from Shoplazza 2026-01 to 2025-06", async () => {
    axiosGet
      .mockRejectedValueOnce({ response: { status: 404, data: {} } })
      .mockResolvedValueOnce({ status: 200, data: { shop: { time_zone: "Europe/London" } } });

    const result = await fetchPlatformStoreTimezone({
      platform: "shoplazza",
      domain: "shop.example.com",
      shoplazza_token: "shoplazza-token"
    });

    expect(result?.timezone).toBe("Europe/London");
    expect(axiosGet.mock.calls[1][0]).toContain("/openapi/2025-06/shop");
  });

  it("TZ-08 returns null for Shoplazza HTTP 200 without an IANA field", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { shop: { name: "Romanticed" } } } });

    const result = await fetchPlatformStoreTimezone({
      platform: "shoplazza",
      domain: "shop.example.com",
      shoplazza_token: "shoplazza-token"
    });

    expect(result).toBeNull();
  });

  it("TZ-TEMP-01 uses a temporary LA source for Shoplazza when Shop API has no timezone and Store.timezone is valid", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { shop: { name: "Romanticed" } } } });

    const result = await resolveVerifiedStoreTimezone({
      id: 2,
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      timezone: "America/Los_Angeles",
      shoplazza_token: "shoplazza-token"
    });

    expect(result).toMatchObject({
      timezone: "America/Los_Angeles",
      timezoneSource: "temporary_default_la",
      platformTimezoneRaw: null,
      temporaryTimezoneFallback: true,
      temporaryTimezoneReason: "SHOPLAZZA_TIMEZONE_FIELD_UNAVAILABLE"
    });
  });

  it("TZ-TEMP-02 uses fixed LA only when Shoplazza Store.timezone is empty or invalid", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { shop: { name: "Romanticed" } } } });

    const result = await resolveVerifiedStoreTimezone({
      id: 2,
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      timezone: "",
      shoplazza_token: "shoplazza-token"
    });

    expect(result).toMatchObject({
      timezone: "America/Los_Angeles",
      timezoneSource: "temporary_default_la"
    });
  });

  it("TZ-TEMP-03 does not fallback to LA for Shoplazza 403", async () => {
    axiosGet.mockRejectedValue({ response: { status: 403, data: { error: "forbidden" } } });

    await expect(resolveVerifiedStoreTimezone({
      id: 2,
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      timezone: "America/Los_Angeles",
      shoplazza_token: "shoplazza-token"
    })).rejects.toMatchObject({ code: "STORE_TIMEZONE_PERMISSION_DENIED" });
  });

  it("TZ-TEMP-04 does not fallback to LA for non-Shoplazza platforms without timezone fields", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { shop: { name: "Baslayer" } } } });

    await expect(resolveVerifiedStoreTimezone({
      id: 1,
      platform: "shopline",
      domain: "baslayer.myshopline.com",
      timezone: "America/Los_Angeles",
      shopline_token: "shopline-token"
    })).rejects.toMatchObject({ code: "STORE_TIMEZONE_UNVERIFIED" });
  });

  it("TZ-TEMP-05 does not fallback to LA for unknown Shoplazza network errors", async () => {
    axiosGet.mockRejectedValue(new Error("network unavailable"));

    await expect(resolveVerifiedStoreTimezone({
      id: 2,
      platform: "shoplazza",
      domain: "lachry.myshoplaza.com",
      timezone: "America/Los_Angeles",
      shoplazza_token: "shoplazza-token"
    })).rejects.toMatchObject({ code: "STORE_TIMEZONE_UNVERIFIED" });
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
    expect(prismaMock.syncLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        taskType: "sync_store_orders",
        status: "success"
      })
    }));
    expect(prismaMock.syncLog.findFirst.mock.calls[0][0].where).not.toHaveProperty("type");
  });

  it("TZ-10 rejects persisted timezone evidence without verifiedAt", async () => {
    axiosGet.mockRejectedValue(new Error("platform unavailable"));
    prismaMock.syncLog.findFirst.mockResolvedValue({
      startedAt: new Date("2026-07-01T00:00:00.000Z"),
      metadata: JSON.stringify({
        timezone: "America/Los_Angeles",
        timezoneSource: "platform_shop_api"
      })
    });

    await expect(resolveVerifiedStoreTimezone({
      id: 1,
      platform: "shopline",
      domain: "shop.example.com",
      timezone: "America/Los_Angeles",
      shopline_token: "shopline-token"
    })).rejects.toMatchObject({ code: "STORE_TIMEZONE_UNVERIFIED" });
  });
});
