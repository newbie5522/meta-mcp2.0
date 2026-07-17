import { describe, expect, it } from "vitest";
import {
  buildAudienceClearedState,
  buildAudienceSourceRequestParams,
  resolveAudienceMetaSourceResult,
  resolveAudienceStoreSourceResult,
  shouldApplyAudienceSourceResult,
  type AudienceRequestContext
} from "./audience-dashboard-orchestrator";

function context(overrides: Partial<AudienceRequestContext> = {}): AudienceRequestContext {
  return {
    requestKey: "audience:2026-07-01:2026-07-07:country",
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
  summary: { totalSpend: 10 },
  metaCoverage: { status: "READY", source: "meta" },
  storeCoverage: { status: "STALE_FROM_META" },
  dataHealth: { status: "READY" },
  dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" }
};

const storePayload = {
  rows: [{ country: "US", orderCount: 2 }],
  dataHealth: { status: "READY" },
  storeCoverage: { status: "READY", source: "countries" }
};

describe("Audience source orchestration contract", () => {
  it("clears Meta and Store source state before a new request", () => {
    expect(buildAudienceClearedState()).toEqual({
      data: [],
      summary: null,
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
      summary: metaPayload.summary,
      metaCoverage: metaPayload.metaCoverage
    });
    expect(meta).not.toHaveProperty("storeCoverage");
    expect(store).toMatchObject({
      orderCountryRows: storePayload.rows,
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
    expect(meta).not.toHaveProperty("storeCoverage");
  });

  it("allows Meta error and Store success to coexist", () => {
    const ctx = context();
    const meta = resolveAudienceMetaSourceResult({ error: new Error("meta failed"), context: ctx, lastGoodData: null });
    const store = resolveAudienceStoreSourceResult({ payload: storePayload, context: ctx });

    expect(meta.dataHealth.status).toBe("ERROR");
    expect(store.orderCountryRows).toHaveLength(1);
    expect(store.storeCoverage.status).toBe("READY");
  });

  it("allows Meta success and Store error to coexist", () => {
    const ctx = context();
    const meta = resolveAudienceMetaSourceResult({ payload: metaPayload, context: ctx, lastGoodData: null });
    const store = resolveAudienceStoreSourceResult({ error: new Error("store failed"), context: ctx });

    expect(meta.dataHealth.status).toBe("READY");
    expect(store.orderCountryRows).toEqual([]);
    expect(store.storeCoverage.status).toBe("ERROR");
  });

  it("keeps Store success when Meta has a date range mismatch", () => {
    const ctx = context();
    const meta = resolveAudienceMetaSourceResult({
      payload: { ...metaPayload, dateRange: { startDate: "2026-06-01", endDate: "2026-06-07" } },
      context: ctx,
      lastGoodData: null
    });
    const store = resolveAudienceStoreSourceResult({ payload: storePayload, context: ctx });

    expect(meta.data).toEqual([]);
    expect(meta.dataHealth.status).toBe("DATE_RANGE_MISMATCH");
    expect(store.storeCoverage).toEqual(storePayload.storeCoverage);
  });

  it("preserves only Meta lastGoodData and never restores Store coverage", () => {
    const ctx = context();
    const lastGoodData = {
      requestKey: ctx.requestKey,
      rows: [{ dimensionValue: "CA", spend: 8 }],
      summary: { totalSpend: 8 },
      dataHealth: { status: "READY" },
      metaCoverage: { status: "READY", source: "last-good-meta" },
      storeCoverage: { status: "STALE_STORE_SHOULD_NOT_APPLY" }
    };
    const meta = resolveAudienceMetaSourceResult({
      payload: { rows: [], dataHealth: { status: "SYNC_RUNNING" }, allowStaleWhileRunning: true },
      context: ctx,
      lastGoodData
    });
    const store = resolveAudienceStoreSourceResult({ payload: storePayload, context: ctx });

    expect(meta.data).toEqual(lastGoodData.rows);
    expect(meta.metaCoverage).toEqual(lastGoodData.metaCoverage);
    expect(meta).not.toHaveProperty("storeCoverage");
    expect(store.storeCoverage).toEqual(storePayload.storeCoverage);
  });

  it("rejects stale request A after switching to request B", () => {
    expect(shouldApplyAudienceSourceResult("request-A", "request-B")).toBe(false);
    expect(shouldApplyAudienceSourceResult("request-B", "request-B")).toBe(true);
  });

  it("clears Store source state when active tab is not country", () => {
    const store = resolveAudienceStoreSourceResult({
      payload: storePayload,
      context: context({ activeTab: "age_gender" })
    });

    expect(store).toEqual({
      orderCountryRows: [],
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

  it("never takes Store coverage from the Meta audience payload", () => {
    const meta = resolveAudienceMetaSourceResult({
      payload: metaPayload,
      context: context(),
      lastGoodData: null
    });

    expect(meta.metaCoverage).toEqual(metaPayload.metaCoverage);
    expect(meta).not.toHaveProperty("storeCoverage");
  });
});
