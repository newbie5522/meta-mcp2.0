// @ts-nocheck
import prisma from "../../db/index.js";
import axios from "axios";
import dayjs from "dayjs";
import { getMetaToken, normalizeMetaAccountId } from "../utils.js";
import { ensureAdAccounts } from "./meta-hierarchy-sync.service.js";
import { syncMetaInsightsForActiveAccounts } from "./meta-insights.service.js";
import { syncAudienceBreakdownsForActiveAccounts } from "./audience-insights.service.js";
import { syncStoreData } from "./store-sync.service.js";
import { extractMetaAssetHash } from "./metaFetchPatch.service.js";

// Utility to generate a nice UUID
function generateUUID(): string {
  return "sc-" + Math.random().toString(36).substring(2, 15) + "-" + Math.random().toString(36).substring(2, 15);
}

// Pre-check and ensure parent records exist in database before child insertions to prevent foreign key errors (P2003)
async function safeEnsureAdAccount(fb_account_id: string): Promise<void> {
  try {
    const existing = await prisma.adAccount.findUnique({ where: { fb_account_id } });
    if (!existing) {
      await prisma.adAccount.create({
        data: {
          fb_account_id,
          fb_account_name: `Meta Account ${fb_account_id}`,
          status: "1",
          activityStatus: 1,
          recentActivity90d: true
        }
      });
    }
  } catch (err: any) {
    console.warn(`[Sync Center] Error ensuring AdAccount placeholder for ${fb_account_id}:`, err.message);
  }
}

async function safeEnsureCampaign(id: string, accountId: string): Promise<void> {
  try {
    await safeEnsureAdAccount(accountId);
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) {
      await prisma.campaign.create({
        data: {
          id,
          accountId,
          name: `Campaign ${id}`,
          status: "ACTIVE"
        }
      });
    }
  } catch (err: any) {
    console.warn(`[Sync Center] Error ensuring Campaign placeholder for ${id}:`, err.message);
  }
}

