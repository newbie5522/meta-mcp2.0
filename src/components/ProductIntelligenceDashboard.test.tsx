import { describe, expect, it } from "vitest";
import {
  buildProductSnapshot,
  emptyProductSnapshot,
  resolveProductSnapshot,
  type ProductViewSnapshot
} from "./ProductIntelligenceDashboard";
import { shouldApplyLatestRequest } from "../lib/data-view-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function snapshot(label: string): ProductViewSnapshot {
  return {
    products: [{
      id: `${label}-id`,
      productId: `${label}-product`,
      storeId: 1,
      productName: label,
      sku: `${label}-sku`,
      category: "test",
      revenue: 100,
      revenueAvailable: true,
      orders: 2,
      refundedOrders: 1,
      profit: null,
      averageOrderValue: 50,
      refundRate: 0.5,
      firstOrderAt: "2026-07-01",
      lastOrderAt: "2026-07-02",
      warnings: [],
      source: "Order"
    }],
    summary: {
      productsCount: 1,
      totalOrders: 2,
      refundedOrders: 1,
      refundRate: 0.5,
      totalProductLineRevenue: 100,
      revenueComplete: true,
      profitAvailable: false
    },
    dataHealth: { status: "READY", marker: label },
    dataHealthStatus: "READY",
    responseDateRange: {
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      timezone: "Asia/Shanghai"
    },
    coverage: null
  };
}

const requestKey = "page:products|storeId:1";

describe("Product view snapshot contract", () => {
  it("adopts the complete current snapshot for a normal response", () => {
    const current = snapshot("current");
    const payload = {
      products: current.products,
      summary: current.summary,
      dataHealth: current.dataHealth,
      dateRange: current.responseDateRange
    };
    const built = buildProductSnapshot(payload);
    const decision = resolveProductSnapshot({
      payload,
      currentSnapshot: built,
      lastGoodData: null,
      currentRequestKey: requestKey,
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(decision.snapshot).toEqual(current);
    expect(decision.persist).toBe(true);
    expect(decision.notice).toBeNull();
  });

  it("clears the snapshot on a date mismatch", () => {
    const old = snapshot("old");
    const current = snapshot("mismatched");
    const decision = resolveProductSnapshot({
      payload: { products: current.products, dataHealth: current.dataHealth, dateRange: { startDate: "2026-06-01", endDate: "2026-06-07" } },
      currentSnapshot: current,
      lastGoodData: { requestKey, data: old },
      currentRequestKey: requestKey,
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(decision.snapshot).toEqual(emptyProductSnapshot("DATE_RANGE_MISMATCH"));
    expect(decision.persist).toBe(false);
  });

  it("does not reuse the old snapshot for empty or not-synced states", () => {
    for (const status of ["EMPTY", "NO_NEW_DATA", "NOT_SYNCED", "ERROR"]) {
      const old = snapshot(`old-${status}`);
      const current = emptyProductSnapshot(status);
      const decision = resolveProductSnapshot({
        payload: { products: [], dataHealth: { status }, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } },
        currentSnapshot: current,
        lastGoodData: { requestKey, data: old },
        currentRequestKey: requestKey,
        startDate: "2026-07-01",
        endDate: "2026-07-07"
      });

      expect(decision.snapshot).toEqual(current);
      expect(decision.persist).toBe(true);
    }
  });

  it("preserves a coherent snapshot only for an explicitly allowed same-key sync", () => {
    const old = snapshot("coherent-old");
    const current = snapshot("new-response");
    const decision = resolveProductSnapshot({
      payload: { products: [], dataHealth: { status: "SYNC_RUNNING" }, allowStaleWhileRunning: true, dateRange: current.responseDateRange },
      currentSnapshot: { ...current, products: [], dataHealthStatus: "SYNC_RUNNING" },
      lastGoodData: { requestKey, data: old },
      currentRequestKey: requestKey,
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(decision.snapshot.products).toBe(old.products);
    expect(decision.snapshot.summary).toBe(old.summary);
    expect(decision.snapshot.dataHealth).toBe(old.dataHealth);
    expect(decision.snapshot.dataHealthStatus).toBe(old.dataHealthStatus);
    expect(decision.snapshot.responseDateRange).toBe(old.responseDateRange);
    expect(decision.persist).toBe(false);
  });

  it("does not reuse a snapshot after storeId changes the request key", () => {
    const oldStoreSnapshot = snapshot("store-one");
    const current = emptyProductSnapshot("EMPTY");
    const decision = resolveProductSnapshot({
      payload: { products: [], dataHealth: { status: "EMPTY" }, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } },
      currentSnapshot: current,
      lastGoodData: { requestKey: "page:products|storeId:1", data: oldStoreSnapshot },
      currentRequestKey: "page:products|storeId:2",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(decision.snapshot).toEqual(current);
    expect(decision.snapshot.products).toEqual([]);
    expect(decision.snapshot.summary).toBeNull();
  });

  it("RC-01 ignores an older deferred product response after a newer request wins", async () => {
    const oldResponse = deferred<ProductViewSnapshot>();
    const newResponse = deferred<ProductViewSnapshot>();
    let latestRequestId = 2;
    let latestRequestKey = "products:new";

    newResponse.resolve(snapshot("new"));
    const appliedNew = await newResponse.promise;
    expect(shouldApplyLatestRequest({
      requestId: 2,
      latestRequestId,
      sourceRequestKey: "products:new",
      latestRequestKey
    })).toBe(true);
    expect(appliedNew.dataHealthStatus).toBe("READY");

    oldResponse.resolve(snapshot("old"));
    latestRequestId = 2;
    latestRequestKey = "products:new";
    await oldResponse.promise;
    expect(shouldApplyLatestRequest({
      requestId: 1,
      latestRequestId,
      sourceRequestKey: "products:old",
      latestRequestKey
    })).toBe(false);
  });
});
