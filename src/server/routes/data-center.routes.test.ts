import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    campaign: { findMany: vi.fn() },
    adSet: { findMany: vi.fn() },
    ad: { findMany: vi.fn() },
    factMetaPerformance: { findMany: vi.fn() },
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    order: { findMany: vi.fn() },
    dataCenterStoreDaily: { findMany: vi.fn() }
  }
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({ normalizeMetaAccountId: (value: string) => value }));

import {
  audienceMetaMetric,
  buildStoreApiDisplayMetrics,
  buildStoreTimezoneDisplay,
  buildAudienceMetaSummaryFromVisibleRows,
  createCreativeAnalyzeHandler,
  createDataCenterHierarchyHandler,
  reconcileCoverageWithVisibleRows,
  reconcileAudienceCoverageWithFactRows
} from "./data-center.routes";
import dataCenterRouter from "./data-center.routes";

function responseMock() {
  const response: any = {
    statusCode: 200,
    body: null,
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    })
  };
  return response;
}

async function invoke(handler: any, query: any) {
  const response = responseMock();
  await handler({ query }, response);
  return response;
}

function getRouteHandler(path: string) {
  const layer = (dataCenterRouter as any).stack.find((item: any) => item.route?.path === path);
  if (!layer) throw new Error(`Route not found: ${path}`);
  return layer.route.stack[0].handle;
}

async function invokeDataCenterRoute(path: string, input: { query?: any; params?: any }) {
  const response = responseMock();
  await getRouteHandler(path)({ query: input.query || {}, params: input.params || {} }, response);
  return response;
}

