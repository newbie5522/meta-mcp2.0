import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { getMetaToken, normalizeMetaAccountId, getNumericAccountId } from "../utils.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBreakdownEdges(path: string, params: Record<string, any>, token: string, maxPages = 10) {
  const url = `https://graph.facebook.com/v19.0${path}`;
  const rows = [];
  let after: string | undefined;

  // Clone the params block to allow dynamic limit pruning locally in pagination loop
  const activeParams = { ...params };

  for (let page = 0; page < maxPages; page++) {
    let retries = 5; // Increased retry threshold to support adaptive parameters adjustment safely
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
        
        // Mitigation 1: "Please reduce the amount of data you're asking for, then retry your request"
        const isReduceDataError =
          code === 1 ||
          msg.toLowerCase().includes("reduce the amount of data") ||
          msg.toLowerCase().includes("please reduce") ||
          msg.toLowerCase().includes("too much data") ||
          msg.toLowerCase().includes("reduce amount");

        if (isReduceDataError) {
          const oldLimit = activeParams.limit || 1000;
          const newLimit = Math.max(100, Math.floor(oldLimit / 4)); // Drop page size to 1/4th (usually 1000 -> 250)
          console.warn(`[Meta Audience Fetch] Data density restriction hit. Custom self-healing protocol: reducing pagination limit from ${oldLimit} to ${newLimit} and repeating...`);
          activeParams.limit = newLimit;
          await delay(2000);
          continue; // immediately retry with the newly restricted limit
        }

        // Mitigation 2: Rate Limiting ("Application request limit reached")
        const isRateLimitError =
          code === 4 ||
          code === 17 ||
          code === 341 ||
          subcode === 1504022 ||
          msg.toLowerCase().includes("request limit reached") ||
          msg.toLowerCase().includes("rate limit") ||
          msg.toLowerCase().includes("too many requests");

        if (isRateLimitError) {
          console.warn(`[Meta Audience Fetch] Rate limit throttling threshold triggered (Code ${code}, Subcode ${subcode}). Warming up 20 seconds cool-off delay...`);
          await delay(20000); // polite rate compliance backoff
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
        console.error(`[Meta Audience Fetch] Fallback recovery on transient error [Code ${code}, Subcode ${subcode}] for ${path}. Returning cached/partial rows.`);
        break; 
      } else {
        console.error(`[Meta Audience Fetch] Fatal error fetching path ${path}:`, lastErr.response?.data || lastErr.message);
        throw lastErr;
      }
    }
  }
  return rows;
}

interface AudienceSyncOptions {
  days?: number;
  startDate?: string;
  endDate?: string;
  accountId?: string;
  taskChainId?: string;
  parentTaskId?: string | null;
  triggeredBy?: string;
}

