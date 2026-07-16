// @ts-nocheck
import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { getMetaToken, normalizeMetaAccountId, getNumericAccountId } from "../utils.js";
import { deriveCanonicalSyncStatus } from "../types/sync-tasks.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchMetaInsightEdges(path: string, params: Record<string, any>, token: string, maxPages = 10) {
  const url = `https://graph.facebook.com/v19.0${path}`;
  const rows = [];
  const failedSlices: any[] = [];
  let after: string | undefined;
  let hasNextPage = false;

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
        hasNextPage = Boolean(after && res.data?.paging?.next);
        success = true;
        if (!hasNextPage) {
          return { rows, failedSlices, truncated: false, coverageComplete: true };
        }
      } catch (err: any) {
        lastErr = err;
        const fbError = err.response?.data?.error;
        const msg = fbError?.message || err.message || "";
        const code = fbError?.code;
        const subcode = fbError?.error_subcode;

        console.warn(`[Meta API Fetch Warn] Attempt failed for path ${path} (Retries left: ${retries - 1}). Error: [Code ${code}, Subcode ${subcode}] ${msg}`);

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
          console.warn(`[Meta API Fetch] Data aggregation size limit hit. Custom self-healing protocol: reducing pagination limit from ${oldLimit} to ${newLimit} and repeating...`);
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
          console.warn(`[Meta API Fetch] Rate limit throttling threshold triggered (Code ${code}, Subcode ${subcode}). Warming up 20 seconds cool-off delay...`);
          await delay(20000); // polite rate compliance backoff
          retries--;
          continue;
        }
        
        // Wait longer on each retry
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
        console.error(`[Meta API Fetch] Transient/internal error [Code ${code}, Subcode ${subcode}] for ${path}. Returning explicitly partial rows.`);
        failedSlices.push({
          path,
          page: page + 1,
          message: msg,
          code,
          subcode,
          transient: true
        });
        return { rows, failedSlices, truncated: false, coverageComplete: false };
      } else {
        console.error(`[Meta API Fetch] Non-transient fatal error fetching path ${path}:`, lastErr.response?.data || lastErr.message);
        throw lastErr;
      }
    }
  }
  if (hasNextPage) {
    failedSlices.push({
      path,
      page: maxPages,
      message: `Pagination stopped at maxPages=${maxPages} while a next page remained.`,
      truncated: true
    });
  }
  return { rows, failedSlices, truncated: hasNextPage, coverageComplete: !hasNextPage };
}

interface SyncOptions {
  days?: number;
  startDate?: string;
  endDate?: string;
  accountId?: string;
  taskChainId?: string;
  parentTaskId?: string | null;
  triggeredBy?: string;
}

