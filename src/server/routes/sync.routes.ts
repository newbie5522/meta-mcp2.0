// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";
import { SyncCenter } from "../services/sync-center.service.js";
import { getMetaToken, normalizeMetaAccountId } from "../utils.js";
import { syncStoreData } from "../services/store-sync.service.js";
import { syncMetaInsightsForActiveAccounts } from "../services/meta-insights.service.js";
import { rebuiltStoreOrderSummary, rebuildStoreLedgerForRange } from "../services/store-ledger.service.js";
import { cleanMetaAccountFactsForRange } from "../services/meta-ledger.service.js";
import dayjs from "dayjs";
import { syncMetaAccountSpendRealtime } from "../services/meta-realtime-sync.service.js";
import { getStoreOrderSummary } from "../services/order-fact.service.js";
import { refreshStoreDataCenterLedger } from "../services/datacenter-store-ledger.service.js";
import { refreshMetaDataCenterLedger } from "../services/datacenter-meta-ledger.service.js";
import { syncMetaAudienceBreakdown } from "../services/meta-audience-breakdown-sync.service.js";
import { v4 as uuidv4 } from "uuid";
import { SyncTaskType, SyncTriggerRequest, SyncTriggerResponse } from "../types/sync-tasks.js";

const router = Router();
const STALE_RUNNING_TASK_MINUTES = 30;

// ============================================================
// 🔐 权限控制
// ============================================================

function isManualSyncEnabled(): boolean {
  return process.env.ENABLE_MANUAL_SYNC === "true";
}

function requireManualSyncEnabled(req: any, res: any, next: any) {
  if (!isManualSyncEnabled()) {
    return res.status(403).json({
      success: false,
      error: "MANUAL_SYNC_DISABLED",
      message: "Manual sync endpoints are disabled by default. Set ENABLE_MANUAL_SYNC=true to enable them explicitly."
    });
  }
  return next();
}

function parseSyncMetadata(log: any) {
  if (!log?.metadata) return {};
  if (typeof log.metadata === "object") return log.metadata;
  try {
    return JSON.parse(String(log.metadata));
  } catch {
    return {};
  }
}

async function summarizeSyncLogs(taskIds: string[]) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return {
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      failedAccounts: [],
      targetAccountsCount: null,
      hasFailedTask: false
    };
  }

  const logs = await prisma.syncLog.findMany({
    where: { id: { in: taskIds } }
  });

  let recordsFetched = 0;
  let recordsSaved = 0;
  let recordsUpdated = 0;
  const failedAccounts: any[] = [];
  let targetAccountsCount: number | null = null;
  let hasFailedTask = false;
  let metadataStatus: string | null = null;
  let metadataReason: string | null = null;
  let metadataMessage: string | null = null;
  let dimensionsRequested: string[] | null = null;
  let dimensionsSynced: string[] | null = null;

  for (const log of logs) {
    const metadata = parseSyncMetadata(log);
    recordsFetched += Number(log.recordsFetched || 0);
    recordsSaved += Number(log.recordsSaved || 0);
    recordsUpdated += Number(metadata.recordsUpdated || 0);
    if (Array.isArray(metadata.failedAccounts)) {
      failedAccounts.push(...metadata.failedAccounts);
    }
    const nextTargetCount = Number(
      metadata.targetAccountsCount ?? metadata.accountsSynced ?? metadata.accountsChecked ?? NaN
    );
    if (Number.isFinite(nextTargetCount)) {
      targetAccountsCount = Math.max(targetAccountsCount || 0, nextTargetCount);
    }
    if (metadata.status) metadataStatus = String(metadata.status);
    if (metadata.reason) metadataReason = String(metadata.reason);
    if (metadata.message) metadataMessage = String(metadata.message);
    if (Array.isArray(metadata.dimensionsRequested)) dimensionsRequested = metadata.dimensionsRequested;
    if (Array.isArray(metadata.dimensionsSynced)) dimensionsSynced = metadata.dimensionsSynced;
    if (log.status === "failed") {
      hasFailedTask = true;
    }
  }

  return {
    recordsFetched,
    recordsSaved,
    recordsUpdated,
    failedAccounts,
    targetAccountsCount,
    hasFailedTask,
    metadataStatus,
    metadataReason,
    metadataMessage,
    dimensionsRequested,
    dimensionsSynced
  };
}

function buildLimitReceipt(rawLimit: any, targetCount: number) {
  const requestedLimit =
    rawLimit !== undefined && rawLimit !== null && rawLimit !== ""
      ? Number.parseInt(String(rawLimit), 10)
      : null;
  const appliedLimit =
    requestedLimit !== null && Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit || 1, 50))
      : null;

  return {
    requestedLimit,
    appliedLimit,
    targetAccountsCount: targetCount,
    hasMoreTargets: appliedLimit !== null ? targetCount >= appliedLimit : false
  };
}

function buildProgress(input: {
  currentStep?: number;
  totalSteps?: number;
  stepLabel?: string;
  processedAccounts?: number | null;
  totalAccounts?: number | null;
  processedDimensions?: number | null;
  totalDimensions?: number | null;
}) {
  const currentStep = input.currentStep ?? input.totalSteps ?? 1;
  const totalSteps = Math.max(1, input.totalSteps ?? 1);
  const progressPercent = Math.max(0, Math.min(100, Math.round((currentStep / totalSteps) * 100)));

  return {
    progressPercent,
    currentStep,
    totalSteps,
    stepLabel: input.stepLabel || "同步任务完成",
    processedAccounts: input.processedAccounts ?? null,
    totalAccounts: input.totalAccounts ?? null,
    processedDimensions: input.processedDimensions ?? null,
    totalDimensions: input.totalDimensions ?? null
  };
}

