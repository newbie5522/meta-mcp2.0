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
  const setting = await prisma.setting.findFirst({
    where: { key: { in: ["META_ACCESS_TOKEN", "meta_token"] } }
  });
  const dbVal = setting ? setting.value.trim() : null;
  if (dbVal && !dbVal.includes("...")) {
    return dbVal;
  }
  const envVal = process.env.META_ACCESS_TOKEN || process.env.meta_token;
  if (envVal) {
    const trimmedEnv = envVal.trim();
    if (trimmedEnv && !trimmedEnv.includes("...")) {
      return trimmedEnv;
    }
  }
  if (dbVal && dbVal.includes("...")) {
    return null;
  }
  return dbVal;
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



export async function syncSingleAccountAdData(accountId: string, startDate: string, endDate: string, token: string) {
  const normAccountId = normalizeMetaAccountId(accountId);
  const cleanAccountId = getNumericAccountId(accountId);
  const url = `https://graph.facebook.com/v19.0/act_${cleanAccountId}/insights`;
  console.log(`[Unified Ad Sync] Fetching ACCOUNT-level insights for account ${normAccountId} from URL ${url}`);
  
  const insightsResponse = await axios.get(
    url,
    {
      params: {
        level: "account",
        time_range: JSON.stringify({
          since: startDate,
          until: endDate,
        }),
        time_increment: 1,
        fields:
          "account_id,account_name,date_start,reach,impressions,clicks,spend,actions,purchase_roas,action_values",
        limit: 1000,
        access_token: token,
      },
    },
  );

  const insights = insightsResponse.data.data || [];
  console.log(`[Unified Ad Sync] Received ${insights.length} account-level insight items for account ${normAccountId}`);

  const accountInsightsByDate: Record<string, {
    date: string;
    accountName: string;
    reach: number;
    impressions: number;
    clicks: number;
    spend: number;
    addToCart: number;
    initiateCheckout: number;
    purchases: number;
    purchaseValue: number;
  }> = {};

  let syncedRecords = 0;

  for (const day of insights) {
    const currentDate = day.date_start;
    
    const itemAccountId = normalizeMetaAccountId(day.account_id || normAccountId);
    const accountNameRaw = day.account_name || "Default Meta Account";

    const actions = day.actions || [];
    const getActionValue = (type: string) => {
      const action = actions.find((a: any) => a.action_type === type);
      return action ? parseFloat(action.value) : 0;
    };

    const actionValues = day.action_values || [];
    const getActionVal = (type: string) => {
      const action = actionValues.find(
        (a: any) => a.action_type === type,
      );
      return action ? parseFloat(action.value) : 0;
    };

    const carts = getActionValue("add_to_cart");
    const checkouts = getActionValue("initiate_checkout");
    const purchases = getActionValue("purchase");
    const purchaseValue =
      getActionVal("purchase") || getActionVal("omni_purchase");

    const spend = parseFloat(day.spend || "0");
    const clicks = parseInt(day.clicks || "0");
    const impressions = parseInt(day.impressions || "0");
    const reach = parseInt(day.reach || "0");

    // 1. Ensure/Sync AdAccount
    let dbAdAccount = await prisma.adAccount.findUnique({
      where: { fb_account_id: itemAccountId }
    });

    // Look up AccountMapping first to see if this account is mapped to a specific store
    const mapping = await prisma.accountMapping.findFirst({
      where: { fbAccountId: itemAccountId }
    });

    if (mapping && mapping.storeId === null) {
      if (dbAdAccount) {
        try {
          await prisma.adAccount.delete({
            where: { fb_account_id: itemAccountId }
          });
        } catch (e) {}
      }
      return; // Skip syncing this ad account since it is explicitly unmapped
    }

    let targetStoreId: number | null = mapping ? mapping.storeId : null;

    if (!dbAdAccount) {
      // Fallback to defaultStore if no mapping or mapped store does not exist
      if (!targetStoreId) {
        const defaultStore = await prisma.store.findFirst();
        if (defaultStore) {
          targetStoreId = defaultStore.id;
        }
      }

      if (targetStoreId) {
        dbAdAccount = await prisma.adAccount.create({
          data: {
            fb_account_id: itemAccountId,
            fb_account_name: accountNameRaw,
            fb_access_token: token,
            storeId: targetStoreId
          }
        });
      }
    } else {
      // If dbAdAccount exists, update name/token and also realign storeId if mapping dictates a valid store
      const updateData: any = {
        fb_account_name: accountNameRaw,
        fb_access_token: token
      };
      if (targetStoreId) {
        updateData.storeId = targetStoreId;
      }
      dbAdAccount = await prisma.adAccount.update({
        where: { fb_account_id: itemAccountId },
        data: updateData
      });
    }

    const store = dbAdAccount ? await prisma.store.findUnique({ where: { id: dbAdAccount.storeId } }) : null;
    const storeName = store ? store.name : null;

    // 2. Ensure/Sync AccountMapping
    if (dbAdAccount) {
      await prisma.accountMapping.upsert({
        where: {
          fbAccountId: itemAccountId
        },
        update: {
          // Keep storeId unchanged as the mapping table is the single source of truth.
        },
        create: {
          storeId: mapping ? mapping.storeId : null,
          fbAccountId: itemAccountId
        }
      });
    }

    // 3. (REMOVED) Ensure/Sync Campaign, AdSet, Ad
    // This is now purely handled by syncMetaHierarchy directly avoiding dummy empty string IDs

    // 4. Group metrics for account-level AdInsight upsert
    if (!accountInsightsByDate[currentDate]) {
      accountInsightsByDate[currentDate] = {
        date: currentDate,
        accountName: accountNameRaw,
        reach: 0,
        impressions: 0,
        clicks: 0,
        spend: 0,
        addToCart: 0,
        initiateCheckout: 0,
        purchases: 0,
        purchaseValue: 0
      };
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

  // GLOBLAL METRIC GOVERNANCE PROTOCOL - READINESS TRANSITION
  // Primary single source of truth: FactMetaPerformance model
  // Legacy fallback source of truth: AdInsight model
  // 
  // [LEGACY-DOUBLE-WRITE]: The block below performs double-writing to AdInsight ONLY to support legacy backward-compatibility.
  // No new features or endpoints are allowed to read from AdInsight.
  // TODO: Decommission this write block during retirement Phase 4.
  for (const dateKey of Object.keys(accountInsightsByDate)) {
    const item = accountInsightsByDate[dateKey];
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const atcRate = item.clicks > 0 ? (item.addToCart / item.clicks) * 100 : 0;
    const checkoutRate = item.clicks > 0 ? (item.initiateCheckout / item.clicks) * 100 : 0;
    const cpp = item.purchases > 0 ? item.spend / item.purchases : 0;
    const roas = item.spend > 0 ? item.purchaseValue / item.spend : 0;

    // Optimization to avoid duplicate database writes if exact data already exists
    const existing = await prisma.adInsight.findUnique({
      where: {
        accountId_level_campaignId_adsetId_adId_date: {
          accountId: normAccountId,
          level: "account",
          campaignId: "",
          adsetId: "",
          adId: "",
          date: dateKey,
        },
      },
    });

    if (existing) {
      const isIdentical =
        existing.accountName === item.accountName &&
        existing.reach === item.reach &&
        existing.impressions === item.impressions &&
        existing.clicks === item.clicks &&
        Math.abs(existing.spend - item.spend) < 0.001 &&
        existing.addToCart === item.addToCart &&
        existing.initiateCheckout === item.initiateCheckout &&
        existing.purchases === item.purchases &&
        Math.abs(existing.purchaseValue - item.purchaseValue) < 0.001;

      if (isIdentical) {
        // Data is identical, skip updating to optimize database and sync performance
        syncedRecords++;
        continue;
      }
    }

    await prisma.adInsight.upsert({
      where: {
        accountId_level_campaignId_adsetId_adId_date: {
          accountId: normAccountId,
          level: "account",
          campaignId: "",
          adsetId: "",
          adId: "",
          date: dateKey,
        },
      },
      update: {
        accountName: item.accountName,
        reach: item.reach,
        impressions: item.impressions,
        clicks: item.clicks,
        spend: item.spend,
        addToCart: item.addToCart,
        initiateCheckout: item.initiateCheckout,
        purchases: item.purchases,
        purchaseValue: item.purchaseValue,
        cpc,
        ctr,
        atcRate,
        checkoutRate,
        cpp,
        roas,
      },
      create: {
        accountId: normAccountId,
        level: "account",
        campaignId: "",
        adsetId: "",
        adId: "",
        date: dateKey,
        accountName: item.accountName,
        reach: item.reach,
        impressions: item.impressions,
        clicks: item.clicks,
        spend: item.spend,
        addToCart: item.addToCart,
        initiateCheckout: item.initiateCheckout,
        purchases: item.purchases,
        purchaseValue: item.purchaseValue,
        cpc,
        ctr,
        atcRate,
        checkoutRate,
        cpp,
        roas,
      },
    });

    // Write to FactMetaPerformance synchronously
    const sandboxAccounts = ["act_439281903", "act_583920194", "act_204928103"];
    if (!sandboxAccounts.includes(normAccountId)) {
      try {
        const dbAcc = await prisma.adAccount.findUnique({
          where: { fb_account_id: normAccountId },
        });
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
      } catch (err: any) {
        console.error(`[Fact Table Sync] Failed writing ${normAccountId} for date ${dateKey}:`, err.message);
      }
    }

    syncedRecords++;
  }

  return syncedRecords;
}

export function isDemoDataEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.ENABLE_DEMO_DATA === "true";
}