describe("Audience coverage route helpers", () => {
  const row = (date = "2026-07-19") => ({ date, spend: 10 });

  it("AUD-ROUTE-01 NOT_SYNCED + dbRows > 0 resolves PARTIAL_COVERAGE", () => {
    const coverage = reconcileAudienceCoverageWithFactRows({ status: "NOT_SYNCED" }, [row()]);
    expect(coverage.status).toBe("PARTIAL_COVERAGE");
    expect(coverage.allowCurrentFactsWhileRunning).toBe(false);
    expect(coverage.rangeRowCount).toBe(1);
  });

  it("AUD-ROUTE-02 TRUE_EMPTY + dbRows > 0 resolves PARTIAL_COVERAGE", () => {
    expect(reconcileAudienceCoverageWithFactRows({ status: "TRUE_EMPTY" }, [row()]).status).toBe("PARTIAL_COVERAGE");
  });

  it("AUD-ROUTE-03 NOT_SYNCED + dbRows = 0 keeps rows unavailable and metrics null", () => {
    const coverage = reconcileAudienceCoverageWithFactRows({ status: "NOT_SYNCED" }, []);
    expect(coverage.status).toBe("NOT_SYNCED");
    expect(audienceMetaMetric(coverage, false, 10, "additive")).toBeNull();
  });

  it("AUD-ROUTE-04 TRUE_EMPTY + dbRows = 0 renders additive zero and ratios null", () => {
    const coverage = reconcileAudienceCoverageWithFactRows({ status: "TRUE_EMPTY" }, []);
    expect(audienceMetaMetric(coverage, false, 10, "additive")).toBe(0);
    expect(audienceMetaMetric(coverage, false, 1.5, "ratio")).toBeNull();
  });

  it("AUD-ROUTE-05 SYNC_RUNNING + dbRows > 0 allows current persisted facts", () => {
    const coverage = reconcileAudienceCoverageWithFactRows({ status: "SYNC_RUNNING" }, [row()]);
    expect(coverage.status).toBe("SYNC_RUNNING");
    expect(coverage.allowCurrentFactsWhileRunning).toBe(true);
    expect(audienceMetaMetric(coverage, true, 10, "additive")).toBe(10);
  });

  it("AUD-ROUTE-06 ERROR + dbRows > 0 keeps rows and metrics hidden", () => {
    const coverage = reconcileAudienceCoverageWithFactRows({ status: "ERROR" }, [row()]);
    expect(coverage.status).toBe("ERROR");
    expect(coverage.allowCurrentFactsWhileRunning).toBe(false);
    expect(audienceMetaMetric(coverage, true, 10, "additive")).toBeNull();
  });

  it("AUD-ROUTE-09 exact row dates are carried into effective coverage", () => {
    const coverage = reconcileAudienceCoverageWithFactRows({ status: "PARTIAL_COVERAGE" }, [row("2026-07-18"), row("2026-07-19")]);
    expect(coverage.earliestAvailableDate).toBe("2026-07-18");
    expect(coverage.latestAvailableDate).toBe("2026-07-19");
  });

  it("AUD-COV-01 never leaves current visible rows under NOT_SYNCED coverage", () => {
    const coverage = reconcileCoverageWithVisibleRows({ status: "NOT_SYNCED" }, [{ dimensionValue: "US", spend: 10 }], {
      coverageBasis: "FACT_ROWS_ONLY",
      message: "current rows exist"
    });

    expect(coverage.status).toBe("PARTIAL_COVERAGE");
    expect(coverage.status).not.toBe("NOT_SYNCED");
    expect(coverage.rangeRowCount).toBe(1);
  });

  it("AUD-SUM-01 builds Meta KPI summary only from currently visible rows", () => {
    const visibleRows = [
      { spend: 10, impressions: 100, clicks: 5, purchases: 1, purchaseValue: 30 },
      { spend: 20, impressions: 300, clicks: 15, purchases: 2, purchaseValue: 90 }
    ];

    const summary = buildAudienceMetaSummaryFromVisibleRows(visibleRows, { status: "READY" }, true);

    expect(summary.meta).toMatchObject({
      spend: 30,
      impressions: 400,
      clicks: 20,
      purchases: 3,
      purchaseValue: 120,
      ctr: 0.05,
      cpc: 1.5,
      cpm: 75,
      cpa: 10,
      roas: 4
    });
  });

  it("AUD-FILTER-01 does not include filtered-out rows in Meta KPI summary", () => {
    const allRows = [
      { spend: 5, impressions: 100, clicks: 10, purchases: 1, purchaseValue: 20 },
      { spend: 50, impressions: 500, clicks: 25, purchases: 5, purchaseValue: 200 }
    ];
    const visibleRows = allRows.filter(row => row.spend >= 10);

    const summary = buildAudienceMetaSummaryFromVisibleRows(visibleRows, { status: "READY" }, true);

    expect(summary.meta.spend).toBe(50);
    expect(summary.meta.purchaseValue).toBe(200);
    expect(summary.meta.purchases).toBe(5);
  });

  it("AUD-ERR-01 true error coverage keeps metrics unavailable instead of wrapping as empty data", () => {
    const coverage = reconcileCoverageWithVisibleRows({ status: "ERROR" }, [{ dimensionValue: "US", spend: 10 }], {
      coverageBasis: "FACT_ROWS_ONLY",
      message: "current rows exist"
    });
    const summary = buildAudienceMetaSummaryFromVisibleRows([{ spend: 10, impressions: 100, clicks: 5, purchases: 1, purchaseValue: 30 }], coverage, true);

    expect(coverage.status).toBe("ERROR");
    expect(summary.meta.spend).toBeNull();
  });

  it("COUNTRY-COV-01 reconciles country rows with NOT_SYNCED coverage before response", () => {
    const coverage = reconcileCoverageWithVisibleRows({ status: "NOT_SYNCED" }, [{ country: "US", orderCount: 2, revenue: 50 }], {
      coverageBasis: "ORDER_COUNTRY_ROWS_ONLY",
      message: "country rows exist"
    });

    expect(coverage.status).toBe("PARTIAL_COVERAGE");
    expect(coverage.rangeRowCount).toBe(1);
  });
});

