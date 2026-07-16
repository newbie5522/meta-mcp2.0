// @ts-nocheck
import prisma from "../../db/index.js";
import axios from "axios";
import dayjs from "dayjs";
import { getMetaToken, normalizeMetaAccountId } from "../utils.js";
import { ensureAdAccounts } from "./meta-hierarchy-sync.service.js";
import { syncMetaInsightsForActiveAccounts } from "./meta-insights.service.js";
import { syncMetaAudienceBreakdown } from "./meta-audience-breakdown-sync.service.js";
import { syncStoreData } from "./store-sync.service.js";
import { extractMetaAssetHash } from "./metaFetchPatch.service.js";
import { normalizeSyncExecutionResult, type SyncExecutionResult } from "../types/sync-tasks.js";

// Utility to generate a nice UUID
function generateUUID(): string {
  return "sc-" + Math.random().toString(36).substring(2, 15) + "-" + Math.random().toString(36).substring(2, 15);
}

// Pre-check and ensure parent records exist in database before child insertions to prevent foreign key errors (P2003)
async function safeEnsureAdAccount(fb_account_id: string): Promise<void> {
  const existing = await prisma.adAccount.findUnique({ where: { fb_account_id } });
  if (!existing) {
    throw new Error(
      `STRUCTURE_PARENT_ACCOUNT_MISSING: AdAccount ${fb_account_id} must be synced before writing structure.`
    );
  }
}

async function safeEnsureCampaign(id: string, accountId: string): Promise<void> {
  await safeEnsureAdAccount(accountId);
  await prisma.campaign.upsert({
    where: { id },
    update: { accountId },
    create: {
      id,
      accountId,
      name: id,
      status: "UNKNOWN"
    }
  });
}

async function safeEnsureAdSet(id: string, campaignId: string, accountId: string): Promise<void> {
  await safeEnsureCampaign(campaignId, accountId);
  await prisma.adSet.upsert({
    where: { id },
    update: { campaignId, accountId },
    create: {
      id,
      campaignId,
      accountId,
      name: id
    }
  });
}

function normalizeSyncLogStoreId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

function buildSummaryMetrics(payload: Record<string, unknown>) {
  return JSON.stringify({
    ...payload,
    generatedAt: new Date().toISOString()
  });
}

// Interfaces
export interface TaskResult {
  recordsFetched: number;
  recordsSaved: number;
  recordsUpdated?: number;
  failedAccounts?: unknown[];
  failedSlices?: unknown[];
  truncated?: boolean;
  coverageComplete?: boolean;
  status?: SyncExecutionResult["status"];
  metadata?: any;
}

export interface RunTaskOptions {
  parentChainId?: string | null;
  allowSameChainRunning?: boolean;
  parentViewTask?: boolean;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  scopeKey?: string | null;
  coverageComplete?: boolean;
}

/**
 * Sync Center Core Engine
 */
