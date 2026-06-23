import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export const APP_BUSINESS_TIMEZONE = "America/Los_Angeles";

export function getBusinessTimezone() {
  return APP_BUSINESS_TIMEZONE;
}

export function getBusinessNow() {
  return dayjs().tz(APP_BUSINESS_TIMEZONE);
}

export function getBusinessTodayString() {
  return getBusinessNow().format("YYYY-MM-DD");
}

export function getBusinessYesterdayString() {
  return getBusinessNow().subtract(1, "day").format("YYYY-MM-DD");
}

export function businessDateStringToSafeDate(dateStr: string): Date {
  // Use noon local time to avoid browser timezone date rollover when React/date-fns receives Date.
  return new Date(`${dateStr}T12:00:00`);
}

export function safeDateToDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getBusinessDateRange(rangeId: string): { startDateStr: string; endDateStr: string } {
  const today = getBusinessNow();
  const closedEnd = getBusinessNow().subtract(1, "day");

  switch (rangeId) {
    case "today":
      return {
        startDateStr: today.format("YYYY-MM-DD"),
        endDateStr: today.format("YYYY-MM-DD")
      };

    case "yesterday":
      return {
        startDateStr: closedEnd.format("YYYY-MM-DD"),
        endDateStr: closedEnd.format("YYYY-MM-DD")
      };

    case "past_7":
      return {
        startDateStr: closedEnd.subtract(6, "day").format("YYYY-MM-DD"),
        endDateStr: closedEnd.format("YYYY-MM-DD")
      };

    case "past_14":
      return {
        startDateStr: closedEnd.subtract(13, "day").format("YYYY-MM-DD"),
        endDateStr: closedEnd.format("YYYY-MM-DD")
      };

    case "past_30":
      return {
        startDateStr: closedEnd.subtract(29, "day").format("YYYY-MM-DD"),
        endDateStr: closedEnd.format("YYYY-MM-DD")
      };

    case "this_week": {
      const start = closedEnd.startOf("week").add(1, "day");
      const fixedStart = start.isAfter(closedEnd) ? start.subtract(7, "day") : start;

      return {
        startDateStr: fixedStart.format("YYYY-MM-DD"),
        endDateStr: closedEnd.format("YYYY-MM-DD")
      };
    }

    case "last_week": {
      const thisWeekStart = today.startOf("week").add(1, "day");
      const fixedThisWeekStart = thisWeekStart.isAfter(today) ? thisWeekStart.subtract(7, "day") : thisWeekStart;
      const lastWeekStart = fixedThisWeekStart.subtract(7, "day");
      const lastWeekEnd = fixedThisWeekStart.subtract(1, "day");
      return {
        startDateStr: lastWeekStart.format("YYYY-MM-DD"),
        endDateStr: lastWeekEnd.format("YYYY-MM-DD")
      };
    }

    case "this_month": {
      return {
        startDateStr: closedEnd.startOf("month").format("YYYY-MM-DD"),
        endDateStr: closedEnd.format("YYYY-MM-DD")
      };
    }

    case "last_month": {
      const lastMonth = today.subtract(1, "month");
      return {
        startDateStr: lastMonth.startOf("month").format("YYYY-MM-DD"),
        endDateStr: lastMonth.endOf("month").format("YYYY-MM-DD")
      };
    }

    default:
      return {
        startDateStr: closedEnd.subtract(29, "day").format("YYYY-MM-DD"),
        endDateStr: closedEnd.format("YYYY-MM-DD")
      };
  }
}

export function getBusinessClockLabel() {
  return getBusinessNow().format("YYYY-MM-DD HH:mm:ss");
}
