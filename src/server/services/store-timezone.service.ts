import axios from "axios";
import prisma from "../../db/index.js";
import { normalizeIanaTimezoneOrNull } from "../utils/timezone.js";

export type StoreTimezoneSource = "platform_shop_api" | "persisted_verified";

export type VerifiedStoreTimezone = {
  timezone: string;
  timezoneSource: StoreTimezoneSource;
  timezoneVerifiedAt: string;
  platformTimezoneRaw: string | null;
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
  code: "STORE_TIMEZONE_UNVERIFIED" | "STORE_TIMEZONE_CHANGED";
  details: Record<string, unknown>;

  constructor(code: "STORE_TIMEZONE_UNVERIFIED" | "STORE_TIMEZONE_CHANGED", details: Record<string, unknown> = {}) {
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

function firstRawTimezone(payload: any): string | null {
  const candidates = [
    payload?.shop?.iana_timezone,
    payload?.shop?.timezone,
    payload?.data?.iana_timezone,
    payload?.data?.timezone,
    payload?.iana_timezone,
    payload?.timezone
  ];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return null;
}

async function getJson(url: string, headers: Record<string, string>) {
  const response = await axios.get(url, { headers, timeout: 5000 });
  if (response.status !== 200) return null;
  return response.data;
}

export async function fetchPlatformStoreTimezone(store: StoreTimezoneInput): Promise<VerifiedStoreTimezone | null> {
  const platform = normalizePlatform(store.platform);
  const domain = normalizeDomain(store.domain);
  const token = tokenForPlatform(store);
  if (!domain || !token) return null;

  const verifiedAt = new Date().toISOString();

  if (platform === "shopify") {
    const payload = await getJson(`https://${domain}/admin/api/2024-01/shop.json`, {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    });
    const raw = firstRawTimezone(payload);
    const timezone = normalizeIanaTimezoneOrNull(raw);
    return timezone ? { timezone, timezoneSource: "platform_shop_api", timezoneVerifiedAt: verifiedAt, platformTimezoneRaw: raw } : null;
  }

  if (platform === "shopline") {
    const candidates = [
      `https://${domain}/admin/openapi/v20240301/shop.json`,
      `https://${domain}/admin/openapi/v20220301/shop.json`,
      `https://${domain}/admin/openapi/v20201201/shop.json`,
      `https://${domain}/admin/api/v20200901/shop.json`,
      `https://${domain}/admin/openapi/shop.json`
    ];
    for (const url of candidates) {
      try {
        const payload = await getJson(url, {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        });
        const raw = firstRawTimezone(payload);
        const timezone = normalizeIanaTimezoneOrNull(raw);
        if (timezone) return { timezone, timezoneSource: "platform_shop_api", timezoneVerifiedAt: verifiedAt, platformTimezoneRaw: raw };
      } catch (error) {
        // Try the next documented Shop endpoint candidate.
      }
    }
    return null;
  }

  const candidates = [
    `https://${domain}/openapi/2022-01/shop`,
    `https://${domain}/openapi/2022-01/shop.json`,
    `https://${domain}/openapi/2020-01/shop`,
    `https://${domain}/openapi/shop`
  ];
  for (const url of candidates) {
    try {
      const payload = await getJson(url, {
        "Access-Token": token,
        "Content-Type": "application/json"
      });
      const raw = firstRawTimezone(payload);
      const timezone = normalizeIanaTimezoneOrNull(raw);
      if (timezone) return { timezone, timezoneSource: "platform_shop_api", timezoneVerifiedAt: verifiedAt, platformTimezoneRaw: raw };
    } catch (error) {
      // Try the next documented Shop endpoint candidate.
    }
  }
  return null;
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
  return {
    timezone: metadata?.timezone || diagnostics?.timezoneAfter || diagnostics?.timezone,
    timezoneSource: metadata?.timezoneSource || diagnostics?.timezoneSource,
    timezoneVerifiedAt: metadata?.timezoneVerifiedAt || diagnostics?.timezoneVerifiedAt,
    platformTimezoneRaw: metadata?.platformTimezoneRaw || diagnostics?.platformTimezoneRaw || null
  };
}

export async function resolveVerifiedStoreTimezone(store: StoreTimezoneInput): Promise<VerifiedStoreTimezone> {
  const platformVerified = await fetchPlatformStoreTimezone(store);
  if (platformVerified) {
    const persistedTimezone = normalizeIanaTimezoneOrNull(store.timezone);
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

  const persistedTimezone = normalizeIanaTimezoneOrNull(store.timezone);
  if (store.id && persistedTimezone) {
    const log = await prisma.syncLog.findFirst({
      where: {
        storeId: store.id,
        type: "sync_store_orders",
        status: "success"
      },
      orderBy: { startedAt: "desc" }
    });
    const evidence = metadataTimezoneEvidence(parseMetadata(log?.metadata));
    if (evidence.timezone === persistedTimezone && evidence.timezoneSource === "platform_shop_api") {
      return {
        timezone: persistedTimezone,
        timezoneSource: "persisted_verified",
        timezoneVerifiedAt: String(evidence.timezoneVerifiedAt || log?.startedAt?.toISOString?.() || new Date().toISOString()),
        platformTimezoneRaw: evidence.platformTimezoneRaw || persistedTimezone
      };
    }
  }

  throw new StoreTimezoneError("STORE_TIMEZONE_UNVERIFIED", {
    storeId: store.id ?? null,
    platform: normalizePlatform(store.platform),
    domain: normalizeDomain(store.domain),
    persistedTimezone: store.timezone || null
  });
}
