import { describe, expect, it } from "vitest";
import {
  compareDateRanges,
  getDateRangeByPreset,
  getStoreLocalDate,
  getUtcRangeForStoreLocalDateRange,
  localDateStringToUtcDate,
} from "../../src/shared/date-time.js";

describe("date/time utility", () => {
  it("assigns orders to the store local date instead of a fixed UTC date", () => {
    const utcOrderTime = "2026-06-08T02:30:00.000Z";

    expect(getStoreLocalDate(utcOrderTime, "America/Los_Angeles")).toBe("2026-06-07");
    expect(getStoreLocalDate(utcOrderTime, "Asia/Shanghai")).toBe("2026-06-08");
  });

  it("builds UTC query windows from store local date ranges", () => {
    const range = getUtcRangeForStoreLocalDateRange("2026-06-08", "2026-06-08", "America/Los_Angeles");

    expect(range.startUtc.toISOString()).toBe("2026-06-08T07:00:00.000Z");
    expect(range.endUtc.toISOString()).toBe("2026-06-09T06:59:59.999Z");
  });

  it("computes presets in the requested timezone", () => {
    const now = new Date("2026-06-08T01:30:00.000Z");

    expect(getDateRangeByPreset("today", "America/Los_Angeles", now)).toMatchObject({
      startDate: "2026-06-07",
      endDate: "2026-06-07",
      timezone: "America/Los_Angeles",
    });
    expect(getDateRangeByPreset("today", "Asia/Shanghai", now)).toMatchObject({
      startDate: "2026-06-08",
      endDate: "2026-06-08",
      timezone: "Asia/Shanghai",
    });
  });

  it("derives previous comparison ranges from the same timezone", () => {
    const comparison = compareDateRanges({ startDate: "2026-06-01", endDate: "2026-06-07", timezone: "Asia/Shanghai" }, undefined);

    expect(comparison.previous).toMatchObject({
      startDate: "2026-05-25",
      endDate: "2026-05-31",
      timezone: "Asia/Shanghai",
    });
  });

  it("stores local dates as UTC midnight date values for Prisma date columns", () => {
    expect(localDateStringToUtcDate("2026-06-08").toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });
});
