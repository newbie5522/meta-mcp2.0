import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { profilePathForPlatform, requestShopApiJson } from "../shop/client.js";
import { decryptStoreToken } from "./stores.js";
import { normalizeTimezone, SYSTEM_DEFAULT_TIMEZONE } from "../shared/date-time.js";

interface ExtractedProfile {
  name?: string;
  currency?: string;
  timezone?: string;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function unwrapProfilePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return {};
  let record = payload as Record<string, unknown>;
  for (let depth = 0; depth < 3; depth++) {
    let unwrapped: Record<string, unknown> | undefined;
    for (const key of ["shop", "store", "data", "merchant"]) {
      const value = record[key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        unwrapped = value as Record<string, unknown>;
        break;
      }
    }
    if (!unwrapped) return record;
    record = unwrapped;
  }
  return record;
}

export function extractStoreProfile(payload: unknown): ExtractedProfile {
  const profile = unwrapProfilePayload(payload);
  return {
    name: firstString(profile, ["name", "shop_name", "store_name", "merchant_name"]),
    currency: firstString(profile, ["currency", "currency_code", "default_currency"]),
    timezone: firstString(profile, ["timezone", "time_zone", "iana_timezone"]),
  };
}

async function fetchStoreProfile(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const token = decryptStoreToken(store);
  const payload = await requestShopApiJson<unknown>({
    platform: store.platform,
    apiBaseUrl: store.apiBaseUrl,
    token,
    path: profilePathForPlatform(store.platform),
  });
  return {
    store,
    profile: extractStoreProfile(payload),
  };
}

export async function syncStoreProfile(storeId: string) {
  const log = await prisma.syncLog.create({
    data: {
      type: "store_profile",
      status: "running",
      storeId,
    },
  });

  try {
    const { store: existingStore, profile } = await fetchStoreProfile(storeId);
    const updateData: Prisma.StoreUpdateInput = {};
    if (profile.name) updateData.name = profile.name;
    if (profile.currency) updateData.currency = profile.currency;
    if (profile.timezone) {
      updateData.timezone = normalizeTimezone(profile.timezone);
      updateData.timezoneSource = "api";
      updateData.timezoneVerifiedAt = new Date();
    } else if (!existingStore.timezone) {
      updateData.timezone = normalizeTimezone(undefined);
      updateData.timezoneSource = "default";
      updateData.timezoneVerifiedAt = new Date();
    }

    const store = Object.keys(updateData).length > 0
      ? await prisma.store.update({ where: { id: storeId }, data: updateData })
      : await prisma.store.findUniqueOrThrow({ where: { id: storeId } });

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFetched: 1,
        recordsSaved: Object.keys(updateData).length > 0 ? 1 : 0,
        metadata: {
          syncedFields: Object.keys(updateData),
          timezone: profile.timezone || updateData.timezone,
          timezoneSource: profile.timezone ? "api" : "default",
          warning: profile.timezone ? undefined : "Store profile did not return timezone; system default timezone was used.",
        },
      },
    });

    return {
      store,
      syncedFields: Object.keys(updateData),
    };
  } catch (error) {
    const fallbackStore = await prisma.store.findUnique({ where: { id: storeId } });
    if (fallbackStore && !fallbackStore.timezone) {
      await prisma.store.update({
        where: { id: storeId },
        data: {
          timezone: SYSTEM_DEFAULT_TIMEZONE,
          timezoneSource: "default",
          timezoneVerifiedAt: new Date(),
        },
      });
    }
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          timezone: fallbackStore?.timezone || SYSTEM_DEFAULT_TIMEZONE,
          timezoneSource: fallbackStore?.timezone ? fallbackStore.timezoneSource : "default",
          warning: "Store profile sync failed; default timezone is available as fallback.",
        },
      },
    });
    throw error;
  }
}
