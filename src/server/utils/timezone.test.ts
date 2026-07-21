import { describe, expect, it } from "vitest";
import {
  getStoreLocalDate,
  getTzOffset,
  normalizeIanaTimezoneOrNull,
  requireVerifiedIanaTimezone
} from "./timezone";

describe("strict store timezone utilities", () => {
  it("accepts valid IANA identifiers without guessing from offsets or aliases", () => {
    expect(normalizeIanaTimezoneOrNull("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(normalizeIanaTimezoneOrNull("UTC")).toBe("UTC");
    expect(normalizeIanaTimezoneOrNull("GMT-7")).toBeNull();
    expect(normalizeIanaTimezoneOrNull("+08:00")).toBeNull();
    expect(normalizeIanaTimezoneOrNull("Pacific Time")).toBeNull();
  });

  it("throws STORE_TIMEZONE_UNVERIFIED instead of falling back", () => {
    expect(() => requireVerifiedIanaTimezone(null)).toThrow("STORE_TIMEZONE_UNVERIFIED");
    expect(() => getTzOffset("GMT+8", "2026-07-01")).toThrow("STORE_TIMEZONE_UNVERIFIED");
  });

  it("uses the supplied verified timezone for local order dates", () => {
    expect(getStoreLocalDate("2026-07-01T06:30:00.000Z", "America/Los_Angeles")).toBe("2026-06-30");
    expect(getStoreLocalDate("2026-07-01T06:30:00.000Z", "Asia/Shanghai")).toBe("2026-07-01");
  });
});
