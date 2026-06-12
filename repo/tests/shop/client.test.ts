import { afterEach, describe, expect, it, vi } from "vitest";
import { ordersPathForPlatform, ordersPathsForPlatform, productPathsForPlatform, profilePathForPlatform, shopApiHeaders, validateShopApiBaseUrl } from "../../src/shop/client.js";
import { extractOrders, extractProducts, nextOrderCursor, nextOrderPageLink, orderQueryForPlatform } from "../../src/domain/order-sync.js";

describe("shop private-app API adapters", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses official Shopline read-only endpoints and authentication", () => {
    expect(ordersPathForPlatform("shopline")).toBe("/admin/openapi/v20240301/orders.json");
    expect(ordersPathsForPlatform("shopline")).toContain("/admin/openapi/v20250601/orders.json");
    expect(productPathsForPlatform("shopline")).toContain("/admin/openapi/v20240301/products.json");
    expect(productPathsForPlatform("shopline")).toContain("/admin/openapi/products");
    expect(profilePathForPlatform("shopline")).toBe("/admin/openapi/v20240301/merchants/shop.json");
    expect(shopApiHeaders({ platform: "shopline", token: "secret-token" })).toEqual({
      Accept: "application/json",
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    });
  });

  it("uses official Shoplazza private-app endpoints and Access-Token header", () => {
    expect(ordersPathForPlatform("shoplazza")).toBe("/openapi/2022-01/orders");
    expect(ordersPathsForPlatform("shoplazza")).toContain("/openapi/2022-01/orders.json");
    expect(productPathsForPlatform("shoplazza")).toContain("/openapi/2022-01/products");
    expect(productPathsForPlatform("shoplazza")).toContain("/openapi/2020-01/products.json");
    expect(profilePathForPlatform("shoplazza")).toBe("/openapi/2022-01/shop");
    expect(shopApiHeaders({ platform: "shoplazza", token: "secret-token" })).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "Access-Token": "secret-token",
      "User-Agent": "Mozilla/5.0",
    });
  });

  it("allows advanced environment overrides", () => {
    vi.stubEnv("SHOPLINE_API_VERSION", "v20251201");
    vi.stubEnv("SHOPLAZZA_ORDERS_PATH", "/custom/orders");
    expect(ordersPathForPlatform("shopline")).toBe("/admin/openapi/v20251201/orders.json");
    expect(ordersPathForPlatform("shoplazza")).toBe("/custom/orders");
  });

  it("uses platform-specific date filters and pagination parameters", () => {
    const rangeStart = new Date("2026-05-01T00:00:00.000Z");
    const rangeEnd = new Date("2026-05-31T23:59:59.000Z");
    expect(orderQueryForPlatform("shopline", { storeId: "store", rangeStart, rangeEnd, limit: 250 })).toEqual({
      status: "any",
      created_at_min: "2026-05-01T00:00:00-08:00",
      created_at_max: "2026-05-31T23:59:59-08:00",
      limit: 100,
    });
    expect(orderQueryForPlatform("shopline", { storeId: "store", rangeStart, rangeEnd, shoplineTimeOffset: "+08:00" })).toEqual({
      status: "any",
      created_at_min: "2026-05-01T00:00:00+08:00",
      created_at_max: "2026-05-31T23:59:59+08:00",
      limit: 100,
    });
    expect(orderQueryForPlatform("shoplazza", { storeId: "store", rangeStart, rangeEnd, limit: 250 })).toEqual({
      updated_at_min: expect.stringContaining("2026-05-01T"),
      updated_at_max: expect.stringContaining("2026-05-31T"),
      limit: 50,
      page: 1,
    });
  });

  it("allows HTTPS shop API domains and rejects insecure URLs", () => {
    expect(validateShopApiBaseUrl("shopline", "https://example.com").hostname).toBe("example.com");
    expect(validateShopApiBaseUrl("shoplazza", "https://example.com").hostname).toBe("example.com");
    expect(validateShopApiBaseUrl("shopline", "https://handle.myshopline.com").hostname).toBe("handle.myshopline.com");
    expect(validateShopApiBaseUrl("shoplazza", "https://store.myshoplaza.com").hostname).toBe("store.myshoplaza.com");
    expect(() => validateShopApiBaseUrl("shopline", "http://handle.myshopline.com")).toThrow("HTTPS");
  });

  it("extracts nested orders and platform pagination tokens", () => {
    expect(extractOrders({ data: { orders: [{ id: "1" }] } })).toEqual([{ id: "1" }]);
    expect(extractProducts({ data: { products: [{ id: "p1" }] } })).toEqual([{ id: "p1" }]);
    expect(nextOrderPageLink(new Headers({
      link: '<https://store.myshopline.com/admin/openapi/v20240301/orders.json?page_info=next>; rel="next"',
    }))).toContain("page_info=next");
    expect(nextOrderCursor({ data: { pagination: { next_cursor: "cursor-next" } } })).toBe("cursor-next");
  });
});
