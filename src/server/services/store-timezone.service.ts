import axios from "axios";
import prisma from "../../db/index.js";
import { normalizeIanaTimezoneOrNull } from "../utils/timezone.js";

export type StoreTimezoneSource =
  | "platform_shop_api"
  | "persisted_verified"
  | "manual_verified"
  | "temporary_default_la";

export type TimezoneProbeAttempt = {
  platform: string;
  apiVersion: string;
  endpoint: string;
  httpStatus: number | null;
  responseTopLevelKeys: string[];
  dataKeys: string[];
  timezoneFieldPath: string | null;
  errorCode: string | null;
};

export type VerifiedStoreTimezone = {
  timezone: string;
  timezoneSource: StoreTimezoneSource;
  timezoneVerifiedAt: string;
  platformTimezoneRaw: string | null;
  attempts?: TimezoneProbeAttempt[];
  temporaryTimezoneFallback?: boolean;
  temporaryTimezoneReason?: string;
};

type StoreTimezoneInput = {
  id?: number | null;
  name?: string | null;
  platform?: string | null;
  domain?: string | null;
  timezone?: string | null;
  shopline_token?: string | null;
  shopify_token?: string | null;
  shoplazza_token?: string | null;
};

export class StoreTimezoneError extends Error {
  code:
    | "STORE_TIMEZONE_UNVERIFIED"
    | "STORE_TIMEZONE_CHANGED"
    | "STORE_TIMEZONE_FIELD_UNAVAILABLE"
    | "STORE_TIMEZONE_PERMISSION_DENIED";
  details: Record<string, unknown>;

  constructor(code: StoreTimezoneError["code"], details: Record<string, unknown> = {}) {
    super(code);
    this.name = "StoreTimezoneError";
    this.code = code;
    this.details = details;
  }
}

function normalizePlatform(platform: string | null | undefined): "shopline" | "shopify" | "shoplazza" {
  const value = String(platform || "shopline").trim().toLowerCase();
  if (value === "shopify") return "shopify";
  if (value === "shoplazza") return "shoplazza";
  return "shopline";
}

function normalizeDomain(domain: string | null | undefined): string {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/admin(\/.*)?$/, "")
    .replace(/\/+$/, "");
}

function tokenForPlatform(store: StoreTimezoneInput): string | null {
  const platform = normalizePlatform(store.platform);
  const token =
    platform === "shopify"
      ? store.shopify_token
      : platform === "shoplazza"
        ? store.shoplazza_token
        : store.shopline_token;
  const trimmed = String(token || "").trim();
  return trimmed ? trimmed : null;
}

function canonicalIanaTimezoneOrNull(value: string | null | undefined): string | null {
  const normalized = normalizeIanaTimezoneOrNull(value);
  if (normalized === "US/Pacific") return "America/Los_Angeles";
  return normalized;
}

function readPath(payload: any, path: string): unknown {
  return path.split(".").reduce((current, key) => current?.[key], payload);
}

function firstRawTimezone(payload: any, paths?: string[]): { raw: string | null; path: string | null } {
  const candidates = [
    ...(paths || []),
    "shop.iana_timezone",
    "shop.timezone",
    "data.iana_timezone",
    "data.timezone",
    "iana_timezone",
    "timezone"
  ];
  for (const path of candidates) {
    const candidate = readPath(payload, path);
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return { raw: String(candidate).trim(), path };
    }
  }
  return { raw: null, path: null };
}

function sanitizedEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function keysOf(value: any): string[] {
  return value && typeof value === "object" ? Object.keys(value).sort() : [];
}

