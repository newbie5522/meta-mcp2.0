import { describe, expect, it } from "vitest";
import { shouldPreserveLastGoodData } from "./data-view-state";

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