describe("Store API display metrics", () => {
  it("STORE-SLZ-01 preserves Shoplazza ledger order and sales values under partial coverage", () => {
    const metrics = buildStoreApiDisplayMetrics({
      orderCount: 3,
      revenue: 150,
      adSpend: 50,
      storeCoverage: { status: "PARTIAL_COVERAGE" },
      metaCoverage: { status: "READY" }
    });

    expect(metrics).toMatchObject({
      visibleOrderCount: 3,
      visibleRevenue: 150,
      visibleAov: 50,
      visibleAdSpend: 50,
      roas: 3,
      hasOrders: true
    });
  });

  it("STORE-SLZ-02 distinguishes zero orders from unavailable store facts", () => {
    const trueEmpty = buildStoreApiDisplayMetrics({
      orderCount: 0,
      revenue: 0,
      adSpend: 0,
      storeCoverage: { status: "TRUE_EMPTY" },
      metaCoverage: { status: "TRUE_EMPTY" }
    });
    const notSynced = buildStoreApiDisplayMetrics({
      orderCount: 0,
      revenue: 0,
      adSpend: 0,
      storeCoverage: { status: "NOT_SYNCED" },
      metaCoverage: { status: "NOT_SYNCED" }
    });

    expect(trueEmpty.visibleOrderCount).toBe(0);
    expect(trueEmpty.visibleRevenue).toBe(0);
    expect(trueEmpty.visibleAov).toBe(0);
    expect(trueEmpty.hasOrders).toBe(false);
    expect(notSynced.visibleOrderCount).toBeNull();
    expect(notSynced.visibleRevenue).toBeNull();
    expect(notSynced.visibleAov).toBeNull();
    expect(notSynced.hasOrders).toBeNull();
  });

  it("STORE-SLZ-03 does not wrap true coverage errors as empty store data", () => {
    const metrics = buildStoreApiDisplayMetrics({
      orderCount: 2,
      revenue: 80,
      adSpend: 20,
      storeCoverage: { status: "ERROR" },
      metaCoverage: { status: "READY" }
    });

    expect(metrics.visibleOrderCount).toBeNull();
    expect(metrics.visibleRevenue).toBeNull();
    expect(metrics.visibleAov).toBeNull();
    expect(metrics.roas).toBeNull();
  });

  it("STORE-SLZ-04 only calculates ROAS when both store revenue and mapped ad spend are visible", () => {
    expect(buildStoreApiDisplayMetrics({
      orderCount: 2,
      revenue: 100,
      adSpend: 25,
      storeCoverage: { status: "READY" },
      metaCoverage: { status: "READY" }
    }).roas).toBe(4);

    expect(buildStoreApiDisplayMetrics({
      orderCount: 2,
      revenue: 100,
      adSpend: 25,
      storeCoverage: { status: "READY" },
      metaCoverage: { status: "NOT_SYNCED" }
    }).roas).toBeNull();
  });

  it("STORE-SLZ-05 treats running coverage as visible only when current facts are explicitly allowed", () => {
    const allowed = buildStoreApiDisplayMetrics({
      orderCount: 1,
      revenue: 20,
      adSpend: 10,
      storeCoverage: { status: "RUNNING", allowCurrentFactsWhileRunning: true },
      metaCoverage: { status: "RUNNING", allowCurrentFactsWhileRunning: true }
    });
    const blocked = buildStoreApiDisplayMetrics({
      orderCount: 1,
      revenue: 20,
      adSpend: 10,
      storeCoverage: { status: "RUNNING" },
      metaCoverage: { status: "RUNNING" }
    });

    expect(allowed.visibleOrderCount).toBe(1);
    expect(allowed.roas).toBe(2);
    expect(blocked.visibleOrderCount).toBeNull();
    expect(blocked.roas).toBeNull();
  });

  it("STORE-SLZ-TZ-01/02/03 system_default keeps real order, grossSales, and AOV values visible", () => {
    const metrics = buildStoreApiDisplayMetrics({
      orderCount: 2,
      revenue: 80,
      adSpend: 20,
      storeCoverage: { status: "READY" },
      metaCoverage: { status: "READY" }
    });
    const timezone = buildStoreTimezoneDisplay({
      store: { id: 2, name: "Romanticed", timezone: "" },
      storeRows: [{
        timezone: "America/Los_Angeles",
        diagnosticsJson: JSON.stringify({
          timezone: "America/Los_Angeles",
          timezoneSource: "system_default"
        }),
        apiFetchedAt: new Date("2026-07-02T00:00:00.000Z")
      }]
    });

    expect(metrics.visibleOrderCount).toBe(2);
    expect(metrics.visibleRevenue).toBe(80);
    expect(metrics.visibleAov).toBe(40);
    expect(timezone).toMatchObject({
      timezone: "America/Los_Angeles",
      timezoneSource: "system_default",
      temporaryTimezoneFallback: true
    });
  });

  it("STORE-SLZ-TZ-04 system_default does not turn syncStatus into failed or partial", () => {
    const coverage = { status: "READY" };
    const metrics = buildStoreApiDisplayMetrics({
      orderCount: 1,
      revenue: 50,
      adSpend: 25,
      storeCoverage: coverage,
      metaCoverage: { status: "READY" }
    });
    const timezone = buildStoreTimezoneDisplay({
      store: { timezone: "" },
      storeRows: [{ diagnosticsJson: JSON.stringify({ timezoneSource: "system_default" }) }]
    });

    expect(metrics.visibleOrderCount).toBe(1);
    expect(timezone.timezoneSource).toBe("system_default");
    expect(coverage.status).toBe("READY");
    expect(coverage.status).not.toBe("FAILED");
    expect(coverage.status).not.toBe("PARTIAL_COVERAGE");
  });

  it("STORE-SLZ-TZ-05 true permission coverage errors remain unavailable", () => {
    const metrics = buildStoreApiDisplayMetrics({
      orderCount: 1,
      revenue: 50,
      adSpend: 25,
      storeCoverage: { status: "ERROR", error: "STORE_TIMEZONE_PERMISSION_DENIED" },
      metaCoverage: { status: "READY" }
    });

    expect(metrics.visibleOrderCount).toBeNull();
    expect(metrics.visibleRevenue).toBeNull();
    expect(metrics.roas).toBeNull();
  });
});