function buildAttempt(input: {
  platform: string;
  apiVersion: string;
  url: string;
  httpStatus?: number | null;
  payload?: any;
  timezoneFieldPath?: string | null;
  errorCode?: string | null;
}): TimezoneProbeAttempt {
  return {
    platform: input.platform,
    apiVersion: input.apiVersion,
    endpoint: sanitizedEndpoint(input.url),
    httpStatus: input.httpStatus ?? null,
    responseTopLevelKeys: keysOf(input.payload),
    dataKeys: keysOf(input.payload?.data),
    timezoneFieldPath: input.timezoneFieldPath ?? null,
    errorCode: input.errorCode ?? null
  };
}

function axiosErrorCode(error: any): string {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return "STORE_TIMEZONE_PERMISSION_DENIED";
  if (status === 404) return "HTTP_404";
  if (status) return `HTTP_${status}`;
  return error?.code || error?.message || "REQUEST_ERROR";
}

async function tryTimezoneEndpoint(input: {
  platform: "shopline" | "shopify" | "shoplazza";
  apiVersion: string;
  url: string;
  headers: Record<string, string>;
  fieldPaths: string[];
  attempts: TimezoneProbeAttempt[];
}): Promise<{ raw: string | null; timezone: string | null; fieldPath: string | null; permissionDenied: boolean }> {
  try {
    const response = await axios.get(input.url, { headers: input.headers, timeout: 5000 });
    const payload = response.data;
    const found = firstRawTimezone(payload, input.fieldPaths);
    const timezone = canonicalIanaTimezoneOrNull(found.raw);
    input.attempts.push(buildAttempt({
      platform: input.platform,
      apiVersion: input.apiVersion,
      url: input.url,
      httpStatus: response.status ?? null,
      payload,
      timezoneFieldPath: found.path,
      errorCode: timezone ? null : "STORE_TIMEZONE_FIELD_UNAVAILABLE"
    }));
    return { raw: found.raw, timezone, fieldPath: found.path, permissionDenied: false };
  } catch (error: any) {
    const errorCode = axiosErrorCode(error);
    input.attempts.push(buildAttempt({
      platform: input.platform,
      apiVersion: input.apiVersion,
      url: input.url,
      httpStatus: error?.response?.status ?? null,
      payload: error?.response?.data,
      errorCode
    }));
    return { raw: null, timezone: null, fieldPath: null, permissionDenied: errorCode === "STORE_TIMEZONE_PERMISSION_DENIED" };
  }
}

