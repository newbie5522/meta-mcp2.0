import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosGet } = vi.hoisted(() => ({
  axiosGet: vi.fn()
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));

import { fetchStoreOrdersCanonical } from "./store-sync-core";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("store sync core verified timezone contract", () => {
  it("rejects non-IANA timezone before requesting platform orders", async () => {
    await expect(fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "GMT-7"
    })).rejects.toMatchObject({ code: "STORE_TIMEZONE_UNVERIFIED" });
  });

  it("PAGE-01 natural end marks coverage complete", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: [] }, headers: {} });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(result.coverageComplete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.diagnostics.paginationTermination).toBe("EMPTY_PAGE");
  });

  it("PAGE-03 page 50 with next page marks truncated", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      data: { data: [{ id: "order-1", financial_status: "paid", created_at: "2026-07-01T12:00:00Z", line_items: [] }] },
      headers: { link: '<https://shop.example.com/admin/openapi/v20260601/orders.json?page_info=next>; rel="next"' }
    });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(axiosGet).toHaveBeenCalledTimes(50);
    expect(result.coverageComplete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.diagnostics.paginationTermination).toBe("PAGE_LIMIT");
    expect(result.failedSlices[0]).toMatchObject({ reason: "PAGE_LIMIT", truncated: true });
  });

  it("PAGE-04 request error rejects before claiming complete coverage", async () => {
    axiosGet.mockRejectedValue(new Error("network down"));

    await expect(fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    })).rejects.toThrow("network down");
  });

  it("SHOPLAZZA-MAP-01/02/03/05/DATE-01 maps canonical Shoplazza fields and local date", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      data: {
        data: {
          orders: [{
            id: "slz-1",
            number: "R-1001",
            created_at: "2026-07-02T06:30:00Z",
            placed_at: "2026-07-02T06:35:00Z",
            payment_status: "paid",
            status: "finished",
            total_price: "42.50",
            current_total_price: "99.99",
            line_items: [{
              id: "line-1",
              product_id: "product-1",
              product_title: "Real Shoplazza Product",
              sku: "SKU-1",
              quantity: 2,
              price: "10.00",
              total_price: "20.00"
            }]
          }],
          cursor: ""
        }
      },
      headers: {}
    });

    const result = await fetchStoreOrdersCanonical({
      platform: "shoplazza",
      storeId: 2,
      domain: "lachry.myshoplaza.com",
      token: "shoplazza-token",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      timezone: "America/Los_Angeles",
      timezoneSource: "manual_verified"
    });

    expect(result.coverageComplete).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: "slz-1",
      orderNumber: "R-1001",
      rawPlacedAt: "2026-07-02T06:35:00Z",
      rawPaidAt: null,
      attributionField: "placed_at",
      attributionTimeRaw: "2026-07-02T06:35:00Z",
      paymentStatus: "paid",
      orderTotal: 42.5,
      orderTotalSource: "total_price",
      storeLocalDate: "2026-07-01",
      storeTimezone: "America/Los_Angeles"
    });
    expect(result.orders[0].lineItems[0]).toMatchObject({
      productId: "product-1",
      name: "Real Shoplazza Product",
      revenue: 20
    });
    expect(result.diagnostics).toMatchObject({
      selectedApiVersion: "2026-01",
      selectedEndpointPath: "/openapi/2026-01/orders",
      responseOrderPath: "data.orders",
      paginationMode: "cursor",
      orderTotalSource: "total_price",
      timezoneSource: "manual_verified"
    });
  });

  it("SHOPLAZZA-MAP-04 excludes status=cancelled even when payment_status is paid", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      data: {
        data: {
          orders: [{
            id: "slz-cancelled",
            number: "R-VOID",
            created_at: "2026-07-02T06:30:00Z",
            placed_at: "2026-07-02T06:35:00Z",
            payment_status: "paid",
            status: "cancelled",
            total_price: "42.50",
            line_items: [{ id: "line-1", product_title: "Cancelled Product", quantity: 1, price: "42.50" }]
          }],
          cursor: ""
        }
      },
      headers: {}
    });

    const result = await fetchStoreOrdersCanonical({
      platform: "shoplazza",
      storeId: 2,
      domain: "lachry.myshoplaza.com",
      token: "shoplazza-token",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      timezone: "America/Los_Angeles"
    });

    expect(result.diagnostics.apiOrdersCount).toBe(1);
    expect(result.diagnostics.paymentStatusCounts).toMatchObject({ paid: 1 });
    expect(result.diagnostics.validOrdersCount).toBe(0);
    expect(result.orders).toEqual([]);
  });

  it("SHOPLAZZA-DATE-02/06 includes placed_at in-range orders and derives store_local_date from the canonical attribution time", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "paid-in-range",
              number: "R-PAID",
              created_at: "2026-06-20T12:00:00Z",
              placed_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "35.00",
              line_items: [{ id: "line-1", product_title: "Paid Product", quantity: 1, price: "35.00" }]
            }],
            cursor: ""
          }
        },
        headers: {}
      });

    const result = await fetchStoreOrdersCanonical({
      platform: "shoplazza",
      storeId: 2,
      domain: "lachry.myshoplaza.com",
      token: "shoplazza-token",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      timezone: "America/Los_Angeles",
      timezoneSource: "manual_verified"
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: "paid-in-range",
      attributionField: "placed_at",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01"
    });
    expect(result.diagnostics.queryDateFields).toEqual(["created_at", "placed_at"]);
    expect(result.diagnostics.deduplicatedOrderCount).toBe(1);
    expect(result.coverageComplete).toBe(true);
  });

  it("SHOPLAZZA-DATE-07 applies attribution per order instead of using a batch-level best field", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "created-only",
              number: "R-CREATED",
              created_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "22.00",
              line_items: [{ id: "line-1", product_title: "Created Product", quantity: 1, price: "22.00" }]
            }],
            cursor: ""
          }
        },
        headers: {}
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "placed-only",
              number: "R-PLACED",
              created_at: "2026-06-20T12:00:00Z",
              placed_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "35.00",
              line_items: [{ id: "line-1", product_title: "Placed Product", quantity: 1, price: "35.00" }]
            }],
            cursor: ""
          }
        },
        headers: {}
      });

    const result = await fetchStoreOrdersCanonical({
      platform: "shoplazza",
      storeId: 2,
      domain: "lachry.myshoplaza.com",
      token: "shoplazza-token",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      timezone: "America/Los_Angeles",
      timezoneSource: "manual_verified"
    });

    expect(result.orders.map(order => [order.orderId, order.attributionField, order.storeLocalDate])).toEqual([
      ["created-only", "created_at", "2026-07-01"],
      ["placed-only", "placed_at", "2026-07-01"]
    ]);
    expect(result.diagnostics.attributionField).toBe("per_order");
  });

  it("SHOPLAZZA-DATE-05 fixes attribution to created_at when only created_at is available", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "created-only",
              number: "R-CREATED",
              created_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "22.00",
              line_items: [{ id: "line-1", product_title: "Created Product", quantity: 1, price: "22.00" }]
            }],
            cursor: ""
          }
        },
        headers: {}
      })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} });

    const result = await fetchStoreOrdersCanonical({
      platform: "shoplazza",
      storeId: 2,
      domain: "lachry.myshoplaza.com",
      token: "shoplazza-token",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      timezone: "America/Los_Angeles",
      timezoneSource: "manual_verified"
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: "created-only",
      attributionField: "created_at",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01"
    });
    expect(result.coverageComplete).toBe(true);
  });
});
