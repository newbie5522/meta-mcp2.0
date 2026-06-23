import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export const APP_BUSINESS_TIMEZONE = process.env.APP_BUSINESS_TIMEZONE || "America/Los_Angeles";

export function businessNow() {
  return dayjs().tz(APP_BUSINESS_TIMEZONE);
}

export function businessTodayString() {
  return businessNow().format("YYYY-MM-DD");
}

export function businessYesterdayString() {
  return businessNow().subtract(1, "day").format("YYYY-MM-DD");
}

export function businessDateRange(rangeId: string) {
  const today = businessNow();

  if (rangeId === "today") {
    return { startDate: today.format("YYYY-MM-DD"), endDate: today.format("YYYY-MM-DD") };
  }

  if (rangeId === "yesterday") {
    const y = today.subtract(1, "day");
    return { startDate: y.format("YYYY-MM-DD"), endDate: y.format("YYYY-MM-DD") };
  }

  return {
    startDate: today.subtract(29, "day").format("YYYY-MM-DD"),
    endDate: today.format("YYYY-MM-DD")
  };
}