describe("Data Center store-orders route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.store.findMany.mockResolvedValue([
      { id: 2, name: "Romanticed", platform: "shoplazza", timezone: "America/Los_Angeles" }
    ]);
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "line-2",
        storeId: 2,
        orderId: "order-1",
        store_local_date: "2026-07-02",
        store_local_datetime: "2026-07-02T10:00:00",
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
        created_at_utc: new Date("2026-07-02T17:00:00.000Z"),
        store_timezone: "America/Los_Angeles",
        orderTotal: 100,
        revenue: 40,
        profit: 0,
        refunded: false,
        paymentStatus: "paid",
        fulfillmentStatus: "shipped",
        shippingCountryCode: "US",
        billingCountryCode: "US",
        countrySource: "shipping",
        raw_payload: "{\"token\":\"secret\"}"
      }
    ]);
  });

  it("STORE-ORDERS-01 returns 200 without relying on an Order.store relation", async () => {
    const response = await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.not.objectContaining({
      include: expect.anything()
    }));
    expect(response.body.rows).toHaveLength(1);
  });

  it("STORE-ORDERS-02 hydrates Store fields through a separate Store query", async () => {
    const response = await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });

    expect(prismaMock.store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [2] } },
      select: expect.objectContaining({ name: true, platform: true, timezone: true })
    }));
    expect(response.body.rows[0]).toMatchObject({
      storeName: "Romanticed",
      platform: "shoplazza",
      timezone: "America/Los_Angeles"
    });
  });

  it("STORE-ORDERS-03 filters dates only by Order.store_local_date", async () => {
    await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        store_local_date: { gte: "2026-07-01", lte: "2026-07-02" },
        storeId: 2
      }
    }));
    expect(JSON.stringify(prismaMock.order.findMany.mock.calls[0][0].where)).not.toContain("createdAt");
  });

  it("STORE-ORDERS-04 applies storeId without crossing stores", async () => {
    await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });

    expect(prismaMock.order.findMany.mock.calls[0][0].where.storeId).toBe(2);
  });

  it("STORE-ORDERS-05 builds summary from the same filtered rows", async () => {
    const response = await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });

    expect(response.body.summary).toMatchObject({
      rowCount: response.body.rows.length,
      orderCount: 1,
      grossSales: 100
    });
  });

  it("STORE-ORDERS-06 uses the same filtered rows for pagination total", async () => {
    const response = await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });

    expect(response.body.pagination.total).toBe(response.body.rows.length);
    expect(response.body.count).toBe(response.body.rows.length);
  });

  it("STORE-ORDERS-07 returns a true error when the database query fails", async () => {
    prismaMock.order.findMany.mockRejectedValueOnce(new Error("DB_DOWN"));
    const response = await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.body.details).toBe("DB_DOWN");
  });

  it("STORE-ORDERS-08 does not expose tokens, raw payloads, or raw customer PII in rows", async () => {
    const response = await invokeDataCenterRoute("/store-orders", {
      query: { startDate: "2026-07-01", endDate: "2026-07-02", storeId: "2" }
    });
    const serialized = JSON.stringify(response.body.rows);

    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("raw_payload");
    expect(response.body.rows[0]).not.toHaveProperty("customerName");
  });
});

