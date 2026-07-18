import { describe, expect, it } from "vitest";
import {
  buildOverviewRequestKey,
  overviewCoverageAvailable,
  overviewCurrency,
  overviewRoas,
  resolveOverviewResponseState
} from "./OverviewDashboard";
import { shouldApplyLatestRequest } from "../lib/data-view-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Overview page contract", () => {
  it("OVERVIEW-08 Store NOT_SYNCED renders N/A", () => {
    expect(overviewCoverageAvailable("NOT_SYNCED")).toBe(false);
    expect(overviewCurrency(null)).toBe("N/A");
  });

  it("OVERVIEW-09 Meta TRUE_EMPTY renders 0", () => {
    expect(overviewCoverageAvailable("TRUE_EMPTY")).toBe(true);
    expect(overviewCurrency(0)).toBe("$0.00");
    expect(overviewRoas(0)).toBe("0.00x");
  });

  it("OVERVIEW-10 old response ignored", () => {
    expect(shouldApplyLatestRequest({
      requestId: 1,
      latestRequestId: 2,
      sourceRequestKey: "old",
      latestRequestKey: "new"
    })).toBe(false);
  });

  it("RC-04 old deferred overview response cannot replace the newer date response", async () => {
    const oldResponse = deferred<unknown>();
    const newResponse = deferred<unknown>();
    const latestRequestId = 2;
    const latestRequestKey = "overview:new";

    newResponse.resolve({ data: { overview: { storeSales: 200 } } });
    await newResponse.promise;
    expect(shouldApplyLatestRequest({
      requestId: 2,
      latestRequestId,
      sourceRequestKey: "overview:new",
      latestRequestKey
    })).toBe(true);

    oldResponse.resolve({ data: { overview: { storeSales: 100 } } });
    await oldResponse.promise;
    expect(shouldApplyLatestRequest({
      requestId: 1,
      latestRequestId,
      sourceRequestKey: "overview:old",
      latestRequestKey
    })).toBe(false);
  });

  it("OVERVIEW-11 refresh button POST then GET request key excludes refresh", () => {
    const key = buildOverviewRequestKey(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-07T00:00:00Z"));
    expect(key).toContain("2026-07-01");
    expect(key).toContain("2026-07-07");
    expect(key).not.toContain("refresh");
  });

  it("RC-04 rejects overview responses from a different dateRange before applying data", () => {
    const state = resolveOverviewResponseState({
      data: { overview: { storeSales: 100 } },
      dateRange: { startDate: "2026-06-01", endDate: "2026-06-07" }
    }, "2026-07-01", "2026-07-07");

    expect(state.stale).toBe(true);
    expect(state.summary).toBeNull();
    expect(state.storeCoverage).toBeNull();
    expect(state.productCoverage).toBeNull();
  });

  it("RC-04 product coverage gates product table metrics", () => {
    expect(overviewCoverageAvailable("READY")).toBe(true);
    expect(overviewCoverageAvailable("TRUE_EMPTY")).toBe(true);
    expect(overviewCoverageAvailable("ERROR")).toBe(false);
    expect(overviewCoverageAvailable("SYNC_RUNNING")).toBe(false);
    expect(overviewCoverageAvailable("NOT_SYNCED")).toBe(false);
  });
});
