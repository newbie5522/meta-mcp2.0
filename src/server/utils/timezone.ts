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

  if (!tz) return "America/Los_Angeles"; // Default fallback instead of Asia/Shanghai
  const trimmed = tz.trim();

  // Explicit mappings
  const lower = trimmed.toLowerCase();
  
  if (lower === "us/pacific" || lower === "pacific time" || lower === "pst" || lower === "pdt" || lower === "pacific/los_angeles") {
    return "America/Los_Angeles";
  }

  if (
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
    // try formatting other numeric offsets typical to database inputs
    const match = trimmed.match(/([+-])(\d{1,2})/);
    if (match) {
      const sign = match[1] === '-' ? -1 : 1;
      const hours = parseInt(match[2], 10) * sign;
      
      if (hours === -8 || hours === -7) {
        return "America/Los_Angeles";
      }
      if (hours === -6) return "America/Chicago";
      if (hours === -5) return "America/New_York";
      if (hours === -4) return "America/Halifax";
      if (hours === -3) return "America/Argentina/Buenos_Aires";
      if (hours === -2) return "America/Noronha";
      if (hours === -1) return "Atlantic/Cape_Verde";
      if (hours === 0) return "UTC";
      if (hours === 1) return "Europe/London";
      if (hours === 2) return "Europe/Paris";
      if (hours === 3) return "Europe/Moscow";
      if (hours === 4) return "Asia/Dubai";
      if (hours === 5) return "Asia/Karachi";
      if (hours === 6) return "Asia/Almaty";
      if (hours === 7) return "Asia/Bangkok";
      if (hours === 8) return "Asia/Shanghai";
      if (hours === 9) return "Asia/Tokyo";
      if (hours === 10) return "Australia/Sydney";
      if (hours === 11) return "Pacific/Guadalcanal";
      if (hours === 12) return "Pacific/Auckland";
      if (hours === 13) return "Pacific/Apia";
    }
  }

  // Fallback to America/Los_Angeles instead of Asia/Shanghai or Pacific/Honolulu
  return "America/Los_Angeles";
}

export function getTzOffset(timezoneName: string, dateStr: string): string {
  try {
    const d = dayjs.tz(`${dateStr}T12:00:00`, timezoneName);
    return d.format("Z");
  } catch (err) {
    return "-07:00"; // PDT standard
  }
}

export function getStoreLocalDate(createdAtStr: string | Date, timezoneStr: string): string {
  if (!createdAtStr) return dayjs().format("YYYY-MM-DD");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  try {
    return dayjs(d).tz(timezoneStr).format("YYYY-MM-DD");
  } catch (err) {
    return dayjs(d).format("YYYY-MM-DD");
  }
}

export function getStoreLocalDatetime(createdAtStr: string | Date, timezoneStr: string): string {
  if (!createdAtStr) return dayjs().format("YYYY-MM-DDTHH:mm:ss");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  try {
    return dayjs(d).tz(timezoneStr).format("YYYY-MM-DDTHH:mm:ss");
  } catch (err) {
    return dayjs(d).format("YYYY-MM-DDTHH:mm:ss");
  }
}
