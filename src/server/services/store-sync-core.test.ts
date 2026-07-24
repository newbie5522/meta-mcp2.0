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
            paid_at: "2026-07-02T06:35:00Z",
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
      rawPaidAt: "2026-07-02T06:35:00Z",
      attributionField: "paid_at",
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
            paid_at: "2026-07-02T06:35:00Z",
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

  it("SLZ-TZ-CORE-01 system_default still derives Order.store_local_date from America/Los_Angeles", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      data: {
        data: {
          orders: [{
            id: "slz-system-tz",
            number: "R-SYSTEM-TZ",
            created_at: "2026-07-02T06:30:00Z",
            placed_at: "2026-07-02T06:30:00Z",
            paid_at: "2026-07-02T06:30:00Z",
            payment_status: "paid",
            status: "finished",
            total_price: "80.00",
            line_items: [{ id: "line-1", product_title: "System TZ Product", quantity: 1, price: "80.00" }]
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
      timezoneSource: "system_default"
    });

    expect(result.orders[0]).toMatchObject({
      orderId: "slz-system-tz",
      attributionField: "paid_at",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01",
      storeTimezone: "America/Los_Angeles"
    });
    expect(result.diagnostics).toMatchObject({
      timezoneAfter: "America/Los_Angeles",
      timezoneSource: "system_default"
    });
  });

  it("SHOPLAZZA-DATE-02/06 includes paid_at in-range orders and derives store_local_date from final payment time", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: { data: { orders: [], cursor: "" } },
        headers: {}
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "paid-in-range",
              number: "R-PAID",
              created_at: "2026-06-20T12:00:00Z",
              placed_at: "2026-07-02T06:30:00Z",
              paid_at: "2026-07-02T06:30:00Z",
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
      attributionField: "paid_at",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01"
    });
    expect(result.diagnostics.queryDateFields).toEqual(["created_at", "placed_at", "paid_at"]);
    expect(result.diagnostics.deduplicatedOrderCount).toBe(1);
    expect(result.coverageComplete).toBe(true);
  });

  it("SHOPLAZZA-DATE-07 uses paid_at for every sales order instead of created_at or placed_at", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "created-only",
              number: "R-CREATED",
              created_at: "2026-07-02T06:30:00Z",
              paid_at: "2026-07-02T06:30:00Z",
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
              paid_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "35.00",
              line_items: [{ id: "line-1", product_title: "Placed Product", quantity: 1, price: "35.00" }]
            }],
            cursor: ""
          }
        },
        headers: {}
      })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} })
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

    expect(result.orders.map(order => [order.orderId, order.attributionField, order.storeLocalDate])).toEqual([
      ["created-only", "paid_at", "2026-07-01"],
      ["placed-only", "paid_at", "2026-07-01"]
    ]);
    expect(result.diagnostics.attributionField).toBe("paid_at");
  });

  it("SHOPLAZZA-DATE-05 rejects paid orders when final paid_at is unavailable", async () => {
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
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} })
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

    expect(result.orders).toHaveLength(0);
    expect(result.coverageComplete).toBe(false);
    expect(result.failedSlices).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderId: "created-only", reason: "ATTRIBUTION_TIME_UNAVAILABLE" })
    ]));
  });

  it("DST-01 uses distinct start and end offsets across DST boundary", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} });

    const result = await fetchStoreOrdersCanonical({
      platform: "shoplazza",
      storeId: 3,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-10-31",
      endDate: "2026-11-03",
      timezone: "America/Los_Angeles"
    });

    expect(result.diagnostics.requestStartAt).toContain("-07:00");
    expect(result.diagnostics.requestEndAt).toContain("-08:00");
    expect(result.diagnostics.expandedStartAt).toContain("-07:00");
    expect(result.diagnostics.expandedEndAt).toContain("-08:00");
  });

  it("ATTR-01 uses paid_at for Shoplazza orders even when placed_at is absent", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "attr-created",
              number: "R-CREATED",
              created_at: "2026-07-02T06:30:00Z",
              paid_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "18.00",
              line_items: [{ id: "line-1", product_title: "Created Attribution Product", quantity: 1, price: "18.00" }]
            }],
            cursor: ""
          }
        },
        headers: {}
      })
      .mockResolvedValueOnce({ status: 200, data: { data: { orders: [], cursor: "" } }, headers: {} })
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

    expect(result.orders[0]).toMatchObject({
      orderId: "attr-created",
      attributionField: "paid_at",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01"
    });
  });

  it("ATTR-02 excludes Shoplazza orders with no placed_at or created_at and marks coverage incomplete", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "attr-missing",
              number: "R-MISSING",
              payment_status: "paid",
              status: "finished",
              total_price: "18.00",
              line_items: [{ id: "line-1", product_title: "Missing Attribution Product", quantity: 1, price: "18.00" }]
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

    expect(result.orders).toEqual([]);
    expect(result.coverageComplete).toBe(false);
    expect(result.failedSlices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        orderId: "attr-missing",
        reason: "ATTRIBUTION_TIME_UNAVAILABLE"
      })
    ]));
  });

  it("ATTR-03 keeps final payment attribution for mixed created_at and placed_at audit fields", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            orders: [{
              id: "created-at-order",
              number: "R-CREATED",
              created_at: "2026-07-02T06:30:00Z",
              paid_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "21.00",
              line_items: [{ id: "line-1", product_title: "Created Product", quantity: 1, price: "21.00" }]
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
              id: "placed-at-order",
              number: "R-PLACED",
              created_at: "2026-06-20T12:00:00Z",
              placed_at: "2026-07-02T06:30:00Z",
              paid_at: "2026-07-02T06:30:00Z",
              payment_status: "paid",
              status: "finished",
              total_price: "34.00",
              line_items: [{ id: "line-1", product_title: "Placed Product", quantity: 1, price: "34.00" }]
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

    expect(result.orders.map(order => ({
      orderId: order.orderId,
      attributionField: order.attributionField,
      attributionTimeRaw: order.attributionTimeRaw,
      storeLocalDate: order.storeLocalDate
    }))).toEqual([
      {
        orderId: "created-at-order",
        attributionField: "paid_at",
        attributionTimeRaw: "2026-07-02T06:30:00Z",
        storeLocalDate: "2026-07-01"
      },
      {
        orderId: "placed-at-order",
        attributionField: "paid_at",
        attributionTimeRaw: "2026-07-02T06:30:00Z",
        storeLocalDate: "2026-07-01"
      }
    ]);
  });
});
