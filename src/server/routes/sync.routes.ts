// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";
import { SyncCenter } from "../services/sync-center.service.js";
import { getMetaToken } from "../utils.js";
import { syncStoreData } from "../services/store-sync.service.js";
import { syncMetaInsightsForActiveAccounts } from "../services/meta-insights.service.js";
import dayjs from "dayjs";

const router = Router();

function isManualSyncEnabled(): boolean {
  return process.env.ENABLE_MANUAL_SYNC === "true";
}

function requireManualSyncEnabled(req, res, next) {
  if (!isManualSyncEnabled()) {
    return res.status(403).json({
      success: false,
      error: "MANUAL_SYNC_DISABLED",
      message: "Manual sync endpoints are disabled by default. Set ENABLE_MANUAL_SYNC=true to enable them explicitly."
    });
  }
  return next();
}

/**
 * GET /api/sync/status
 * Evaluation of system configuration and metrics sync health.
 */
router.get("/sync/status", async (req, res) => {
  try {
    const metaToken = await getMetaToken();
    const stores = await prisma.store.findMany();
    const mappings = await prisma.accountMapping.findMany();
    const totalInsights = await prisma.factMetaPerformance.count();
    const runningTasks = await prisma.syncLog.findMany({
      where: { status: "running" }
    });

    let healthStatus = "ready";
    let detailMessage = "数据链路正常，所有系统均已就绪。";

    if (!metaToken) {
      healthStatus = "missing_meta_token";
      detailMessage = "Meta 令牌缺失：请前往配置中心绑定 Meta API Token。";
    } else if (runningTasks.length > 0) {
      healthStatus = "syncing";
      detailMessage = "数据同步中：系统正在后台拉取最新报表并重建底层汇总表。";
    } else if (stores.length === 0) {
      healthStatus = "partial_data";
      detailMessage = "未配置店铺：添加至少一个电商或 ERP 来源以计算 ROAS。";
    } else if (mappings.length === 0) {
      healthStatus = "partial_data";
      detailMessage = "缺少账号/店铺映射。系统将无法计算销售额与费用的实际 ROAS！";
    } else {
      // Check if some sync failed recently
      const recentFailed = await prisma.syncLog.findFirst({
        where: {
          status: "failed",
          finishedAt: { gte: dayjs().subtract(12, "hour").toDate() }
        }
      });
      if (recentFailed) {
        healthStatus = "sync_failed";
        detailMessage = `最近同步失败：任务 [${recentFailed.taskType}] 发生错误 ("${recentFailed.errorMessage || recentFailed.error}")。`;
      } else {
        // Check for stale data (last successful sync was > 24 hours ago)
        const lastSuccess = await prisma.syncLog.findFirst({
          where: { status: "success" },
          orderBy: { finishedAt: "desc" }
        });
        if (lastSuccess && dayjs(lastSuccess.finishedAt).isBefore(dayjs().subtract(24, "hour"))) {
          healthStatus = "stale_data";
          detailMessage = "数据滞后：距离上一次系统数据自动同步已超过 24 小时。";
        }
      }
    }

    res.json({
      healthStatus,
      detailMessage,
      metaConfigured: !!metaToken,
      storesCount: stores.length,
      mappingsCount: mappings.length,
      totalInsightsCount: totalInsights,
      activeSyncCount: runningTasks.length,
      runningTasksList: runningTasks.map(t => ({ id: t.id, type: t.type, taskType: t.taskType, taskChainId: t.taskChainId })),
      dataSourceExplain: {
        primarySource: "FactMetaPerformance",
        legacySource: "AdInsight",
        legacyUsed: false
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to evaluate sync status", details: error.message });
  }
});

/**
 * GET /api/sync/logs
 * Retrieve task execution logs.
 */
router.get("/sync/logs", async (req, res) => {
  const { status, type, storeId, limit = 50 } = req.query;
  try {
    const whereClause: Record<string, any> = {};
    if (status) whereClause.status = status;
    if (type) {
      whereClause.OR = [
        { type },
        { taskType: type }
      ];
    }
    if (storeId) whereClause.storeId = String(storeId);

    const logs = await prisma.syncLog.findMany({
      where: whereClause,
      orderBy: { startedAt: "desc" },
      take: parseInt(limit, 10)
    });

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list sync logs", details: error.message });
  }
});

/**
 * GET /api/sync/chains
 * Lists and groups logs by execution chain ID.
 */
router.get("/sync/chains", async (req, res) => {
  try {
    const logs = await prisma.syncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 100
    });

    const chainsMap: Record<string, any> = {};
    for (const log of logs) {
      const chainId = log.taskChainId || "independent";
      if (!chainsMap[chainId]) {
        chainsMap[chainId] = {
          chainId,
          startedAt: log.startedAt,
          finishedAt: log.finishedAt || null,
          status: "success", // calculated below
          tasks: []
        };
      }

      chainsMap[chainId].tasks.push({
        id: log.id,
        type: log.taskType || log.type,
        status: log.status,
        startedAt: log.startedAt,
        finishedAt: log.finishedAt,
        recordsFetched: log.recordsFetched || 0,
        recordsSaved: log.recordsSaved || 0,
        errorMessage: log.errorMessage || log.error
      });

      // Update aggregate start dates / state
      if (new Date(log.startedAt) < new Date(chainsMap[chainId].startedAt)) {
        chainsMap[chainId].startedAt = log.startedAt;
      }
      if (log.finishedAt && (!chainsMap[chainId].finishedAt || new Date(log.finishedAt) > new Date(chainsMap[chainId].finishedAt))) {
        chainsMap[chainId].finishedAt = log.finishedAt;
      }
      if (log.status === "running") {
        chainsMap[chainId].status = "running";
      } else if (log.status === "failed" && chainsMap[chainId].status !== "running") {
        chainsMap[chainId].status = "failed";
      }
    }

    const chainsList = Object.values(chainsMap).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    res.json(chainsList);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load grouped task chains", details: error.message });
  }
});

/**
 * POST /api/sync/trigger
 * Manually starts a specific task trigger.
 */
router.post("/sync/trigger", requireManualSyncEnabled, async (req, res) => {
  const { taskType, storeId, accountId, startDate, endDate, days } = req.body;
  if (!taskType) {
    return res.status(400).json({ error: "taskType is required" });
  }

  try {
    const chainId = "manual-opt-" + Math.random().toString(36).substring(2, 8);
    let message = "";

    // Trigger asynchronous execution and deliver prompt feedback.
    if (taskType === "sync_meta_accounts") {
      SyncCenter.syncMetaAccounts(chainId, "manual_trigger")
        .then(t => SyncCenter.syncMetaActivity(chainId, "manual_trigger", t))
        .catch(e => console.error(e));
      message = "已开始同步 Meta 平台授权客户与有效账户检测。";
    } else if (taskType === "sync_meta_structure") {
      SyncCenter.syncMetaStructure(chainId, "manual_trigger").catch(e => console.error(e));
      message = "已启动 Meta 创意结构拆解任务 (Campaign / AdSet / Ads)。";
    } else if (taskType === "sync_meta_insights") {
      const daysVal = days ? parseInt(days, 10) : 3; // manual defaults to 3 days!
      SyncCenter.syncMetaInsights(chainId, "manual_trigger", null, daysVal, accountId, startDate, endDate)
        .then(() => SyncCenter.rebuildMetaSummary(chainId, "manual_trigger", null, daysVal))
        .then(() => SyncCenter.rebuildDashboardSummary(chainId, "manual_trigger", null, daysVal))
        .catch(e => console.error(e));
      
      message = accountId
        ? `已开始对账户 ${accountId} 同步指定范围的 Meta 广告成效数据。`
        : `已开始同步 Meta 过去 ${daysVal} 天的广告成效与展现/消耗报表。`;
    } else if (taskType === "sync_meta_audience") {
      const daysVal = days ? parseInt(days, 10) : 3;
      SyncCenter.syncMetaAudience(chainId, "manual_trigger", null, daysVal, accountId, startDate, endDate)
        .catch(e => console.error(e));
      
      message = accountId
        ? `已开始对账户 ${accountId} 同步指定范围的 Meta 受众、设备与渠道版位细分洞察。`
        : `已开始从 Meta API 单步同步过去 ${daysVal} 天的受众/版位/设备等事实事实级细分归档。`;
    } else if (taskType === "sync_store_orders") {
      if (!storeId) return res.status(400).json({ error: "Store ID is required for sync_store_orders" });
      const daysVal = days ? parseInt(days, 10) : 90;
      SyncCenter.syncStoreOrders(parseInt(storeId, 10), chainId, "manual_trigger", null, daysVal, startDate || null, endDate || null)
        .then(() => SyncCenter.rebuildStoreSummary(chainId, "manual_trigger", null, daysVal))
        .then(() => SyncCenter.rebuildDashboardSummary(chainId, "manual_trigger", null, daysVal))
        .catch(e => console.error(e));
      message = `已触发该店铺 (ID:${storeId}) 订单流水历史同步与日度转化归档。`;
    } else if (taskType === "rebuild_roas_summary") {
      SyncCenter.rebuildRoasSummary(chainId, "manual_trigger", null, 90)
        .then(() => SyncCenter.rebuildDashboardSummary(chainId, "manual_trigger", null, 90))
        .catch(e => console.error(e));
      message = "开始重新对齐店铺及Meta广告账户映射以重新计算真实现成 ROAS。";
    } else if (taskType === "run_ai_rule_monitor") {
      SyncCenter.runAiRuleMonitor(chainId, "manual_trigger").catch(e => console.error(e));
      message = "启动 AI 风控报警与素材健康等级自动体检扫描。";
    } else {
      return res.status(400).json({ error: `Unsupported task type: ${taskType}` });
    }

    res.json({
      success: true,
      message,
      taskChainId: chainId
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to initial task trigger", details: error.message });
  }
});

/**
 * POST /api/sync/rebuild
 * Completely clears the dailySummary table and starts rebuilding all metrics for last 90 days.
 */
router.post("/sync/rebuild", requireManualSyncEnabled, async (req, res) => {
  try {
    const chainId = "rebuild-all-" + Math.random().toString(36).substring(2, 8);
    
    // Clear summaries safely
    await prisma.dailySummary.deleteMany();
    await prisma.aiAnalysisReport.deleteMany();
    await prisma.aiActionSuggestion.deleteMany();

    // Async pipeline
    (async () => {
      try {
        console.log(`[Rebuild Sync] Clean done. Triggering full data reconstructionchain: ${chainId}`);
        const id1 = await SyncCenter.rebuildStoreSummary(chainId, "rebuild_btn", null, 90);
        const id2 = await SyncCenter.rebuildMetaSummary(chainId, "rebuild_btn", id1, 90);
        const id3 = await SyncCenter.rebuildRoasSummary(chainId, "rebuild_btn", id2, 90);
        const id4 = await SyncCenter.rebuildDashboardSummary(chainId, "rebuild_btn", id3, 90);
        await SyncCenter.runAiRuleMonitor(chainId, "rebuild_btn", id4);
        console.log(`[Rebuild Sync] Data reconstruction complete! ${chainId}`);
      } catch (err) {
        console.error("[Rebuild Sync Error]:", err);
      }
    })();

    res.json({
      success: true,
      message: "正在后台重建过去 90 天所有店铺与广告链条的每日交易数、汇总开销、以及各店铺对齐 ROAS 和 AI 风控卡片。",
      taskChainId: chainId
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to initiate data rebuild", details: error.message });
  }
});

/**
 * LEGACY ROUTE FALLBACK (Satisfies old UI manual triggered global calls)
 */
router.post("/sync", requireManualSyncEnabled, async (req, res) => {
  try {
    const parentChainId = "sync-" + Math.random().toString(36).substring(2, 8);
    const startedVal = new Date();

    console.log(`[Unified Sync API] Initiating real Meta insights pull for active accounts...`);
    
    // Call the real Meta Insights endpoint sync (this queries account, campaign, adset, ad levels from Meta Graph API)
    await syncMetaInsightsForActiveAccounts(3);

    // Rebuild summaries inside SQLite to align with the synced real insights
    await SyncCenter.rebuildStoreSummary(parentChainId, "manual_sync_btn", null, 3);
    await SyncCenter.rebuildMetaSummary(parentChainId, "manual_sync_btn", null, 3);
    await SyncCenter.rebuildRoasSummary(parentChainId, "manual_sync_btn", null, 3);
    await SyncCenter.rebuildDashboardSummary(parentChainId, "manual_sync_btn", null, 3);

    const finishedVal = new Date();
    await prisma.syncLog.create({
      data: {
        id: parentChainId,
        taskChainId: parentChainId,
        type: "sync_meta_insights",
        taskType: "sync_meta_insights",
        startedAt: startedVal,
        finishedAt: finishedVal,
        status: "success",
        recordsFetched: 1, // positive indicator of process completion
        recordsSaved: 1,
        errorMessage: null
      }
    });

    res.json({
      success: true,
      message: `同步成功：已拉取并更新了真实 Meta 广告账户各级成效数据并完成了看板对齐（排除沙盒数据）。`
    });
  } catch (error: any) {
    console.error("Sync handler error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/sync-store", requireManualSyncEnabled, async (req, res) => {
  const { storeId } = req.body;
  if (!storeId) {
    return res.status(400).json({ error: "storeId is required" });
  }
  try {
    const chainId = await SyncCenter.triggerStoreConfigChain(parseInt(storeId, 10), "legacy_store_sync");
    res.json({
      success: true,
      message: "Store sync started in background via integration chain",
      taskChainId: chainId
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// CRON MONTHLY
router.get("/cron/sync-monthly", requireManualSyncEnabled, async (req, res) => {
  try {
    const chainId = await SyncCenter.triggerMetaConfigChain("cron_monthly");
    res.json({ success: true, taskChainId: chainId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sync/stores/:storeId/orders
 * 同步指定店铺订单
 */
router.post("/sync/stores/:storeId/orders", requireManualSyncEnabled, async (req, res) => {
  const { storeId } = req.params;
  const chainId = "sync-single-store-" + Math.random().toString(36).substring(2, 8);
  try {
    const id1 = await SyncCenter.syncStoreOrders(parseInt(storeId, 10), chainId, "manual_trigger_single");
    await SyncCenter.rebuildStoreSummary(chainId, "manual_trigger_single", id1, 90);
    await SyncCenter.rebuildDashboardSummary(chainId, "manual_trigger_single", id1, 90);

    res.json({
      success: true,
      message: `店铺 ${storeId} 订单同步与归档汇总成功。`,
      taskChainId: chainId
    });
  } catch (error: any) {
    console.error(`Sync store orders error (ID: ${storeId}):`, error);
    res.status(500).json({ error: "Failed to sync store orders", details: error.message });
  }
});

/**
 * POST /api/sync/stores/orders
 * 同步所有店铺订单
 */
router.post("/sync/stores/orders", requireManualSyncEnabled, async (req, res) => {
  const chainId = "sync-all-stores-" + Math.random().toString(36).substring(2, 8);
  try {
    const stores = await prisma.store.findMany();
    let lastTaskId: string | null = null;
    for (const store of stores) {
      lastTaskId = await SyncCenter.syncStoreOrders(store.id, chainId, "manual_trigger_all", lastTaskId);
    }
    
    await SyncCenter.rebuildStoreSummary(chainId, "manual_trigger_all", lastTaskId, 90);
    await SyncCenter.rebuildDashboardSummary(chainId, "manual_trigger_all", lastTaskId, 90);

    res.json({
      success: true,
      message: `所有店铺（共计 ${stores.length} 个）订单同步完毕，汇总对齐完成。`,
      taskChainId: chainId
    });
  } catch (error: any) {
    console.error("Sync all stores orders error:", error);
    res.status(500).json({ error: "Failed to sync all stores orders", details: error.message });
  }
});

/**
 * POST /api/summary/stores/rebuild
 * 重建店铺汇总
 */
router.post("/summary/stores/rebuild", requireManualSyncEnabled, async (req, res) => {
  const chainId = "rebuild-store-summary-" + Math.random().toString(36).substring(2, 8);
  try {
    const id1 = await SyncCenter.rebuildStoreSummary(chainId, "rebuild_summary_btn", null, 90);
    await SyncCenter.rebuildDashboardSummary(chainId, "rebuild_summary_btn", id1, 90);

    res.json({
      success: true,
      message: "店铺及电商业务明细汇总模型重建构建完毕。",
      taskChainId: chainId
    });
  } catch (error: any) {
    console.error("Rebuild store summary error:", error);
    res.status(500).json({ error: "Failed to rebuild store summary", details: error.message });
  }
});

/**
 * GET /api/sync/stores/:storeId/reconcile
 * Fetch a direct audit check comparing active platform orders with DB saved ones
 */
router.get("/sync/stores/:storeId/reconcile", requireManualSyncEnabled, async (req, res) => {
  const { storeId } = req.params;
  const startDate = (req.query.startDate as string) || dayjs().subtract(7, "day").format("YYYY-MM-DD");
  const endDate = (req.query.endDate as string) || dayjs().format("YYYY-MM-DD");

  try {
    const store = await prisma.store.findUnique({
      where: { id: parseInt(storeId, 10) }
    });
    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    // Call our upgraded live sync with verbose audit reporting!
    const syncResults = await syncStoreData(startDate, endDate, String(storeId));
    const auditReport = syncResults[parseInt(storeId, 10)];

    if (!auditReport) {
      return res.status(500).json({ error: "No audit report returned for this store" });
    }

    // Cross-verify with database: how many orders are physically queryable in DB
    const savedOrdersCount = await prisma.order.count({
      where: {
        storeId: store.id,
        store_local_date: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    const savedOrdersDistinct = await prisma.order.findMany({
      where: {
        storeId: store.id,
        store_local_date: {
          gte: startDate,
          lte: endDate
        }
      },
      select: { orderId: true },
      distinct: ['orderId']
    });
    const uniqueSavedCount = savedOrdersDistinct.length;

    res.json({
      success: true,
      startDate,
      endDate,
      storeName: store.name,
      platform: store.platform,
      timezone: store.timezone,
      auditReport,
      backendTotalSavedItems: savedOrdersCount,
      backendTotalUniqueSavedOrders: uniqueSavedCount
    });

  } catch (err: any) {
    console.error(`Reconcile store orders error (ID: ${storeId}):`, err);
    res.status(500).json({ error: "Failed to perform order reconciliation", details: err?.message || String(err) });
  }
});

export default router;
