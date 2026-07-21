import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Accepts only concrete IANA timezone identifiers. Store-local calculations
 * must not infer timezone from store id/name/domain, fixed offsets, or system
 * defaults.
 */
export function normalizeIanaTimezoneOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed || !trimmed.includes("/")) return trimmed === "UTC" ? "UTC" : null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch (e) {
    return null;
  }
}

export function requireVerifiedIanaTimezone(value: string | null | undefined): string {
  const normalized = normalizeIanaTimezoneOrNull(value);
  if (!normalized) {
    const err: any = new Error("STORE_TIMEZONE_UNVERIFIED");
    err.code = "STORE_TIMEZONE_UNVERIFIED";
    throw err;
  }
  return normalized;
}

export function normalizeTimezone(
  tz: string | null | undefined,
  _storeContext?: { id?: number; name?: string; domain?: string }
): string {
  return requireVerifiedIanaTimezone(tz);
}

export function getTzOffset(timezoneName: string, dateStr: string): string {
  const secureTz = requireVerifiedIanaTimezone(timezoneName);
  const d = dayjs.tz(`${dateStr}T12:00:00`, secureTz);
  return d.format("Z");
}

export function getStoreLocalDate(createdAtStr: string | Date, timezoneStr: string): string {
  const secureTz = requireVerifiedIanaTimezone(timezoneStr);
  if (!createdAtStr) return dayjs().tz(secureTz).format("YYYY-MM-DD");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  return dayjs(d).tz(secureTz).format("YYYY-MM-DD");
}

export function getStoreLocalDatetime(createdAtStr: string | Date, timezoneStr: string): string {
  const secureTz = requireVerifiedIanaTimezone(timezoneStr);
  if (!createdAtStr) return dayjs().tz(secureTz).format("YYYY-MM-DDTHH:mm:ss");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  return dayjs(d).tz(secureTz).format("YYYY-MM-DDTHH:mm:ss");
}
