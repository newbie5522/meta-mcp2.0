// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";
import { SyncCenter } from "../services/sync-center.service.js";
import { getMetaToken, normalizeMetaAccountId } from "../utils.js";
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

const MAX_FRONTEND_META_DAYS = 3650;
const MAX_FRONTEND_STORE_DAYS = 3650;

function parseBoundedInt(value: any, fallback: number, min: number, max: number): number {
  const parsed = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function daysForRange(startDate?: string | null, endDate?: string | null, fallback = 7, max = MAX_FRONTEND_META_DAYS): number {
  if (startDate && endDate) {
    const diff = dayjs(endDate).diff(dayjs(startDate), "day") + 1;
    if (Number.isFinite(diff) && diff > 0) {
      return diff;
    }
  }
  return fallback;
}

function boundedDateRange(startDate: any, endDate: any, fallbackDays: number, maxDays: number) {
  const end = endDate && dayjs(String(endDate)).isValid()
    ? dayjs(String(endDate))
    : dayjs();
  const fallbackStart = end.subtract(Math.max(1, fallbackDays) - 1, "day");
  let start = startDate && dayjs(String(startDate)).isValid()
    ? dayjs(String(startDate))
    : fallbackStart;

  if (start.isAfter(end)) {
    start = fallbackStart;
  }

  return {
    startDate: start.format("YYYY-MM-DD"),
    endDate: end.format("YYYY-MM-DD"),
    days: end.diff(start, "day") + 1
  };
}

function getErrorMessage(error: any): string {
  return error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.response?.data?.details ||
    error?.message ||
    String(error);
}

function hasStoreToken(store: any): boolean {
  return Boolean(store?.shopline_token || store?.shopify_token || store?.shoplazza_token);
}

function isProductionSyncableStore(store: any): boolean {
  return store?.mode === "production" && hasStoreToken(store);
}

async function assertNoRunningTask(taskTypes: string[]) {
  const running = await prisma.syncLog.findFirst({
    where: {
      status: "running",
      taskType: { in: taskTypes }
    },
    orderBy: { startedAt: "desc" }
  });

  if (running) {
    const taskName = running.taskType || running.type || "unknown";
    const error: any = new Error(`已有同步任务正在运行：${taskName} (${running.id})。请等待当前任务结束后再试。`);
    error.statusCode = 409;
    error.code = "SYNC_ALREADY_RUNNING";
    error.runningTask = {
      id: running.id,
      taskType: taskName,
      taskChainId: running.taskChainId,
      startedAt: running.startedAt
    };
    throw error;
  }
}

async function resolveSafeMetaTargets(input: {
  accountId?: string | null;
  accountIds?: string[] | null;
  limit?: number;
}) {
  const requested = [
    input.accountId,
    ...(Array.isArray(input.accountIds) ? input.accountIds : [])
  ]
    .filter(Boolean)
    .map((id) => normalizeMetaAccountId(String(id)))
    .filter((id, index, arr) => id && arr.indexOf(id) === index);

  if (requested.length > 0) {
    const accounts = await prisma.adAccount.findMany({
      where: { fb_account_id: { in: requested } },
      include: { store: true },
      orderBy: { updatedAt: "desc" }
    });

    if (accounts.length === 0) {
      const error: any = new Error("未找到可同步的已落库 Meta 广告账户。请先在配置中心拉取账户。");
      error.statusCode = 404;
      error.code = "ACCOUNT_NOT_FOUND";
      throw error;
    }
    return accounts;
  }

  const boundAccounts = await prisma.adAccount.findMany({
    where: { storeId: { not: null } },
    include: { store: true },
    orderBy: { updatedAt: "desc" }
  });

  const boundIds = boundAccounts.map((account) => account.fb_account_id);
  const activeAccounts = await prisma.adAccount.findMany({
    where: {
      recentActivity90d: true,
      fb_account_id: { notIn: boundIds }
    },
    include: { store: true },
    orderBy: { updatedAt: "desc" }
  });

  const targets = [...boundAccounts, ...activeAccounts];
  if (targets.length === 0) {
    const error: any = new Error("没有符合安全同步范围的广告账户。默认只同步已绑定店铺或最近 90 天活跃的账户。");
    error.statusCode = 400;
    error.code = "NO_SYNC_TARGETS";
    throw error;
  }

  return targets;
}

async function resolveSafeStoreTargets(input: { storeId?: string | number | null; limit?: number }) {
  if (input.storeId) {
    const id = parseInt(String(input.storeId), 10);
    if (!Number.isFinite(id) || Number.isNaN(id)) {
      const error: any = new Error("storeId 必须 be effective digit.");
      error.statusCode = 400;
      error.code = "INVALID_STORE_ID";
      throw error;
    }

    const store = await prisma.store.findUnique({ where: { id } });
    if (!store) {
      const error: any = new Error("Store does not exist, cannot trigger sync.");
      error.statusCode = 404;
      error.code = "STORE_NOT_FOUND";
      throw error;
    }
    if (!isProductionSyncableStore(store)) {
      const error: any = new Error("This store mode is not production or API token empty.");
      error.statusCode = 400;
      error.code = "STORE_NOT_SYNCABLE";
      throw error;
    }
    return [store];
  }

  const stores = await prisma.store.findMany({
    where: { mode: "production" },
    orderBy: { updatedAt: "desc" }
  });
  const targets = stores.filter(isProductionSyncableStore);

  if (targets.length === 0) {
    const error: any = new Error("No production store with API token config available to sync.");
    error.statusCode = 400;
    error.code = "NO_SYNCABLE_STORES";
    throw error;
  }

  return targets;
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
 * Frontend-safe sync tasks run with bounded scope by default.
 * Dangerous/admin tasks continue to the guarded route below.
 */
router.post("/sync/trigger", async (req, res, next) => {
  const { taskType, storeId, accountId, accountIds, startDate, endDate, days, limit } = req.body;

  const validSafeTypes = [
    "sync_meta_insights",
    "sync_store_orders",
    "sync_meta_structure",
    "sync_meta_accounts",
    "sync_meta_audience",
    "run_ai_rule_monitor",
    "rebuild_roas_summary"
  ];

  if (!validSafeTypes.includes(taskType)) {
    return next();
  }

  try {
    const chainId = "frontend-sync-" + Math.random().toString(36).substring(2, 8);

    if (taskType === "sync_meta_insights") {
      await assertNoRunningTask(["sync_meta_insights"]);
      const daysVal = parseBoundedInt(days, daysForRange(startDate, endDate, 7, MAX_FRONTEND_META_DAYS), 1, MAX_FRONTEND_META_DAYS);
      const range = boundedDateRange(startDate, endDate, daysVal, MAX_FRONTEND_META_DAYS);
      const targets = await resolveSafeMetaTargets({ accountId, accountIds, limit });
      let lastTaskId: string | null = null;
      let recordsFetched = 0;
      let recordsSaved = 0;
      const taskIds: string[] = [];

      for (const account of targets) {
        const taskId = await SyncCenter.syncMetaInsights(
          chainId,
          "frontend_safe_sync",
          lastTaskId,
          range.days,
          account.fb_account_id,
          range.startDate,
          range.endDate
        );
        taskIds.push(taskId);
        lastTaskId = taskId;

        const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
        recordsFetched += log?.recordsFetched || 0;
        recordsSaved += log?.recordsSaved || 0;
      }

      const summaryDays = range.days;
      const metaSummaryTaskId = await SyncCenter.rebuildMetaSummary(chainId, "frontend_safe_sync", lastTaskId, summaryDays);
      await SyncCenter.rebuildDashboardSummary(chainId, "frontend_safe_sync", metaSummaryTaskId, summaryDays);

      const status = recordsFetched === 0 && recordsSaved === 0 ? "NO_NEW_DATA" : "SUCCESS";
      return res.json({
        success: true,
        status,
        message: status === "NO_NEW_DATA"
          ? `同步完成，但 Meta API 在当前日期范围没有返回新的广告表现数据。已检查 ${targets.length} 个安全范围内账户。`
          : `同步完成：已检查 ${targets.length} 个账户，拉取 ${recordsFetched} 条 Meta 表现记录，写入/更新 ${recordsSaved} 条事实记录。`,
        taskChainId: chainId,
        taskIds,
      targetAccounts: targets.map((account) => ({
          accountId: account.fb_account_id,
          name: account.fb_account_name,
          storeId: account.storeId || null
        })),
        recordsFetched,
        recordsSaved,
        startDate: range.startDate,
        endDate: range.endDate,
        dataSourceExplain: {
          inventorySource: "AdAccount",
          factSource: "FactMetaPerformance",
          executor: "SyncCenter.syncMetaInsights"
        }
      });
    }

    if (taskType === "sync_store_orders") {
      await assertNoRunningTask(["sync_store_orders"]);
      const daysVal = parseBoundedInt(days, daysForRange(startDate, endDate, 30, MAX_FRONTEND_STORE_DAYS), 1, MAX_FRONTEND_STORE_DAYS);
      const range = boundedDateRange(startDate, endDate, daysVal, MAX_FRONTEND_STORE_DAYS);
      const targets = await resolveSafeStoreTargets({ storeId, limit });
      let lastTaskId: string | null = null;
      let recordsFetched = 0;
      let recordsSaved = 0;
      const taskIds: string[] = [];

      for (const store of targets) {
        const taskId = await SyncCenter.syncStoreOrders(
          store.id,
          chainId,
          "frontend_safe_sync",
          lastTaskId,
          range.days,
          range.startDate,
          range.endDate
        );
        taskIds.push(taskId);
        lastTaskId = taskId;

        const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
        recordsFetched += log?.recordsFetched || 0;
        recordsSaved += log?.recordsSaved || 0;
      }

      const summaryDays = range.days;
      const storeSummaryTaskId = await SyncCenter.rebuildStoreSummary(chainId, "frontend_safe_sync", lastTaskId, summaryDays);
      await SyncCenter.rebuildDashboardSummary(chainId, "frontend_safe_sync", storeSummaryTaskId, summaryDays);

      const status = recordsFetched === 0 && recordsSaved === 0 ? "NO_NEW_DATA" : "SUCCESS";
      return res.json({
        success: true,
        status,
        message: status === "NO_NEW_DATA"
          ? `同步完成，但店铺 API 在当前日期范围没有返回新的订单数据。已检查 ${targets.length} 个可同步店铺。`
          : `同步完成：已检查 ${targets.length} 个店铺，拉取 ${recordsFetched} 条订单记录，写入/更新 ${recordsSaved} 条订单事实。`,
        taskChainId: chainId,
        taskIds,
        targetStores: targets.map((store) => ({
          id: store.id,
          name: store.name,
          platform: store.platform,
          mode: store.mode
        })),
        recordsFetched,
        recordsSaved,
        startDate: range.startDate,
        endDate: range.endDate,
        dataSourceExplain: {
          inventorySource: "Store",
          factSource: "Order",
          executor: "SyncCenter.syncStoreOrders"
        }
      });
    }

    if (taskType === "sync_meta_structure") {
      await assertNoRunningTask(["sync_meta_structure"]);
      const taskId = await SyncCenter.syncMetaStructure(chainId, "frontend_safe_sync");
      return res.json({
        success: true,
        message: "已启动并成功同步 Meta 创意结构拆解任务 (Campaign / AdSet / Ads)。",
        taskChainId: chainId,
        taskIds: [taskId]
      });
    }

    if (taskType === "sync_meta_accounts") {
      await assertNoRunningTask(["sync_meta_accounts"]);
      const taskId = await SyncCenter.syncMetaAccounts(chainId, "frontend_safe_sync");
      await SyncCenter.syncMetaActivity(chainId, "frontend_safe_sync", taskId);
      return res.json({
        success: true,
        message: "成功同步并更新 Meta 客户及有效广告账户状态 (AdAccount)。",
        taskChainId: chainId,
        taskIds: [taskId]
      });
    }

    if (taskType === "sync_meta_audience") {
      await assertNoRunningTask(["sync_meta_audience"]);
      const daysVal = parseBoundedInt(days, daysForRange(startDate, endDate, 7, MAX_FRONTEND_META_DAYS), 1, MAX_FRONTEND_META_DAYS);
      const range = boundedDateRange(startDate, endDate, daysVal, MAX_FRONTEND_META_DAYS);
      const targets = await resolveSafeMetaTargets({ accountId, accountIds, limit });
      let lastTaskId: string | null = null;
      const taskIds: string[] = [];

      for (const account of targets) {
        const taskId = await SyncCenter.syncMetaAudience(
          chainId,
          "frontend_safe_sync",
          lastTaskId,
          range.days,
          account.fb_account_id,
          range.startDate,
          range.endDate
        );
        taskIds.push(taskId);
        lastTaskId = taskId;
      }
      return res.json({
        success: true,
        message: `成功完成受众与渠道细分数据同步（已处理 ${targets.length} 个账户，期间: ${range.startDate} 到 ${range.endDate}）。`,
        taskChainId: chainId,
        taskIds
      });
    }

    if (taskType === "run_ai_rule_monitor") {
      await assertNoRunningTask(["run_ai_rule_monitor"]);
      const taskId = await SyncCenter.runAiRuleMonitor(chainId, "frontend_safe_sync");
      return res.json({
        success: true,
        message: "AI风控系统体检扫描运行完毕，已重新计算并更新各账户的诊断卡片。",
        taskChainId: chainId,
        taskIds: [taskId]
      });
    }

    if (taskType === "rebuild_roas_summary") {
      await assertNoRunningTask(["rebuild_roas_summary"]);
      const summaryDays = days ? parseInt(days, 10) : 90;
      const taskId = await SyncCenter.rebuildRoasSummary(chainId, "frontend_safe_sync", null, summaryDays);
      await SyncCenter.rebuildDashboardSummary(chainId, "frontend_safe_sync", taskId, summaryDays);
      return res.json({
        success: true,
        message: `销售额/开销 ROAS 映射汇总表重新对准成功（对齐窗口: 过去 ${summaryDays} 天）。`,
        taskChainId: chainId,
        taskIds: [taskId]
      });
    }

  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: error?.code || "SYNC_TRIGGER_FAILED",
      message: getErrorMessage(error),
      details: getErrorMessage(error),
      runningTask: error?.runningTask || null
    });
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
