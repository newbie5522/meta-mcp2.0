import { describe, expect, it } from "vitest";
import {
  applyMinOrdersFilter,
  collectCountryRowWarnings,
  filterStoreOrderCountryRows,
  summarizeCountryRows,
  type CountryAnalyticsLikeRow
} from "./country-analytics.logic";

function row(input: Partial<CountryAnalyticsLikeRow>): CountryAnalyticsLikeRow {
  return {
    orderCount: 0,
    orderRevenue: 0,
    orderProfit: 0,
    orderFirstAt: "2026-07-01",
    orderLastAt: "2026-07-01",
    metaSpend: 0,
    metaPurchases: 0,
    metaPurchaseValue: 0,
    ...input
  };
}

describe("country analytics store-only logic", () => {
  it("keeps store orders with zero revenue and zero meta spend", () => {
    const rows = filterStoreOrderCountryRows([
      row({ orderCount: 2, orderRevenue: 0, metaSpend: 0 }),
      row({ orderCount: 0, orderRevenue: 0, metaSpend: 500 })
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].orderCount).toBe(2);
  });

  it("keeps revenue rows with zero order count and records a warning", () => {
    const rows = filterStoreOrderCountryRows([
      row({ orderCount: 0, orderRevenue: 120, metaSpend: 0 })
    ]);

    expect(rows).toHaveLength(1);
    expect(collectCountryRowWarnings(rows)).toContain("STORE_REVENUE_WITHOUT_ORDER_COUNT");
  });

  it("does not let minSpend remove store country rows", () => {
    const storeRows = filterStoreOrderCountryRows([
      row({ orderCount: 1, orderRevenue: 80, metaSpend: 1 }),
      row({ orderCount: 0, orderRevenue: 0, metaSpend: 999 })
    ]);
    const result = applyMinOrdersFilter(storeRows, 0);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].orderRevenue).toBe(80);
  });

  it("applies minOrders and summarizes the final visible rows only", () => {
    const storeRows = filterStoreOrderCountryRows([
      row({ orderCount: 1, orderRevenue: 50, metaSpend: 20, metaPurchases: 1, metaPurchaseValue: 30 }),
      row({ orderCount: 3, orderRevenue: 150, metaSpend: 5, metaPurchases: 2, metaPurchaseValue: 90 })
    ]);
    const result = applyMinOrdersFilter(storeRows, 2);
    const summary = summarizeCountryRows(result.rows);

    expect(result.rows).toHaveLength(1);
    expect(summary.orderCount).toBe(3);
    expect(summary.revenue).toBe(150);
    expect(summary.totalMetaSpend).toBe(5);
    expect(summary.totalMetaPurchases).toBe(2);
    expect(summary.totalMetaPurchaseValue).toBe(90);
  });

  it("excludes meta-only countries from store country rows", () => {
    const rows = filterStoreOrderCountryRows([
      row({ orderCount: 0, orderRevenue: 0, metaSpend: 100, metaPurchases: 4 })
    ]);

    expect(rows).toHaveLength(0);
  });

  it("preserves real zero profit instead of replacing it with an estimate", () => {
    const summary = summarizeCountryRows([
      row({ orderCount: 1, orderRevenue: 100, orderProfit: 0 })
    ]);

    expect(summary.orderProfit).toBe(0);
  });

  it("returns unavailable profit when any visible row lacks real profit", () => {
    const visibleRows = [
      row({ orderCount: 1, orderRevenue: 100, orderProfit: null }),
      row({ orderCount: 1, orderRevenue: 50, orderProfit: 0 })
    ];
    const summary = summarizeCountryRows(visibleRows);

    expect(summary.orderProfit).toBeNull();
    expect(collectCountryRowWarnings(visibleRows)).toContain("PROFIT_UNAVAILABLE");
  });

  it("records unavailable business dates", () => {
    const visibleRows = [
      row({ orderCount: 1, orderRevenue: 100, orderFirstAt: null, orderLastAt: null })
    ];

    expect(collectCountryRowWarnings(visibleRows)).toContain("ORDER_BUSINESS_TIME_UNAVAILABLE");
  });
});
