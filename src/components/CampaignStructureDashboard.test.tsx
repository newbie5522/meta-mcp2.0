import { describe, expect, it, vi } from "vitest";
import {
  buildCampaignAiPayload,
  buildHierarchyPerformanceTotals,
  dispatchCampaignAiRequest,
  formatFixed,
  formatMoney,
  formatNumber,
  hasPerformanceFacts,
  resolveCampaignStructureResponseState
} from "./campaign-structure-view-state";

describe("Campaign structure behavior contract", () => {
  it("blocks AI dispatch and clipboard writes for structure-only rows", () => {
    const dispatchEvent = vi.fn();
    const writeClipboard = vi.fn();
    const result = dispatchCampaignAiRequest({
      row: { hasPerformanceFacts: false, spend: null, impressions: null },
      viewLevel: "campaigns",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      dispatchEvent,
      writeClipboard
    });

    expect(result).toEqual({ blocked: true, reason: "NO_PERFORMANCE_FACTS" });
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it("blocks rows with null spend or impressions using the same UI guard", () => {
    expect(hasPerformanceFacts({ spend: null, impressions: 0 })).toBe(false);
    expect(hasPerformanceFacts({ spend: 0, impressions: null })).toBe(false);
    expect(hasPerformanceFacts({ spend: 0, impressions: 0 })).toBe(true);
  });

  it("dispatches one AI event for real facts and computes CPC/CPA from facts", () => {
    const dispatchEvent = vi.fn();
    const writeClipboard = vi.fn();
    const row = {
      id: "camp-1",
      name: "Campaign 1",
      spend: 20,
      impressions: 1000,
      clicks: 10,
      purchases: 2,
      roas: 3,
      hasPerformanceFacts: true
    };

    const result = dispatchCampaignAiRequest({
      row,
      viewLevel: "campaigns",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      dispatchEvent,
      writeClipboard
    });

    expect(result.blocked).toBe(false);
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(writeClipboard).toHaveBeenCalledOnce();
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.detail.prompt).toContain("2026-07-01 ~ 2026-07-07");
    expect(event.detail.prompt).toContain("CPC: $2.00");
    expect(event.detail.prompt).toContain("CPA: $10.00");
    expect(event.detail.context).toMatchObject({
      spend: 20,
      impressions: 1000,
      clicks: 10,
      purchases: 2,
      cpc: 2,
      cpa: 10
    });
  });

  it("does not coerce null context metrics into zero", () => {
    const payload = buildCampaignAiPayload({
      row: { id: "ad-1", spend: 0, impressions: 0, clicks: null, purchases: null, roas: null },
      viewLevel: "ads",
      startDate: "2026-07-01",
      endDate: "2026-07-07"
    });

    expect(payload.blocked).toBe(false);
    if (!payload.blocked) {
      expect(payload.context.clicks).toBeNull();
      expect(payload.context.purchases).toBeNull();
      expect(payload.context.roas).toBeNull();
    }
  });

  it("builds footer totals from performance facts only and preserves real zero facts", () => {
    const totals = buildHierarchyPerformanceTotals([
      { hasPerformanceFacts: false, spend: null, impressions: null, clicks: null, purchases: null, purchase_value: null },
      { hasPerformanceFacts: true, spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0 },
      { hasPerformanceFacts: true, spend: 20, impressions: 1000, clicks: 10, purchases: 2, purchase_value: 60 }
    ]);

    expect(totals.performanceRows).toHaveLength(2);
    expect(totals).toMatchObject({
      spend: 20,
      impressions: 1000,
      clicks: 10,
      purchases: 2,
      purchaseValue: 60,
      ctr: 1,
      cpc: 2,
      cpm: 20,
      cpa: 10,
      roas: 3
    });
  });

  it("returns null KPI totals when no performance facts exist", () => {
    expect(buildHierarchyPerformanceTotals([{ hasPerformanceFacts: false, spend: null, impressions: null }])).toMatchObject({
      spend: null,
      impressions: null,
      ctr: null,
      cpc: null,
      cpa: null,
      roas: null
    });
  });

  it("renders unavailable metrics as N/A instead of fabricating zero values", () => {
    expect(formatMoney(null)).toBe("N/A");
    expect(formatNumber(undefined)).toBe("N/A");
    expect(formatFixed(null, 2, "%")).toBe("N/A");
    expect(formatMoney(12.345)).toBe("$12.35");
  });

  it("resolves READY and PARTIAL_COVERAGE rows into current state", () => {
    for (const status of ["READY", "PARTIAL_COVERAGE"]) {
      const state = resolveCampaignStructureResponseState({
        payload: { dataHealth: { status }, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } },
        rows: [{ id: status }],
        startStr: "2026-07-01",
        endStr: "2026-07-07",
        requestKey: `key-${status}`,
        lastGoodData: null
      });
      expect(state.data).toEqual([{ id: status }]);
      expect(state.dataHealth.status).toBe(status);
      expect(state.viewNotice).toBeNull();
    }
  });

  it("keeps TRUE_EMPTY empty and does not restore stale data", () => {
    const state = resolveCampaignStructureResponseState({
      payload: { dataHealth: { status: "TRUE_EMPTY" } },
      rows: [],
      startStr: "2026-07-01",
      endStr: "2026-07-07",
      requestKey: "empty-key",
      lastGoodData: { requestKey: "empty-key", data: [{ id: "stale" }] }
    });

    expect(state.data).toEqual([]);
    expect(state.dataHealth.status).toBe("TRUE_EMPTY");
  });

  it("clears rows for DATE_RANGE_MISMATCH and ERROR does not restore lastGoodData", () => {
    const mismatch = resolveCampaignStructureResponseState({
      payload: { dateRange: { startDate: "2026-06-01", endDate: "2026-06-07" } },
      rows: [{ id: "wrong-range" }],
      startStr: "2026-07-01",
      endStr: "2026-07-07",
      requestKey: "key",
      lastGoodData: null
    });
    const error = resolveCampaignStructureResponseState({
      payload: { dataHealth: { status: "ERROR" } },
      rows: [],
      startStr: "2026-07-01",
      endStr: "2026-07-07",
      requestKey: "key",
      lastGoodData: { requestKey: "key", data: [{ id: "stale" }] }
    });

    expect(mismatch.data).toEqual([]);
    expect(mismatch.dataHealth.status).toBe("DATE_RANGE_MISMATCH");
    expect(error.data).toEqual([]);
    expect(error.dataHealth.status).toBe("ERROR");
  });
});
