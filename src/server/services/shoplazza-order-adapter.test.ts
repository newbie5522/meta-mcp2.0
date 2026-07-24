import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosGet } = vi.hoisted(() => ({
  axiosGet: vi.fn()
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));

import {
  buildShoplazzaNextPage,
  extractShoplazzaCursor,
  extractShoplazzaOrders,
  fetchShoplazzaOrderPages,
  fetchShoplazzaOrderSlices
} from "./shoplazza-order-adapter";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Shoplazza order adapter", () => {
  it("SHOPLAZZA-API-01 reads 2026-01 data.orders and requests the next cursor page", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { data: { orders: [{ id: "order-1" }], cursor: "cursor-2" } },
        headers: { "x-request-id": "safe" }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { data: { orders: [{ id: "order-2" }], cursor: "" } },
        headers: {}
      });

    const result = await fetchShoplazzaOrderPages({
      domain: "shop.example.com",
      token: "secret-token",
      startUtc: "2026-07-01T00:00:00Z",
      endUtc: "2026-07-02T23:59:59Z"
    });

    expect(result.rawOrders.map(o => o.id)).toEqual(["order-1", "order-2"]);
    expect(result.coverageComplete).toBe(true);
    expect(result.paginationTermination).toBe("NATURAL_END");
    expect(result.responseOrderPath).toBe("data.orders");
    expect(result.cursorPages).toBe(1);
    expect(axiosGet.mock.calls[0][0]).toContain("page_size=250");
    expect(axiosGet.mock.calls[0][0]).not.toContain("limit=250");
    expect(axiosGet.mock.calls[1][0]).toContain("cursor=cursor-2");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("SHOPLAZZA-API-03/04 supports known order array shapes", () => {
    expect(extractShoplazzaOrders({ orders: [{ id: 1 }] })).toMatchObject({ path: "orders" });
    expect(extractShoplazzaOrders({ data: { data: { orders: [{ id: 2 }] } } })).toMatchObject({ path: "data.data.orders" });
    expect(extractShoplazzaOrders({ data: [{ id: 3 }] })).toMatchObject({ path: "data" });
  });

  it("SHOPLAZZA-API-05 does not mark unrecognized HTTP 200 as complete empty data", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { shop: { name: "Romanticed" } } }, headers: {} });

    const result = await fetchShoplazzaOrderPages({
      domain: "shop.example.com",
      token: "secret-token",
      startUtc: "2026-07-01T00:00:00Z",
      endUtc: "2026-07-02T23:59:59Z"
    });

    expect(result.rawOrders).toEqual([]);
    expect(result.coverageComplete).toBe(false);
    expect(result.paginationTermination).toBe("ERROR");
    expect(result.failedSlices.some(slice => slice.reason === "SHOPLAZZA_ORDER_RESPONSE_UNRECOGNIZED")).toBe(true);
  });

  it("SHOPLAZZA-API-06 rejects duplicate cursors as incomplete coverage", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [{ id: "order-1" }], cursor: "same" } }, headers: {} })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [{ id: "order-2" }], cursor: "same" } }, headers: {} });

    const result = await fetchShoplazzaOrderPages({
      domain: "shop.example.com",
      token: "secret-token",
      startUtc: "2026-07-01T00:00:00Z",
      endUtc: "2026-07-02T23:59:59Z"
    });

    expect(result.coverageComplete).toBe(false);
    expect(result.paginationTermination).toBe("ERROR");
    expect(result.failedSlices[0]).toMatchObject({ reason: "SHOPLAZZA_ORDER_DUPLICATE_CURSOR" });
  });

  it("SHOPLAZZA-API-07 supports legacy page mode only with real pagination structure", async () => {
    axiosGet
      .mockRejectedValueOnce({ response: { status: 404, data: {} } })
      .mockRejectedValueOnce({ response: { status: 404, data: {} } })
      .mockResolvedValueOnce({
        status: 200,
        data: { orders: [{ id: "legacy-1" }], pagination: { current_page: 1, total_pages: 2 } },
        headers: {}
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { orders: [{ id: "legacy-2" }], pagination: { current_page: 2, total_pages: 2 } },
        headers: {}
      });

    const result = await fetchShoplazzaOrderPages({
      domain: "shop.example.com",
      token: "secret-token",
      startUtc: "2026-07-01T00:00:00Z",
      endUtc: "2026-07-02T23:59:59Z"
    });

    expect(result.selectedEndpointPath).toBe("/openapi/2022-01/orders");
    expect(result.paginationMode).toBe("legacy_page");
    expect(result.rawOrders.map(o => o.id)).toEqual(["legacy-1", "legacy-2"]);
    expect(result.coverageComplete).toBe(true);
  });

  it("extractShoplazzaCursor and buildShoplazzaNextPage support known cursor paths", () => {
    expect(extractShoplazzaCursor({ data: { pagination: { next: "next-token" } } })).toMatchObject({
      cursor: "next-token",
      path: "data.pagination.next"
    });

    const next = buildShoplazzaNextPage({
      currentUrl: "https://shop.example.com/openapi/2026-01/orders?page_size=250",
      endpoint: { apiVersion: "2026-01", path: "/openapi/2026-01/orders", mode: "cursor" },
      payload: { next_cursor: "cursor-2" },
      page: 1
    });

    expect(next.nextUrl).toContain("cursor=cursor-2");
  });

  it("SHOPLAZZA-DATE-02 returns an order paid inside the range in multi-slice mode", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: { data: { orders: [{ id: "paid-in-range", created_at: "2026-06-01T00:00:00Z", placed_at: "2026-06-05T06:00:00Z", paid_at: "2026-07-02T06:00:00Z" }], cursor: "" } },
        headers: {}
      });

    const result = await fetchShoplazzaOrderSlices({
      domain: "shop.example.com",
      token: "secret-token",
      startUtc: "2026-07-01T07:00:00Z",
      endUtc: "2026-07-03T06:59:59Z"
    });

    expect(result.queryDateFields).toEqual(["created_at", "placed_at", "paid_at"]);
    expect(result.rawOrders.map(order => order.id)).toEqual(["paid-in-range"]);
    expect(result.coverageComplete).toBe(true);
    expect(axiosGet.mock.calls[0][0]).toContain("created_at_min=");
    expect(axiosGet.mock.calls[1][0]).toContain("placed_at_min=");
    expect(axiosGet.mock.calls[2][0]).toContain("paid_at_min=");
  });

  it("SHOPLAZZA-DATE-03 deduplicates the same order across created_at, placed_at, and paid_at slices by order id", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [{ id: "same-order" }], cursor: "" } }, headers: {} })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [{ id: "same-order" }], cursor: "" } }, headers: {} })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [{ id: "same-order" }], cursor: "" } }, headers: {} });

    const result = await fetchShoplazzaOrderSlices({
      domain: "shop.example.com",
      token: "secret-token",
      startUtc: "2026-07-01T07:00:00Z",
      endUtc: "2026-07-03T06:59:59Z"
    });

    expect(result.rawOrders).toHaveLength(1);
    expect(result.deduplicatedOrderCount).toBe(1);
    expect(result.duplicateAcrossSlicesCount).toBe(2);
    expect(result.coverageComplete).toBe(true);
  });

  it("SHOPLAZZA-DATE-04 marks coverage incomplete when the placed_at slice fails after created_at succeeds", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [{ id: "created-ok" }], cursor: "" } }, headers: {} })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: "boom" } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: "boom" } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: "boom" } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: "boom" } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: "boom" } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: "boom" } } })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} });

    const result = await fetchShoplazzaOrderSlices({
      domain: "shop.example.com",
      token: "secret-token",
      startUtc: "2026-07-01T07:00:00Z",
      endUtc: "2026-07-03T06:59:59Z"
    });

    expect(result.rawOrders.map(order => order.id)).toEqual(["created-ok"]);
    expect(result.coverageComplete).toBe(false);
    expect(result.failedSlices.some(slice => slice.dateFilter === "placed_at")).toBe(true);
  });
});