describe("Data Center store reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.store.findUnique.mockResolvedValue({
      id: 2,
      name: "Romanticed",
      platform: "shoplazza",
      timezone: "America/Los_Angeles"
    });
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "line-1",
        storeId: 2,
        orderId: "order-1",
        store_local_date: "2026-07-02",
        createdAt: new Date("2026-07-02T12:00:00.000Z"),
        created_at_utc: new Date("2026-07-02T12:00:00.000Z"),
        orderTotal: 100,
        revenue: 100,
        paymentStatus: "paid",
        fulfillmentStatus: "shipped"
      }
    ]);
    prismaMock.dataCenterStoreDaily.findMany.mockResolvedValue([
      {
        storeId: 2,
        date: "2026-07-02",
        orderCount: 1,
        grossSales: 100,
        orderIdsJson: JSON.stringify(["store:2:order:order-1"]),
        rawDigestJson: JSON.stringify({ source: "Order", orderIds: ["store:2:order:order-1"] })
      }
    ]);
  });

  it("RECON-01 returns canonicalLedger and MATCHED when Order and Ledger agree", async () => {
    const response = await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-02", endDate: "2026-07-02" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("MATCHED");
    expect(response.body.canonicalLedger).toMatchObject({ rowCount: 1, orderCount: 1, grossSales: 100 });
  });

  it("RECON-02 does not return 0/0 when DataCenterStoreDaily has data", async () => {
    const response = await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-02", endDate: "2026-07-02" }
    });

    expect(response.body.canonicalLedger.orderCount).toBe(1);
    expect(response.body.canonicalLedger.grossSales).toBe(100);
  });

  it("RECON-03 normalizes string storeId to numeric Prisma filters", async () => {
    await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-02", endDate: "2026-07-02" }
    });

    expect(prismaMock.store.findUnique).toHaveBeenCalledWith({ where: { id: 2 } });
    expect(prismaMock.dataCenterStoreDaily.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { storeId: 2, date: { gte: "2026-07-02", lte: "2026-07-02" } }
    }));
  });

  it("RECON-04 uses the same date range for Order and Ledger", async () => {
    await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-01", endDate: "2026-07-03" }
    });

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { storeId: 2, store_local_date: { gte: "2026-07-01", lte: "2026-07-03" } }
    }));
    expect(prismaMock.dataCenterStoreDaily.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { storeId: 2, date: { gte: "2026-07-01", lte: "2026-07-03" } }
    }));
  });

  it("RECON-05 returns COUNT_MISMATCH for count differences", async () => {
    prismaMock.dataCenterStoreDaily.findMany.mockResolvedValueOnce([
      { orderCount: 2, grossSales: 100, orderIdsJson: JSON.stringify(["store:2:order:order-1", "store:2:order:order-2"]) }
    ]);
    const response = await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-02", endDate: "2026-07-02" }
    });

    expect(response.body.status).toBe("COUNT_MISMATCH");
  });

  it("RECON-06 returns SALES_MISMATCH for gross sales differences", async () => {
    prismaMock.dataCenterStoreDaily.findMany.mockResolvedValueOnce([
      { orderCount: 1, grossSales: 120, orderIdsJson: JSON.stringify(["store:2:order:order-1"]) }
    ]);
    const response = await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-02", endDate: "2026-07-02" }
    });

    expect(response.body.status).toBe("SALES_MISMATCH");
  });

  it("RECON-07 returns ERROR when the Ledger query fails", async () => {
    prismaMock.dataCenterStoreDaily.findMany.mockRejectedValueOnce(new Error("LEDGER_DOWN"));
    const response = await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-02", endDate: "2026-07-02" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.body.status).toBe("ERROR");
    expect(response.body.details).toBe("LEDGER_DOWN");
  });

  it("RECON-08 returns TRUE_EMPTY only when Order and Ledger are both empty", async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    prismaMock.dataCenterStoreDaily.findMany.mockResolvedValueOnce([]);
    const response = await invokeDataCenterRoute("/stores/:storeId/reconciliation", {
      params: { storeId: "2" },
      query: { startDate: "2026-07-02", endDate: "2026-07-02" }
    });

    expect(response.body.status).toBe("TRUE_EMPTY");
    expect(response.body.canonicalLedger).toMatchObject({ rowCount: 0, orderCount: 0, grossSales: 0 });
  });
});