export async function probePlatformStoreTimezone(store: StoreTimezoneInput): Promise<{
  verified: VerifiedStoreTimezone | null;
  attempts: TimezoneProbeAttempt[];
  finalErrorCode: string | null;
}> {
  const platform = normalizePlatform(store.platform);
  const domain = normalizeDomain(store.domain);
  const token = tokenForPlatform(store);
  const attempts: TimezoneProbeAttempt[] = [];
  if (!domain || !token) return { verified: null, attempts, finalErrorCode: "STORE_TOKEN_MISSING" };

  const verifiedAt = new Date().toISOString();

  if (platform === "shopify") {
    const url = `https://${domain}/admin/api/2024-01/shop.json`;
    const probe = await tryTimezoneEndpoint({
      platform,
      apiVersion: "2024-01",
      url,
      attempts,
      fieldPaths: ["shop.iana_timezone", "shop.timezone"],
      headers: {
      "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });
    if (probe.timezone) {
      return {
        verified: { timezone: probe.timezone, timezoneSource: "platform_shop_api", timezoneVerifiedAt: verifiedAt, platformTimezoneRaw: probe.raw, attempts },
        attempts,
        finalErrorCode: null
      };
    }
    return { verified: null, attempts, finalErrorCode: probe.permissionDenied ? "STORE_TIMEZONE_PERMISSION_DENIED" : "STORE_TIMEZONE_FIELD_UNAVAILABLE" };
  }

  if (platform === "shopline") {
    const candidates = [
      { version: "20260601", url: `https://${domain}/admin/openapi/v20260601/merchants/shop.json` },
      { version: "20250601", url: `https://${domain}/admin/openapi/v20250601/merchants/shop.json` },
      { version: "20250301", url: `https://${domain}/admin/openapi/v20250301/merchants/shop.json` }
    ];
    for (const candidate of candidates) {
      const probe = await tryTimezoneEndpoint({
        platform,
        apiVersion: candidate.version,
        url: candidate.url,
        attempts,
        fieldPaths: ["data.iana_timezone", "data.timezone", "shop.iana_timezone", "shop.timezone"],
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
          "Accept": "application/json"
        }
      });
      if (probe.permissionDenied) {
        return { verified: null, attempts, finalErrorCode: "STORE_TIMEZONE_PERMISSION_DENIED" };
      }
      if (probe.timezone) {
        return {
          verified: { timezone: probe.timezone, timezoneSource: "platform_shop_api", timezoneVerifiedAt: verifiedAt, platformTimezoneRaw: probe.raw, attempts },
          attempts,
          finalErrorCode: null
        };
      }
    }
    return {
      verified: null,
      attempts,
      finalErrorCode: attempts.some(a => a.errorCode === "STORE_TIMEZONE_FIELD_UNAVAILABLE")
        ? "STORE_TIMEZONE_FIELD_UNAVAILABLE"
        : attempts.length > 0 && attempts.every(a => a.errorCode === "HTTP_404")
          ? "HTTP_404"
          : "STORE_TIMEZONE_UNVERIFIED"
    };
  }

  const candidates = [
    { version: "2026-01", url: `https://${domain}/openapi/2026-01/shop` },
    { version: "2025-06", url: `https://${domain}/openapi/2025-06/shop` },
    { version: "2024-07", url: `https://${domain}/openapi/2024-07/shop` },
    { version: "2022-01", url: `https://${domain}/openapi/2022-01/shop` }
  ];
  const shoplazzaFields = [
    "shop.iana_timezone",
    "shop.timezone",
    "shop.time_zone",
    "data.shop.iana_timezone",
    "data.shop.timezone",
    "data.shop.time_zone",
    "data.iana_timezone",
    "data.timezone",
    "data.time_zone",
    "iana_timezone",
    "timezone",
    "time_zone"
  ];
  for (const candidate of candidates) {
    const probe = await tryTimezoneEndpoint({
      platform,
      apiVersion: candidate.version,
      url: candidate.url,
      attempts,
      fieldPaths: shoplazzaFields,
      headers: {
        "access-token": token,
        "Accept": "application/json",
        "Content-Type": "application/json"
      }
    });
    if (probe.permissionDenied) {
      return { verified: null, attempts, finalErrorCode: "STORE_TIMEZONE_PERMISSION_DENIED" };
    }
    if (probe.timezone) {
      return {
        verified: { timezone: probe.timezone, timezoneSource: "platform_shop_api", timezoneVerifiedAt: verifiedAt, platformTimezoneRaw: probe.raw, attempts },
        attempts,
        finalErrorCode: null
      };
    }
  }
  return {
    verified: null,
    attempts,
    finalErrorCode: attempts.some(a => a.errorCode === "STORE_TIMEZONE_FIELD_UNAVAILABLE")
      ? "STORE_TIMEZONE_FIELD_UNAVAILABLE"
      : attempts.length > 0 && attempts.every(a => a.errorCode === "HTTP_404")
        ? "HTTP_404"
        : "STORE_TIMEZONE_UNVERIFIED"
  };
}

export async function fetchPlatformStoreTimezone(store: StoreTimezoneInput): Promise<VerifiedStoreTimezone | null> {
  const result = await probePlatformStoreTimezone(store);
  if (result.finalErrorCode === "STORE_TIMEZONE_PERMISSION_DENIED") {
    throw new StoreTimezoneError("STORE_TIMEZONE_PERMISSION_DENIED", {
      storeId: store.id ?? null,
      platform: normalizePlatform(store.platform),
      attempts: result.attempts
    });
  }
  return result.verified;
}

function parseMetadata(value: unknown): any {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function metadataTimezoneEvidence(metadata: any) {
  const diagnostics = metadata?.diagnostics || {};
  const manual = metadata?.timezoneVerification || diagnostics?.timezoneVerification || {};
  return {
    timezone: metadata?.timezone || diagnostics?.timezoneAfter || diagnostics?.timezone,
    timezoneSource: metadata?.timezoneSource || diagnostics?.timezoneSource,
    timezoneVerifiedAt: metadata?.timezoneVerifiedAt || diagnostics?.timezoneVerifiedAt,
    platformTimezoneRaw: metadata?.platformTimezoneRaw || diagnostics?.platformTimezoneRaw || null,
    manualTimezone: manual?.timezone,
    manualSource: manual?.source,
    manualVerifiedAt: manual?.verifiedAt
  };
}

export async function resolveVerifiedStoreTimezone(store: StoreTimezoneInput): Promise<VerifiedStoreTimezone> {
  const platform = normalizePlatform(store.platform);
  const probeResult = await probePlatformStoreTimezone(store);
  if (probeResult.finalErrorCode === "STORE_TIMEZONE_PERMISSION_DENIED") {
    throw new StoreTimezoneError("STORE_TIMEZONE_PERMISSION_DENIED", {
      storeId: store.id ?? null,
      platform,
      attempts: probeResult.attempts
    });
  }

  const platformVerified = probeResult.verified;
  if (platformVerified) {
    const persistedTimezone = canonicalIanaTimezoneOrNull(store.timezone);
    if (store.id && persistedTimezone && persistedTimezone !== platformVerified.timezone) {
      const affectedOrderCount = await prisma.order.count({
        where: { storeId: store.id }
      });
      if (affectedOrderCount > 0) {
        throw new StoreTimezoneError("STORE_TIMEZONE_CHANGED", {
          storeId: store.id,
          previousTimezone: persistedTimezone,
          platformTimezone: platformVerified.timezone,
          affectedOrderCount
        });
      }
    }
    return platformVerified;
  }

  const persistedTimezone = canonicalIanaTimezoneOrNull(store.timezone);

  if (store.id && persistedTimezone) {
    const log = await prisma.syncLog.findFirst({
      where: {
        storeId: store.id,
        taskType: "sync_store_orders",
        status: "success"
      },
      orderBy: { startedAt: "desc" }
    });
    const evidence = metadataTimezoneEvidence(parseMetadata(log?.metadata));
    const evidenceTimezone = canonicalIanaTimezoneOrNull(evidence.timezone);
    if (
      evidenceTimezone === persistedTimezone &&
      evidence.timezoneSource === "platform_shop_api" &&
      evidence.timezoneVerifiedAt
    ) {
      return {
        timezone: persistedTimezone,
        timezoneSource: "persisted_verified",
        timezoneVerifiedAt: String(evidence.timezoneVerifiedAt || log?.startedAt?.toISOString?.() || new Date().toISOString()),
        platformTimezoneRaw: evidence.platformTimezoneRaw || persistedTimezone
      };
    }
    const manualTimezone = canonicalIanaTimezoneOrNull(evidence.manualTimezone);
    if (
      platform === "shoplazza" &&
      probeResult.finalErrorCode === "STORE_TIMEZONE_FIELD_UNAVAILABLE" &&
      manualTimezone === persistedTimezone &&
      evidence.manualSource === "manual_verified" &&
      evidence.manualVerifiedAt
    ) {
      return {
        timezone: persistedTimezone,
        timezoneSource: "manual_verified",
        timezoneVerifiedAt: String(evidence.manualVerifiedAt),
        platformTimezoneRaw: null
      };
    }
  }

  throw new StoreTimezoneError("STORE_TIMEZONE_UNVERIFIED", {
    storeId: store.id ?? null,
    platform,
    domain: normalizeDomain(store.domain),
    persistedTimezone: store.timezone || null
  });
}
