import { describe, expect, it } from "vitest";
import {
  buildAudienceClearedState,
  buildAudienceScopeKey,
  buildAudienceSourceRequestParams,
  resolveAudienceMetaSourceResult,
  resolveAudienceStoreSourceResult,
  shouldApplyAudienceScopedResponse,
  shouldApplyAudienceSourceResult,
  type AudienceRequestContext
} from "./audience-dashboard-orchestrator";

function context(overrides: Partial<AudienceRequestContext> = {}): AudienceRequestContext {
  return {
    requestKey: "audience:2026-07-01:2026-07-07:country:store-1",
    startStr: "2026-07-01",
    endStr: "2026-07-07",
    selectedStore: "1",
    selectedAccount: "act_1",
    activeTab: "country",
    minSpend: "10",
    includeZeroSpend: false,
    sortBy: "spend",
    ...overrides
  };
}

const metaPayload = {
  rows: [{ dimensionValue: "US", spend: 10 }],
  summary: { meta: { spend: 10, impressions: 100, clicks: 5, purchases: 1, purchaseValue: 20, ctr: 0.05, cpc: 2, cpm: 100, cpa: 10, roas: 2 } },
  metaCoverage: { status: "READY", source: "meta" },
  storeCoverage: { status: "STALE_FROM_META" },
  dataHealth: { status: "READY" },
  dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" }
};

const storePayload = {
  rows: [{ country: "US", orderCount: 2, orderRevenue: 30 }],
  summary: { orderCount: 2, revenue: 30, averageOrderValue: 15, countryCount: 1 },
  dataHealth: { status: "READY" },
  storeCoverage: { status: "READY", source: "countries" },
  dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" }
};

