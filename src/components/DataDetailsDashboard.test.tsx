import { describe, expect, it } from "vitest";
import {
  accountMetric,
  buildAccountPerformanceTotals,
  compareAccountPerformanceValues,
  displayAccountTotal
} from "./account-performance-view-state";

describe("Accounts performance view-state", () => {
  const structureOnly = { hasPerformanceFacts: false, spend: null, impressions: null, clicks: null, purchases: null, purchaseValue: null };
  const realZero = { hasPerformanceFacts: true, spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, ctr: 0, cpc: 0, cpm: 0, cpa: null, roas: 0 };
  const fact = { hasPerformanceFacts: true, spend: 20, impressions: 1000, clicks: 10, purchases: 2, purchaseValue: 60 };

  it("ACC-PAGE-05 structure-only row renders N/A", () => {
    expect(accountMetric(structureOnly, "spend")).toBeNull();
    expect(accountMetric(structureOnly, "impressions")).toBeNull();
  });

  it("ACC-PAGE-06 real zero fact renders 0", () => {
    expect(accountMetric(realZero, "spend")).toBe(0);
    expect(accountMetric(realZero, "impressions")).toBe(0);
  });

  it("ACC-PAGE-07 totals exclude structure-only", () => {
    const totals = buildAccountPerformanceTotals([structureOnly, fact]);
    expect(totals.factAccountCount).toBe(1);
    expect(totals.spend).toBe(20);
  });

  it("ACC-PAGE-08 totals use visible filtered rows", () => {
    const totals = buildAccountPerformanceTotals([realZero, fact]);
    expect(totals.factAccountCount).toBe(2);
    expect(totals.ctr).toBe(1);
    expect(totals.roas).toBe(3);
  });

  it("ACC-PAGE-09 TRUE_EMPTY totals render 0", () => {
    expect(displayAccountTotal("TRUE_EMPTY", null)).toBe(0);
  });

  it("ACC-PAGE-10 NOT_SYNCED totals render N/A", () => {
    expect(displayAccountTotal("NOT_SYNCED", 10)).toBeNull();
  });

  it("sorts null after real zero", () => {
    expect(compareAccountPerformanceValues(null, 0, "asc")).toBe(1);
    expect(compareAccountPerformanceValues(0, null, "desc")).toBe(-1);
  });
});
