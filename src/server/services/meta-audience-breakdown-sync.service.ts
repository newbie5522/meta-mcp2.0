import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { getMetaToken, normalizeMetaAccountId, getNumericAccountId } from "../utils.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBreakdownEdges(path: string, params: Record<string, any>, token: string, maxPages = 10) {
  const url = `https://graph.facebook.com/v19.0${path}`;
  const rows: any[] = [];
  let after: string | undefined;

  const activeParams = { ...params };

  for (let page = 0; page < maxPages; page++) {
    let retries = 5;
    let success = false;
    let lastErr: any = null;

    while (retries > 0 && !success) {
      try {
        const res = await axios.get(url, {
          params: { ...activeParams, access_token: token, after }
        });
        const data = res.data?.data || [];
        rows.push(...data);
        after = res.data?.paging?.cursors?.after;
        success = true;
        if (!after || !res.data?.paging?.next) break;
      } catch (err: any) {
        lastErr = err;
        const fbError = err.response?.data?.error;
        const msg = fbError?.message || err.message || "";
        const code = fbError?.code;
        const subcode = fbError?.error_subcode;

        console.warn(`[Meta Audience Fetch Warn] Attempt failed for path ${path} (Retries left: ${retries - 1}). Error: [Code ${code}, Subcode ${subcode}] ${msg}`);
        
        const isReduceDataError =
          code === 1 ||
          msg.toLowerCase().includes("reduce the amount of data") ||
          msg.toLowerCase().includes("please reduce") ||
          msg.toLowerCase().includes("too much data") ||
          msg.toLowerCase().includes("reduce amount");

        if (isReduceDataError) {
          const oldLimit = activeParams.limit || 1000;
          const newLimit = Math.max(100, Math.floor(oldLimit / 4));
          console.warn(`[Meta Audience Fetch] Reducing pagination limit from ${oldLimit} to ${newLimit}...`);
          activeParams.limit = newLimit;
          await delay(2000);
          continue;
        }

        const isRateLimitError =
          code === 4 ||
          code === 17 ||
          code === 341 ||
          subcode === 1504022 ||
          msg.toLowerCase().includes("request limit reached") ||
          msg.toLowerCase().includes("rate limit") ||
          msg.toLowerCase().includes("too many requests");

        if (isRateLimitError) {
          console.warn(`[Meta Audience Fetch] Rate limit hit. Cooling off for 15s...`);
          await delay(15000);
          retries--;
          continue;
        }

        const waitMs = (6 - retries) * 1500;
        await delay(waitMs);
        retries--;
      }
    }

    if (!success && lastErr) {
      const fbError = lastErr.response?.data?.error;
      const msg = fbError?.message || lastErr.message || "";
      const code = fbError?.code;
      const subcode = fbError?.error_subcode;
      
      const isTransient = code === 1 || subcode === 99 || msg.includes("An unknown error occurred") || msg.includes("timeout") || lastErr.code === "ECONNABORTED";
      
      if (isTransient) {
        console.error(`[Meta Audience Fetch] Transient error for ${path}, returning partial rows.`);
        break; 
      } else {
        console.error(`[Meta Audience Fetch] Fatal error fetching ${path}:`, lastErr.response?.data || lastErr.message);
        throw lastErr;
      }
    }
  }
  return rows;
}

