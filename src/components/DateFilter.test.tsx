import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getBusinessDateRange } from "../shared/business-time";

const dateFilterSource = readFileSync(resolve(process.cwd(), "src/components/DateFilter.tsx"), "utf8");

describe("DateFilter shared date range contract", () => {
  it("DATE-PRESET-07 uses getBusinessDateRange for active state and shortcut changes", () => {
    expect(dateFilterSource.match(/getBusinessDateRange\(id\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(dateFilterSource).toContain("const r = getBusinessDateRange(id)");
    expect(dateFilterSource).toContain("const range = getBusinessDateRange(id)");
  });

  it("DATE-PRESET-08 does not locally recalculate past completed-day presets", () => {
    expect(dateFilterSource).not.toContain("subtract(6");
    expect(dateFilterSource).not.toContain("subtract(13");
    expect(dateFilterSource).not.toContain("subtract(29");
    expect(getBusinessDateRange("past_7")).toHaveProperty("startDateStr");
  });
});
