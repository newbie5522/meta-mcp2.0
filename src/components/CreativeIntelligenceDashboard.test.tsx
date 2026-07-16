import { describe, expect, it } from "vitest";
import { resolveCreativePageState } from "./CreativeIntelligenceDashboard";

describe("Creative page state contract", () => {
  it("keeps structure-only creatives out of performance KPIs and buckets", () => {
    const structureOnlyRows = Array.from({ length: 100 }, (_, index) => ({ id: `ad-${index + 1}` }));
    const state = resolveCreativePageState({
      performanceRows: [],
      structureOnlyRows,
      summary: null,
      structureSummary: { performanceCount: 0, structureOnlyCount: 100 },
      bucketSummary: {},
      coverage: { status: "NOT_SYNCED", latestAvailableDate: "2026-07-14" }
    });

    expect(state.performanceRows).toEqual([]);
    expect(state.structureOnlyRows).toHaveLength(100);
    expect(state.structureSummary).toMatchObject({ performanceCount: 0, structureOnlyCount: 100 });
    expect(state.bucketSummary).toEqual({});
    expect(state.summary).toBeNull();
    expect(state.coverage.status).toBe("NOT_SYNCED");
  });

  it("clears every business result on an error response", () => {
    const state = resolveCreativePageState({
      performanceRows: [{ id: "stale-performance" }],
      structureOnlyRows: [{ id: "stale-structure" }],
      summary: { spend: 1 },
      bucketSummary: { watching: 1 },
      coverage: { status: "ERROR" }
    });

    expect(state.performanceRows).toEqual([]);
    expect(state.structureOnlyRows).toEqual([]);
    expect(state.summary).toBeNull();
    expect(state.bucketSummary).toEqual({});
  });
});
