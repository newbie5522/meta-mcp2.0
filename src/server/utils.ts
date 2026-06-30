// @ts-nocheck
import prisma from "../db/index.js";
import axios from "axios";
import { format, subDays } from "date-fns";

export function normalizeMetaAccountId(id: string | null | undefined): string {
  if (!id) return "";
  const cleaned = String(id).trim();
  if (!cleaned) return "";
  if (cleaned.toLowerCase().startsWith("act_")) {
    return `act_${cleaned.substring(4)}`;
  }
  return `act_${cleaned}`;
}

export function getNumericAccountId(id: string): string {
  if (!id) return id;
  return String(id).trim().replace(/^act_/, "");
}

// CACHE map for utils
const queryCache = new Map();

export async function getMetaToken(): Promise<string | null> {
  // 1. Read META_ACCESS_TOKEN from database
  const metaToken = await prisma.setting.findUnique({
    where: { key: "META_ACCESS_TOKEN" }
  });
  if (metaToken && metaToken.value) {
    const val = metaToken.value.trim();
    if (val && !val.includes("...")) {
      return val;
    }
  }

  // 2. Read legacy meta_token from database (read-only compatibility)
  const legacyToken = await prisma.setting.findUnique({
    where: { key: "meta_token" }
  });
  if (legacyToken && legacyToken.value) {
    const val = legacyToken.value.trim();
    if (val && !val.includes("...")) {
      return val;
    }
  }

  // 3. Read environment variable META_ACCESS_TOKEN
  const envVal = process.env.META_ACCESS_TOKEN;
  if (envVal) {
    const trimmed = envVal.trim();
    if (trimmed && !trimmed.includes("...")) {
      return trimmed;
    }
  }

  return null;
}

export function getTimezoneOffsetStr(timezone: string | null | undefined): string {
  if (!timezone) return "-08:00";
  const match = timezone.match(/GMT([+-]?\d+)/i); // Handle GMT-8, GMT+8, GMT8 etc
  if (match) {
    const val = parseInt(match[1], 10);
    const sign = val < 0 ? "-" : "+";
    const hrs = Math.abs(val);
    return `${sign}${String(hrs).padStart(2, '0')}:00`;
  }
  return "-08:00";
}

export function extractMetaError(error: any): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.message || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function evaluateActivityStatus(accountId: string, fbAccountStatus: number, token: string): Promise<number> {
  // If status is disabled (2), return 3 (Red: disabled)
  if (fbAccountStatus === 2) {
    return 3;
  }
  // If status is closed/resolved (101), return 4 (Gray: dormant)
  if (fbAccountStatus === 101) {
    return 4;
  }

  try {
    const normAccountId = normalizeMetaAccountId(accountId);
    const today = new Date();
    const startDate = format(subDays(today, 7), "yyyy-MM-dd");
    const endDate = format(today, "yyyy-MM-dd");

    const res = await axios.get(`https://graph.facebook.com/v19.0/${normAccountId}/insights`, {
      params: {
        level: "account",
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        fields: "spend",
        access_token: token,
      },
      timeout: 5000
    });

    const insights = res.data?.data || [];
    const totalSpend = insights.reduce((sum: number, item: any) => sum + parseFloat(item.spend || "0"), 0);

    if (totalSpend > 0) {
      return 1; // Green: highly active
    }
    return 2; // Blue: active normal
  } catch (err: any) {
    if (err.response?.status === 403 || err.response?.status === 401) {
      return 3; // Red: unauthorized / locked
    }
    return 2;
  }
}

export function getCachedData(key: string) {
  const cached = queryCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiry) {
    queryCache.delete(key);
    return null;
  }
  return cached.data;
}

export function setCachedData(key: string, data: any, ttlMs: number = 300000) {
  queryCache.set(key, {
    data,
    expiry: Date.now() + ttlMs
  });
}

    const entry = accountInsightsByDate[currentDate];
    entry.reach += reach;
    entry.impressions += impressions;
    entry.clicks += clicks;
    entry.spend += spend;
    entry.addToCart += carts;
    entry.initiateCheckout += checkouts;
    entry.purchases += purchases;
    entry.purchaseValue += purchaseValue;
  }

  // Single source of truth: FactMetaPerformance.
  for (const dateKey of Object.keys(accountInsightsByDate)) {
    const item = accountInsightsByDate[dateKey];
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const atcRate = item.clicks > 0 ? (item.addToCart / item.clicks) * 100 : 0;
    const checkoutRate = item.clicks > 0 ? (item.initiateCheckout / item.clicks) * 100 : 0;
    const cpp = item.purchases > 0 ? item.spend / item.purchases : 0;
    const roas = item.spend > 0 ? item.purchaseValue / item.spend : 0;

    // AdInsight double-writing is fully DECOMMISSIONED in LOCKDOWN phase.
    // No queries to prisma.adInsight.findUnique or upsert.

    // Write to FactMetaPerformance synchronously
    try {
      const dbAcc = await prisma.adAccount.findUnique({
        where: { fb_account_id: normAccountId },
        include: { store: true }
      });
      
      if (!dbAcc || dbAcc.store?.mode !== "sandbox") {
        const currency = dbAcc?.currency || "USD";

        await prisma.factMetaPerformance.upsert({
          where: {
            date_level_account_id_entity_id: {
              date: dateKey,
              level: "account",
              account_id: normAccountId,
              entity_id: normAccountId,
            }
          },
          update: {
            campaign_id: "",
            adset_id: "",
            ad_id: "",
            creative_id: "",
            spend: item.spend ?? 0,
            impressions: item.impressions ?? 0,
            clicks: item.clicks ?? 0,
            ctr: ctr,
            cpc: cpc,
            cpm: item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0,
            purchases: item.purchases ?? 0,
            purchase_value: item.purchaseValue ?? 0,
            roas: roas,
            currency: currency,
            synced_at: new Date(),
          },
          create: {
            date: dateKey,
            level: "account",
            account_id: normAccountId,
            campaign_id: "",
            adset_id: "",
            ad_id: "",
            creative_id: "",
            entity_id: normAccountId,
            spend: item.spend ?? 0,
            impressions: item.impressions ?? 0,
            clicks: item.clicks ?? 0,
            ctr: ctr,
            cpc: cpc,
            cpm: item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0,
            purchases: item.purchases ?? 0,
            purchase_value: item.purchaseValue ?? 0,
            roas: roas,
            currency: currency,
            synced_at: new Date(),
          }
        });
      }
    } catch (err: any) {
      console.error(`[Fact Table Sync] Failed writing ${normAccountId} for date ${dateKey}:`, err.message);
    }

    syncedRecords++;
  }

  return syncedRecords;
}
