import { describe, expect, it } from "vitest";
import {
  buildAccountDetailsPerformanceTotals,
  buildAccountDetailsServerRequestKey,
  compareAccountDetailsSortValues,
  getAccountDetailsCoverageMode,
  getAccountDetailsMetric,
  resolveAccountDetailsResponseState,
  shouldApplyAccountDetailsResult,
  shouldApplyAccountHierarchyResult
} from "./account-details-view-state";

const structureOnly = {
  hasPerformanceFacts: false,
  insights: {
    data: [{
      spend: null,
      impressions: null,
      clicks: null,
      cpm: null,
      ctr: null,
      cpc: null,
      cpa: null,
      purchases: null,
      reach: null,
      frequency: null,
      inline_link_clicks: null,
      addToCart: null
    }]
  }
};

const realZero = {
  hasPerformanceFacts: true,
  insights: {
    data: [{
      spend: 0,
      impressions: 0,
      clicks: 0,
      cpm: 0,
      ctr: 0,
      cpc: 0,
      cpa: 0,
      purchases: 0,
      purchaseValue: 0,
      roas: 0,
      reach: null,
      reachAvailable: false,
      frequency: null,
      inlineLinkClicksAvailable: false,
      addToCartAvailable: false,
      actions: [],
      action_values: []
    }]
  }
};

function fact(spend: number, impressions: number, clicks: number, purchases: number, purchaseValue: number) {
  return {
    hasPerformanceFacts: true,
    insights: {
      data: [{
        spend,
        impressions,
        clicks,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpa: purchases > 0 ? spend / purchases : 0,
        purchases,
        purchaseValue,
        roas: spend > 0 ? purchaseValue / spend : 0,
        actions: [{ action_type: "purchase", value: String(purchases) }],
        action_values: [{ action_type: "purchase", value: String(purchaseValue) }]
      }]
    }
  };
}

describe("Account details view-state contract", () => {
  it("returns null for all unavailable structure-only performance metrics", () => {
    for (const key of ["spend", "impressions", "clicks", "results", "cpm", "ctr", "cpc", "cpr", "reach", "frequency", "link_clicks", "add_to_cart"]) {
      expect(getAccountDetailsMetric(structureOnly, key)).toBeNull();
    }
  });

  it("preserves real zero facts as zeros", () => {
    for (const key of ["spend", "impressions", "clicks", "results", "cpm", "ctr", "cpc", "cpr", "purchase_value", "roas"]) {
      expect(getAccountDetailsMetric(realZero, key)).toBe(0);
    }
  });

  it("excludes structure-only rows from totals and keeps real zero fact rows", () => {
    const totals = buildAccountDetailsPerformanceTotals([
      structureOnly,
      realZero,
      fact(20, 1000, 10, 2, 60)
    ]);
    expect(totals.factRows).toHaveLength(2);
    expect(totals).toMatchObject({
      spend: 20,
      impressions: 1000,
      clicks: 10,
      purchases: 2,
      purchaseValue: 60
    });
  });

  it("returns null totals when there are no fact rows", () => {
    expect(buildAccountDetailsPerformanceTotals([structureOnly])).toMatchObject({
      spend: null,
      impressions: null,
      clicks: null,
      purchases: null,
      purchaseValue: null,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      roas: null
    });
  });

  it("computes weighted KPIs from total numerator and denominator", () => {
    const totals = buildAccountDetailsPerformanceTotals([
      fact(10, 100, 10, 1, 20),
      fact(30, 300, 30, 3, 120)
    ]);
    expect(totals.ctr).toBe(10);
    expect(totals.cpc).toBe(1);
    expect(totals.cpm).toBe(100);
    expect(totals.cpa).toBe(10);
    expect(totals.roas).toBe(3.5);
  });

  it("maps coverage states into distinct modes", () => {
    expect(getAccountDetailsCoverageMode({ status: "READY" })).toBe("READY");
    expect(getAccountDetailsCoverageMode({ status: "PARTIAL_COVERAGE" })).toBe("PARTIAL_COVERAGE");
    expect(getAccountDetailsCoverageMode({ status: "NOT_SYNCED" })).toBe("NOT_SYNCED");
    expect(getAccountDetailsCoverageMode({ status: "TRUE_EMPTY" })).toBe("TRUE_EMPTY");
    expect(getAccountDetailsCoverageMode({ status: "ERROR" })).toBe("ERROR");
  });

  it("clears rows for ERROR and DATE_RANGE_MISMATCH response states", () => {
    const error = resolveAccountDetailsResponseState({
      payload: { coverage: { status: "ERROR" }, dataHealth: { status: "ERROR" } },
      rows: [{ id: "stale" }],
      startStr: "2026-07-01",
      endStr: "2026-07-07",
      sourceRequestKey: "same",
      currentRequestKey: "same"
    });
    const mismatch = resolveAccountDetailsResponseState({
      payload: { dateRange: { startDate: "2026-06-01", endDate: "2026-06-07" } },
      rows: [{ id: "wrong" }],
      startStr: "2026-07-01",
      endStr: "2026-07-07",
      sourceRequestKey: "same",
      currentRequestKey: "same"
    });
    expect(error.data).toEqual([]);
    expect(mismatch.data).toEqual([]);
    expect(mismatch.dataHealth.status).toBe("DATE_RANGE_MISMATCH");
  });

  it("keeps PARTIAL rows while facts-only totals exclude unavailable rows", () => {
    const state = resolveAccountDetailsResponseState({
      payload: { coverage: { status: "PARTIAL_COVERAGE" }, dataHealth: { status: "PARTIAL_COVERAGE" } },
      rows: [structureOnly, fact(5, 100, 5, 1, 15)],
      startStr: "2026-07-01",
      endStr: "2026-07-07",
      sourceRequestKey: "same",
      currentRequestKey: "same"
    });
    expect(state.data).toHaveLength(2);
    expect(buildAccountDetailsPerformanceTotals(state.data).spend).toBe(5);
  });

  it("ignores stale success, catch, and finally candidates with request guard", () => {
    expect(shouldApplyAccountDetailsResult({
      requestId: 1,
      currentRequestId: 2,
      sourceRequestKey: "old",
      currentRequestKey: "new"
    })).toBe(false);
    expect(resolveAccountDetailsResponseState({
      payload: { coverage: { status: "READY" } },
      rows: [{ id: "old" }],
      startStr: "2026-07-01",
      endStr: "2026-07-07",
      sourceRequestKey: "old",
      currentRequestKey: "new"
    })).toMatchObject({ ignored: true, reason: "STALE_RESPONSE", data: [] });
  });

  it("sorts null after real zero and returns null for unknown metrics", () => {
    expect(compareAccountDetailsSortValues(null, 0, "asc")).toBe(1);
    expect(compareAccountDetailsSortValues(0, null, "desc")).toBe(-1);
    expect(getAccountDetailsMetric(realZero, "unknown_metric")).toBeNull();
  });

  it("keeps selected parent ids out of the server request key", () => {
    const key = buildAccountDetailsServerRequestKey({
      accountId: "act_1",
      level: "adsets",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });
    expect(key).not.toContain("campaignId");
    expect(key).not.toContain("adsetId");
    expect(key).not.toContain("adId");
  });

  it("guards hierarchy inventory by account and clears on account change", () => {
    expect(shouldApplyAccountHierarchyResult({
      requestId: 1,
      currentRequestId: 2,
      accountId: "act_A",
      currentAccountId: "act_B"
    })).toBe(false);
  });
});
