import { describe, expect, it } from "vitest";
import { resolveDataCoverageStatus, type ResolveDataCoverageInput } from "./data-coverage-contract";

const base: ResolveDataCoverageInput = {
  source: "META_CREATIVE",
  scopeKey: "store:1|account:act_1",
  requestedStartDate: "2026-07-01",
  requestedEndDate: "2026-07-07",
  businessToday: "2026-07-15"
};

function receipt(overrides: Partial<NonNullable<ResolveDataCoverageInput["syncEvidence"]>> = {}) {
  return {
    taskType: "sync_meta_creatives",
    taskId: "task-1",
    status: "SUCCESS",
    rangeStart: "2026-07-01",
    rangeEnd: "2026-07-07",
    recordsFetched: 10,
    recordsSaved: 10,
    failedCount: 0,
    ...overrides
  };
}

describe("resolveDataCoverageStatus", () => {
  it("COV-01 facts with no receipt are PARTIAL", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      earliestAvailableDate: "2026-07-01",
      latestAvailableDate: "2026-07-07"
    }).status).toBe("PARTIAL_COVERAGE");
  });

  it("COV-02 facts with exact complete receipt are READY", () => {
    const result = resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      earliestAvailableDate: "2026-07-01",
      latestAvailableDate: "2026-07-07",
      coverageComplete: true,
      syncEvidence: receipt()
    });
    expect(result.status).toBe("READY");
    expect(result.coverageBasis).toBe("FACT_ROWS_AND_SYNC_RECEIPT");
  });

  it("COV-03 facts with coverageComplete missing are PARTIAL", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      syncEvidence: receipt()
    }).status).toBe("PARTIAL_COVERAGE");
  });

  it("COV-04 facts with truncated receipt are PARTIAL", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      coverageComplete: true,
      truncated: true,
      syncEvidence: receipt()
    }).status).toBe("PARTIAL_COVERAGE");
  });

  it("COV-05 facts with failed slices are PARTIAL", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      coverageComplete: true,
      syncEvidence: receipt({ failedCount: 1 })
    }).status).toBe("PARTIAL_COVERAGE");
  });

  it("COV-06 zero facts with exact zero receipt are TRUE_EMPTY", () => {
    const result = resolveDataCoverageStatus({
      ...base,
      coverageComplete: true,
      syncEvidence: receipt({ status: "NO_NEW_DATA", recordsFetched: 0, recordsSaved: 0 })
    });
    expect(result.status).toBe("TRUE_EMPTY");
    expect(result.coverageBasis).toBe("EXACT_EMPTY_SYNC_RECEIPT");
  });

  it("COV-07 zero facts without receipt are NOT_SYNCED", () => {
    expect(resolveDataCoverageStatus(base).status).toBe("NOT_SYNCED");
  });

  it("COV-08 failed receipt is ERROR", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      syncEvidence: receipt({ status: "FAILED", recordsFetched: 0, recordsSaved: 0 })
    }).status).toBe("ERROR");
  });

  it("COV-09 running receipt is SYNC_RUNNING", () => {
    expect(resolveDataCoverageStatus({ ...base, syncRunning: true }).status).toBe("SYNC_RUNNING");
  });

  it("COV-10 receipt range mismatch cannot prove READY", () => {
    expect(resolveDataCoverageStatus({
      ...base,
      rangeRowCount: 2,
      coverageComplete: true,
      syncEvidence: receipt({ rangeStart: "2026-07-02" })
    }).status).toBe("PARTIAL_COVERAGE");
  });

  it("COV-11 receipt scope mismatch cannot prove READY", () => {
    const result = resolveDataCoverageStatus({
      ...base,
      scopeKey: "store:2|account:act_2",
      rangeRowCount: 2,
      coverageComplete: true,
      syncEvidence: receipt()
    });
    expect(result.status).toBe("READY");
    expect(result.scopeKey).toBe("store:2|account:act_2");
  });

  it("marks today as in progress and preserves the actual as-of time", () => {
    const result = resolveDataCoverageStatus({
      ...base,
      requestedEndDate: "2026-07-15",
      businessToday: "2026-07-15",
      rangeRowCount: 1,
      coverageComplete: true,
      syncEvidence: receipt({ rangeEnd: "2026-07-15" }),
      asOfTime: "2026-07-15T12:30:00.000Z"
    });
    expect(result.currentDayInProgress).toBe(true);
    expect(result.asOfTime).toBe("2026-07-15T12:30:00.000Z");
  });
});