export class SyncCenter {
  /**
   * Helper to execute a single task, write logs, handle fails, and propagate status.
   */
  static async runTask(
    taskType: string,
    sourceType: "meta" | "shopline" | "shoplazza" | "erp" | "summary" | "ai",
    triggeredBy: string,
    taskChainId: string,
    parentTaskId: string | null = null,
    storeId: string | number | null = null,
    adAccountId: string | null = null,
    executor: () => Promise<TaskResult>,
    options: RunTaskOptions = {}
  ): Promise<string> {
    const taskId = generateUUID();
    console.log(`[Sync Center | chain:${taskChainId}] Task ${taskType} started...`);

    const normalizedStoreId = normalizeSyncLogStoreId(storeId);
    const initialMetadata = {
      description: `Running task ${taskType}`,
      parentTaskId,
      originalStoreId: storeId !== null && storeId !== undefined ? String(storeId) : null,
      rangeStart: options.rangeStart || null,
      rangeEnd: options.rangeEnd || null,
      scopeKey: options.scopeKey || null,
      coverageComplete: options.coverageComplete !== false
    };

    const existingRunningTask = await prisma.syncLog.findFirst({
      where: {
        taskType,
        status: "running"
      },
      orderBy: {
        startedAt: "desc"
      }
    });

    if (existingRunningTask) {
      const ageMs = Date.now() - existingRunningTask.startedAt.getTime();
      const maxRunningAgeMs = 30 * 60 * 1000;
      const sameChain =
        existingRunningTask.taskChainId === taskChainId ||
        (options.parentChainId && existingRunningTask.taskChainId === options.parentChainId);

      if (ageMs < maxRunningAgeMs) {
        if (sameChain && (options.allowSameChainRunning || options.parentViewTask)) {
          console.log(
            `[Sync Center | chain:${taskChainId}] Reusing running same-chain task ${existingRunningTask.id} for ${taskType}.`
          );
          return existingRunningTask.id;
        }
        throw new Error(
          `SYNC_TASK_ALREADY_RUNNING: ${taskType} is already running. taskId=${existingRunningTask.id}`
        );
      }

        await prisma.syncLog.update({
          where: { id: existingRunningTask.id },
          data: {
            status: "failed",
            finishedAt: new Date(),
            error: "STALE_RUNNING_TASK_TIMEOUT",
            errorMessage: "STALE_RUNNING_TASK_TIMEOUT"
          }
        });
    }

    try {
      await prisma.syncLog.create({
        data: {
          id: taskId,
          type: taskType,
          status: "running",
          startedAt: new Date(),
          taskType,
          sourceType,
          triggeredBy,
          taskChainId,
          storeId: normalizedStoreId,
          adAccountId,
          rangeStart: options.rangeStart ? dayjs(options.rangeStart).startOf("day").toDate() : null,
          rangeEnd: options.rangeEnd ? dayjs(options.rangeEnd).endOf("day").toDate() : null,
          metadata: JSON.stringify(initialMetadata)
        }
      });
    } catch (logErr) {
      console.error(`[Sync Center | chain:${taskChainId}] Failed to create SyncLog for ${taskType}:`, logErr);
      throw logErr;
    }

    try {
      const result = await executor();
      const canonicalResult = normalizeSyncExecutionResult({
        recordsFetched: result.recordsFetched,
        recordsSaved: result.recordsSaved,
        recordsUpdated: result.recordsUpdated ?? result.metadata?.recordsUpdated,
        failedAccounts: result.failedAccounts ?? result.metadata?.failedAccounts,
        failedSlices: result.failedSlices ?? result.metadata?.failedSlices,
        truncated: result.truncated ?? result.metadata?.truncated,
        coverageComplete:
          result.coverageComplete ??
          result.metadata?.coverageComplete ??
          options.coverageComplete
      });

      await prisma.syncLog.update({
        where: { id: taskId },
        data: {
          status: canonicalResult.status === "FAILED" ? "failed" : "success",
          finishedAt: new Date(),
          recordsFetched: canonicalResult.recordsFetched,
          recordsSaved: canonicalResult.recordsSaved,
          error: canonicalResult.status === "FAILED" ? "SYNC_TASK_FAILED" : null,
          errorMessage: canonicalResult.status === "FAILED" ? "SYNC_TASK_FAILED" : null,
          metadata: JSON.stringify({
            parentTaskId,
            originalStoreId: storeId !== null && storeId !== undefined ? String(storeId) : null,
            ...result.metadata,
            ...canonicalResult,
            rangeStart: options.rangeStart || null,
            rangeEnd: options.rangeEnd || null,
            scopeKey: options.scopeKey || null,
            completedAt: new Date().toISOString()
          })
        }
      });

      console.log(`[Sync Center | chain:${taskChainId}] Task ${taskType} completed with ${canonicalResult.status}.`);
      return taskId;
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message || "Unknown error";
      const fbtraceId = err.response?.data?.error?.fbtrace_id || null;
      const errorCode = err.response?.status?.toString() || "500";

      await prisma.syncLog.update({
        where: { id: taskId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: errMsg,
          errorMessage: errMsg,
          fbtraceId,
          metadata: JSON.stringify({
            parentTaskId,
            originalStoreId: storeId !== null && storeId !== undefined ? String(storeId) : null,
            errorStack: err.stack,
            errorCode,
            fbtraceId,
            failedAt: new Date().toISOString()
          })
        }
      });

      console.error(`[Sync Center | chain:${taskChainId}] Task ${taskType} failed: ${errMsg}`);
      throw err;
    }
  }