describe("Audience source orchestration contract", () => {
  it("clears Meta and Store source state before a new request", () => {
    expect(buildAudienceClearedState()).toEqual({
      data: [],
      metaSummary: null,
      storeSummary: null,
      orderCountryRows: [],
      metaCoverage: null,
      storeCoverage: null,
      dataHealth: null,
      countriesHealth: null,
      viewNotice: null
    });
  });

  it("keeps Meta success and Store success independent when Meta returns first", () => {
    const ctx = context();
    const meta = resolveAudienceMetaSourceResult({ payload: metaPayload, context: ctx, lastGoodData: null });
    const store = resolveAudienceStoreSourceResult({ payload: storePayload, context: ctx });

    expect(meta).toMatchObject({
      data: metaPayload.rows,
      metaSummary: metaPayload.summary.meta,
      metaCoverage: metaPayload.metaCoverage
    });
    expect(meta).not.toHaveProperty("storeCoverage");
    expect(store).toMatchObject({
      orderCountryRows: storePayload.rows,
      storeSummary: storePayload.summary,
      countriesHealth: storePayload.dataHealth,
      storeCoverage: storePayload.storeCoverage
    });
  });

  it("keeps Store success authoritative when Store returns before Meta", () => {
    const ctx = context();
    const store = resolveAudienceStoreSourceResult({ payload: storePayload, context: ctx });
    const meta = resolveAudienceMetaSourceResult({ payload: metaPayload, context: ctx, lastGoodData: null });

    expect(store.storeCoverage).toEqual({ status: "READY", source: "countries" });
    expect(meta.metaCoverage).toEqual({ status: "READY", source: "meta" });
    expect(meta).not.toHaveProperty("storeSummary");
  });

  it("AUD-ORCH-01 NOT_SYNCED + rows fails closed", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: { ...metaPayload, metaCoverage: { status: "NOT_SYNCED" } },
      context: context(),
      lastGoodData: null
    });

    expect(meta.data).toEqual([]);
    expect(meta.metaSummary).toBeNull();
    expect(meta.dataHealth.status).toBe("RESPONSE_SCOPE_INCONSISTENT");
  });

  it("AUD-ORCH-02 TRUE_EMPTY + rows fails closed", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: { ...metaPayload, metaCoverage: { status: "TRUE_EMPTY" } },
      context: context(),
      lastGoodData: null
    });

    expect(meta.data).toEqual([]);
    expect(meta.metaSummary).toBeNull();
  });

  it("AUD-ORCH-03 PARTIAL + rows + summary is accepted", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: { ...metaPayload, metaCoverage: { status: "PARTIAL_COVERAGE", message: "partial" } },
      context: context(),
      lastGoodData: null
    });

    expect(meta.data).toHaveLength(1);
    expect(meta.metaSummary.spend).toBe(10);
    expect(meta.viewNotice).toBe("partial");
  });

  it("keeps current Meta KPI values when rows are returned", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: metaPayload,
      context: context(),
      lastGoodData: null
    });

    expect(meta.data).toEqual(metaPayload.rows);
    expect(meta.metaSummary).toMatchObject({
      spend: 10,
      impressions: 100,
      clicks: 5,
      purchases: 1,
      purchaseValue: 20
    });
  });

  it("PARTIAL_SUCCESS shows a warning but keeps current rows and summary", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: { ...metaPayload, metaCoverage: { status: "PARTIAL_SUCCESS", message: "部分完成" } },
      context: context(),
      lastGoodData: null
    });

    expect(meta.data).toEqual(metaPayload.rows);
    expect(meta.metaSummary.spend).toBe(10);
    expect(meta.viewNotice).toBe("部分完成");
  });

  it("AUD-ORCH-04 rows + null summary fails closed", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: { ...metaPayload, summary: null },
      context: context(),
      lastGoodData: null
    });

    expect(meta.data).toEqual([]);
    expect(meta.dataHealth.reason).toBe("ROWS_VISIBLE_WITHOUT_CURRENT_SUMMARY");
  });

  it("NOT_SYNCED displays unavailable KPI state instead of zero", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: { rows: [], summary: null, metaCoverage: { status: "NOT_SYNCED" }, dateRange: metaPayload.dateRange },
      context: context(),
      lastGoodData: null
    });

    expect(meta.data).toEqual([]);
    expect(meta.metaSummary).toEqual({
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

  it("ERROR displays the real current request error and does not reuse old rows", () => {
    const meta = resolveAudienceMetaSourceResult({
      error: { response: { data: { message: "Meta audience query failed" } } },
      context: context(),
      lastGoodData: {
        requestKey: context().requestKey,
        rows: [{ dimensionValue: "OLD", spend: 99 }],
        metaSummary: { spend: 99 }
      }
    });

    expect(meta.data).toEqual([]);
    expect(meta.metaSummary).toBeNull();
    expect(meta.viewNotice).toBe("Meta audience query failed");
  });

  it("AUD-ORCH-05 Store date mismatch clears Store rows and summary", () => {
    const store = resolveAudienceStoreSourceResult({
      payload: { ...storePayload, dateRange: { startDate: "2026-06-01", endDate: "2026-06-07" } },
      context: context()
    });

    expect(store.orderCountryRows).toEqual([]);
    expect(store.storeSummary).toBeNull();
    expect(store.countriesHealth.status).toBe("DATE_RANGE_MISMATCH");
  });

  it("AUD-ORCH-06 Store summary falls back to Store response rows when summary is absent", () => {
    const store = resolveAudienceStoreSourceResult({
      payload: { ...storePayload, summary: null },
      context: context()
    });

    expect(store.storeSummary).toEqual({
      orderCount: 2,
      revenue: 30,
      averageOrderValue: 15,
      countryCount: 1
    });
  });

  it("AUD-ORCH-07 Meta result never supplies Store summary", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: metaPayload,
      context: context(),
      lastGoodData: null
    });

    expect(meta).not.toHaveProperty("storeSummary");
  });

  it("AUD-ORCH-08 request A does not override request B", () => {
    expect(shouldApplyAudienceSourceResult("request-A", "request-B")).toBe(false);
    expect(shouldApplyAudienceSourceResult("request-B", "request-B")).toBe(true);
  });

  it("AUD-ORCH-10 lastGoodData cross date is rejected", () => {
    const ctx = context({ requestKey: "audience:2026-07-02:2026-07-07:country:store-1", startStr: "2026-07-02" });
    const lastGoodData = {
      requestKey: "audience:2026-07-01:2026-07-07:country:store-1",
      rows: [{ dimensionValue: "CA", spend: 8 }],
      metaSummary: { spend: 8 },
      dataHealth: { status: "READY" },
      metaCoverage: { status: "READY" }
    };
    const meta = resolveAudienceMetaSourceResult({
      payload: { rows: [], coverage: { status: "SYNC_RUNNING" }, dataHealth: { status: "SYNC_RUNNING" }, allowStaleWhileRunning: true, dateRange: { startDate: "2026-07-02", endDate: "2026-07-07" } },
      context: ctx,
      lastGoodData
    });

    expect(meta.data).toEqual([]);
    expect((meta as any).preservedLastGoodData).toBeUndefined();
  });

  it("AUD-ORCH-11 lastGoodData cross Store is rejected", () => {
    const ctx = context({ requestKey: "audience:2026-07-01:2026-07-07:country:store-2", selectedStore: "2" });
    const lastGoodData = {
      requestKey: "audience:2026-07-01:2026-07-07:country:store-1",
      rows: [{ dimensionValue: "CA", spend: 8 }],
      metaSummary: { spend: 8 },
      dataHealth: { status: "READY" },
      metaCoverage: { status: "READY" }
    };
    const meta = resolveAudienceMetaSourceResult({
      payload: { rows: [], coverage: { status: "SYNC_RUNNING" }, dataHealth: { status: "SYNC_RUNNING" }, allowStaleWhileRunning: true, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } },
      context: ctx,
      lastGoodData
    });

    expect(meta.data).toEqual([]);
    expect((meta as any).preservedLastGoodData).toBeUndefined();
  });

  it("rejects scoped responses from a different date, store, account, dimension, or minSpend", () => {
    const currentScopeKey = buildAudienceScopeKey({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      storeId: "1",
      accountId: "act_1",
      dimension: "country",
      minSpend: "10"
    });
    const oldScopeKey = buildAudienceScopeKey({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      storeId: "2",
      accountId: "act_1",
      dimension: "country",
      minSpend: "10"
    });

    expect(shouldApplyAudienceScopedResponse(oldScopeKey, currentScopeKey)).toBe(false);
    expect(shouldApplyAudienceScopedResponse(currentScopeKey, currentScopeKey)).toBe(true);
  });

  it("AUD-ORCH-12 same-key running reuse requires allowStaleWhileRunning", () => {
    const ctx = context();
    const lastGoodData = {
      requestKey: ctx.requestKey,
      rows: [{ dimensionValue: "CA", spend: 8 }],
      metaSummary: { spend: 8, impressions: 1, clicks: 1, purchases: 1, purchaseValue: 8 },
      dataHealth: { status: "READY" },
      metaCoverage: { status: "READY", source: "last-good-meta" }
    };
    const blocked = resolveAudienceMetaSourceResult({
      payload: { rows: [], coverage: { status: "SYNC_RUNNING" }, dataHealth: { status: "SYNC_RUNNING" }, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } },
      context: ctx,
      lastGoodData
    });
    const preserved = resolveAudienceMetaSourceResult({
      payload: { rows: [], coverage: { status: "SYNC_RUNNING" }, dataHealth: { status: "SYNC_RUNNING" }, allowStaleWhileRunning: true, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } },
      context: ctx,
      lastGoodData
    });

    expect(blocked.data).toEqual([]);
    expect(preserved.data).toEqual(lastGoodData.rows);
    expect(preserved.metaSummary).toEqual(lastGoodData.metaSummary);
  });

  it("clears Store source state when active tab is not country", () => {
    const store = resolveAudienceStoreSourceResult({
      payload: storePayload,
      context: context({ activeTab: "age" })
    });

    expect(store).toEqual({
      orderCountryRows: [],
      storeSummary: null,
      countriesHealth: null,
      storeCoverage: null,
      countriesLoading: false
    });
  });

  it("builds source-specific params from the current request context", () => {
    const params = buildAudienceSourceRequestParams(context());

    expect(params.metaParams).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      storeId: "1",
      accountId: "act_1",
      dimensionType: "country",
      minSpend: "10",
      includeZeroSpend: "false",
      sortBy: "spend"
    });
    expect(params.storeParams).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      storeId: "1",
      minSpend: "10",
      includeUnmappedSpend: "true"
    });
  });
});
