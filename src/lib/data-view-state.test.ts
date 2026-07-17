import { describe, expect, it } from "vitest";
import {
  isCanceledRequest,
  isDateRangeMismatch,
  responseDateRangeMatches,
  shouldApplyLatestRequest,
  shouldPreserveLastGoodData
} from "./data-view-state";

const requestKey = "date:2026-07-01..2026-07-07|store:1";
const snapshot = { requestKey, data: [{ id: 1 }] };

describe("shouldPreserveLastGoodData", () => {
  for (const status of [
    "EMPTY",
    "TRUE_EMPTY",
    "NOT_SYNCED",
    "PARTIAL_COVERAGE",
    "REQUEST_FAILED",
    "DATE_RANGE_MISMATCH",
    "ERROR"
  ]) {
    it(`does not preserve ${status}`, () => {
      expect(shouldPreserveLastGoodData({
        coverage: { status },
        status,
        allowStaleWhileRunning: true
      }, [], snapshot, requestKey)).toBe(false);
    });
  }

  it("preserves only an explicitly allowed same-scope SYNC_RUNNING snapshot", () => {
    expect(shouldPreserveLastGoodData({
      coverage: { status: "SYNC_RUNNING" },
      status: "SYNC_RUNNING",
      allowStaleWhileRunning: true
    }, [], snapshot, requestKey)).toBe(true);
  });

  it("does not preserve SYNC_RUNNING without explicit stale permission", () => {
    expect(shouldPreserveLastGoodData({ status: "SYNC_RUNNING" }, [], snapshot, requestKey)).toBe(false);
  });

  it("never preserves a different request key", () => {
    expect(shouldPreserveLastGoodData({
      status: "SYNC_RUNNING",
      allowStaleWhileRunning: true
    }, [], snapshot, `${requestKey}|account:2`)).toBe(false);
  });
});

describe("data view request and date guards", () => {
  it("DV-01 missing response date is mismatch", () => {
    expect(isDateRangeMismatch({}, "2026-07-01", "2026-07-07")).toBe(true);
  });

  it("DV-02 mismatched response date is mismatch", () => {
    expect(isDateRangeMismatch({
      dateRange: { startDate: "2026-07-02", endDate: "2026-07-07" }
    }, "2026-07-01", "2026-07-07")).toBe(true);
  });

  it("DV-03 exact response date matches", () => {
    expect(responseDateRangeMatches({
      appliedFilters: { startDate: "2026-07-01", endDate: "2026-07-07" }
    }, "2026-07-01", "2026-07-07")).toBe(true);
  });

  it("DV-04 old request id is rejected", () => {
    expect(shouldApplyLatestRequest({
      requestId: 1,
      latestRequestId: 2,
      sourceRequestKey: "same",
      latestRequestKey: "same"
    })).toBe(false);
  });

  it("DV-05 old request key is rejected", () => {
    expect(shouldApplyLatestRequest({
      requestId: 2,
      latestRequestId: 2,
      sourceRequestKey: "old",
      latestRequestKey: "new"
    })).toBe(false);
  });

  it("DV-06 current id and key are accepted", () => {
    expect(shouldApplyLatestRequest({
      requestId: 2,
      latestRequestId: 2,
      sourceRequestKey: "current",
      latestRequestKey: "current"
    })).toBe(true);
  });

  it("DV-07 canceled request detection", () => {
    expect(isCanceledRequest({ name: "CanceledError" })).toBe(true);
    expect(isCanceledRequest({ code: "ERR_CANCELED" })).toBe(true);
    expect(isCanceledRequest({ message: "canceled" })).toBe(true);
    expect(isCanceledRequest(new Error("boom"))).toBe(false);
  });
});