export async function syncAudienceBreakdownsForActiveAccounts(options: AudienceSyncOptions = {}) {
  const days = options.days !== undefined ? options.days : 3;
  const startDate = options.startDate;
  const endDate = options.endDate;
  const accountId = options.accountId;
  const taskChainId = options.taskChainId || "aud-chain-" + Math.random().toString(36).substring(2, 8);
  const triggeredBy = options.triggeredBy || "system";

  const endStr = endDate || dayjs().format("YYYY-MM-DD");
  const startStr = startDate || dayjs().subtract(days - 1, "day").format("YYYY-MM-DD");

  console.log(`[Meta Audience Sync] Starting Sync. Range: [${startStr}] to [${endStr}]`);
  
  const token = await getMetaToken();
  if (!token) {
    console.error("[Meta Audience Sync] Missing Meta API token configured in system.");
    throw new Error("Missing Meta API oauth token. Please configure token in Settings/Config first.");
  }

  // 1. Resolve target ad accounts
  let validAccounts = [];
  if (accountId) {
    const actId = normalizeMetaAccountId(accountId);
    const dbAcc = await prisma.adAccount.findUnique({
      where: { fb_account_id: actId },
      include: { store: true }
    });
    if (dbAcc) {
      validAccounts = [dbAcc];
    } else {
      const matched = await prisma.adAccount.findFirst({
        where: {
          OR: [
            { fb_account_id: actId },
            { fb_account_id: getNumericAccountId(actId) }
          ]
        },
        include: { store: true }
      });
      if (matched) {
        validAccounts = [matched];
      }
    }
  } else {
    validAccounts = await prisma.adAccount.findMany({
      where: {
        OR: [
          { recentActivity90d: true },
          { storeId: { not: null } }
        ]
      },
      include: { store: true }
    });
  }

  console.log(`[Meta Audience Sync] Resolved ${validAccounts.length} accounts for demographic & placement breakdowns.`);

  const breakdownTypes = ["country", "region", "age", "gender", "publisher_platform", "impression_device"];

  let totalFetched = 0;
  let totalSaved = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  for (const acc of validAccounts) {
    const actId = normalizeMetaAccountId(acc.fb_account_id);
    const numericAccountId = getNumericAccountId(acc.fb_account_id);

    if (acc.store?.mode === "sandbox") {
      console.log(`[Meta Audience Sync] Account ${actId} is a duplicate sandbox account. Skipping.`);
      continue;
    }

    console.log(`[Meta Audience Sync] Processing Account [${actId}] "${acc.fb_account_name || "Unknown Name"}"`);

    for (const bType of breakdownTypes) {
      console.log(`[Meta Audience Sync]   -> Syncing Breakdown: "${bType}" for ${actId}...`);

      let sliceFetchedCount = 0;
      let sliceSavedCount = 0;
      let sliceUpdatedCount = 0;
      let sliceFailedCount = 0;
      let sliceErrorMessage = "";
      let sliceTraceId = "";

      try {
        const rows = await fetchBreakdownEdges(`/act_${numericAccountId}/insights`, {
          level: "account",
          time_increment: 1,
          time_range: JSON.stringify({
            since: startStr,
            until: endStr,
          }),
          breakdowns: bType,
          fields: "spend,impressions,clicks,actions,action_values",
          limit: 1000
        }, token, 15);

        sliceFetchedCount = rows.length;
        totalFetched += sliceFetchedCount;

        for (const row of rows) {
          const dateStr = row.date_start;
          if (!dateStr) continue;

          // Resolve dimension value based on type
          let dimVal = "";
          if (bType === "country") dimVal = row.country || "";
          else if (bType === "region") dimVal = row.region || "";
          else if (bType === "age") dimVal = row.age || "";
          else if (bType === "gender") dimVal = row.gender || "";
          else if (bType === "publisher_platform") dimVal = row.publisher_platform || "";
          else if (bType === "impression_device") dimVal = row.impression_device || "";

          // Skip if dimension value is empty
          if (!dimVal) {
            continue;
          }

          const spend = parseFloat(row.spend || 0);
          const impressions = parseInt(row.impressions || 0, 10);
          const clicks = parseInt(row.clicks || 0, 10);

          let purchases = 0;
          let purchaseValue = 0;

          if (Array.isArray(row.actions)) {
            purchases = parseInt(row.actions.find((a: any) => a.action_type === "purchase")?.value || 0, 10);
          }
          if (Array.isArray(row.action_values)) {
            purchaseValue = parseFloat(row.action_values.find((a: any) => a.action_type === "purchase")?.value || 0);
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
              date_level_account_id_dimension_type_dimension_value_dimension_value_secondary_campaign_id_adset_id_ad_id: {
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
            sliceUpdatedCount++;
            totalUpdated++;
          }
          sliceSavedCount++;
          totalSaved++;

          await prisma.factAudienceBreakdown.upsert({
            where: {
              date_level_account_id_dimension_type_dimension_value_dimension_value_secondary_campaign_id_adset_id_ad_id: {
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

        console.log(`[Meta Audience Sync] Completed Breakdown "${bType}" for ${actId}. Fetched: ${sliceFetchedCount}, Saved: ${sliceSavedCount}, Updated: ${sliceUpdatedCount}`);

      } catch (err: any) {
        sliceErrorMessage = err.response?.data?.error?.message || err.message || "Unknown Breakdown Error";
        sliceTraceId = err.response?.data?.error?.fbtrace_id || "";
        console.error(`[Meta Audience Sync] Error for breakdown "${bType}" under ${actId}:`, sliceErrorMessage);
        sliceFailedCount += 1;
        totalFailed += 1;
      }

      // Write SyncLog entry for trace integrity
      const sliceTaskId = "sc-sub-aud-" + Math.random().toString(36).substring(2, 12);
      try {
        await prisma.syncLog.create({
          data: {
            id: sliceTaskId,
            type: "sync_meta_audience_slice",
            status: sliceErrorMessage ? "failed" : "success",
            startedAt: new Date(),
            finishedAt: new Date(),
            recordsFetched: sliceFetchedCount,
            recordsSaved: sliceSavedCount,
            adAccountId: actId,
            rangeStart: startStr,
            rangeEnd: endStr,
            taskType: "sync_meta_audience",
            sourceType: "meta",
            errorMessage: sliceErrorMessage || null,
            fbtraceId: sliceTraceId || null,
            triggeredBy: triggeredBy,
            taskChainId: taskChainId,
            metadata: JSON.stringify({
              breakdownType: bType,
              recordsUpdated: sliceUpdatedCount,
              recordsFailed: sliceFailedCount,
              targetTable: "FactAudienceBreakdown",
              completedAt: new Date().toISOString()
            })
          }
        });
      } catch (logErr: any) {
        console.error(`[Meta Audience Sync] Failed logging slice result:`, logErr.message);
      }
    }

    await delay(300); // polite throttling
  }

  console.log(`[Meta Audience Sync] Execution Completed. Fetched: ${totalFetched}, Saved (New/Overwrite): ${totalSaved}, Updated: ${totalUpdated}, Failed: ${totalFailed}`);

  return {
    recordsFetched: totalFetched,
    recordsSaved: totalSaved,
    recordsUpdated: totalUpdated,
    recordsFailed: totalFailed
  };
}