describe("Data Center canonical hierarchy handlers", () => {
  let getCanonicalAdHierarchy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    getCanonicalAdHierarchy = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: "row-1" }],
      coverage: { status: "READY" }
    });
  });

  it("maps campaigns route params to canonical campaign level and returns service result unchanged", async () => {
    const handler = createDataCenterHierarchyHandler("campaign", { getCanonicalAdHierarchy });
    const response = await invoke(handler, {
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      includeZeroSpend: "true"
    });

    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith({
      level: "campaign",
      accountId: "act_1",
      scope: "current_account",
      campaignId: undefined,
      adsetId: undefined,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      includeZeroSpend: true
    });
    expect(response.body).toEqual({ success: true, data: [{ id: "row-1" }], coverage: { status: "READY" } });
  });

  it("maps adsets route campaignId and includeZeroSpend", async () => {
    const handler = createDataCenterHierarchyHandler("adset", { getCanonicalAdHierarchy });
    await invoke(handler, {
      accountId: "all",
      campaignId: "camp-1",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      includeZeroSpend: "false"
    });

    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith(expect.objectContaining({
      level: "adset",
      accountId: "all",
      scope: "all_accounts",
      campaignId: "camp-1",
      includeZeroSpend: false
    }));
  });

  it("maps ads route adsetId", async () => {
    const handler = createDataCenterHierarchyHandler("ad", { getCanonicalAdHierarchy });
    await invoke(handler, {
      accountId: "act_1",
      adsetId: "set-1",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(getCanonicalAdHierarchy).toHaveBeenCalledWith(expect.objectContaining({
      level: "ad",
      adsetId: "set-1"
    }));
  });

  it("returns 400 for missing required params and 500 for true errors", async () => {
    const adsets = createDataCenterHierarchyHandler("adset", { getCanonicalAdHierarchy });
    const missing = await invoke(adsets, { accountId: "act_1" });
    expect(missing.statusCode).toBe(400);

    getCanonicalAdHierarchy.mockRejectedValueOnce(new Error("boom"));
    const failed = await invoke(createDataCenterHierarchyHandler("campaign", { getCanonicalAdHierarchy }), { accountId: "act_1" });
    expect(failed.statusCode).toBe(500);
    expect(failed.body.error).toBe("HIERARCHY_CAMPAIGNS_QUERY_FAILED");
  });

  it("does not use route-local Prisma hierarchy aggregation", async () => {
    const handler = createDataCenterHierarchyHandler("campaign", { getCanonicalAdHierarchy });
    await invoke(handler, { accountId: "act_1" });

    expect(prismaMock.campaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.adSet.findMany).not.toHaveBeenCalled();
    expect(prismaMock.ad.findMany).not.toHaveBeenCalled();
    expect(prismaMock.factMetaPerformance.findMany).not.toHaveBeenCalled();
  });
});