  // --- Task IMPLEMENTATIONS ---

  // 1. sync_store_profile
  static async syncStoreProfile(storeId: number, taskChainId: string, triggeredBy: string, parentTaskId: string | null = null): Promise<string> {
    return this.runTask(
      "sync_store_profile",
      "shopline",
      triggeredBy,
      taskChainId,
      parentTaskId,
      String(storeId),
      null,
      async () => {
        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) {
          throw new Error(`Store with ID ${storeId} not found`);
        }

        // Simulating profile read with token or updates
        const domain = store.domain || `${store.name}.shoplineapp.com`;
        const currency = "USD"; // Default Currency
        const timezone = store.timezone || "Asia/Shanghai";

        await prisma.store.update({
          where: { id: storeId },
          data: {
            domain,
            timezone
          }
        });

        return {
          recordsFetched: 1,
          recordsSaved: 1,
          metadata: { storeName: store.name, domain, currency, timezone }
        };
      }
    );
  }

  // 2. sync_store_orders
  static async syncStoreOrders(
    storeId: number,
    taskChainId: string,
    triggeredBy: string,
    parentTaskId: string | null = null,
    days: number = 90,
    startDateOverride: string | null = null,
    endDateOverride: string | null = null,
    options?: {
      baselineRevenue?: number;
      rebuild?: boolean;
    }
  ): Promise<string> {
    const effectiveEndDate = endDateOverride || dayjs().format("YYYY-MM-DD");
    const effectiveStartDate = startDateOverride || dayjs(effectiveEndDate).subtract(days, "day").format("YYYY-MM-DD");
    return this.runTask(
      "sync_store_orders",
      "shopline",
      triggeredBy,
      taskChainId,
      parentTaskId,
      String(storeId),
      null,
      async () => {
        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) throw new Error(`Store with ID ${storeId} not found`);

        const endDate = effectiveEndDate;
        const startDate = effectiveStartDate;

        console.log(`[Sync Center] Running syncStoreData for ${store.name} (${startDate} to ${endDate}) with options: ${JSON.stringify(options || {})}`);
        const syncResults = await syncStoreData(startDate, endDate, String(storeId), options);
        const res = syncResults[storeId] || {
          storeId,
          storeName: store.name,
          platform: store.platform || "unknown",
          timezone: store.timezone || "GMT+8",
          localStartDate: startDate,
          localEndDate: endDate,
          utcStartDate: "",
          utcEndDate: "",
          requestUrlSanitized: "",
          pageCount: 0,
          recordsFetched: 0,
          recordsSaved: 0,
          recordsSkipped: 0,
          skippedReasons: [],
          duplicateCount: 0,
          failedCount: 0,
          orderItems: []
        };

        if (res.errorMessage) {
          throw new Error(`[Store Orders Sync] ${res.errorMessage}`);
        }

        // Fetch counts from DB
        const ordersCount = await prisma.order.count({ where: { storeId } });
        const productsCount = await prisma.product.count({ where: { storeId } });

        return {
          recordsFetched: res.recordsFetched,
          recordsSaved: res.recordsSaved,
          metadata: {
            ...res,
            ordersCountInDb: ordersCount,
            productsCountInDb: productsCount,
            startDate,
            endDate
          }
        };
      },
      {
        rangeStart: effectiveStartDate,
        rangeEnd: effectiveEndDate,
        scopeKey: `store:${storeId}`,
        coverageComplete: true
      }
    );
  }

  // 3. sync_meta_accounts
  static async syncMetaAccounts(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null, runOptions: RunTaskOptions = {}): Promise<string> {
    return this.runTask(
      "sync_meta_accounts",
      "meta",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        const token = await getMetaToken();
        if (!token) throw new Error("Meta Access Token is not set in settings");

        await ensureAdAccounts(token);
        const count = await prisma.adAccount.count();

        return {
          recordsFetched: count,
          recordsSaved: count,
          metadata: { totalAdAccounts: count }
        };
      },
      runOptions
    );
  }

  // 4. sync_meta_activity
  static async syncMetaActivity(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null, runOptions: RunTaskOptions = {}): Promise<string> {
    return this.runTask(
      "sync_meta_activity",
      "meta",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        const activeAccounts = await prisma.adAccount.findMany({
          where: { recentActivity90d: true }
        });

        return {
          recordsFetched: activeAccounts.length,
          recordsSaved: activeAccounts.length,
          metadata: { activeAccountsCount: activeAccounts.length }
        };
      },
      runOptions
    );
  }

  // 5. sync_meta_structure
  static async syncMetaStructure(
    taskChainId: string,
    triggeredBy: string,
    parentTaskId: string | null = null,
    options: {
      accountId?: string | null;
      accountIds?: string[] | null;
      limit?: number | string | null;
    } = {},
    runOptions: RunTaskOptions = {}
  ): Promise<string> {
    const normalizedTaskAccountId = options.accountId
      ? normalizeMetaAccountId(String(options.accountId))
      : null;

    return this.runTask(
      "sync_meta_structure",
      "meta",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      normalizedTaskAccountId,
      async () => {
        const token = await getMetaToken();
        if (!token) throw new Error("Meta Access Token is not set");

        const requestedAccountIds = [
          options.accountId,
          ...(Array.isArray(options.accountIds) ? options.accountIds : [])
        ]
          .filter(Boolean)
          .map(id => normalizeMetaAccountId(String(id)))
          .filter((id, index, arr) => id && arr.indexOf(id) === index);

        const take =
          options.limit !== undefined && options.limit !== null
            ? Math.max(1, Math.min(parseInt(String(options.limit), 10) || 1, 50))
            : undefined;

        const activeAccounts = await prisma.adAccount.findMany({
          where: requestedAccountIds.length > 0
            ? {
                fb_account_id: { in: requestedAccountIds },
                OR: [
                  { storeId: null },
                  { store: { mode: { not: "sandbox" } } }
                ]
              }
            : {
                recentActivity90d: true,
                OR: [
                  { storeId: null },
                  { store: { mode: { not: "sandbox" } } }
                ]
              },
          include: { store: true },
          orderBy: { updatedAt: "desc" },
          ...(take ? { take } : {})
        });

        console.log(
          `[Sync Center] Syncing structures for ${activeAccounts.length} Meta Accounts. ` +
          `requested=${JSON.stringify(requestedAccountIds)}, limit=${options.limit || null}`
        );

        if (activeAccounts.length === 0) {
          return {
            recordsFetched: 0,
            recordsSaved: 0,
            metadata: {
              status: "NO_SYNC_TARGETS",
              accountId: options.accountId || null,
              accountIds: requestedAccountIds,
              limit: options.limit || null,
              targetAccountsCount: 0,
              campaignsFetched: 0,
              adsetsFetched: 0,
              adsFetched: 0,
              creativesFetched: 0
            }
          };
        }
        let creativeCountTotal = 0;
        let campaignsTotal = 0;
        let adsetsTotal = 0;
        let adsTotal = 0;
        let skippedAdsets = 0;
        let skippedAds = 0;
        const failedAccounts: Array<{ accountId: string; message: string }> = [];

        for (const account of activeAccounts) {
          const actId = normalizeMetaAccountId(account.fb_account_id);
          const cleanAccountId = actId.replace("act_", "");

          try {
            console.log(`[Sync Center] Querying Meta structure for active account ${actId}`);

            if (account.store?.mode === "sandbox") {
              throw new Error("Sandbox Account Mode");
            }

            // Fetch campaigns
            const campRes = await axios.get(`https://graph.facebook.com/v19.0/${actId}/campaigns`, {
              params: { fields: "id,name,status", limit: 300, access_token: token }
            });
            const campaigns = campRes.data?.data || [];
            campaignsTotal += campaigns.length;
            for (const camp of campaigns) {
              await safeEnsureAdAccount(actId);
              await prisma.campaign.upsert({
                where: { id: camp.id },
                update: { accountId: actId, name: camp.name || camp.id, status: camp.status || null },
                create: { id: camp.id, accountId: actId, name: camp.name || camp.id, status: camp.status || null }
              });
            }

            // Fetch adsets
            const adsetsRes = await axios.get(`https://graph.facebook.com/v19.0/act_${cleanAccountId}/adsets`, {
              params: { fields: "id,name,campaign_id", limit: 300, access_token: token }
            });
            const adsets = adsetsRes.data?.data || [];
            adsetsTotal += adsets.length;
            for (const adset of adsets) {
              if (!adset.campaign_id) {
                skippedAdsets++;
                continue;
              }
              await safeEnsureCampaign(String(adset.campaign_id), actId);
              await prisma.adSet.upsert({
                where: { id: adset.id },
                update: { campaignId: adset.campaign_id, accountId: actId, name: adset.name || adset.id },
                create: { id: adset.id, campaignId: adset.campaign_id, accountId: actId, name: adset.name || adset.id }
              });
            }

            // Fetch ads & creatives
            const adsRes = await axios.get(`https://graph.facebook.com/v19.0/act_${cleanAccountId}/ads`, {
              params: { fields: "id,name,campaign_id,adset_id,creative{id}", limit: 300, access_token: token }
            });
            const ads = adsRes.data?.data || [];
            adsTotal += ads.length;
            for (const ad of ads) {
              if (!ad.adset_id) {
                skippedAds++;
                continue;
              }
              const existingAdSet = await prisma.adSet.findUnique({ where: { id: String(ad.adset_id) } });
              const campaignId = ad.campaign_id || existingAdSet?.campaignId;
              if (!campaignId) {
                skippedAds++;
                continue;
              }
              await safeEnsureAdSet(String(ad.adset_id), String(campaignId), actId);
              const creativeId = ad.creative?.id;
              if (creativeId) {
                const creativeExists = await prisma.adCreative.findUnique({ where: { creativeId } });
                if (!creativeExists) {
                  let assets = { landingUrl: null, previewUrl: null, metaAssetId: null, videoHash: null, videoId: null, imageHash: null };
                  try {
                    assets = await extractMetaAssetHash(creativeId, token);
                  } catch (err) {}

                  await prisma.adCreative.create({
                    data: {
                      creativeId,
                      fbAccountId: actId,
                      mediaType: assets.videoHash || assets.videoId ? "VIDEO" : "IMAGE",
                      imageUrl: assets.previewUrl || null,
                      videoId: assets.videoId || null,
                      videoHash: assets.videoHash || null,
                      imageHash: assets.imageHash || null,
                      storeId: account.storeId,
                      name: ad.name || creativeId,
                      landingUrl: assets.landingUrl || null,
                      previewUrl: assets.previewUrl || null,
                      metaAssetId: assets.metaAssetId || null,
                      hookRate: 0
                    }
                  }).catch(() => {});
                  creativeCountTotal++;
                }
              }

              await prisma.ad.upsert({
                where: { id: ad.id },
                update: {
                  adsetId: ad.adset_id,
                  campaignId,
                  accountId: actId,
                  name: ad.name || ad.id,
                  creativeId: creativeId || null
                },
                create: {
                  id: ad.id,
                  adsetId: ad.adset_id,
                  campaignId,
                  accountId: actId,
                  name: ad.name || ad.id,
                  creativeId: creativeId || null
                }
              });
            }
          } catch (accErr: any) {
            console.log(`[Sync Center] Account structure info check for ${actId} failed (network status: ${accErr.message}). No sandbox fallback data will be written.`);
            failedAccounts.push({ accountId: actId, message: accErr.message || "Structure sync failed" });
          }
        }

        return {
          recordsFetched: campaignsTotal + adsetsTotal + adsTotal,
          recordsSaved: campaignsTotal + adsetsTotal + adsTotal,
          recordsUpdated: 0,
          failedAccounts,
          failedSlices: [],
          truncated: false,
          coverageComplete: failedAccounts.length === 0,
          metadata: {
            targetAccountsCount: activeAccounts.length,
            accountId: options.accountId || null,
            accountIds: requestedAccountIds,
            limit: options.limit || null,
            campaignsFetched: campaignsTotal,
            adsetsFetched: adsetsTotal,
            adsFetched: adsTotal,
            creativesFetched: creativeCountTotal,
            skippedAdsets,
            skippedAds,
            failedAccounts,
            completedAt: new Date().toISOString()
          }
        };
      },
      {
        ...runOptions,
        scopeKey: runOptions.scopeKey || (normalizedTaskAccountId
          ? `account:${normalizedTaskAccountId}`
          : `accounts:${(options.accountIds || []).map(normalizeMetaAccountId).sort().join(",") || "active"}`)
      }
    );
  }

  // 6. sync_meta_insights
  static async syncMetaInsights(
    taskChainId: string,
    triggeredBy: string,
    parentTaskId: string | null = null,
    days: number = 3,
    accountId: string | null = null,
    startDate: string | null = null,
    endDate: string | null = null,
    runOptions: RunTaskOptions = {}
  ): Promise<string> {
    const effectiveEndDate = endDate || dayjs().format("YYYY-MM-DD");
    const effectiveStartDate = startDate || dayjs(effectiveEndDate).subtract(days - 1, "day").format("YYYY-MM-DD");
    return this.runTask(
      "sync_meta_insights",
      "meta",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      accountId,
      async () => {
        const stats = await syncMetaInsightsForActiveAccounts({
          days,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          accountId: accountId || undefined,
          taskChainId,
          parentTaskId,
          triggeredBy
        });

        const failedAccounts = Array.isArray(stats?.failedAccounts)
          ? stats.failedAccounts
          : [];

        const dimensionsSynced = Array.isArray(stats?.dimensionsSynced)
          ? stats.dimensionsSynced
          : [];

        const levelCounts = stats?.levelCounts || {};

        const recordsFetched = Number(stats?.recordsFetched || 0);
        const recordsSaved = Number(stats?.recordsSaved || 0);
        const recordsUpdated = Number(stats?.recordsUpdated || 0);
        const recordsFailed = Number(stats?.recordsFailed || failedAccounts.length || 0);

        return {
          recordsFetched,
          recordsSaved,
          recordsUpdated,
          failedAccounts,
          failedSlices: Array.isArray(stats?.failedSlices) ? stats.failedSlices : [],
          truncated: Boolean(stats?.truncated),
          coverageComplete: stats?.coverageComplete !== false,
          metadata: {
            days,
            startDate: effectiveStartDate,
            endDate: effectiveEndDate,
            accountId,
            targetTable: "FactMetaPerformance",
            recordsUpdated,
            recordsFailed,
            failedAccounts,
            failedSlices: Array.isArray(stats?.failedSlices) ? stats.failedSlices : [],
            truncated: Boolean(stats?.truncated),
            coverageComplete: stats?.coverageComplete !== false,
            accountsSynced: Number(stats?.accountsSynced || (accountId ? 1 : 0)),
            dimensionsSynced,
            status:
              stats?.status ||
              (recordsFetched === 0 && recordsSaved === 0 ? "NO_NEW_DATA" : "SUCCESS"),
            levelCounts,
            completedAt: new Date().toISOString()
          }
        };
      },
      {
        ...runOptions,
        rangeStart: effectiveStartDate,
        rangeEnd: effectiveEndDate,
        scopeKey: runOptions.scopeKey || `account:${accountId ? normalizeMetaAccountId(accountId) : "active"}`,
        coverageComplete: runOptions.coverageComplete !== false
      }
    );
  }

  // 6b. sync_meta_audience
  static async syncMetaAudience(
    taskChainId: string,
    triggeredBy: string,
    parentTaskId: string | null = null,
    days: number = 3,
    accountId: string | null = null,
    startDate: string | null = null,
    endDate: string | null = null,
    runOptions: RunTaskOptions = {}
  ): Promise<string> {
    return this.runTask(
      "sync_meta_audience",
      "meta",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      accountId,
      async () => {
        const endStr = endDate || dayjs().format("YYYY-MM-DD");
        const startStr = startDate || dayjs(endStr).subtract(days - 1, "day").format("YYYY-MM-DD");

        const stats = await syncMetaAudienceBreakdown({
          startDate: startStr,
          endDate: endStr,
          accountIds: accountId ? [accountId] : undefined,
          dimensions: ["country", "age", "gender", "publisher_platform"],
          includeUnmapped: true
        });

        return {
          recordsFetched: stats.recordsFetched,
          recordsSaved: stats.recordsSaved,
          recordsUpdated: stats.recordsUpdated,
          failedAccounts: stats.failedAccounts,
          failedSlices: stats.failedSlices,
          truncated: stats.truncated,
          coverageComplete: stats.coverageComplete,
          metadata: {
            days,
            startDate: startStr,
            endDate: endStr,
            accountId,
            targetTable: "FactAudienceBreakdown",
            recordsUpdated: stats.recordsUpdated,
            recordsFailed: stats.failedAccounts.length + stats.failedSlices.length,
            failedAccounts: stats.failedAccounts,
            failedSlices: stats.failedSlices,
            truncated: stats.truncated,
            coverageComplete: stats.coverageComplete,
            accountsSynced: stats.accountsSynced,
            targetAccountsCount: stats.targetAccountsCount,
            dimensionsRequested: stats.dimensionsRequested || ["country", "age", "gender", "publisher_platform"],
            dimensionsSynced: stats.dimensionsSynced,
            status: stats.status,
            reason: stats.reason,
            message: stats.message,
            completedAt: new Date().toISOString()
          }
        };
      },
      {
        ...runOptions,
        rangeStart: startDate || dayjs(endDate || undefined).subtract(days - 1, "day").format("YYYY-MM-DD"),
        rangeEnd: endDate || dayjs().format("YYYY-MM-DD"),
        scopeKey: runOptions.scopeKey || `account:${accountId ? normalizeMetaAccountId(accountId) : "active"}`,
        coverageComplete: runOptions.coverageComplete !== false
      }
    );
  }

  // --- AUTOMATIC CONFIG TRIGGERS ---

  /**
   * Executes Meta registration chain
   */
  static async triggerMetaConfigChain(triggeredBy = "auto"): Promise<string> {
    const taskChainId = generateUUID();
    console.log(`[Sync Center] Starting Meta Initialization Pipeline. Chain ID: ${taskChainId}`);

    // Run async in background without blocking
    (async () => {
      try {
        const id1 = await this.syncMetaAccounts(taskChainId, triggeredBy, null);
        const id2 = await this.syncMetaActivity(taskChainId, triggeredBy, id1);
        const id3 = await this.syncMetaStructure(taskChainId, triggeredBy, id2);
        await this.syncMetaInsights(taskChainId, triggeredBy, id3);
        console.log(`[Sync Center] Meta Init pipeline finished with canonical Meta facts. Chain ID: ${taskChainId}`);
      } catch (err) {
        console.error(`[Sync Center] Meta Initialization chain ${taskChainId} failed to complete:`, err);
      }
    })();

    return taskChainId;
  }

  /**
   * Executes Store registration chain
   */
  static async triggerStoreConfigChain(storeId: number, triggeredBy = "auto"): Promise<string> {
    const taskChainId = generateUUID();
    console.log(`[Sync Center] Starting Store Initialization Pipeline for Store: ${storeId}. Chain ID: ${taskChainId}`);

    (async () => {
      try {
        const id1 = await this.syncStoreProfile(storeId, taskChainId, triggeredBy, null);
        await this.syncStoreOrders(storeId, taskChainId, triggeredBy, id1);
        console.log(`[Sync Center] Store Init pipeline finished with canonical store orders. Chain ID: ${taskChainId}`);
      } catch (err) {
        console.error(`[Sync Center] Store Initialization chain ${taskChainId} failed:`, err);
      }
    })();

    return taskChainId;
  }

  /**
   * Executes Mapping update chain
   */
  static async triggerMappingChangeChain(triggeredBy = "mapping_change"): Promise<string> {
    const taskChainId = generateUUID();
    console.log(`[Sync Center] Starting Mapping Change rebuilding ROAS. Chain ID: ${taskChainId}`);

    (async () => {
      try {
        console.log(`[Sync Center] Mapping change acknowledged. Canonical ROAS is calculated from data-center ledgers. Chain ID: ${taskChainId}`);
      } catch (err) {
        console.error(`[Sync Center] Mapping change chain ${taskChainId} failed:`, err);
      }
    })();

    return taskChainId;
  }
}
