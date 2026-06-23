import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Standardizes timezones to IANA tz names according to instructions.
 */
export function normalizeTimezone(tz: string | null | undefined, storeContext?: { id?: number; name?: string; domain?: string }): string {
  // If store context suggests Baslayer, force America/Los_Angeles
  if (storeContext) {
    const isBaslayer = 
      storeContext.id === 1 || 
      (storeContext.name && storeContext.name.toLowerCase().includes("baslayer")) ||
      (storeContext.domain && storeContext.domain.toLowerCase().includes("baslayer"));
    if (isBaslayer) {
      return "America/Los_Angeles";
    }
  }

  if (!tz) return "America/Los_Angeles";
  const trimmed = tz.trim();
  const lower = trimmed.toLowerCase();
  
  if (
    lower === "us/pacific" || 
    lower === "pacific time" || 
    lower === "pst" || 
    lower === "pdt" || 
    lower === "pacific/los_angeles" ||
    lower.includes("gmt-7") || 
    lower.includes("utc-7") || 
    lower.includes("gmt-07") || 
    lower.includes("utc-07") ||
    lower.includes("gmt -07") ||
    lower.includes("utc -07")
  ) {
    return "America/Los_Angeles";
  }

  // General check if it is already a valid IANA timezone name
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch (e) {
    // If not a valid IANA timezone name, return America/Los_Angeles fallback as required
  }

  return "America/Los_Angeles";
}

export function getTzOffset(timezoneName: string, dateStr: string): string {
  const secureTz = normalizeTimezone(timezoneName);
  try {
    const d = dayjs.tz(`${dateStr}T12:00:00`, secureTz);
    return d.format("Z");
  } catch (err) {
    return "-07:00"; // PDT standard
  }
}

export function getStoreLocalDate(createdAtStr: string | Date, timezoneStr: string): string {
  const secureTz = normalizeTimezone(timezoneStr);
  if (!createdAtStr) return dayjs().tz(secureTz).format("YYYY-MM-DD");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  try {
    return dayjs(d).tz(secureTz).format("YYYY-MM-DD");
  } catch (err) {
    return dayjs(d).tz("America/Los_Angeles").format("YYYY-MM-DD");
  }
}

export function getStoreLocalDatetime(createdAtStr: string | Date, timezoneStr: string): string {
  const secureTz = normalizeTimezone(timezoneStr);
  if (!createdAtStr) return dayjs().tz(secureTz).format("YYYY-MM-DDTHH:mm:ss");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  try {
    return dayjs(d).tz(secureTz).format("YYYY-MM-DDTHH:mm:ss");
  } catch (err) {
    return dayjs(d).tz("America/Los_Angeles").format("YYYY-MM-DDTHH:mm:ss");
  }
}