export async function syncMetaAudienceBreakdown(options: {
  startDate: string;
  endDate: string;
  storeId?: number | null;
  accountIds?: string[];
  dimensions?: Array<"country" | "age" | "gender" | "publisher_platform">;
  includeUnmapped?: boolean;
}): Promise<{
  success: boolean;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  recordsFetched: number;
  recordsSaved: number;
  recordsUpdated: number;
  accountsSynced: number;
  dimensionsSynced: string[];
  failedAccounts: Array<{
    accountId: string;
    dimension?: string;
    message: string;
    code?: string | number;
    fbtraceId?: string;
  }>;
}> {
  const { startDate, endDate, storeId, accountIds, dimensions, includeUnmapped = true } = options;
  const activeDimensions = dimensions && dimensions.length > 0 ? dimensions : ["country", "age", "gender", "publisher_platform"];

  console.log(`[Meta Audience Breakdown Sync service] Started. Range: ${startDate} to ${endDate}, storeId=${storeId}, dimensions=[${activeDimensions.join(", ")}]`);

  const token = await getMetaToken();
  if (!token) {
    throw new Error("Missing Meta API OAuth token. Please configure token in Settings/Config first.");
  }

  // 1. Resolve Target Accounts
  let queryWhere: any = {};
  if (accountIds && accountIds.length > 0) {
    const normalizedIds = accountIds.map(id => normalizeMetaAccountId(id));
    queryWhere.fb_account_id = { in: normalizedIds };
  } else if (storeId) {
    const targetStoreId = Number(storeId);
    // Find all mapping
    const mappings = await prisma.accountMapping.findMany({
      where: { storeId: targetStoreId }
    });
    const mappedFbIds = mappings.map(m => normalizeMetaAccountId(m.fbAccountId)).filter(Boolean);
    const directAccounts = await prisma.adAccount.findMany({
      where: { storeId: targetStoreId }
    });
    const directFbIds = directAccounts.map(a => normalizeMetaAccountId(a.fb_account_id)).filter(Boolean);
    const targetFbIds = Array.from(new Set([...mappedFbIds, ...directFbIds]));

    if (includeUnmapped) {
      queryWhere = {
        OR: [
          { fb_account_id: { in: targetFbIds } },
          { storeId: targetStoreId },
          { storeId: null }
        ]
      };
    } else {
      queryWhere = {
        OR: [
          { fb_account_id: { in: targetFbIds } },
          { storeId: targetStoreId }
        ]
      };
    }
  } else if (!includeUnmapped) {
    queryWhere.storeId = { not: null };
  }

  const accounts = await prisma.adAccount.findMany({
    where: queryWhere,
    include: { store: true }
  });

  console.log(`[Meta Audience Breakdown Sync service] Found ${accounts.length} ad accounts for processing.`);

  let totalFetched = 0;
  let totalSaved = 0;
  let totalUpdated = 0;
  let accountsSyncedCount = 0;

  const failedAccounts: Array<{
    accountId: string;
    dimension?: string;
    message: string;
    code?: string | number;
    fbtraceId?: string;
  }> = [];

  for (const acc of accounts) {
    const actId = normalizeMetaAccountId(acc.fb_account_id);
    const numericAccountId = getNumericAccountId(acc.fb_account_id);
    let accountHadSuccess = false;

    console.log(`[Meta Audience Breakdown Sync service] Syncing account: ${actId}`);

    for (const bType of activeDimensions) {
      try {
        const rows = await fetchBreakdownEdges(`/act_${numericAccountId}/insights`, {
          level: "account",
          time_increment: 1,
          time_range: JSON.stringify({
            since: startDate,
            until: endDate,
          }),
          breakdowns: bType,
          fields: "account_id,account_name,date_start,date_stop,spend,impressions,reach,clicks,cpc,cpm,ctr,actions,action_values",
          limit: 1000
        }, token, 10);

        totalFetched += rows.length;
        if (rows.length > 0) {
          accountHadSuccess = true;
        }

        for (const row of rows) {
          const dateStr = row.date_start;
          if (!dateStr) continue;

          let dimVal = "";
          if (bType === "country") dimVal = row.country || "";
          else if (bType === "age") dimVal = row.age || "";
          else if (bType === "gender") dimVal = row.gender || "";
          else if (bType === "publisher_platform") dimVal = row.publisher_platform || "";

          if (!dimVal) continue;

          const spend = parseFloat(row.spend || 0);
          const impressions = parseInt(row.impressions || 0, 10);
          const clicks = parseInt(row.clicks || 0, 10);

          let purchases = 0;
          let purchaseValue = 0;

          // Parse purchases from actions array
          if (Array.isArray(row.actions)) {
            const pAction = row.actions.find((a: any) => 
              a.action_type === "purchase" || 
              a.action_type === "offsite_conversion.fb_pixel_purchase" ||
              a.action_type === "onsite_conversion.purchase" ||
              a.action_type === "omni_purchase"
            );
            purchases = parseInt(pAction?.value || 0, 10);
          }
          // Parse purchase value from action_values array
          if (Array.isArray(row.action_values)) {
            const pValAction = row.action_values.find((a: any) => 
              a.action_type === "purchase" || 
              a.action_type === "offsite_conversion.fb_pixel_purchase" ||
              a.action_type === "onsite_conversion.purchase" ||
              a.action_type === "omni_purchase"
            );
            purchaseValue = parseFloat(pValAction?.value || 0);
          }

          const dataObj = {
            date: dateStr,
            level: "account",
            account_id: actId,
            campaign_id: "",
            adset_id: "",
            ad_id: "",
            dimension_type: bType,
            dimension_value: dimVal,
            dimension_value_secondary: "",
            spend,
            impressions,
            clicks,
            purchases,
            purchase_value: purchaseValue,
            synced_at: new Date(),
            raw_payload: JSON.stringify(row)
          };

          const existing = await prisma.factAudienceBreakdown.findUnique({
            where: {
              date_level_account_id_dimension_type_dimension_value_dimensi_key: {
                date: dateStr,
                level: "account",
                account_id: actId,
                dimension_type: bType,
                dimension_value: dimVal,
                dimension_value_secondary: "",
                campaign_id: "",
                adset_id: "",
                ad_id: ""
              }
            }
          });

          if (existing) {
            totalUpdated++;
          }
          totalSaved++;

          await prisma.factAudienceBreakdown.upsert({
            where: {
              date_level_account_id_dimension_type_dimension_value_dimensi_key: {
                date: dateStr,
                level: "account",
                account_id: actId,
                dimension_type: bType,
                dimension_value: dimVal,
                dimension_value_secondary: "",
                campaign_id: "",
                adset_id: "",
                ad_id: ""
              }
            },
            update: dataObj,
            create: dataObj
          });
        }
      } catch (err: any) {
        const errorDetail = err.response?.data?.error || {};
        const msg = errorDetail.message || err.message || "Unknown Meta API error";
        const code = errorDetail.code || null;
        const fbtraceId = errorDetail.fbtrace_id || null;

        console.error(`[Meta Audience Breakdown Sync service] Failed for account ${actId}, dim ${bType}: ${msg}`);
        failedAccounts.push({
          accountId: actId,
          dimension: bType,
          message: msg,
          code,
          fbtraceId
        });
      }
    }

    if (accountHadSuccess) {
      accountsSyncedCount++;
    }
  }

  let status: "SUCCESS" | "PARTIAL" | "FAILED" = "SUCCESS";
  if (failedAccounts.length > 0) {
    if (accountsSyncedCount > 0) {
      status = "PARTIAL";
    } else {
      status = "FAILED";
    }
  } else if (totalFetched === 0 && accounts.length > 0) {
    status = "FAILED";
  }

  return {
    success: status !== "FAILED",
    status,
    recordsFetched: totalFetched,
    recordsSaved: totalSaved,
    recordsUpdated: totalUpdated,
    accountsSynced: accountsSyncedCount,
    dimensionsSynced: activeDimensions,
    failedAccounts
  };
}