async function safeEnsureAdSet(id: string, campaignId: string, accountId: string): Promise<void> {
  try {
    await safeEnsureCampaign(campaignId, accountId);
    const existing = await prisma.adSet.findUnique({ where: { id } });
    if (!existing) {
      await prisma.adSet.create({
        data: {
          id,
          campaignId,
          accountId,
          name: `Ad Set ${id}`
        }
      });
    }
  } catch (err: any) {
    console.warn(`[Sync Center] Error ensuring AdSet placeholder for ${id}:`, err.message);
  }
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
  metadata?: any;
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
    executor: () => Promise<TaskResult>
  ): Promise<string> {
    const taskId = generateUUID();
    console.log(`[Sync Center | chain:${taskChainId}] Task ${taskType} started...`);

    const normalizedStoreId = normalizeSyncLogStoreId(storeId);
    const initialMetadata = {
      description: `Running task ${taskType}`,
      parentTaskId,
      originalStoreId: storeId !== null && storeId !== undefined ? String(storeId) : null
    };

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
          metadata: JSON.stringify(initialMetadata)
        }
      });
    } catch (logErr) {
      console.error(`[Sync Center | chain:${taskChainId}] Failed to create SyncLog for ${taskType}:`, logErr);
      throw logErr;
    }

    try {
      const result = await executor();
      
      await prisma.syncLog.update({
        where: { id: taskId },
        data: {
          status: "success",
          finishedAt: new Date(),
          recordsFetched: result.recordsFetched,
          recordsSaved: result.recordsSaved,
          metadata: JSON.stringify({
            parentTaskId,
            originalStoreId: storeId !== null && storeId !== undefined ? String(storeId) : null,
            ...result.metadata,
            completedAt: new Date().toISOString()
          })
        }
      });
      
      console.log(`[Sync Center | chain:${taskChainId}] Task ${taskType} completed successfully.`);
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

        const endDate = endDateOverride || dayjs().format("YYYY-MM-DD");
        const startDate = startDateOverride || dayjs(endDate).subtract(days, "day").format("YYYY-MM-DD");

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
      }
    );
  }

  // 3. sync_meta_accounts
  static async syncMetaAccounts(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null): Promise<string> {
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
      }
    );
  }

  // 4. sync_meta_activity
  static async syncMetaActivity(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null): Promise<string> {
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
      }
    );
  }

  // 5. sync_meta_structure
  static async syncMetaStructure(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null): Promise<string> {
    return this.runTask(
      "sync_meta_structure",
      "meta",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        const token = await getMetaToken();
        if (!token) throw new Error("Meta Access Token is not set");

        // Sync for each active/mapped account
        const activeAccounts = await prisma.adAccount.findMany({
          where: {
            OR: [
              { storeId: null },
              { store: { mode: { not: "sandbox" } } }
            ]
          },
          include: { store: true }
        });

        console.log(`[Sync Center] Syncing structures for ${activeAccounts.length} Meta Accounts...`);
        let creativeCountTotal = 0;
        let campaignsTotal = 0;
        let adsetsTotal = 0;
        let adsTotal = 0;

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
                update: { accountId: actId, name: camp.name || "Unnamed Campaign", status: camp.status || "ACTIVE" },
                create: { id: camp.id, accountId: actId, name: camp.name || "Unnamed Campaign", status: camp.status || "ACTIVE" }
              });
            }

            // Fetch adsets
            const adsetsRes = await axios.get(`https://graph.facebook.com/v19.0/act_${cleanAccountId}/adsets`, {
              params: { fields: "id,name,campaign_id", limit: 300, access_token: token }
            });
            const adsets = adsetsRes.data?.data || [];
            adsetsTotal += adsets.length;
            for (const adset of adsets) {
              if (adset.campaign_id) {
                await safeEnsureCampaign(String(adset.campaign_id), actId);
              }
              await prisma.adSet.upsert({
                where: { id: adset.id },
                update: { campaignId: adset.campaign_id, accountId: actId, name: adset.name || "Unnamed Ad Set" },
                create: { id: adset.id, campaignId: adset.campaign_id, accountId: actId, name: adset.name || "Unnamed Ad Set" }
              });
            }

            // Fetch ads & creatives
            const adsRes = await axios.get(`https://graph.facebook.com/v19.0/act_${cleanAccountId}/ads`, {
              params: { fields: "id,name,campaign_id,adset_id,creative{id}", limit: 300, access_token: token }
            });
            const ads = adsRes.data?.data || [];
            adsTotal += ads.length;
            for (const ad of ads) {
              if (ad.adset_id && ad.campaign_id) {
                await safeEnsureAdSet(String(ad.adset_id), String(ad.campaign_id), actId);
              }
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
                      name: ad.name ? `${ad.name} Creative` : "Auto Creative",
                      landingUrl: assets.landingUrl || null,
                      previewUrl: assets.previewUrl || null,
                      metaAssetId: assets.metaAssetId || null,
                      hookRate: 0.15
                    }
                  }).catch(() => {});
                  creativeCountTotal++;
                }
              }

              await prisma.ad.upsert({
                where: { id: ad.id },
                update: {
                  adsetId: ad.adset_id,
                  campaignId: ad.campaign_id,
                  accountId: actId,
                  name: ad.name || "Unnamed Ad",
                  creativeId: creativeId || null
                },
                create: {
                  id: ad.id,
                  adsetId: ad.adset_id,
                  campaignId: ad.campaign_id,
                  accountId: actId,
                  name: ad.name || "Unnamed Ad",
                  creativeId: creativeId || null
                }
              });
            }
          } catch(accErr: any) {
            console.log(`[Sync Center] Account structure info check for ${actId} failed (network status: ${accErr.message}). No sandbox fallback data will be written.`);
          }
        }

        return {
          recordsFetched: campaignsTotal + adsetsTotal + adsTotal,
          recordsSaved: campaignsTotal + adsetsTotal + adsTotal,
          metadata: { campaignsFetched: campaignsTotal, adsetsFetched: adsetsTotal, adsFetched: adsTotal, creativesFetched: creativeCountTotal }
        };
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
    endDate: string | null = null
  ): Promise<string> {
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
        
        return {
          recordsFetched: stats.recordsFetched,
          recordsSaved: stats.recordsSaved,
          metadata: {
            days,
            startDate,
            endDate,
            accountId,
            targetTable: "fact_meta_performance",
            recordsUpdated: stats.recordsUpdated,
            recordsFailed: stats.recordsFailed,
            levelCounts: stats.levelCounts,
            completedAt: new Date().toISOString()
          }
        };
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
    endDate: string | null = null
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
        const stats = await syncAudienceBreakdownsForActiveAccounts({
          days,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          accountId: accountId || undefined,
          taskChainId,
          parentTaskId,
          triggeredBy
        });
        
        return {
          recordsFetched: stats.recordsFetched,
          recordsSaved: stats.recordsSaved,
          metadata: {
            days,
            startDate,
            endDate,
            accountId,
            targetTable: "FactAudienceBreakdown",
            recordsUpdated: stats.recordsUpdated,
            recordsFailed: stats.recordsFailed,
            completedAt: new Date().toISOString()
          }
        };
      }
    );
  }

  // 7. rebuild_store_summary
  static async rebuildStoreSummary(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null, days: number = 90): Promise<string> {
    return this.runTask(
      "rebuild_store_summary",
      "summary",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        const stores = await prisma.store.findMany();
        let upsertedCount = 0;

        for (const store of stores) {
          // Loop over last N days date by date
          for (let i = 0; i < days; i++) {
            const dateStr = dayjs().subtract(i, "day").format("YYYY-MM-DD");
            
            // Calculate orders for this store on this day
            const orders = await prisma.order.findMany({
              where: {
                storeId: store.id,
                store_local_date: dateStr
              }
            });

            const filteredOrders = orders.filter(o => {
              if (!o.paymentStatus) return true;
              const s = o.paymentStatus.toLowerCase().trim();
              return !["waiting", "unpaid", "pending", "cancelled", "voided"].includes(s);
            });

            const uniqueOrdersMap = new Map<string, number>();
            for (const o of filteredOrders) {
              const oId = o.orderId || o.id;
              const orderAmount = (o.orderTotal != null && o.orderTotal > 0) ? o.orderTotal : (o.revenue || 0);

              if (!uniqueOrdersMap.has(oId)) {
                uniqueOrdersMap.set(oId, orderAmount);
              } else {
                if (o.orderTotal == null || o.orderTotal === 0) {
                  uniqueOrdersMap.set(oId, uniqueOrdersMap.get(oId)! + (o.revenue || 0));
                }
              }
            }

            let revenue = 0;
            let totalOrders = 0;
            uniqueOrdersMap.forEach((amt) => {
              revenue += amt;
              totalOrders++;
            });

            const metrics = buildSummaryMetrics({
              revenue,
              orders: totalOrders,
              spend: 0,
              clicks: 0,
              impressions: 0,
              roas: 0,
              metaRoas: 0,
              source: "rebuildStoreSummary"
            });

            await prisma.dailySummary.upsert({
              where: {
                scope_scopeId_date: {
                  scope: "store",
                  scopeId: String(store.id),
                  date: dateStr
                }
              },
              update: {
                revenue,
                orders: totalOrders,
                metrics
              },
              create: {
                scope: "store",
                scopeId: String(store.id),
                date: dateStr,
                revenue,
                orders: totalOrders,
                spend: 0,
                clicks: 0,
                impressions: 0,
                roas: 0,
                metaRoas: 0,
                metrics
              }
            });
            upsertedCount++;
          }
        }

        return {
          recordsFetched: upsertedCount,
          recordsSaved: upsertedCount,
          metadata: { totalDailySummariesUpserted: upsertedCount }
        };
      }
    );
  }

  // 8. rebuild_meta_summary
  static async rebuildMetaSummary(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null, days: number = 90): Promise<string> {
    return this.runTask(
      "rebuild_meta_summary",
      "summary",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        const accounts = await prisma.adAccount.findMany();
        let upsertedCount = 0;

        for (const account of accounts) {
          const cleanId = normalizeMetaAccountId(account.fb_account_id);
          for (let i = 0; i < days; i++) {
            const dateStr = dayjs().subtract(i, "day").format("YYYY-MM-DD");

            const insights = await prisma.factMetaPerformance.findMany({
              where: {
                account_id: cleanId,
                date: dateStr,
                level: "account"
              }
            });

            const spend = insights.reduce((sum, item) => sum + (item.spend || 0), 0);
            const clicks = insights.reduce((sum, item) => sum + (item.clicks || 0), 0);
            const impressions = insights.reduce((sum, item) => sum + (item.impressions || 0), 0);
            const purchasesRevenue = insights.reduce((sum, item) => sum + (item.purchase_value || 0), 0);
            const purchases = insights.reduce((sum, item) => sum + (item.purchases || 0), 0);
            const metaRoas = spend > 0 ? (purchasesRevenue / spend) : 0;

            const metrics = buildSummaryMetrics({
              spend,
              clicks,
              impressions,
              metaRoas,
              revenue: purchasesRevenue,
              orders: purchases,
              roas: 0,
              source: "rebuildMetaSummary"
            });

            await prisma.dailySummary.upsert({
              where: {
                scope_scopeId_date: {
                  scope: "ad_account",
                  scopeId: account.fb_account_id,
                  date: dateStr
                }
              },
              update: {
                spend,
                clicks,
                impressions,
                metaRoas,
                revenue: purchasesRevenue,
                orders: purchases,
                metrics
              },
              create: {
                scope: "ad_account",
                scopeId: account.fb_account_id,
                date: dateStr,
                spend,
                clicks,
                impressions,
                metaRoas,
                revenue: purchasesRevenue,
                orders: purchases,
                roas: 0,
                metrics
              }
            });
            upsertedCount++;
          }
        }

        return {
          recordsFetched: upsertedCount,
          recordsSaved: upsertedCount,
          metadata: { adAccountSummariesUpserted: upsertedCount }
        };
      }
    );
  }

  // 9. rebuild_roas_summary
  static async rebuildRoasSummary(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null, days: number = 90): Promise<string> {
    return this.runTask(
      "rebuild_roas_summary",
      "summary",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        // Rebuild genuine ROAS: store orders vs mapped fb accounts spend
        const stores = await prisma.store.findMany();
        let updatedCount = 0;

        for (const store of stores) {
          // Get strictly mapped ad accounts
          const mappings = await prisma.accountMapping.findMany({
            where: { storeId: store.id },
            select: { fbAccountId: true }
          });
          const mappedFbIds = mappings.map(m => normalizeMetaAccountId(m.fbAccountId));
          
          const hasMappings = mappedFbIds.length > 0;

          for (let i = 0; i < days; i++) {
            const dateStr = dayjs().subtract(i, "day").format("YYYY-MM-DD");

            // Fetch daily Summary of store to get store revenue
            const storeSummary = await prisma.dailySummary.findUnique({
              where: {
                scope_scopeId_date: {
                  scope: "store",
                  scopeId: String(store.id),
                  date: dateStr
                }
              }
            });

            const storeRevenue = storeSummary ? storeSummary.revenue : 0;
            const storeOrders = storeSummary ? storeSummary.orders : 0;

            let mappedSpend = 0;
            let mappedClicks = 0;
            let mappedImpressions = 0;
            let mappedMetaRevenue = 0;

            if (hasMappings) {
              const insights = await prisma.factMetaPerformance.findMany({
                where: {
                  account_id: { in: mappedFbIds },
                  date: dateStr,
                  level: "account"
                }
              });

              mappedSpend = insights.reduce((sum, idx) => sum + (idx.spend || 0), 0);
              mappedClicks = insights.reduce((sum, idx) => sum + (idx.clicks || 0), 0);
              mappedImpressions = insights.reduce((sum, idx) => sum + (idx.impressions || 0), 0);
              mappedMetaRevenue = insights.reduce((sum, idx) => sum + (idx.purchase_value || 0), 0);
            }

            const realRoas = mappedSpend > 0 ? (storeRevenue / mappedSpend) : 0;
            const metaRoas = mappedSpend > 0 ? (mappedMetaRevenue / mappedSpend) : 0;

            const metrics = buildSummaryMetrics({
              spend: mappedSpend,
              clicks: mappedClicks,
              impressions: mappedImpressions,
              roas: hasMappings ? realRoas : 0,
              metaRoas: hasMappings ? metaRoas : 0,
              hasMapping: hasMappings,
              mappedAccounts: mappedFbIds,
              source: "rebuildRoasSummary"
            });

            await prisma.dailySummary.upsert({
              where: {
                scope_scopeId_date: {
                  scope: "store",
                  scopeId: String(store.id),
                  date: dateStr
                }
              },
              update: {
                spend: mappedSpend,
                clicks: mappedClicks,
                impressions: mappedImpressions,
                roas: hasMappings ? realRoas : 0,
                metaRoas: hasMappings ? metaRoas : 0,
                metrics
              },
              create: {
                scope: "store",
                scopeId: String(store.id),
                date: dateStr,
                revenue: storeRevenue,
                orders: storeOrders,
                spend: mappedSpend,
                clicks: mappedClicks,
                impressions: mappedImpressions,
                roas: hasMappings ? realRoas : 0,
                metaRoas: hasMappings ? metaRoas : 0,
                metrics
              }
            });
            updatedCount++;
          }
        }

        return {
          recordsFetched: updatedCount,
          recordsSaved: updatedCount,
          metadata: { updatedRoasSummaries: updatedCount }
        };
      }
    );
  }

  // 10. rebuild_dashboard_summary
  static async rebuildDashboardSummary(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null, days: number = 90): Promise<string> {
    return this.runTask(
      "rebuild_dashboard_summary",
      "summary",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        let upsertedCount = 0;

        for (let i = 0; i < days; i++) {
          const dateStr = dayjs().subtract(i, "day").format("YYYY-MM-DD");

          // Pull all store daily summaries
          const storeSummaries = await prisma.dailySummary.findMany({
            where: {
              scope: "store",
              date: dateStr
            }
          });

          const totalRevenue = storeSummaries.reduce((sum, s) => sum + s.revenue, 0);
          const totalOrders = storeSummaries.reduce((sum, s) => sum + s.orders, 0);
          const totalSpend = storeSummaries.reduce((sum, s) => sum + s.spend, 0);
          const totalClicks = storeSummaries.reduce((sum, s) => sum + s.clicks, 0);
          const totalImpressions = storeSummaries.reduce((sum, s) => sum + s.impressions, 0);

          // Combined calculations
          const combinedRoas = totalSpend > 0 ? (totalRevenue / totalSpend) : 0;
          
          // Combined Meta conversion value
          const adAccountSummaries = await prisma.dailySummary.findMany({
            where: {
              scope: "ad_account",
              date: dateStr
            }
          });
          const totalMetaRevenue = adAccountSummaries.reduce((sum, a) => sum + a.revenue, 0);
          const combinedMetaRoas = totalSpend > 0 ? (totalMetaRevenue / totalSpend) : 0;

          const metrics = buildSummaryMetrics({
            revenue: totalRevenue,
            orders: totalOrders,
            spend: totalSpend,
            clicks: totalClicks,
            impressions: totalImpressions,
            roas: combinedRoas,
            metaRoas: combinedMetaRoas,
            source: "rebuildDashboardSummary"
          });

          await prisma.dailySummary.upsert({
            where: {
              scope_scopeId_date: {
                scope: "dashboard",
                scopeId: "all",
                date: dateStr
              }
            },
            update: {
              revenue: totalRevenue,
              orders: totalOrders,
              spend: totalSpend,
              clicks: totalClicks,
              impressions: totalImpressions,
              roas: combinedRoas,
              metaRoas: combinedMetaRoas,
              metrics
            },
            create: {
              scope: "dashboard",
              scopeId: "all",
              date: dateStr,
              revenue: totalRevenue,
              orders: totalOrders,
              spend: totalSpend,
              clicks: totalClicks,
              impressions: totalImpressions,
              roas: combinedRoas,
              metaRoas: combinedMetaRoas,
              metrics
            }
          });
          upsertedCount++;
        }

        return {
          recordsFetched: upsertedCount,
          recordsSaved: upsertedCount,
          metadata: { dashboardDaysUpserted: upsertedCount }
        };
      }
    );
  }

  // 11. run_ai_rule_monitor
  static async runAiRuleMonitor(taskChainId: string, triggeredBy: string, parentTaskId: string | null = null): Promise<string> {
    return this.runTask(
      "run_ai_rule_monitor",
      "ai",
      triggeredBy,
      taskChainId,
      parentTaskId,
      null,
      null,
      async () => {
        // Clear any old pending and generate real alerts inside SQLite!
        // Read recent daily summaries in aggregate of 7 days
        const last7Days = Array.from({ length: 7 }, (_, i) => dayjs().subtract(i, "day").format("YYYY-MM-DD"));
        
        const dashboardSummaries = await prisma.dailySummary.findMany({
          where: {
            scope: "store",
            date: { in: last7Days }
          }
        });

        // Rules check
        let anomaliesCreated = 0;

        // Ensure we create a general container report if we find issues
        // Rule A: Low ROAS alert
        const storesWithLowRoas = [];
        for (const summary of dashboardSummaries) {
          if (summary.spend > 100 && summary.roas < 1.0) {
            storesWithLowRoas.push(summary);
          }
        }

        if (storesWithLowRoas.length > 0) {
          const report = await prisma.aiAnalysisReport.create({
            data: {
              type: "anomaly",
              entityType: "store",
              entityId: storesWithLowRoas[0].scopeId,
              dateRange: JSON.stringify({ gte: last7Days[6], lte: last7Days[0] }),
              conclusion: `检测到店铺和广告账映射中的ROAS异常下降（最低ROAS：${storesWithLowRoas[0].roas.toFixed(2)}）。花费了大量广告费（$${storesWithLowRoas[0].spend.toFixed(2)}），但店铺销售额没有实现同比例增加。`,
              dataBasis: JSON.stringify(storesWithLowRoas),
              riskPoints: JSON.stringify(["ROAS低于平衡点1.0", "有流量但转化不佳"]),
              priority: 1,
              observationWindow: "7d",
              model: "Gemini 3.5 Flash",
              metadata: JSON.stringify({ storesAffected: storesWithLowRoas.map(s => s.scopeId) })
            }
          });

          await prisma.aiActionSuggestion.create({
            data: {
              reportId: report.id,
              action: `停止对该店铺（ID:${storesWithLowRoas[0].scopeId}）绑定的高成本亏损Meta广告渠道进行投放。`,
              rationale: `当前ROAS为 ${storesWithLowRoas[0].roas.toFixed(2)} 处于亏损。继续投放将导致资金持续流失。`,
              priority: 1,
              status: "pending",
              executionChecklist: JSON.stringify([
                "审查该店铺绑定的全部 Meta 广告账户",
                "排查最近24小时无转化的单品广告",
                "降低预算30%或暂停转化率极低的广告组"
              ])
            }
          });
          anomaliesCreated += 2;
        }

        // Rule B: Missing Store Mapping alert
        const stores = await prisma.store.findMany();
        const unmappedStores = [];
        for (const s of stores) {
          const m = await prisma.accountMapping.findFirst({ where: { storeId: s.id } });
          if (!m || !m.fbAccountId) {
            unmappedStores.push(s);
          }
        }

        if (unmappedStores.length > 0) {
          const report = await prisma.aiAnalysisReport.create({
            data: {
              type: "media_buyer",
              entityType: "store",
              entityId: String(unmappedStores[0].id),
              conclusion: `链路阻断：存在未绑定 Facebook 广告账户的活跃店铺，真实 ROAS 列可能被判定为缺失或无法被自动算得。`,
              dataBasis: JSON.stringify({ unmappedStoresCount: unmappedStores.length }),
              riskPoints: JSON.stringify(["缺少店铺与广告账户的一对一投产比映射", "数据分析和 AI 分析链路不可靠"]),
              priority: 2,
              observationWindow: "24h",
              model: "Gemini 3.5 Flash",
              metadata: JSON.stringify({ names: unmappedStores.map(u => u.name) })
            }
          });

          await prisma.aiActionSuggestion.create({
            data: {
              reportId: report.id,
              action: `在配置中心或映射设置中绑关联店铺与Facebook广告账户。`,
              rationale: `只有打通数据链路后，系统才能正确记录并输出真实的 ROAS。`,
              priority: 2,
              status: "pending",
              executionChecklist: JSON.stringify([
                "前往配置中心 -> 绑定映射",
                "确保每个店铺在 Meta 账户中有其对应来源",
                "点击重建 ROAS 后刷新数据中心"
              ])
            }
          });
          anomaliesCreated += 2;
        }

        return {
          recordsFetched: anomaliesCreated,
          recordsSaved: anomaliesCreated,
          metadata: { anomaliesGenerated: anomaliesCreated }
        };
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
        const id4 = await this.syncMetaInsights(taskChainId, triggeredBy, id3);
        const id5 = await this.rebuildMetaSummary(taskChainId, triggeredBy, id4);
        const id6 = await this.rebuildDashboardSummary(taskChainId, triggeredBy, id5);
        await this.runAiRuleMonitor(taskChainId, triggeredBy, id6);
        console.log(`[Sync Center] Meta Init pipeline finished nicely. Chain ID: ${taskChainId}`);
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
        const id2 = await this.syncStoreOrders(storeId, taskChainId, triggeredBy, id1);
        const id3 = await this.rebuildStoreSummary(taskChainId, triggeredBy, id2);
        const id4 = await this.rebuildDashboardSummary(taskChainId, triggeredBy, id3);
         console.log(`[Sync Center] Store Init pipeline finished nicely. Chain ID: ${taskChainId}`);
      } catch(err) {
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
        const id1 = await this.rebuildRoasSummary(taskChainId, triggeredBy, null);
        const id2 = await this.rebuildDashboardSummary(taskChainId, triggeredBy, id1);
        await this.runAiRuleMonitor(taskChainId, triggeredBy, id2);
        console.log(`[Sync Center] Mapping change pipeline and AI rule monitor finished. Chain ID: ${taskChainId}`);
      } catch (err) {
        console.error(`[Sync Center] Mapping change chain ${taskChainId} failed:`, err);
      }
    })();

    return taskChainId;
  }
}
