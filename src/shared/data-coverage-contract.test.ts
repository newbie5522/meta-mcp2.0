import { describe, expect, it } from "vitest";
import { resolveDataCoverageStatus, type ResolveDataCoverageInput } from "./data-coverage-contract";

const base: ResolveDataCoverageInput = {
  source: "META_CREATIVE",
  scopeKey: "store:1|account:act_1",
  requestedStartDate: "2026-07-01",
  requestedEndDate: "2026-07-07",
  businessToday: "2026-07-15"
};

describe("resolveDataCoverageStatus", () => {
  it("returns READY only when both fact boundaries cover the request", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      earliestAvailableDate: "2026-07-01",
      latestAvailableDate: "2026-07-07"
    }).status).toBe("READY");
  });

  it("returns PARTIAL_COVERAGE when either fact boundary is incomplete", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      earliestAvailableDate: "2026-07-02",
      latestAvailableDate: "2026-07-07"
    }).status).toBe("PARTIAL_COVERAGE");
  });

  it("does not call empty rows TRUE_EMPTY without exact success evidence", () => {
    expect(resolveDataCoverageStatus(base).status).toBe("NOT_SYNCED");
  });

  it("maps an exact complete zero-row NO_NEW_DATA receipt to TRUE_EMPTY", () => {
    const result = resolveDataCoverageStatus({
      ...base,
      coverageComplete: true,
      syncEvidence: {
        taskType: "sync_meta_creatives",
        taskId: "task-1",
        status: "NO_NEW_DATA",
        rangeStart: "2026-07-01",
        rangeEnd: "2026-07-07",
        recordsFetched: 0,
        recordsSaved: 0,
        failedCount: 0
      }
    });
    expect(result.status).toBe("TRUE_EMPTY");
    expect(result.coverageBasis).toBe("EXACT_EMPTY_SYNC_RECEIPT");
  });

  it("keeps a non-exact NO_NEW_DATA receipt out of TRUE_EMPTY", () => {
    const result = resolveDataCoverageStatus({
      ...base,
      coverageComplete: true,
      syncEvidence: {
        taskType: "sync_meta_creatives",
        taskId: "task-1",
        status: "NO_NEW_DATA",
        rangeStart: "2026-07-02",
        rangeEnd: "2026-07-07",
        recordsFetched: 0,
        recordsSaved: 0,
        failedCount: 0
      }
    });
    expect(result.status).not.toBe("TRUE_EMPTY");
  });

  it("returns SYNC_RUNNING only for matching running evidence supplied by the caller", () => {
    expect(resolveDataCoverageStatus({ ...base, syncRunning: true }).status).toBe("SYNC_RUNNING");
  });

  it("returns ERROR for a coverage query failure", () => {
    expect(resolveDataCoverageStatus({ ...base, queryError: true }).status).toBe("ERROR");
  });

  it("marks today as in progress and preserves the actual as-of time", () => {
    const result = resolveDataCoverageStatus({
      ...base,
      requestedEndDate: "2026-07-15",
      businessToday: "2026-07-15",
      rangeRowCount: 1,
      earliestAvailableDate: "2026-07-01",
      latestAvailableDate: "2026-07-15",
      asOfTime: "2026-07-15T12:30:00.000Z"
    });
    expect(result.currentDayInProgress).toBe(true);
    expect(result.asOfTime).toBe("2026-07-15T12:30:00.000Z");
  });
});
