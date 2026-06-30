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
      detailMessage = "数据同步中：系统正在后台拉取最新报表并重建底层汇总表。";
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
 * - sync_store_orders
 * - run_ai_rule_monitor
 * - rebuild_store_summary
 * - rebuild_meta_summary
 * - rebuild_roas_summary
 * - rebuild_dashboard_summary
 * - refresh_store_datacenter_ledger
 * - refresh_meta_datacenter_ledger
 * - rebuild_all
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
      error: "INVALID_TASK_TYPE",
      message: `Invalid taskType: ${taskType}`,
      validTypes: validTaskTypes
    });
  }

  try {
    console.log(`[Sync Trigger] Chain ${chainId} started with taskType: ${taskType}`);

    // ============================================================
    // 前端安全任务（不需要 ENABLE_MANUAL_SYNC）
    // ============================================================

    if (taskType === SyncTaskType.SYNC_META_INSIGHTS) {
      const daysVal = days ? parseInt(String(days), 10) : 7;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);

      const targets = await resolveSafeMetaTargets({
        accountId,
        accountIds,
        limit
      });

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
      const metaSummaryTaskId = await SyncCenter.rebuildMetaSummary(
        chainId,
        "frontend_safe_sync",
        lastTaskId,
        summaryDays
      );
      const roasTaskId2 = await SyncCenter.rebuildRoasSummary(
        chainId,
        "frontend_safe_sync",
        metaSummaryTaskId,
        summaryDays
      );
      await SyncCenter.rebuildDashboardSummary(
        chainId,
        "frontend_safe_sync",
        roasTaskId2,
        summaryDays
      );

      const status = recordsFetched === 0 && recordsSaved === 0 ? "NO_NEW_DATA" : "SUCCESS";
      return res.json({
        success: true,
        status,
        message:
          status === "NO_NEW_DATA"
            ? `同步完成，但 Meta API 在当前日期范围没有返回新的广告表现数据。已检查 ${targets.length} 个安全范围内账户。`
            : `同步完成：已检查 ${targets.length} 个账户，拉取 ${recordsFetched} 条 Meta 表现记录，写入/更新 ${recordsSaved} 条事实记录。`,
        chainId,
        taskType,
        taskIds,
        targetAccounts: targets.map(account => ({
          accountId: account.fb_account_id,
          name: account.fb_account_name,
          storeId: account.storeId || null
        })),
        recordsFetched,
        recordsSaved,
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_STORE_ORDERS) {
      const daysVal = days ? parseInt(String(days), 10) : 30;
      const range = boundedDateRange(startDate, endDate, daysVal, 3650);

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
          range.endDate,
          {
            baselineRevenue: baselineRevenue !== undefined ? parseFloat(String(baselineRevenue)) : undefined,
            rebuild: rebuild === true || rebuild === "true"
          }
        );
        taskIds.push(taskId);
        lastTaskId = taskId;

        const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
        recordsFetched += log?.recordsFetched || 0;
        recordsSaved += log?.recordsSaved || 0;
      }

      const summaryDays = range.days;
      const storeSummaryTaskId = await SyncCenter.rebuildStoreSummary(
        chainId,
        "frontend_safe_sync",
        lastTaskId,
        summaryDays
      );
      const roasTaskId1 = await SyncCenter.rebuildRoasSummary(
        chainId,
        "frontend_safe_sync",
        storeSummaryTaskId,
        summaryDays
      );
      await SyncCenter.rebuildDashboardSummary(
        chainId,
        "frontend_safe_sync",
        roasTaskId1,
        summaryDays
      );

      const status = recordsFetched === 0 && recordsSaved === 0 ? "NO_NEW_DATA" : "SUCCESS";
      return res.json({
        success: true,
        status,
        message:
          status === "NO_NEW_DATA"
            ? `同步完成，但店铺 API 在当前日期范围没有返回新的订单数据。已检查 ${targets.length} 个可同步店铺。`
            : `同步完成：已检查 ${targets.length} 个店铺，拉取 ${recordsFetched} 条订单记录，写入/更新 ${recordsSaved} 条订单事实。`,
        chainId,
        taskType,
        taskIds,
        targetStores: targets.map(store => ({
          id: store.id,
          name: store.name,
          platform: store.platform,
          mode: store.mode
        })),
        recordsFetched,
        recordsSaved,
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

      const recordsFetched = log?.recordsFetched || 0;
      const recordsSaved = log?.recordsSaved || 0;
      const status = recordsFetched === 0 && recordsSaved === 0 ? "NO_NEW_DATA" : "SUCCESS";

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
        recordsSaved
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
      let recordsFetched = 0;
      let recordsSaved = 0;
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

        const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
        recordsFetched += log?.recordsFetched || 0;
        recordsSaved += log?.recordsSaved || 0;
      }

      return res.json({
        success: true,
        status: "SUCCESS",
        message: `创意素材链路同步完成：已同步广告结构与 Ad Level 成效，处理 ${targets.length} 个账户，期间 ${range.startDate} 到 ${range.endDate}。`,
        chainId,
        taskType,
        taskIds,
        targetAccounts: targets.map(account => ({
          accountId: account.fb_account_id,
          name: account.fb_account_name,
          storeId: account.storeId || null
        })),
        recordsFetched,
        recordsSaved,
        startDate: range.startDate,
        endDate: range.endDate
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.SYNC_META_ACCOUNTS) {
      const taskId = await SyncCenter.syncMetaAccounts(chainId, "frontend_safe_sync");
      await SyncCenter.syncMetaActivity(chainId, "frontend_safe_sync", taskId);
      return res.json({
        success: true,
        status: "SUCCESS",
        message: "成功同步并更新 Meta 客户及有效广告账户状态 (AdAccount)。",
        chainId,
        taskType,
        taskIds: [taskId]
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

      return res.json({
        success: true,
        status: "SUCCESS",
        message: `成功完成受众与渠道细分数据同步（已处理 ${targets.length} 个账户，期间: ${range.startDate} 到 ${range.endDate}）。`,
        chainId,
        taskType,
        taskIds
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.RUN_AI_RULE_MONITOR) {
      const taskId = await SyncCenter.runAiRuleMonitor(chainId, "frontend_safe_sync");
      return res.json({
        success: true,
        status: "SUCCESS",
        message: "AI风控系统体检扫描运行完毕，已重新计算并更新各账户的诊断卡片。",
        chainId,
        taskType,
        taskIds: [taskId]
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.REBUILD_ROAS_SUMMARY) {
      const summaryDays = days ? parseInt(String(days), 10) : 90;
      const taskId = await SyncCenter.rebuildRoasSummary(
        chainId,
        "frontend_safe_sync",
        null,
        summaryDays
      );
      await SyncCenter.rebuildDashboardSummary(chainId, "frontend_safe_sync", taskId, summaryDays);
      return res.json({
        success: true,
        status: "SUCCESS",
        message: `销售额/开销 ROAS 映射汇总表重新对准成功（对齐窗口: 过去 ${summaryDays} 天）。`,
        chainId,
        taskType,
        taskIds: [taskId]
      } as SyncTriggerResponse);
    }

    // ============================================================
    // 需要 ENABLE_MANUAL_SYNC 的高危任务
    // ============================================================

    if (!isManualSyncEnabled()) {
      return res.status(403).json({
        success: false,
        error: "MANUAL_SYNC_DISABLED",
        message: "This operation requires ENABLE_MANUAL_SYNC=true"
      });
    }

    if (taskType === SyncTaskType.REBUILD_STORE_SUMMARY) {
      const summaryDays = days ? parseInt(String(days), 10) : 90;
      const taskId = await SyncCenter.rebuildStoreSummary(
        chainId,
        "manual_trigger",
        null,
        summaryDays
      );
      await SyncCenter.rebuildDashboardSummary(chainId, "manual_trigger", taskId, summaryDays);
      return res.json({
        success: true,
        status: "SUCCESS",
        message: `店铺汇总表重新构建完毕（回溯窗口: 过去 ${summaryDays} 天）。`,
        chainId,
        taskType,
        taskIds: [taskId]
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.REBUILD_META_SUMMARY) {
      const summaryDays = days ? parseInt(String(days), 10) : 90;
      const taskId = await SyncCenter.rebuildMetaSummary(
        chainId,
        "manual_trigger",
        null,
        summaryDays
      );
      await SyncCenter.rebuildDashboardSummary(chainId, "manual_trigger", taskId, summaryDays);
      return res.json({
        success: true,
        status: "SUCCESS",
        message: `Meta 广告汇总表重新构建完毕（回溯窗口: 过去 ${summaryDays} 天）。`,
        chainId,
        taskType,
        taskIds: [taskId]
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.REBUILD_DASHBOARD_SUMMARY) {
      const summaryDays = days ? parseInt(String(days), 10) : 90;
      const taskId = await SyncCenter.rebuildDashboardSummary(
        chainId,
        "manual_trigger",
        null,
        summaryDays
      );
      return res.json({
        success: true,
        status: "SUCCESS",
        message: `看板聚合层重新构建完毕（回溯窗口: 过去 ${summaryDays} 天）。`,
        chainId,
        taskType,
        taskIds: [taskId]
      } as SyncTriggerResponse);
    }

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
        snapshotsCount: result.snapshots?.length || 0
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

      return res.json({
        success: true,
        status: "SUCCESS",
        message: `Meta 数据中心账本刷新完成`,
        chainId,
        taskType,
        ...result
      } as SyncTriggerResponse);
    }

    if (taskType === SyncTaskType.REBUILD_ALL) {
      const summaryDays = days ? parseInt(String(days), 10) : 90;

      const id1 = await SyncCenter.rebuildStoreSummary(
        chainId,
        "rebuild_btn",
        null,
        summaryDays
      );
      const id2 = await SyncCenter.rebuildMetaSummary(
        chainId,
        "rebuild_btn",
        id1,
        summaryDays
      );
      const id3 = await SyncCenter.rebuildRoasSummary(
        chainId,
        "rebuild_btn",
        id2,
        summaryDays
      );
      const id4 = await SyncCenter.rebuildDashboardSummary(
        chainId,
        "rebuild_btn",
        id3,
        summaryDays
      );
      await SyncCenter.runAiRuleMonitor(chainId, "rebuild_btn", id4);

      return res.json({
        success: true,
        status: "SUCCESS",
        message: `正在后台重建过去 ${summaryDays} 天所有店铺与广告链条的每日交易数、汇总开销、以及各店铺对齐 ROAS 和 AI 风控卡片。`,
        chainId,
        taskType,
        taskIds: [id1, id2, id3, id4]
      } as SyncTriggerResponse);
    }

    return res.status(400).json({
      success: false,
      error: "UNSUPPORTED_TASK_TYPE",
      message: `Unsupported taskType: ${taskType}`
    });

  } catch (error: any) {
    console.error(`[Sync Trigger] Chain ${chainId} failed:`, error);

    const statusCode = error?.statusCode || 500;
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
        "/sync/rebuild": "POST /api/sync/trigger { taskType: 'rebuild_all' }",
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
        "/summary/stores/rebuild": "POST /api/sync/trigger { taskType: 'rebuild_store_summary' }",
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
  const running = await prisma.syncLog.findFirst({
    where: {
      status: "running",
      taskType: { in: taskTypes }
    },
    orderBy: { startedAt: "desc" }
  });

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
