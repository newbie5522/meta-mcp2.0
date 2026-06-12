import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezonePlugin from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "custom";

export interface DateRange {
  startDate: string;
  endDate: string;
  timezone: string;
}

export interface UtcRange {
  startUtc: Date;
  endUtc: Date;
  startUtcIso: string;
  endUtcIso: string;
}

const runtimeEnv = typeof process !== "undefined" ? process.env : undefined;
export const SYSTEM_DEFAULT_TIMEZONE = runtimeEnv?.SYSTEM_DEFAULT_TIMEZONE?.trim() || "UTC";

export function normalizeTimezone(value?: string | null, fallback = SYSTEM_DEFAULT_TIMEZONE): string {
  const timezone = value?.trim() || fallback;
  try {
    dayjs.tz("2026-01-01T00:00:00", timezone);
    return timezone;
  } catch {
    return fallback;
  }
}

export function dateOnlyString(value: Date | string): string {
  if (typeof value === "string") {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  return dayjs(value).utc().format("YYYY-MM-DD");
}

function addDays(date: dayjs.Dayjs, days: number) {
  return date.add(days, "day");
}

export function getDateRangeByPreset(preset: DatePreset, timezone?: string | null, now: Date = new Date()): DateRange {
  const tz = normalizeTimezone(timezone);
  const today = dayjs(now).tz(tz).startOf("day");
  let start = today;
  let end = today;

  switch (preset) {
    case "yesterday":
      start = addDays(today, -1);
      end = addDays(today, -1);
      break;
    case "last_7_days":
      start = addDays(today, -6);
      break;
    case "last_14_days":
      start = addDays(today, -13);
      break;
    case "last_30_days":
      start = addDays(today, -29);
      break;
    case "this_week":
      start = today.startOf("week").add(1, "day");
      if (start.isAfter(today)) start = start.subtract(7, "day");
      break;
    case "last_week": {
      const thisWeekStart = today.startOf("week").add(1, "day");
      const monday = thisWeekStart.isAfter(today) ? thisWeekStart.subtract(7, "day") : thisWeekStart;
      start = monday.subtract(7, "day");
      end = monday.subtract(1, "day");
      break;
    }
    case "this_month":
      start = today.startOf("month");
      break;
    case "last_month":
      start = today.subtract(1, "month").startOf("month");
      end = today.subtract(1, "month").endOf("month").startOf("day");
      break;
    case "this_year":
      start = today.startOf("year");
      break;
    case "last_year":
      start = today.subtract(1, "year").startOf("year");
      end = today.subtract(1, "year").endOf("year").startOf("day");
      break;
    case "custom":
    case "today":
    default:
      break;
  }

  return {
    startDate: start.format("YYYY-MM-DD"),
    endDate: end.format("YYYY-MM-DD"),
    timezone: tz,
  };
}

export function convertToStoreLocalTime(date: Date | string, storeTimezone?: string | null): Date {
  const tz = normalizeTimezone(storeTimezone);
  const local = dayjs(date).tz(tz);
  return dayjs.utc(local.format("YYYY-MM-DDTHH:mm:ss.SSS")).toDate();
}

export function getStoreLocalDate(date: Date | string, storeTimezone?: string | null): string {
  const tz = normalizeTimezone(storeTimezone);
  return dayjs(date).tz(tz).format("YYYY-MM-DD");
}

export function localDateStringToUtcDate(date: string): Date {
  return dayjs.utc(`${dateOnlyString(date)}T00:00:00.000Z`).toDate();
}

export function getUtcRangeForStoreLocalDateRange(startDate: Date | string, endDate: Date | string, storeTimezone?: string | null): UtcRange {
  const tz = normalizeTimezone(storeTimezone);
  const startLocal = dayjs.tz(`${dateOnlyString(startDate)}T00:00:00`, tz);
  const endLocal = dayjs.tz(`${dateOnlyString(endDate)}T23:59:59.999`, tz);
  const startUtc = startLocal.utc().toDate();
  const endUtc = endLocal.utc().toDate();
  return {
    startUtc,
    endUtc,
    startUtcIso: startLocal.utc().toISOString(),
    endUtcIso: endLocal.utc().toISOString(),
  };
}

export function formatDateForDisplay(date: Date | string, timezone?: string | null): string {
  return dayjs(date).tz(normalizeTimezone(timezone)).format("YYYY-MM-DD HH:mm:ss z");
}

export function compareDateRanges(currentRange: DateRange, _previousRange: DateRange | undefined, timezone?: string | null) {
  const tz = normalizeTimezone(timezone ?? currentRange.timezone);
  const start = dayjs.tz(`${currentRange.startDate}T00:00:00`, tz);
  const end = dayjs.tz(`${currentRange.endDate}T00:00:00`, tz);
  const days = Math.max(1, end.diff(start, "day") + 1);
  const previousEnd = start.subtract(1, "day");
  const previousStart = previousEnd.subtract(days - 1, "day");
  return {
    current: { ...currentRange, timezone: tz },
    previous: {
      startDate: previousStart.format("YYYY-MM-DD"),
      endDate: previousEnd.format("YYYY-MM-DD"),
      timezone: tz,
    },
  };
}

export function getMetaDateRangeForAccount(startDate: Date | string, endDate: Date | string, metaAccountTimezone?: string | null): DateRange {
  return {
    startDate: dateOnlyString(startDate),
    endDate: dateOnlyString(endDate),
    timezone: normalizeTimezone(metaAccountTimezone),
  };
}

export function getSystemDisplayDateRange(startDate: Date | string, endDate: Date | string, displayTimezone?: string | null): DateRange {
  return {
    startDate: dateOnlyString(startDate),
    endDate: dateOnlyString(endDate),
    timezone: normalizeTimezone(displayTimezone),
  };
}