function deriveSyncStatus(summary: any) {
  if (summary.hasFailedTask || summary.failedAccounts?.length > 0) {
    return summary.recordsFetched > 0 || summary.recordsSaved > 0 || summary.recordsUpdated > 0
      ? "PARTIAL_SUCCESS"
      : "NO_NEW_DATA";
  }

  return summary.recordsFetched === 0 && summary.recordsSaved === 0 && summary.recordsUpdated === 0
    ? "NO_NEW_DATA"
    : "SUCCESS";
}

function isSyncAlreadyRunningError(error: any) {
  const message = String(error?.message || error || "");
  return (
    error?.code === "SYNC_ALREADY_RUNNING" ||
    message.includes("SYNC_TASK_ALREADY_RUNNING") ||
    message.includes("is already running")
  );
}

function getRunningTaskTypesForSync(taskType: string, error?: any) {
  const message = String(error?.message || error || "");
  const taskTypes = new Set<string>([taskType]);

  if (taskType === SyncTaskType.SYNC_META_CREATIVES) {
    taskTypes.add(SyncTaskType.SYNC_META_STRUCTURE);
    taskTypes.add(SyncTaskType.SYNC_META_INSIGHTS);
  }

  if (taskType === SyncTaskType.SYNC_VIEW_AD_HIERARCHY) {
    taskTypes.add(SyncTaskType.SYNC_META_ACCOUNTS);
    taskTypes.add("sync_meta_activity");
    taskTypes.add(SyncTaskType.SYNC_META_STRUCTURE);
    taskTypes.add(SyncTaskType.SYNC_META_INSIGHTS);
  }

  if (taskType === SyncTaskType.SYNC_VIEW_AUDIENCE) {
    taskTypes.add(SyncTaskType.SYNC_META_AUDIENCE);
  }

  if (taskType === SyncTaskType.SYNC_VIEW_CREATIVES) {
    taskTypes.add(SyncTaskType.SYNC_META_STRUCTURE);
    taskTypes.add(SyncTaskType.SYNC_META_INSIGHTS);
  }

  if (taskType === SyncTaskType.SYNC_VIEW_ACCOUNT_DATA) {
    taskTypes.add(SyncTaskType.SYNC_META_ACCOUNTS);
    taskTypes.add("sync_meta_activity");
    taskTypes.add(SyncTaskType.SYNC_META_INSIGHTS);
    taskTypes.add(SyncTaskType.REFRESH_META_DATACENTER_LEDGER);
  }

  if (taskType === SyncTaskType.SYNC_VIEW_STORE_DATA || taskType === SyncTaskType.SYNC_VIEW_PRODUCTS) {
    taskTypes.add(SyncTaskType.SYNC_STORE_ORDERS);
    taskTypes.add(SyncTaskType.REFRESH_STORE_DATACENTER_LEDGER);
  }

  for (const candidate of Object.values(SyncTaskType)) {
    if (message.includes(candidate)) {
      taskTypes.add(candidate);
    }
  }

  return Array.from(taskTypes);
}

async function findRunningTask(taskTypes: string[]) {
  return prisma.syncLog.findFirst({
    where: {
      status: "running",
      taskType: { in: taskTypes }
    },
    orderBy: { startedAt: "desc" }
  });
}

async function markStaleRunningTasks(taskTypes: string[]) {
  const cutoff = dayjs().subtract(STALE_RUNNING_TASK_MINUTES, "minute").toDate();
  await prisma.syncLog.updateMany({
    where: {
      status: "running",
      taskType: { in: taskTypes },
      startedAt: { lt: cutoff }
    },
    data: {
      status: "failed",
      finishedAt: new Date(),
      error: "STALE_RUNNING_TASK_TIMEOUT",
      errorMessage: "STALE_RUNNING_TASK_TIMEOUT"
    }
  });
}

// ============================================================
// 📊 状态查询接口（保留，不删除）
// ============================================================

/**
 * GET /api/sync/status
 * 查询系统同步状态和健康指标
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
      detailMessage = "数据同步中：系统正在后台拉取最新报表并刷新数据中心事实账本。";
    } else if (stores.length === 0) {
      healthStatus = "partial_data";
      detailMessage = "未配置店铺：添加至少一个电商或 ERP 来源以计算 ROAS。";
    } else if (mappings.length === 0) {
      healthStatus = "partial_data";
      detailMessage = "缺少账号/店铺映射。系统将无法计算销售额与费用的实际 ROAS！";
    }

    res.json({
      healthStatus,
      detailMessage,
      metaConfigured: !!metaToken,
      storesCount: stores.length,
      mappingsCount: mappings.length,
      totalInsightsCount: totalInsights,
      activeSyncCount: runningTasks.length,
      runningTasksList: runningTasks.map(t => ({
        id: t.id,
        type: t.type,
        taskType: t.taskType,
        taskChainId: t.taskChainId
      })),
      dataSourceExplain: {
        primarySource: "FactMetaPerformance",
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to evaluate sync status",
      details: error.message
    });
  }
});

/**
 * GET /api/sync/logs
 * 获取任务执行日志
 */
router.get("/sync/logs", async (req, res) => {
  const { status, type, storeId, limit = 50 } = req.query;
  try {
    const whereClause: Record = {};
    if (status) whereClause.status = status;
    if (type) {
      whereClause.OR = [{ type }, { taskType: type }];
    }
    if (storeId) whereClause.storeId = Number(storeId);

    const logs = await prisma.syncLog.findMany({
      where: whereClause,
      orderBy: { startedAt: "desc" },
      take: parseInt(limit as string, 10)
    });

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to list sync logs",
      details: error.message
    });
  }
});

