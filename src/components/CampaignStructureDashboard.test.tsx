import { describe, expect, it } from "vitest";
import { formatFixed, formatMoney, formatNumber, hasPerformanceFacts } from "./CampaignStructureDashboard";

describe("Campaign structure-only row contract", () => {
  it("marks structure rows without current-period facts as unavailable for performance diagnosis", () => {
    expect(hasPerformanceFacts({ hasPerformanceFacts: false, spend: null, impressions: null })).toBe(false);
    expect(hasPerformanceFacts({ spend: null, impressions: 0 })).toBe(false);
    expect(hasPerformanceFacts({ spend: 0, impressions: 0 })).toBe(true);
  });

  it("renders unavailable metrics as N/A instead of fabricating zero values", () => {
    expect(formatMoney(null)).toBe("N/A");
    expect(formatNumber(undefined)).toBe("N/A");
    expect(formatFixed(null, 2, "%")).toBe("N/A");
    expect(formatMoney(12.345)).toBe("$12.35");
  });
});