describe("Data Center creative analyze handler", () => {
  async function invokeAnalyze(handler: any, body: any, params = { creativeId: "creative-1" }) {
    const response = responseMock();
    await handler({ params, body }, response);
    return response;
  }

  it("CR-ROUTE-06 analyze delegates service with exact scope", async () => {
    const analyzeCreativeScope = vi.fn().mockResolvedValue({
      success: true,
      confidence: "full",
      warnings: []
    });

    const response = await invokeAnalyze(createCreativeAnalyzeHandler({ analyzeCreativeScope }), {
      analysisEntityId: "act_1::asset-a",
      creativeIds: ["creative-1"],
      adIds: ["ad-1"],
      campaignIds: ["camp-1"],
      adsetIds: ["set-1"],
      accountId: "act_1",
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      onlyCached: "true"
    });

    expect(response.statusCode).toBe(200);
    expect(analyzeCreativeScope).toHaveBeenCalledWith({
      analysisEntityId: "act_1::asset-a",
      creativeId: "creative-1",
      creativeIds: ["creative-1"],
      adIds: ["ad-1"],
      campaignIds: ["camp-1"],
      adsetIds: ["set-1"],
      accountId: "act_1",
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      onlyCached: true,
      forceRefresh: false
    });
    expect(response.body).toEqual({ success: true, confidence: "full", warnings: [] });
  });

  it.each([
    ["CR-ROUTE-07 scope error 400", "INVALID_CREATIVE_ANALYSIS_SCOPE", 400],
    ["CR-ROUTE-08 not synced 409", "CREATIVE_ANALYSIS_NOT_SYNCED", 409],
    ["CR-ROUTE-09 no facts 404", "NO_CANONICAL_CREATIVE_FACTS", 404]
  ])("%s", async (_name, code, statusCode) => {
    const error: any = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    const analyzeCreativeScope = vi.fn().mockRejectedValue(error);

    const response = await invokeAnalyze(createCreativeAnalyzeHandler({ analyzeCreativeScope }), {
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.body.error).toBe(code);
  });

  it("CR-ROUTE-10 partial report warning is returned unchanged", async () => {
    const analyzeCreativeScope = vi.fn().mockResolvedValue({
      success: true,
      confidence: "partial",
      warnings: ["当前为部分覆盖，报告按已入库事实降级判断。"]
    });

    const response = await invokeAnalyze(createCreativeAnalyzeHandler({ analyzeCreativeScope }), {
      analysisEntityId: "act_1::asset-a",
      accountId: "act_1",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(response.body).toMatchObject({
      confidence: "partial",
      warnings: ["当前为部分覆盖，报告按已入库事实降级判断。"]
    });
  });
});