/**
 * GET /api/sync/chains
 * 按 chainId 分组查看任务执行链
 */
router.get("/sync/chains", async (req, res) => {
  try {
    const logs = await prisma.syncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 100
    });

    const chainsMap: Record = {};
    for (const log of logs) {
      const chainId = log.taskChainId || "independent";
      if (!chainsMap[chainId]) {
        chainsMap[chainId] = {
          chainId,
          startedAt: log.startedAt,
          finishedAt: log.finishedAt || null,
          status: "success",
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

    const chainsList = Object.values(chainsMap).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    res.json(chainsList);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to load grouped task chains",
      details: error.message
    });
  }
});

// ============================================================
// 🚀 唯一的统一同步入口
// ============================================================

/**
 * POST /api/sync/trigger
 * 
 * 统一的同步任务触发入口
 * 所有数据同步必须通过这个接口
 * 
 * 支持的任务类型：
 * - sync_meta_insights
 * - sync_meta_structure
 * - sync_meta_accounts
 * - sync_meta_audience
 * - sync_meta_creatives
 * - sync_store_orders
 * - refresh_store_datacenter_ledger
 * - refresh_meta_datacenter_ledger
 */
router.post("/sync/trigger", async (req, res) => {
  const {
    taskType,
    storeId,
    accountId,
    accountIds,
    startDate,
    endDate,
    days,
    limit,
    rebuild,
    baselineRevenue,
    includeUnmapped
  } = req.body as SyncTriggerRequest;

  // 生成唯一的 chainId
  const chainId = uuidv4();

  // 参数验证
  if (!taskType) {
    return res.status(400).json({
      success: false,
      error: "MISSING_TASK_TYPE",
      message: "taskType is required",
      validTypes: Object.values(SyncTaskType)
    });
  }

  // 校验 taskType 是否有效
  const validTaskTypes = Object.values(SyncTaskType);
  if (!validTaskTypes.includes(taskType)) {
    return res.status(400).json({
      success: false,
      error: "UNSUPPORTED_SYNC_TASK",
      message: `Unsupported sync task: ${taskType}`,
      validTypes: validTaskTypes
    });
  }

  try {
    console.log(`[Sync Trigger] Chain ${chainId} started with taskType: ${taskType}`);
    await assertNoRunningTask(getRunningTaskTypesForSync(taskType));

    // ============================================================
    // 前端安全任务（不需要 ENABLE_MANUAL_SYNC）
    // ============================================================

    const viewRunOptions = {
      parentChainId: chainId,
      parentViewTask: true,
      allowSameChainRunning: true
    };

    // View task audit strings: sync_view_ad_hierarchy, sync_view_audience, sync_view_creatives, sync_view_account_data, sync_view_store_data, sync_view_products.
    if (taskType === SyncTaskType.SYNC_VIEW_AD_HIERARCHY) {
      const daysVal = days ? parseInt(String(days), 10) : 30;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);
      const taskIds: string[] = [];

      const accountsTaskId = await SyncCenter.syncMetaAccounts(chainId, "frontend_view_sync", null, viewRunOptions);
      taskIds.push(accountsTaskId);
      const activityTaskId = await SyncCenter.syncMetaActivity(chainId, "frontend_view_sync", accountsTaskId, viewRunOptions);
      taskIds.push(activityTaskId);
      const structureTaskId = await SyncCenter.syncMetaStructure(
        chainId,
        "frontend_view_sync",
        activityTaskId,
        { accountId, accountIds, limit },
        viewRunOptions
      );
      taskIds.push(structureTaskId);

      const targets = await resolveSafeMetaTargets({ accountId, accountIds, limit });
      let lastTaskId: string | null = structureTaskId;
      for (const account of targets) {
        const taskId = await SyncCenter.syncMetaInsights(
          chainId,
          "frontend_view_sync",
          lastTaskId,
          range.days,
          account.fb_account_id,
          range.startDate,
          range.endDate,
          viewRunOptions
        );
        taskIds.push(taskId);
        lastTaskId = taskId;
      }

      const summary = await summarizeSyncLogs(taskIds);
      const limitReceipt = buildLimitReceipt(limit, targets.length);
      const status = deriveSyncStatus(summary);
      return res.json({
        success: true,
        status,
        message: status === "NO_NEW_DATA"
          ? "广告层级视图同步完成，但当前日期范围没有新的结构或成效事实数据。"
          : `广告层级视图同步完成：结构 + 成效事实已按 ${range.startDate} 至 ${range.endDate} 执行。`,
        chainId,
        taskType,
        taskIds,
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        targetAccountsCount: summary.targetAccountsCount || targets.length,
        failedAccounts: summary.failedAccounts,
        ...limitReceipt,
        ...buildProgress({
          currentStep: taskIds.length,
          totalSteps: Math.max(1, taskIds.length),
          stepLabel: "广告层级视图同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_VIEW_AUDIENCE) {
      const daysVal = days ? parseInt(String(days), 10) : 7;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);
      const targets = await resolveSafeMetaTargets({ accountId, accountIds, limit });
      const taskIds: string[] = [];
      let lastTaskId: string | null = null;

      for (const account of targets) {
        const taskId = await SyncCenter.syncMetaAudience(
          chainId,
          "frontend_view_sync",
          lastTaskId,
          range.days,
          account.fb_account_id,
          range.startDate,
          range.endDate,
          viewRunOptions
        );
        taskIds.push(taskId);
        lastTaskId = taskId;
      }

      const summary = await summarizeSyncLogs(taskIds);
      const limitReceipt = buildLimitReceipt(limit, targets.length);
      const metadataStatus = String(summary.metadataStatus || "").toUpperCase();
      const status =
        metadataStatus === "NO_NEW_DATA"
          ? "NO_NEW_DATA"
          : metadataStatus === "PARTIAL"
            ? "PARTIAL_SUCCESS"
            : deriveSyncStatus(summary);
      return res.json({
        success: true,
        status,
        message: summary.metadataMessage || "受众视图同步完成。",
        chainId,
        taskType,
        taskIds,
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        targetAccountsCount: summary.targetAccountsCount || targets.length,
        failedAccounts: status === "NO_NEW_DATA" ? [] : summary.failedAccounts,
        reason: summary.metadataReason || null,
        dimensionsRequested: summary.dimensionsRequested || ["country", "age", "gender", "publisher_platform"],
        dimensionsSynced: summary.dimensionsSynced || [],
        ...limitReceipt,
        ...buildProgress({
          currentStep: targets.length,
          totalSteps: Math.max(1, targets.length),
          stepLabel: "受众视图同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length,
          processedDimensions: Array.isArray(summary.dimensionsSynced) ? summary.dimensionsSynced.length : null,
          totalDimensions: Array.isArray(summary.dimensionsRequested) ? summary.dimensionsRequested.length : 4
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_VIEW_CREATIVES) {
      const daysVal = days ? parseInt(String(days), 10) : 30;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);
      const taskIds: string[] = [];
      const structureTaskId = await SyncCenter.syncMetaStructure(
        chainId,
        "frontend_view_sync",
        null,
        { accountId, accountIds, limit },
        viewRunOptions
      );
      taskIds.push(structureTaskId);
      const targets = await resolveSafeMetaTargets({ accountId, accountIds, limit });
      let lastTaskId: string | null = structureTaskId;
      for (const account of targets) {
        const taskId = await SyncCenter.syncMetaInsights(
          chainId,
          "frontend_view_sync",
          lastTaskId,
          range.days,
          account.fb_account_id,
          range.startDate,
          range.endDate,
          viewRunOptions
        );
        taskIds.push(taskId);
        lastTaskId = taskId;
      }
      const summary = await summarizeSyncLogs(taskIds);
      const limitReceipt = buildLimitReceipt(limit, targets.length);
      return res.json({
        success: true,
        status: deriveSyncStatus(summary),
        message: "素材视图同步完成：已执行素材结构和 ad-level 成效事实链路。",
        chainId,
        taskType,
        taskIds,
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        targetAccountsCount: summary.targetAccountsCount || targets.length,
        failedAccounts: summary.failedAccounts,
        ...limitReceipt,
        ...buildProgress({
          currentStep: taskIds.length,
          totalSteps: Math.max(1, taskIds.length),
          stepLabel: "素材视图同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_VIEW_ACCOUNT_DATA) {
      const daysVal = days ? parseInt(String(days), 10) : 30;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);
      const taskIds: string[] = [];
      const accountsTaskId = await SyncCenter.syncMetaAccounts(chainId, "frontend_view_sync", null, viewRunOptions);
      taskIds.push(accountsTaskId);
      const activityTaskId = await SyncCenter.syncMetaActivity(chainId, "frontend_view_sync", accountsTaskId, viewRunOptions);
      taskIds.push(activityTaskId);
      const targets = await resolveSafeMetaTargets({ accountId, accountIds, limit });
      let lastTaskId: string | null = activityTaskId;
      for (const account of targets) {
        const taskId = await SyncCenter.syncMetaInsights(
          chainId,
          "frontend_view_sync",
          lastTaskId,
          range.days,
          account.fb_account_id,
          range.startDate,
          range.endDate,
          viewRunOptions
        );
        taskIds.push(taskId);
        lastTaskId = taskId;
      }
      const ledgerAccountIds = targets.map(account => normalizeMetaAccountId(account.fb_account_id));
      const ledgerResult = await refreshMetaDataCenterLedger({
        storeId: storeId ? Number(storeId) : null,
        accountIds: ledgerAccountIds,
        startDate: range.startDate,
        endDate: range.endDate,
        includeUnmapped: includeUnmapped === false || includeUnmapped === "false" ? false : true
      });
      const summary = await summarizeSyncLogs(taskIds);
      const limitReceipt = buildLimitReceipt(limit, targets.length);
      return res.json({
        success: true,
        status: deriveSyncStatus(summary),
        message: "账户表现视图同步完成：Meta 账户、成效事实与账户 ledger 已串联执行。",
        chainId,
        taskType,
        taskIds,
        recordsFetched: summary.recordsFetched + Number(ledgerResult.recordsFetched || 0),
        recordsSaved: summary.recordsSaved + Number(ledgerResult.recordsSaved || 0),
        recordsUpdated: summary.recordsUpdated + Number(ledgerResult.recordsUpdated || 0),
        targetAccountsCount: summary.targetAccountsCount || targets.length,
        failedAccounts: summary.failedAccounts || ledgerResult.failedAccounts || [],
        ledger: ledgerResult,
        ...limitReceipt,
        ...buildProgress({
          currentStep: taskIds.length + 1,
          totalSteps: Math.max(1, taskIds.length + 1),
          stepLabel: "账户表现视图同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_VIEW_STORE_DATA || taskType === SyncTaskType.SYNC_VIEW_PRODUCTS) {
      const daysVal = days ? parseInt(String(days), 10) : 30;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);
      const targets = await resolveSafeStoreTargets({ storeId, limit });
      const taskIds: string[] = [];
      let lastTaskId: string | null = null;
      const ledgers: any[] = [];

      for (const store of targets) {
        const taskId = await SyncCenter.syncStoreOrders(
          store.id,
          chainId,
          "frontend_view_sync",
          lastTaskId,
          range.days,
          range.startDate,
          range.endDate,
          {
            baselineRevenue: baselineRevenue !== undefined ? parseFloat(String(baselineRevenue)) : undefined,
            rebuild: rebuild === true || rebuild === "true"
          }
        );
        taskIds.push(taskId);
        lastTaskId = taskId;
        ledgers.push(await refreshStoreDataCenterLedger({
          storeId: store.id,
          startDate: range.startDate,
          endDate: range.endDate
        }));
      }

      const summary = await summarizeSyncLogs(taskIds);
      const ledgerRecordsSaved = ledgers.reduce((sum, item) => sum + Number(item.recordsSaved || item.snapshots?.length || 0), 0);
      return res.json({
        success: true,
        status: deriveSyncStatus(summary),
        message: taskType === SyncTaskType.SYNC_VIEW_PRODUCTS
          ? "商品视图同步完成：店铺订单与店铺 ledger 已串联执行。"
          : "店铺视图同步完成：店铺订单与店铺 ledger 已串联执行。",
        chainId,
        taskType,
        taskIds,
        targetStores: targets.map(store => ({ id: store.id, name: store.name, platform: store.platform, mode: store.mode })),
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved + ledgerRecordsSaved,
        recordsUpdated: summary.recordsUpdated,
        failedAccounts: summary.failedAccounts,
        ledgers,
        ...buildProgress({
          currentStep: taskIds.length + ledgers.length,
          totalSteps: Math.max(1, taskIds.length + ledgers.length),
          stepLabel: "店铺视图同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_META_INSIGHTS) {
      const daysVal = days ? parseInt(String(days), 10) : 7;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);

      const targets = await resolveSafeMetaTargets({
        accountId,
        accountIds,
        limit
      });

      let lastTaskId: string | null = null;
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
      }

      const summary = await summarizeSyncLogs(taskIds);
      const limitReceipt = buildLimitReceipt(limit, targets.length);
      const status = deriveSyncStatus(summary);
      return res.json({
        success: true,
        status,
        message:
          status === "NO_NEW_DATA"
            ? `同步完成，但 Meta API 在当前日期范围没有返回新的广告表现数据。已检查 ${targets.length} 个安全范围内账户。`
            : `同步完成：已检查 ${targets.length} 个账户，拉取 ${summary.recordsFetched} 条 Meta 表现记录，写入 ${summary.recordsSaved} 条，更新 ${summary.recordsUpdated} 条事实记录。`,
        chainId,
        taskType,
        taskIds,
        targetAccounts: targets.map(account => ({
          accountId: account.fb_account_id,
          name: account.fb_account_name,
          storeId: account.storeId || null
        })),
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        failedAccounts: summary.failedAccounts,
        ...limitReceipt,
        ...buildProgress({
          currentStep: targets.length,
          totalSteps: Math.max(1, targets.length),
          stepLabel: "Meta 广告成效同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_STORE_ORDERS) {
      const daysVal = days ? parseInt(String(days), 10) : 30;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);

      const targets = await resolveSafeStoreTargets({ storeId, limit });

      let lastTaskId: string | null = null;
      const taskIds: string[] = [];

      for (const store of targets) {
        const taskId = await SyncCenter.syncStoreOrders(
          store.id,
          chainId,
          "frontend_safe_sync",
          lastTaskId,
          range.days,
          range.startDate,
          range.endDate,
          {
            baselineRevenue: baselineRevenue !== undefined ? parseFloat(String(baselineRevenue)) : undefined,
            rebuild: rebuild === true || rebuild === "true"
          }
        );
        taskIds.push(taskId);
        lastTaskId = taskId;
      }

      const summary = await summarizeSyncLogs(taskIds);
      const status = deriveSyncStatus(summary);
      return res.json({
        success: true,
        status,
        message:
          status === "NO_NEW_DATA"
            ? `同步完成，但店铺 API 在当前日期范围没有返回新的订单数据。已检查 ${targets.length} 个可同步店铺。`
            : `同步完成：已检查 ${targets.length} 个店铺，拉取 ${summary.recordsFetched} 条订单记录，写入 ${summary.recordsSaved} 条，更新 ${summary.recordsUpdated} 条订单事实。`,
        chainId,
        taskType,
        taskIds,
        targetStores: targets.map(store => ({
          id: store.id,
          name: store.name,
          platform: store.platform,
          mode: store.mode
        })),
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        failedAccounts: summary.failedAccounts,
        ...buildProgress({
          currentStep: targets.length,
          totalSteps: Math.max(1, targets.length),
          stepLabel: "店铺订单同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_META_STRUCTURE) {
      const taskId = await SyncCenter.syncMetaStructure(
        chainId,
        "frontend_safe_sync",
        null,
        {
          accountId,
          accountIds,
              limit
    }
      );

      const log = await prisma.syncLog.findUnique({ where: { id: taskId } });

      const summary = await summarizeSyncLogs([taskId]);
      const limitReceipt = buildLimitReceipt(limit, summary.targetAccountsCount || 0);
      const recordsFetched = summary.recordsFetched || log?.recordsFetched || 0;
      const recordsSaved = summary.recordsSaved || log?.recordsSaved || 0;
      const status = deriveSyncStatus(summary);

      return res.json({
        success: true,
        status,
        message:
          status === "NO_NEW_DATA"
            ? "Meta 广告结构同步完成，但当前目标账户没有返回新的 Campaign / AdSet / Ad / Creative 结构数据。"
            : `Meta 广告结构同步完成：拉取 ${recordsFetched} 条结构记录，写入/更新 ${recordsSaved} 条。`,
        chainId,
        taskType,
        taskIds: [taskId],
        recordsFetched,
        recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        failedAccounts: summary.failedAccounts,
        ...limitReceipt,
        ...buildProgress({
          currentStep: 1,
          totalSteps: 1,
          stepLabel: "Meta 广告结构同步完成",
          processedAccounts: summary.targetAccountsCount || null,
          totalAccounts: summary.targetAccountsCount || null
        }),
        startDate: startDate || null,
        endDate: endDate || null
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_META_CREATIVES) {
      const daysVal = days ? parseInt(String(days), 10) : 30;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);

      // Creative intelligence depends on:
      // 1. Meta structure: Campaign / AdSet / Ad / AdCreative
      // 2. Ad-level performance: FactMetaPerformance level='ad'
      const structureTaskId = await SyncCenter.syncMetaStructure(
        chainId,
        "frontend_safe_sync",
        null,
        {
          accountId,
          accountIds,
          limit
        }
      );

      const targets = await resolveSafeMetaTargets({
        accountId,
        accountIds,
        limit
      });

      let lastTaskId: string | null = structureTaskId;
      const taskIds: string[] = [structureTaskId];

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
      }

      const summary = await summarizeSyncLogs(taskIds);
      const limitReceipt = buildLimitReceipt(limit, targets.length);
      const status = deriveSyncStatus(summary);

      return res.json({
        success: true,
        status,
        message:
          status === "NO_NEW_DATA"
            ? "创意素材链路同步完成，但当前目标账户没有返回新的广告结构或 Ad Level 成效数据。"
            : `创意素材链路同步完成：已同步广告结构与 Ad Level 成效，处理 ${targets.length} 个账户，期间 ${range.startDate} 到 ${range.endDate}。`,
        chainId,
        taskType,
        taskIds,
        targetAccounts: targets.map(account => ({
          accountId: account.fb_account_id,
          name: account.fb_account_name,
          storeId: account.storeId || null
        })),
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        targetAccountsCount: summary.targetAccountsCount || targets.length,
        failedAccounts: summary.failedAccounts,
        ...limitReceipt,
        ...buildProgress({
          currentStep: 2 + targets.length,
          totalSteps: 2 + targets.length,
          stepLabel: "素材结构与广告成效同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_META_ACCOUNTS) {
      const taskId = await SyncCenter.syncMetaAccounts(chainId, "frontend_safe_sync");
      const activityTaskId = await SyncCenter.syncMetaActivity(chainId, "frontend_safe_sync", taskId);
      const taskIds = [taskId, activityTaskId];
      const summary = await summarizeSyncLogs(taskIds);
      return res.json({
        success: true,
        status: "SUCCESS",
        message: "成功同步并更新 Meta 客户及有效广告账户状态 (AdAccount)。",
        chainId,
        taskType,
        taskIds,
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        targetAccountsCount: summary.targetAccountsCount,
        failedAccounts: summary.failedAccounts,
        ...buildProgress({
          currentStep: 2,
          totalSteps: 2,
          stepLabel: "Meta 账户列表与活跃状态同步完成",
          processedAccounts: summary.targetAccountsCount ?? null,
          totalAccounts: summary.targetAccountsCount ?? null
        }),
        startDate: startDate || null,
        endDate: endDate || null
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_META_AUDIENCE) {
      const daysVal = days ? parseInt(String(days), 10) : 7;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);

      const targets = await resolveSafeMetaTargets({
        accountId,
        accountIds,
        limit
      });

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

      const summary = await summarizeSyncLogs(taskIds);
      const limitReceipt = buildLimitReceipt(limit, targets.length);
      const metadataStatus = String(summary.metadataStatus || "").toUpperCase();
      const status =
        metadataStatus === "NO_NEW_DATA"
          ? "NO_NEW_DATA"
          : metadataStatus === "PARTIAL"
            ? "PARTIAL_SUCCESS"
            : deriveSyncStatus(summary);
      const message =
        status === "NO_NEW_DATA"
          ? summary.metadataMessage || "Meta API 当前日期范围未返回受众 breakdown 数据。"
          : status === "PARTIAL_SUCCESS"
            ? summary.metadataMessage || "部分账户受众 breakdown 同步失败。"
            : `成功完成受众与渠道细分数据同步（已处理 ${targets.length} 个账户，期间: ${range.startDate} 到 ${range.endDate}）。`;

      return res.json({
        success: true,
        status,
        message,
        chainId,
        taskType,
        taskIds,
        recordsFetched: summary.recordsFetched,
        recordsSaved: summary.recordsSaved,
        recordsUpdated: summary.recordsUpdated,
        targetAccountsCount: summary.targetAccountsCount || targets.length,
        failedAccounts: status === "NO_NEW_DATA" ? [] : summary.failedAccounts,
        reason: summary.metadataReason || null,
        dimensionsRequested: summary.dimensionsRequested || ["country", "age", "gender", "publisher_platform"],
        dimensionsSynced: summary.dimensionsSynced || [],
        ...limitReceipt,
        ...buildProgress({
          currentStep: targets.length,
          totalSteps: Math.max(1, targets.length),
          stepLabel:
            status === "NO_NEW_DATA"
              ? "受众拆分同步完成，无新增数据"
              : "受众拆分同步完成",
          processedAccounts: targets.length,
          totalAccounts: targets.length,
          processedDimensions: Array.isArray(summary.dimensionsSynced) ? summary.dimensionsSynced.length : null,
          totalDimensions: Array.isArray(summary.dimensionsRequested) ? summary.dimensionsRequested.length : 4
        }),
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    // ============================================================
    // 数据中心账本刷新任务
    // ============================================================

    if (taskType === SyncTaskType.REFRESH_STORE_DATACENTER_LEDGER) {
      if (!storeId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: "MISSING_PARAMS",
          message: "storeId, startDate, endDate are required for this task"
        });
      }

      const result = await refreshStoreDataCenterLedger({
        storeId: Number(storeId),
        startDate,
        endDate
      });

      const orderCount = result.snapshots?.reduce(
        (s: number, r: any) => s + Number(r.orderCount || 0),
        0
      ) || 0;
      const grossSales = Number(
        (
          result.snapshots?.reduce(
            (s: number, r: any) => s + Number(r.grossSales || 0),
            0
          ) || 0
        ).toFixed(2)
      );

      return res.json({
        success: true,
        status: "SUCCESS",
        message: `店铺数据中心账本刷新完成 (订单数: ${orderCount}, 销售额: $${grossSales})`,
        chainId,
        taskType,
        orderCount,
        grossSales,
        snapshotsCount: result.snapshots?.length || 0,
        recordsFetched: orderCount,
        recordsSaved: result.snapshots?.length || 0,
        recordsUpdated: 0,
        ...buildProgress({
          currentStep: 1,
          totalSteps: 1,
          stepLabel: "店铺数据中心账本刷新完成"
        }),
        startDate,
        endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.REFRESH_META_DATACENTER_LEDGER) {
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: "MISSING_PARAMS",
          message: "startDate, endDate are required for this task"
        });
      }

      const metaLedgerAccountIds = [
        accountId,
        ...(Array.isArray(accountIds) ? accountIds : [])
      ]
        .filter(Boolean)
        .map(id => normalizeMetaAccountId(String(id)))
        .filter((id, index, arr) => id && arr.indexOf(id) === index);

      const result = await refreshMetaDataCenterLedger({
        storeId: storeId ? Number(storeId) : null,
        accountIds: metaLedgerAccountIds.length > 0 ? metaLedgerAccountIds : undefined,
        startDate,
        endDate,
        includeUnmapped: includeUnmapped === true || includeUnmapped === "true"
      });

      const recordsFetched = result.recordsFetched || 0;
      const recordsSaved = result.recordsSaved || 0;
      const recordsUpdated = result.recordsUpdated || 0;
      const status =
        recordsFetched === 0 && recordsSaved === 0 && recordsUpdated === 0
          ? "NO_NEW_DATA"
          : "SUCCESS";

      return res.json({
        success: true,
        status,
        message:
          status === "NO_NEW_DATA"
            ? "Meta 数据中心账本刷新完成，但当前目标账户和日期范围没有返回新的账户数据。"
            : `Meta 数据中心账本刷新完成：拉取 ${recordsFetched} 条，写入/更新 ${recordsSaved} 条。`,
        chainId,
        taskType,
        targetAccounts: metaLedgerAccountIds,
        targetAccountsCount: metaLedgerAccountIds.length,
        recordsFetched,
        recordsSaved,
        recordsUpdated,
        failedAccounts: result.failedAccounts || [],
        taskIds: [],
        ...buildProgress({
          currentStep: 1,
          totalSteps: 1,
          stepLabel: "Meta 数据中心账本刷新完成",
          processedAccounts: metaLedgerAccountIds.length,
          totalAccounts: metaLedgerAccountIds.length
        }),
        startDate,
        endDate,
        ...result
      } as SyncTriggerResponse);
      }

    return res.status(400).json({
      success: false,
      error: "UNSUPPORTED_SYNC_TASK",
      message: `Unsupported taskType: ${taskType}`
    });

  } catch (error: any) {
    console.error(`[Sync Trigger] Chain ${chainId} failed:`, error);

    const statusCode = error?.statusCode || 500;
    if (statusCode === 409 || isSyncAlreadyRunningError(error)) {
      const runningTask = error?.runningTask || await findRunningTask(getRunningTaskTypesForSync(taskType, error));
      return res.status(409).json({
        success: false,
        status: "RUNNING",
        error: "SYNC_ALREADY_RUNNING",
        message: "已有同步任务正在运行，请等待当前任务结束后再试。",
        chainId,
        taskType,
        runningTask: runningTask ? {
          id: runningTask.id,
          taskType: runningTask.taskType || runningTask.type || "unknown",
          taskChainId: runningTask.taskChainId,
          startedAt: runningTask.startedAt
        } : null,
        ...buildProgress({
          currentStep: 1,
          totalSteps: 1,
          stepLabel: "已有同步任务正在运行"
        }),
        progressPercent: 15,
        startDate: startDate || null,
        endDate: endDate || null
      } as SyncTriggerResponse);
    }

    return res.status(statusCode).json({
      success: false,
      status: "FAILED",
      error: error?.code || "SYNC_TRIGGER_FAILED",
      message: error?.message || String(error),
      chainId,
      taskType,
      runningTask: error?.runningTask || null
    } as SyncTriggerResponse);
  }
});

// ============================================================
// ❌ 已弃用的旧接口 — 统一返回 410 Gone
// ============================================================

const DEPRECATED_SYNC_ENDPOINTS = [
  { method: "post", path: "/sync/rebuild" },
  { method: "post", path: "/sync" },
  { method: "post", path: "/sync-store" },
  { method: "post", path: "/sync/stores/:storeId/orders" },
  { method: "post", path: "/sync/stores/orders" },
  { method: "post", path: "/sync/meta-audience-breakdown" },
  { method: "post", path: "/sync/rebuild-store-ledger" },
  { method: "post", path: "/sync/rebuild-meta-ledger" },
  { method: "post", path: "/sync/store-realtime" },
  { method: "post", path: "/sync/meta-realtime" },
  { method: "post", path: "/sync/data-center/refresh-store" },
  { method: "post", path: "/sync/data-center/refresh-meta" },
  { method: "post", path: "/summary/stores/rebuild" },
  { method: "get",  path: "/sync/stores/:storeId/reconcile" }
];

for (const endpoint of DEPRECATED_SYNC_ENDPOINTS) {
  (router as any)[endpoint.method](endpoint.path, (_req: any, res: any) => {
    res.status(410).json({
      error: "DEPRECATED_ENDPOINT",
      statusCode: 410,
      message: "This endpoint has been permanently removed. Please use POST /api/sync/trigger instead.",
      timestamp: new Date().toISOString(),
      migratedTo: "POST /api/sync/trigger",
      migrationGuide: {
        "/sync": "POST /api/sync/trigger { taskType: 'sync_meta_insights' }",
        "/sync-store": "POST /api/sync/trigger { taskType: 'sync_store_orders' }",
        "/sync/stores/:storeId/orders": "POST /api/sync/trigger { taskType: 'sync_store_orders', storeId }",
        "/sync/stores/orders": "POST /api/sync/trigger { taskType: 'sync_store_orders' } (for all stores)",
        "/sync/meta-audience-breakdown": "POST /api/sync/trigger { taskType: 'sync_meta_audience' }",
        "/sync/rebuild-store-ledger": "POST /api/sync/trigger { taskType: 'refresh_store_datacenter_ledger' }",
        "/sync/rebuild-meta-ledger": "POST /api/sync/trigger { taskType: 'refresh_meta_datacenter_ledger' }",
        "/sync/store-realtime": "POST /api/sync/trigger { taskType: 'sync_store_orders' }",
        "/sync/meta-realtime": "POST /api/sync/trigger { taskType: 'sync_meta_insights' }",
        "/sync/data-center/refresh-store": "POST /api/sync/trigger { taskType: 'refresh_store_datacenter_ledger' }",
        "/sync/data-center/refresh-meta": "POST /api/sync/trigger { taskType: 'refresh_meta_datacenter_ledger' }",
        "/summary/stores/rebuild": "POST /api/sync/trigger { taskType: 'refresh_store_datacenter_ledger', storeId, startDate, endDate }",
        "/sync/stores/:storeId/reconcile": "GET /api/data-center/stores/:storeId/reconciliation"
      },
      documentationUrl: "https://github.com/newbie5522/meta-mcp2.0/wiki/Sync-API-Migration"
    });
  });
}

// ============================================================
// 🛠️ 工具函数
// ============================================================

async function assertNoRunningTask(taskTypes: string[]) {
  await markStaleRunningTasks(taskTypes);
  const running = await findRunningTask(taskTypes);

  if (running) {
    const taskName = running.taskType || running.type || "unknown";
    const error: any = new Error(
      `已有同步任务正在运行：${taskName} (${running.id})。请等待当前任务结束后再试。`
    );
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
    .map(id => normalizeMetaAccountId(String(id)))
    .filter((id, index, arr) => id && arr.indexOf(id) === index);

  const take =
    input.limit !== undefined && input.limit !== null
      ? Math.max(1, Math.min(parseInt(String(input.limit), 10) || 1, 50))
      : undefined;

  if (requested.length > 0) {
    const accounts = await prisma.adAccount.findMany({
      where: {
        fb_account_id: { in: requested },
        OR: [
          { storeId: null },
          { store: { mode: { not: "sandbox" } } }
        ]
      },
      include: { store: true },
      orderBy: { updatedAt: "desc" },
      ...(take ? { take } : {})
    });

    if (accounts.length === 0) {
      const error: any = new Error(
        "未找到可同步的已落库 Meta 广告账户，或该账户属于 sandbox / 不可同步范围。请先在配置中心拉取账户并确认账户状态。"
      );
      error.statusCode = 404;
      error.code = "ACCOUNT_NOT_FOUND";
      throw error;
    }

    return accounts;
  }

  const targets = await prisma.adAccount.findMany({
    where: {
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

  if (targets.length === 0) {
    const error: any = new Error("没有符合安全同步范围的广告账户。");
    error.statusCode = 400;
    error.code = "NO_SYNC_TARGETS";
    throw error;
  }

  return targets;
}

async function resolveSafeStoreTargets(input: {
  storeId?: string | number | null;
  limit?: number;
}) {
  if (input.storeId) {
    const id = parseInt(String(input.storeId), 10);
    if (!Number.isFinite(id) || Number.isNaN(id)) {
      const error: any = new Error("storeId 必须为有效数字。");
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
      const error: any = new Error(
        "This store mode is not production or API token empty."
      );
      error.statusCode = 400;
      error.code = "STORE_NOT_SYNCABLE";
      throw error;
    }
    return [store];
  }

  const stores = await prisma.store.findMany({
    where: { mode: { in: ["production", "生产"] } },
    orderBy: { updatedAt: "desc" }
  });

  const targets = stores.filter(isProductionSyncableStore);

  if (targets.length === 0) {
    const error: any = new Error(
      "No production store with API token config available to sync."
    );
    error.statusCode = 400;
    error.code = "NO_SYNCABLE_STORES";
    throw error;
  }

  return targets;
}

function isProductionSyncableStore(store: any): boolean {
  const isProd =
    store?.mode === "production" || store?.mode === "生产";
  return isProd && hasStoreToken(store);
}

function hasStoreToken(store: any): boolean {
  return Boolean(
    store?.shopline_token ||
    store?.shopify_token ||
    store?.shoplazza_token
  );
}

function boundedDateRange(
  startDate: any,
  endDate: any,
  fallbackDays: number,
  maxDays: number
) {
  const end =
    endDate && dayjs(String(endDate)).isValid()
      ? dayjs(String(endDate))
      : dayjs();
  const fallbackStart = end.subtract(Math.max(1, fallbackDays) - 1, "day");
  let start =
    startDate && dayjs(String(startDate)).isValid()
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

export default router;
