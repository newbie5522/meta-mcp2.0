import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreativeAiReportPanel,
  CreativePreviewMedia,
  formatCreativeAiConfidence,
  getCreativePreviewSources,
  normalizeAiReportList,
  resolveCreativePageState
} from "./CreativeIntelligenceDashboard";
import { shouldApplyLatestRequest } from "../lib/data-view-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  it("PAGE-01/02/03 resolves creative preview sources and renders a neutral placeholder", () => {
    expect(getCreativePreviewSources({
      imageUrl: "https://bad.test/a.jpg",
      previewUrl: "https://good.test/b.jpg"
    })).toEqual(["https://bad.test/a.jpg", "https://good.test/b.jpg"]);

    const imageHtml = renderToStaticMarkup(
      <CreativePreviewMedia
        row={{
          creativeId: "creative-1",
          creativeName: "Test",
          type: "IMAGE",
          imageUrl: "https://good.test/a.jpg",
          previewUrl: null
        } as any}
      />
    );
    expect(imageHtml).toContain("creative-image-preview");
    expect(imageHtml).toContain("https://good.test/a.jpg");

    const emptyHtml = renderToStaticMarkup(
      <CreativePreviewMedia
        row={{
          creativeId: "creative-empty",
          creativeName: "Empty",
          type: "IMAGE",
          imageUrl: null,
          previewUrl: null
        } as any}
      />
    );
    expect(emptyHtml).toContain("creative-preview-unavailable");
  });

  it("PAGE-04 renders direct video URLs as video previews", () => {
    const html = renderToStaticMarkup(
      <CreativePreviewMedia
        row={{
          creativeId: "creative-video",
          creativeName: "Video",
          type: "VIDEO",
          imageUrl: null,
          previewUrl: "https://cdn.test/video.mp4"
        } as any}
      />
    );
    expect(html).toContain("creative-video-preview");
    expect(html).toContain("https://cdn.test/video.mp4");
  });

  it("PAGE-05~08 formats AI confidence, lists, and data basis without numeric coercion", () => {
    expect(formatCreativeAiConfidence("full")).toBe("完整覆盖");
    expect(formatCreativeAiConfidence("partial")).toBe("部分覆盖");
    expect(formatCreativeAiConfidence("partial")).not.toContain("NaN");
    expect(normalizeAiReportList("one\ntwo")).toEqual(["one", "two"]);

    const report = {
      conclusion: "WATCH",
      facts: ["spend 10"],
      riskPoints: [],
      recommendedActions: ["observe"],
      warnings: ["partial coverage"],
      coverageStatus: "PARTIAL_COVERAGE",
      confidence: "partial",
      dataBasis: {
        source: "FactMetaPerformance",
        factLevel: "ad",
        factRows: 1,
        accountId: "act_1",
        storeId: 1,
        creativeIds: ["creative-1"],
        adIds: ["ad-1"],
        campaignIds: ["camp-1"],
        adsetIds: ["set-1"],
        latestPerformanceDate: "2026-07-07",
        latestSyncedAt: "2026-07-08T00:00:00.000Z"
      }
    };
    const html = renderToStaticMarkup(<CreativeAiReportPanel aiReport={report} />);
    expect(html).toContain("creative-ai-conclusion");
    expect(html).toContain("spend 10");
    expect(html).toContain("No clear high-risk item");
    expect(html).toContain("observe");
    expect(html).toContain("partial coverage");
    expect(html).not.toContain("NaN");
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

  it("preserves server pagination row counts from the current page response", () => {
    const state = resolveCreativePageState({
      performanceRows: [{ id: "creative-page-row", type: "VIDEO" }],
      summary: { spend: 25 },
      bucketSummary: { scale: 1 },
      coverage: { status: "READY" },
      pagination: { page: 2, pageSize: 25, total: 80, totalPages: 4 },
      pageRowCount: 25,
      filteredTotalCount: 80
    });

    expect(state.performanceRows).toHaveLength(1);
    expect(state.pagination).toMatchObject({
      page: 2,
      pageSize: 25,
      total: 80,
      totalPages: 4,
      pageRowCount: 25,
      filteredTotalCount: 80
    });
  });

  it("RC-02 ignores an older deferred creative response after a newer request wins", async () => {
    const oldResponse = deferred<unknown>();
    const newResponse = deferred<unknown>();
    const latestRequestId = 2;
    const latestRequestKey = "creative:new";

    newResponse.resolve({ performanceRows: [{ id: "new" }] });
    await newResponse.promise;
    expect(shouldApplyLatestRequest({
      requestId: 2,
      latestRequestId,
      sourceRequestKey: "creative:new",
      latestRequestKey
    })).toBe(true);

    oldResponse.resolve({ performanceRows: [{ id: "old" }] });
    await oldResponse.promise;
    expect(shouldApplyLatestRequest({
      requestId: 1,
      latestRequestId,
      sourceRequestKey: "creative:old",
      latestRequestKey
    })).toBe(false);
  });
});