export async function syncMetaInsightsForActiveAccounts(optionsOrDays: number | SyncOptions = {}) {
  let days = 3;
  let startDate: string | undefined;
  let endDate: string | undefined;
  let accountId: string | undefined;
  let taskChainId = "sc-chain-" + Math.random().toString(36).substring(2, 8);
  let triggeredBy = "system";

  if (typeof optionsOrDays === "number") {
    days = optionsOrDays;
  } else if (optionsOrDays && typeof optionsOrDays === "object") {
    if (optionsOrDays.days !== undefined) days = optionsOrDays.days;
    startDate = optionsOrDays.startDate;
    endDate = optionsOrDays.endDate;
    accountId = optionsOrDays.accountId;
    if (optionsOrDays.taskChainId) taskChainId = optionsOrDays.taskChainId;
    if (optionsOrDays.triggeredBy) triggeredBy = optionsOrDays.triggeredBy;
  }

  // Determine actual start and end dates
  const endStr = endDate || dayjs().format("YYYY-MM-DD");
  const startStr = startDate || dayjs().subtract(days - 1, "day").format("YYYY-MM-DD");

  console.log(`[Meta Insights Sync] Starting Multi-Level Sync Range: [${startStr}] to [${endStr}]`);
  
  const token = await getMetaToken();
  if (!token) {
    console.error("[Meta Insights Sync] Missing Meta API token configured in system.");
    throw new Error("Missing Meta API oauth token. Please configure token in Settings/Config first.");
  }

  // 1. Resolve target ad accounts to sync
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
      console.log(`[Meta Insights Sync] Account ${actId} not in DB, querying by raw inputs...`);
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
      } else {
        // Create dynamic temporary ad account mapping if required...
        console.warn(`[Meta Insights Sync] Ad account ${actId} is not in DB metadata.`);
        validAccounts = [];
      }
    }
  } else {
    validAccounts = await prisma.adAccount.findMany({
      where: {
        OR: [
          { storeId: null },
          { store: { mode: { not: "sandbox" } } }
        ]
      },
      include: { store: true }
    });
  }

  console.log(`[Meta Insights Sync] Mapped ${validAccounts.length} accounts for multi-level metrics retrieval.`);

  const levels = ["account", "campaign", "adset", "ad"];

  let totalFetched = 0;
  let totalSaved = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  const fatalErrors: string[] = [];
  const failedAccounts: Array<{ accountId: string; level: string; message: string; fbtraceId?: string }> = [];
  const failedSlices: any[] = [];
  let truncated = false;

  const levelCounts = {
    account: 0,
    campaign: 0,
    adset: 0,
    ad: 0
  };

  for (const acc of validAccounts) {
    const actId = normalizeMetaAccountId(acc.fb_account_id);
    const numericAccountId = getNumericAccountId(acc.fb_account_id);

    if (acc.store?.mode === "sandbox") {
      console.log(`[Meta Insights Sync] Skipping live Facebook API logic for manually seeded sandbox account: ${actId}`);
      continue;
    }

    console.log(`[Meta Insights Sync] Processing Account [${actId}] "${acc.fb_account_name || "Unknown Name"}"...`);

    for (const currentLevel of levels) {
      console.log(`[Meta Insights Sync]   -> Syncing Level: "${currentLevel}" for ${actId}...`);

      const baseFields = [
        "account_id", "account_name", "date_start", "spend",
        "impressions", "reach", "clicks", "cpc", "cpm", "ctr",
        "actions", "action_values", "purchase_roas"
      ];

      if (["campaign", "adset", "ad"].includes(currentLevel)) {
        baseFields.push("campaign_id", "campaign_name");
      }
      if (["adset", "ad"].includes(currentLevel)) {
        baseFields.push("adset_id", "adset_name");
      }
      if (currentLevel === "ad") {
        baseFields.push("ad_id", "ad_name");
      }

      const fields = baseFields.join(",");
      let sliceFetchedCount = 0;
      let sliceSavedCount = 0;
      let sliceUpdatedCount = 0;
      let sliceFailedCount = 0;
      let sliceErrorMessage = "";
      let sliceTraceId = "";

      try {
        const edgeReceipt = await fetchMetaInsightEdges(`/act_${numericAccountId}/insights`, {
          level: currentLevel,
          time_increment: 1,
          time_range: JSON.stringify({
            since: startStr,
            until: endStr,
          }),
          fields,
          limit: 1000
        }, token, 10);
        const insightRows = edgeReceipt.rows;
        truncated ||= edgeReceipt.truncated;
        failedSlices.push(...edgeReceipt.failedSlices.map((slice: any) => ({
          ...slice,
          accountId: actId,
          level: currentLevel
        })));
        if (!edgeReceipt.coverageComplete) {
          sliceFailedCount += edgeReceipt.failedSlices.length || 1;
          totalFailed += edgeReceipt.failedSlices.length || 1;
        }

        sliceFetchedCount = insightRows.length;
        totalFetched += sliceFetchedCount;

        for (const row of insightRows) {
          const dateStr = row.date_start;
          if (!dateStr) continue;

          const spend = parseFloat(row.spend || 0);
          const impressions = parseInt(row.impressions || 0, 10);
          const reach = parseInt(row.reach || 0, 10);
          const clicks = parseInt(row.clicks || 0, 10);

          let purchases = 0;
          let purchaseValue = 0;
          let addToCart = 0;
          let initiateCheckout = 0;

          if (Array.isArray(row.actions)) {
            purchases = parseInt(row.actions.find(a => a.action_type === 'purchase')?.value || 0, 10);
            addToCart = parseInt(row.actions.find(a => a.action_type === 'add_to_cart')?.value || 0, 10);
            initiateCheckout = parseInt(row.actions.find(a => a.action_type === 'initiate_checkout')?.value || 0, 10);
          }
          if (Array.isArray(row.action_values)) {
            purchaseValue = parseFloat(row.action_values.find(a => a.action_type === 'purchase')?.value || 0);
          }

          // Exact mathematical calculations avoiding standard float anomalies
          const ctrValue = impressions > 0 ? (clicks / impressions) * 100 : 0;
          const cpcValue = clicks > 0 ? spend / clicks : 0;
          const cpmValue = impressions > 0 ? (spend / impressions) * 1000 : 0;
          const roasValue = spend > 0 ? purchaseValue / spend : 0;

          const campaignIdValue = row.campaign_id || "";
          const adsetIdValue = row.adset_id || "";
          const adIdValue = row.ad_id || "";

          // Resolve entity_id according to level
          let entity_id = "";
          if (currentLevel === "account") {
            entity_id = actId;
          } else if (currentLevel === "campaign") {
            entity_id = campaignIdValue;
          } else if (currentLevel === "adset") {
            entity_id = adsetIdValue;
          } else if (currentLevel === "ad") {
            entity_id = adIdValue;
          }

          if (!entity_id) {
            console.warn(`[Meta Insights Sync] Skip writing: entity_id resolved as empty at level "${currentLevel}"`);
            sliceFailedCount++;
            totalFailed++;
            failedSlices.push({
              accountId: actId,
              level: currentLevel,
              message: "Meta insight row did not contain the entity id required for its level."
            });
            continue;
          }

          // Resolve creative_id for level=ad
          let creative_id = "";
          if (currentLevel === "ad" && adIdValue) {
            const adObj = await prisma.ad.findUnique({
              where: { id: adIdValue },
              select: { creativeId: true }
            });
            if (adObj?.creativeId) {
              creative_id = adObj.creativeId;
            }
          }

          const currency = acc.currency || "USD";

          // ONLY write to fact_meta_performance if NOT a sandbox account
          if (acc.store?.mode !== "sandbox") {
            const dataObj = {
              date: dateStr,
              level: currentLevel,
              account_id: actId,
              campaign_id: campaignIdValue,
              adset_id: adsetIdValue,
              ad_id: adIdValue,
              creative_id: creative_id,
              entity_id: entity_id,
              spend: spend,
              impressions: impressions,
              clicks: clicks,
              ctr: ctrValue,
              cpc: cpcValue,
              cpm: cpmValue,
              purchases: purchases,
              purchase_value: purchaseValue,
              roas: roasValue,
              currency: currency,
              synced_at: new Date(),
              raw_payload: JSON.stringify(row)
            };

            const existingFact = await prisma.factMetaPerformance.findUnique({
              where: {
                date_level_account_id_entity_id: {
                  date: dateStr,
                  level: currentLevel,
                  account_id: actId,
                  entity_id: entity_id
                }
              }
            });

            if (existingFact) {
              sliceUpdatedCount++;
              totalUpdated++;
            }
            sliceSavedCount++;
            totalSaved++;

            await prisma.factMetaPerformance.upsert({
              where: {
                date_level_account_id_entity_id: {
                  date: dateStr,
                  level: currentLevel,
                  account_id: actId,
                  entity_id: entity_id
                }
              },
              update: dataObj,
              create: dataObj
            });

            levelCounts[currentLevel] = (levelCounts[currentLevel] || 0) + 1;
          } else {
            console.log(`[Meta Insights Sync] Sandbox account filtered out from fact_meta_performance: ${actId}`);
          }

          /*
           * METRIC GOVERNANCE PROTOCOL
           * Primary single source of truth: FactMetaPerformance model.
           * Legacy double-writing has been decommissioned.
           * No secondary performance table is written from this sync path.
           */
        }

        console.log(`[Meta Insights Sync] Finished Level "${currentLevel}" for ${actId}. Fetched: ${sliceFetchedCount}, Saved: ${sliceSavedCount}, Updated: ${sliceUpdatedCount}`);

      } catch (err: any) {
        sliceErrorMessage = err.response?.data?.error?.message || err.message || "Unknown Level Error";
        sliceTraceId = err.response?.data?.error?.fbtrace_id || "";
        console.error(`[Meta Insights Sync] Error for level "${currentLevel}" under ${actId}:`, sliceErrorMessage);
        fatalErrors.push(`${actId}/${currentLevel}: ${sliceErrorMessage}${sliceTraceId ? ` (fbtrace_id: ${sliceTraceId})` : ""}`);
        failedAccounts.push({
          accountId: actId,
          level: currentLevel,
          message: sliceErrorMessage,
          fbtraceId: sliceTraceId || undefined
        });
        sliceFailedCount += 1;
        totalFailed += 1;
      }

      // Write enhanced slice SyncLog to record individual trace execution details!
      const sliceTaskId = "sc-sub-" + Math.random().toString(36).substring(2, 12);
      try {
        await prisma.syncLog.create({
          data: {
            id: sliceTaskId,
            type: "sync_meta_insights_slice",
            status: sliceErrorMessage ? "failed" : "success",
            startedAt: new Date(),
            finishedAt: new Date(),
            recordsFetched: sliceFetchedCount,
            recordsSaved: sliceSavedCount,
            adAccountId: actId,
            rangeStart: dayjs(startStr).startOf("day").toDate(),
            rangeEnd: dayjs(endStr).endOf("day").toDate(),
            taskType: "sync_meta_insights",
            sourceType: "meta",
            errorMessage: sliceErrorMessage || null,
            fbtraceId: sliceTraceId || null,
            triggeredBy: triggeredBy,
            taskChainId: taskChainId,
            metadata: JSON.stringify({
              level: currentLevel,
              recordsUpdated: sliceUpdatedCount,
              recordsFailed: sliceFailedCount,
              targetTable: "fact_meta_performance",
              completedAt: new Date().toISOString()
            })
          }
        });
      } catch (logErr: any) {
        console.error(`[Meta Insights Sync] Failed storing slice SyncLog:`, logErr.message);
      }
    }

    await delay(500); // Polite rate limit preservation
  }

  if (totalFetched > 0 && totalSaved === 0) {
    failedSlices.push({
      message: `Fetched ${totalFetched} insight rows but wrote zero fact rows.`,
      reason: "FETCHED_ROWS_NOT_SAVED"
    });
  }

  console.log(`[Meta Insights Sync] Multi-Level batch execution completed. Fetched: ${totalFetched}, Saved (New): ${totalSaved}, Updated (Overwrite): ${totalUpdated}, Failed: ${totalFailed}`);

  const status = deriveCanonicalSyncStatus({
    recordsFetched: totalFetched,
    recordsSaved: totalSaved,
    recordsUpdated: totalUpdated,
    failedAccounts,
    failedSlices,
    truncated
  });

  return {
    recordsFetched: totalFetched,
    recordsSaved: totalSaved,
    recordsUpdated: totalUpdated,
    recordsFailed: totalFailed,
    failedAccounts,
    failedSlices,
    truncated,
    coverageComplete: status === "SUCCESS" || status === "NO_NEW_DATA",
    status,
    levelCounts,
    errors: [...new Set(fatalErrors)]
  };
}
