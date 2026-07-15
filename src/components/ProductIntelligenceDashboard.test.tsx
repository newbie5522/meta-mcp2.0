import { describe, expect, it } from "vitest";
import {
  buildProductSnapshot,
  emptyProductSnapshot,
  resolveProductSnapshot,
  type ProductViewSnapshot
} from "./ProductIntelligenceDashboard";

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
    }
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

  it("restores the old complete snapshot on a date mismatch", () => {
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

    expect(decision.snapshot).toBe(old);
    expect(decision.persist).toBe(false);
  });

  it("restores the old complete snapshot for EMPTY or NO_NEW_DATA preservation", () => {
    for (const status of ["EMPTY", "NO_NEW_DATA"]) {
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

      expect(decision.snapshot).toBe(old);
      expect(decision.persist).toBe(false);
    }
  });

  it("never mixes fallback rows with current summary, health, status, or date range", () => {
    const old = snapshot("coherent-old");
    const current = snapshot("new-response");
    const decision = resolveProductSnapshot({
      payload: { products: [], dataHealth: { status: "EMPTY" }, dateRange: current.responseDateRange },
      currentSnapshot: { ...current, products: [], dataHealthStatus: "EMPTY" },
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
});
