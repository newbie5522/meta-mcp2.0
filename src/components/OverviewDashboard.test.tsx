import { describe, expect, it } from "vitest";
import {
  buildOverviewRequestKey,
  overviewCoverageAvailable,
  overviewCurrency,
  overviewRoas
} from "./OverviewDashboard";
import { shouldApplyLatestRequest } from "../lib/data-view-state";

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

  it("OVERVIEW-11 refresh button POST then GET request key excludes refresh", () => {
    const key = buildOverviewRequestKey(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-07T00:00:00Z"));
    expect(key).toContain("2026-07-01");
    expect(key).toContain("2026-07-07");
    expect(key).not.toContain("refresh");
  });
});
