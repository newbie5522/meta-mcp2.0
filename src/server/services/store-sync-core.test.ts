import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosGet } = vi.hoisted(() => ({
  axiosGet: vi.fn()
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));

import { fetchStoreOrdersCanonical, resolveSuccessfulPayment } from "./store-sync-core";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("store sync core verified timezone contract", () => {
  it("PAYMENT-SL-01 resolves SHOPLINE payment_details paid + processed_at + pay_amount", () => {
    expect(resolveSuccessfulPayment({
      payment_details: [{ pay_status: "paid", processed_at: "2026-06-30T08:13:50-07:00", create_time: "2026-06-30T08:13:44-07:00", pay_amount: 47.98 }]
    }, "shopline")).toMatchObject({
      paid: true,
      paidAt: "2026-06-30T08:13:50-07:00",
      paidAmount: 47.98,
      statusSourcePath: "payment_details[0].pay_status",
      timeSourcePath: "payment_details[0].processed_at",
      amountSourcePath: "payment_details[0].pay_amount"
    });
  });

  it("PAYMENT-SL-02 pending + processed_at is not successful payment", () => {
    expect(resolveSuccessfulPayment({
      payment_details: [{ pay_status: "pending", processed_at: "2026-06-30T08:13:50-07:00", pay_amount: 47.98 }]
    }, "shopline")).toMatchObject({ paid: false, paidAt: null, reason: "SHOPLINE_PAYMENT_NOT_SUCCESSFUL" });
  });

  it("PAYMENT-SL-03 failed + processed_at is not successful payment", () => {
    expect(resolveSuccessfulPayment({
      payment_details: [{ pay_status: "paid_failed", processed_at: "2026-06-30T08:13:50-07:00", pay_amount: 47.98 }]
    }, "shopline")).toMatchObject({ paid: false, paidAt: null, reason: "SHOPLINE_PAYMENT_NOT_SUCCESSFUL" });
  });

  it("PAYMENT-SL-04 create_time without successful record is not payment success time", () => {
    expect(resolveSuccessfulPayment({
      payment_details: [{ pay_status: "unpaid", create_time: "2026-06-30T08:13:44-07:00", pay_amount: 47.98 }]
    }, "shopline")).toMatchObject({ paid: false, paidAt: null });
  });

  it("PAYMENT-SL-05 top-level processed_at does not replace payment_details success processed_at", () => {
    expect(resolveSuccessfulPayment({
      processed_at: "2026-06-30T08:13:50-07:00",
      payment_details: [{ pay_status: "pending", processed_at: "2026-06-30T08:13:50-07:00", pay_amount: 47.98 }]
    }, "shopline")).toMatchObject({ paid: false, paidAt: null });
  });

  it("PAYMENT-SL-06 resolves real Kolaich sample order 21075917626456041426811369", () => {
    expect(resolveSuccessfulPayment({
      financial_status: "paid",
      processed_at: "2026-06-30T08:13:50-07:00",
      created_at: "2026-06-30T08:13:44-07:00",
      updated_at: "2026-07-08T19:01:10-07:00",
      current_total_price: "47.98",
      payment_details: [{ pay_status: "paid", processed_at: "2026-06-30T08:13:50-07:00", create_time: "2026-06-30T08:13:44-07:00", pay_amount: 47.98 }]
    }, "shopline")).toMatchObject({
      paid: true,
      paidAt: "2026-06-30T08:13:50-07:00",
      paidAmount: 47.98,
      timeSourcePath: "payment_details[0].processed_at"
    });
  });

  it("PAYMENT-SHOPIFY-01 resolves successful capture transaction", () => {
    expect(resolveSuccessfulPayment({
      processedAt: "2026-07-01T00:00:00Z",
      transactions: [{ kind: "capture", status: "success", processedAt: "2026-07-02T06:30:00Z", amount: "20.00" }]
    }, "shopify")).toMatchObject({
      paid: true,
      paidAt: "2026-07-02T06:30:00Z",
      paidAmount: 20,
      statusSourcePath: "transactions[0].status",
      timeSourcePath: "transactions[0].processedAt"
    });
  });

  it("PAYMENT-SHOPIFY-02 pending transaction is not paid", () => {
    expect(resolveSuccessfulPayment({
      transactions: [{ kind: "capture", status: "pending", processedAt: "2026-07-02T06:30:00Z", amount: "20.00" }]
    }, "shopify")).toMatchObject({ paid: false, paidAt: null });
  });

  it("PAYMENT-SHOPIFY-03 failed transaction is not paid", () => {
    expect(resolveSuccessfulPayment({
      transactions: [{ kind: "sale", status: "failure", processedAt: "2026-07-02T06:30:00Z", amount: "20.00" }]
    }, "shopify")).toMatchObject({ paid: false, paidAt: null });
  });

  it("PAYMENT-SHOPIFY-04 order.processedAt without successful transaction is not paid", () => {
    expect(resolveSuccessfulPayment({
      processedAt: "2026-07-02T06:30:00Z",
      transactions: []
    }, "shopify")).toMatchObject({ paid: false, paidAt: null, reason: "SHOPIFY_TRANSACTIONS_UNAVAILABLE" });
  });

  it("PAYMENT-SLZ-01 resolves real Romanticed sample order 254906207565668829056", () => {
    expect(resolveSuccessfulPayment({
      financial_status: "paid",
      status: "placed",
      placed_at: "2026-07-18T09:12:44Z",
      total_price: "45.94",
      sub_total: "36.95",
      total_paid: "45.94",
      payment_lines: [{ payment_channel: "paypal", transaction_no: "2EV25978GA662562N", paid_total: "45.94" }]
    }, "shoplazza")).toMatchObject({
      paid: true,
      paidAt: "2026-07-18T09:12:44Z",
      paidAmount: 45.94,
      statusSourcePath: "financial_status",
      timeSourcePath: "placed_at",
      amountSourcePath: "total_paid"
    });
  });

  it("PAYMENT-SLZ-02 financial_status paid without verified payment time is partial/unpaid for sales facts", () => {
    expect(resolveSuccessfulPayment({
      financial_status: "paid",
      total_price: "45.94"
    }, "shoplazza")).toMatchObject({ paid: false, paidAt: null, reason: "SHOPLAZZA_PAYMENT_TIME_UNVERIFIED" });
  });

  it("PAYMENT-SLZ-03 pending with a time field is not paid", () => {
    expect(resolveSuccessfulPayment({
      financial_status: "pending",
      placed_at: "2026-07-18T09:12:44Z",
      total_price: "45.94"
    }, "shoplazza")).toMatchObject({ paid: false, paidAt: null, reason: "SHOPLAZZA_PAYMENT_NOT_SUCCESSFUL" });
  });

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
    expect(result.diagnostics.paginationTermination).toBe("NATURAL_END");
    expect(result.diagnostics.queryDateFields).toEqual(["created_at", "updated_at"]);
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

    expect(axiosGet).toHaveBeenCalledTimes(100);
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
      attributionField: "successful_payment",
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
      attributionField: "successful_payment",
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
    axiosGet.mockResolvedValueOnce({
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
      attributionField: "successful_payment",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01"
    });
    expect(result.diagnostics.queryDateFields).toEqual(["paid_at"]);
    expect(result.diagnostics.deduplicatedOrderCount).toBe(1);
    expect(result.coverageComplete).toBe(true);
  });

  it("SHOPLAZZA-DATE-07 uses paid_at for every sales order instead of created_at or placed_at", async () => {
    axiosGet.mockResolvedValueOnce({
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
            }, {
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
      ["created-only", "successful_payment", "2026-07-01"],
      ["placed-only", "successful_payment", "2026-07-01"]
    ]);
    expect(result.diagnostics.attributionField).toBe("successful_payment");
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

    expect(result.orders[0]).toMatchObject({
      orderId: "attr-created",
      attributionField: "successful_payment",
      attributionTimeRaw: "2026-07-02T06:30:00Z",
      storeLocalDate: "2026-07-01"
    });
  });

  it("ATTR-02 excludes Shoplazza paid orders with no paid_at and marks coverage incomplete", async () => {
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
    axiosGet.mockResolvedValueOnce({
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
            }, {
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

    expect(result.orders.map(order => ({
      orderId: order.orderId,
      attributionField: order.attributionField,
      attributionTimeRaw: order.attributionTimeRaw,
      storeLocalDate: order.storeLocalDate
    }))).toEqual([
      {
        orderId: "created-at-order",
        attributionField: "successful_payment",
        attributionTimeRaw: "2026-07-02T06:30:00Z",
        storeLocalDate: "2026-07-01"
      },
      {
        orderId: "placed-at-order",
        attributionField: "successful_payment",
        attributionTimeRaw: "2026-07-02T06:30:00Z",
        storeLocalDate: "2026-07-01"
      }
    ]);
  });

  it("PAYMENT-RANGE-01 syncs an order created before the range and paid inside the range", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: [] }, headers: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [{
            id: "early-created-late-paid",
            created_at: "2026-06-15T10:00:00Z",
            updated_at: "2026-07-02T06:40:00Z",
            financial_status: "paid",
            total_price: "102.99",
            payment_details: [{ pay_status: "paid", processed_at: "2026-07-02T06:30:00Z", pay_amount: 102.99 }],
            line_items: [{ id: "line-1", product_id: "p1", title: "Paid Product", quantity: 1, price: "102.99" }]
          }]
        },
        headers: {}
      });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 3,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: "early-created-late-paid",
      attributionField: "successful_payment",
      storeLocalDate: "2026-07-01",
      orderTotal: 102.99
    });
    expect(result.diagnostics.queryDateFields).toEqual(["created_at", "updated_at"]);
    expect(axiosGet.mock.calls[1][0]).toContain("updated_at_min=");
  });

  it("PAYMENT-RANGE-02 excludes an order created inside the range but paid outside the range", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [{
            id: "created-in-range-paid-later",
            created_at: "2026-07-02T06:30:00Z",
            updated_at: "2026-07-04T06:30:00Z",
            financial_status: "paid",
            total_price: "50.00",
            payment_details: [{ pay_status: "paid", processed_at: "2026-07-04T06:30:00Z", pay_amount: 50 }],
            line_items: [{ id: "line-1", product_id: "p1", title: "Late Product", quantity: 1, price: "50.00" }]
          }]
        },
        headers: {}
      })
      .mockResolvedValueOnce({ status: 200, data: { data: [] }, headers: {} });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 3,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(result.orders).toEqual([]);
    expect(result.diagnostics.validOrdersCount).toBe(0);
    expect(result.coverageComplete).toBe(true);
  });

  it("PAYMENT-RANGE-03 excludes pending orders without successful payment from order count and gross sales", async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [{
            id: "pending-no-paid-at",
            created_at: "2026-07-02T06:30:00Z",
            updated_at: "2026-07-02T06:40:00Z",
            financial_status: "pending",
            total_price: "102.99",
            payment_details: [{ pay_status: "pending", processed_at: "2026-07-02T06:40:00Z", pay_amount: 102.99 }],
            line_items: [{ id: "line-1", product_id: "p1", title: "Pending Product", quantity: 1, price: "102.99" }]
          }]
        },
        headers: {}
      })
      .mockResolvedValueOnce({ status: 200, data: { data: [] }, headers: {} });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 3,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(result.orders).toEqual([]);
    expect(result.diagnostics.validOrdersCount).toBe(0);
    expect(result.diagnostics.validPaidTotal).toBe(0);
    expect(result.coverageComplete).toBe(true);
  });

  it("PAYMENT-RANGE-04 assigns a pending-then-paid order to the final payment date", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { data: [] }, headers: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          orders: [{
            id: "pending-then-paid",
            created_at: "2026-06-28T08:00:00Z",
            updated_at: "2026-07-05T08:10:00Z",
            financial_status: "paid",
            total_price: "77.00",
            transactions: [{ kind: "capture", status: "success", processedAt: "2026-07-05T08:00:00Z", amount: "77.00" }],
            line_items: [{ id: "line-1", product_id: "p1", title: "Delayed Payment", quantity: 1, price: "77.00" }]
          }]
        },
        headers: {}
      });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopify",
      storeId: 4,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-05",
      endDate: "2026-07-05",
      timezone: "America/Los_Angeles"
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: "pending-then-paid",
      attributionTimeRaw: "2026-07-05T08:00:00Z",
      storeLocalDate: "2026-07-05"
    });
  });

  it("PAYMENT-RANGE-05 keeps refunded gross sales in the original sale while tracking refund amount separately", async () => {
    axiosGet
      .mockResolvedValueOnce({ status: 200, data: { orders: [] }, headers: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          orders: [{
            id: "refunded-paid-order",
            created_at: "2026-06-25T08:00:00Z",
            updated_at: "2026-07-03T08:10:00Z",
            financial_status: "refunded",
            total_price: "88.00",
            total_refunded_amount: "88.00",
            transactions: [{ kind: "sale", status: "success", processedAt: "2026-07-03T08:00:00Z", amount: "88.00" }],
            line_items: [{ id: "line-1", product_id: "p1", title: "Refunded Product", quantity: 1, price: "88.00" }]
          }]
        },
        headers: {}
      });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopify",
      storeId: 4,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-03",
      endDate: "2026-07-03",
      timezone: "America/Los_Angeles"
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].orderTotal).toBe(88);
    expect(result.orders[0].refundedAmount).toBe(88);
    expect(result.diagnostics.validOrdersCount).toBe(1);
    expect(result.diagnostics.validPaidTotal).toBe(88);
  });

  it("PAYMENT-RANGE-06 marks candidate coverage incomplete when a payment range candidate slice is truncated", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      data: { data: [{ id: "page-limit-order", financial_status: "paid", payment_details: [{ pay_status: "paid", processed_at: "2026-07-02T08:00:00Z", pay_amount: 10 }], line_items: [] }] },
      headers: { link: '<https://shop.example.com/admin/openapi/v20260601/orders.json?page_info=next>; rel="next"' }
    });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 3,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(result.coverageComplete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.diagnostics.paginationTermination).toBe("PAGE_LIMIT");
    expect(result.failedSlices).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "PAGE_LIMIT" })
    ]));
  });
});
