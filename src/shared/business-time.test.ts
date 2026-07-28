import { afterEach, describe, expect, it, vi } from "vitest";
import { getBusinessDateRange, getBusinessTodayString, getBusinessTimezone } from "./business-time";

describe("business time date presets", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("DATE-PRESET-01 returns the previous 7 completed LA business days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T16:00:00Z"));

    expect(getBusinessDateRange("past_7")).toEqual({
      startDateStr: "2026-07-21",
      endDateStr: "2026-07-27"
    });
  });

  it("DATE-PRESET-02 returns the previous 14 completed LA business days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T16:00:00Z"));

    expect(getBusinessDateRange("past_14")).toEqual({
      startDateStr: "2026-07-14",
      endDateStr: "2026-07-27"
    });
  });

  it("DATE-PRESET-03 returns the previous 30 completed LA business days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T16:00:00Z"));

    expect(getBusinessDateRange("past_30")).toEqual({
      startDateStr: "2026-06-28",
      endDateStr: "2026-07-27"
    });
  });

  it("DATE-PRESET-04 keeps today as the current LA business day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T16:00:00Z"));

    expect(getBusinessDateRange("today")).toEqual({
      startDateStr: "2026-07-28",
      endDateStr: "2026-07-28"
    });
  });

  it("DATE-PRESET-05 keeps yesterday as one completed LA business day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T16:00:00Z"));

    expect(getBusinessDateRange("yesterday")).toEqual({
      startDateStr: "2026-07-27",
      endDateStr: "2026-07-27"
    });
  });

  it("DATE-PRESET-06 uses America/Los_Angeles even when UTC date has rolled over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T06:30:00Z"));

    expect(getBusinessTimezone()).toBe("America/Los_Angeles");
    expect(getBusinessTodayString()).toBe("2026-07-28");
    expect(getBusinessDateRange("past_7")).toEqual({
      startDateStr: "2026-07-21",
      endDateStr: "2026-07-27"
    });
  });

  it("defaults to the previous 30 completed LA business days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T16:00:00Z"));

    expect(getBusinessDateRange("unknown")).toEqual(getBusinessDateRange("past_30"));
  });
});
