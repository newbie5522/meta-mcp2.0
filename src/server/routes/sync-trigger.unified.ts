/**
 * src/server/routes/sync-trigger.unified.ts
 * ============================================
 * 统一的同步触发路由 - 合并原有的两个 /api/sync/trigger 处理器
 * 
 * 修复项：
 * - P0-001：删除双重路由注册冲突
 * - P0-002：添加原子性竞态条件锁
 * - 权限检查：区分管理员任务与安全任务
 */

import { Router, Request, Response } from "express";
import prisma from "../../db/index.js";
import { SyncCenter } from "../services/sync-center.service.js";
import dayjs from "dayjs";

const router = Router();

// ============ 配置项 ============
const ENABLE_MANUAL_SYNC = process.env.ENABLE_MANUAL_SYNC === "true";

// 前端安全访问的任务类型 - 自动限制范围和日期
const SAFE_TASK_TYPES = new Set([
  "sync_meta_insights",
  "sync_store_orders",
  "sync_meta_structure",
  "sync_meta_accounts",
  "sync_meta_audience",
  "sync_meta_creatives",
  "run_ai_rule_monitor",
  "rebuild_roas_summary",
  "rebuild_store_summary"
]);

// 管理员专用任务类型 - 需要 ENABLE_MANUAL_SYNC=true
const ADMIN_TASK_TYPES = new Set([
  "rebuild_all",
  "force_rebuild",
  "cleanup_old_facts",
  "repair_ledger",
  "sync_meta_audience_admin"
]);

// ============ 权限检查中间件 ============
function isManualSyncEnabled(): boolean {
  return ENABLE_MANUAL_SYNC;
}

// ============ 竞态条件安全锁管理 ============
export class SyncLockManager {
  /**
   * 原子性获取同步锁 - 使用数据库事务防止竞态条件
   * 
   * 防护原理：
   * 1. 在事务内进行原子性检查
   * 2. 使用数据库唯一约束保证最多一个运行中的同类型任务
   */
  static async acquireLock(
    taskType: string,
    chainId: string,
    conflictingTypes?: string[]
  ): Promise<{ lockId: string; acquired: boolean }> {
    const typesList = [taskType, ...(conflictingTypes || [])];

    try {
      return await prisma.$transaction(async (tx) => {
        // Step 1：在事务内检查是否有同类型任务运行
        const running = await tx.syncLog.findFirst({
          where: {
            status: "running",
            taskType: { in: typesList }
          },
          orderBy: { startedAt: "desc" }
        });

        if (running) {
          const err: any = new Error(
            `Task ${running.taskType} already running since ${running.startedAt}`
          );
          err.statusCode = 409;
          err.code = "SYNC_ALREADY_RUNNING";
          err.runningTask = {
            id: running.id,
            taskType: running.taskType,
            taskChainId: running.taskChainId,
            startedAt: running.startedAt
          };
          throw err;
        }

        // Step 2：原子性创建锁记录（依赖数据库唯一约束）
        const lockId = `lock-${chainId}-${taskType}-${Date.now()}`;
        const lock = await tx.syncLog.create({
          data: {
            id: lockId,
            taskChainId: chainId,
            taskType,
            type: "sync_lock",
            status: "running",
            startedAt: new Date(),
            recordsFetched: 0,
            recordsSaved: 0
          }
        });

        return { lockId: lock.id, acquired: true };
      });
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * 释放锁（标记为成功）
   */
  static async releaseLock(lockId: string): Promise<void> {
    await prisma.syncLog.update({
      where: { id: lockId },
      data: {
        status: "success",
        finishedAt: new Date()
      }
    });
  }

  /**
   * 标记锁失败
   */
  static async failLock(lockId: string, error: string): Promise<void> {
    await prisma.syncLog.update({
      where: { id: lockId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error,
        errorMessage: error
      }
    });
  }
}

// ============ 参数验证 ============
interface SyncTriggerRequest {
  taskType: string;
  storeId?: string | number | null;
  accountId?: string | null;
  accountIds?: string[];
  startDate?: string;
  endDate?: string;
  days?: number;
  limit?: number;
  rebuild?: boolean;
  baselineRevenue?: number;
}

function validateRequest(body: any): {
  valid: boolean;
  error?: string;
  data?: SyncTriggerRequest;
} {
  const { taskType } = body;

  if (!taskType || typeof taskType !== "string") {
    return {
      valid: false,
      error: "taskType is required and must be a string"
    };
  }

  const isSafeTask = SAFE_TASK_TYPES.has(taskType);
  const isAdminTask = ADMIN_TASK_TYPES.has(taskType);

  if (!isSafeTask && !isAdminTask) {
    return {
      valid: false,
      error: `Unknown taskType "${taskType}". Valid: ${Array.from(SAFE_TASK_TYPES)
        .concat(Array.from(ADMIN_TASK_TYPES))
        .join(", ")}`
    };
  }

  return { valid: true, data: body as SyncTriggerRequest };
}

// ============ 统一的 POST /api/sync/trigger 路由 ============
/**
 * 统一同步触发入口
 * 
 * 请求体示例：
 * {
 *   "taskType": "sync_meta_insights",
 *   "accountIds": ["123456789", "987654321"],
 *   "days": 7
 * }
 * 
 * 或：
 * {
 *   "taskType": "sync_store_orders",
 *   "storeId": 1,
 *   "startDate": "2024-01-01",
 *   "endDate": "2024-01-31"
 * }
 */
router.post("/trigger", async (req: Request, res: Response) => {
  try {
    // Step 1：验证请求
    const validation = validateRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: "INVALID_REQUEST",
        message: validation.error
      });
    }

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
      baselineRevenue
    } = validation.data!;

    const isSafeTask = SAFE_TASK_TYPES.has(taskType);
    const isAdminTask = ADMIN_TASK_TYPES.has(taskType);

    // Step 2：权限检查 - 管理员任务需要特殊权限
    if (isAdminTask && !isManualSyncEnabled()) {
      return res.status(403).json({
        success: false,
        error: "MANUAL_SYNC_DISABLED",
        message: `Admin task "${taskType}" requires ENABLE_MANUAL_SYNC=true in environment`
      });
    }

    // Step 3：生成任务链ID
    const chainId = `sync-${isSafeTask ? "safe" : "admin"}-${Math.random()
      .toString(36)
      .substring(2, 8)}-${Date.now()}`;

    // Step 4：获取同步锁
    let lockId: string;
    try {
      const lockResult = await SyncLockManager.acquireLock(taskType, chainId);
      lockId = lockResult.lockId;
    } catch (lockError: any) {
      if (lockError.statusCode === 409) {
        return res.status(409).json({
          success: false,
          error: lockError.code,
          message: lockError.message,
          runningTask: lockError.runningTask
        });
      }
      throw lockError;
    }

    // Step 5：后台异步执行任务（不阻塞响应）
    handleSyncTaskExecution({
      taskType,
      chainId,
      lockId,
      storeId,
      accountId,
      accountIds,
      startDate,
      endDate,
      days,
      limit,
      rebuild,
      baselineRevenue
    }).catch(async (error: any) => {
      console.error(`[SyncTrigger] Task ${chainId} failed:`, error);
      try {
        await SyncLockManager.failLock(lockId, error.message);
      } catch (e) {
        console.error(`[SyncTrigger] Failed to update lock status:`, e);
      }
    });

    // Step 6：立即返回任务信息（异步执行）
    return res.json({
      success: true,
      taskChainId: chainId,
      taskType,
      message: `${taskType} started in background`,
      estimatedTime: `${getEstimatedDuration(taskType)} seconds`
    });
  } catch (error: any) {
    console.error("[SyncTrigger] Unhandled error:", error);
    return res.status(500).json({
      success: false,
      error: "SYNC_TRIGGER_ERROR",
      message: error?.message || "Unknown error"
    });
  }
});

// ============ 实际同步执行处理器（后台异步运行） ============
async function handleSyncTaskExecution(options: {
  taskType: string;
  chainId: string;
  lockId: string;
  storeId?: string | number | null;
  accountId?: string | null;
  accountIds?: string[];
  startDate?: string;
  endDate?: string;
  days?: number;
  limit?: number;
  rebuild?: boolean;
  baselineRevenue?: number;
}) {
  const {
    taskType,
    chainId,
    lockId,
    storeId,
    accountId,
    accountIds,
    startDate,
    endDate,
    days = 7,
    limit,
    rebuild,
    baselineRevenue
  } = options;

  try {
    console.log(
      `[SyncExecution] Starting ${taskType} with chain ${chainId}`
    );

    // 任务路由映射 - 统一在此处理所有 taskType
    let result: any;

    switch (taskType) {
      case "sync_meta_insights":
        result = await SyncCenter.syncMetaInsightsForActiveAccounts(
          chainId,
          "manual_trigger",
          null,
          days,
          accountId,
          startDate,
          endDate,
          limit
        );
        break;

      case "sync_store_orders":
        result = await SyncCenter.syncStoreOrdersForTargets(
          chainId,
          "manual_trigger",
          null,
          days,
          storeId,
          startDate,
          endDate,
          limit,
          rebuild,
          baselineRevenue
        );
        break;

      case "sync_meta_structure":
        result = await SyncCenter.syncMetaStructure(chainId, "manual_trigger", null);
        break;

      case "sync_meta_accounts":
        result = await SyncCenter.syncMetaAccounts(chainId, "manual_trigger", null);
        break;

      case "sync_meta_audience":
        result = await SyncCenter.syncMetaAudience(
          chainId,
          "manual_trigger",
          null,
          days,
          accountId
        );
        break;

      case "sync_meta_creatives":
        result = await SyncCenter.syncMetaCreatives(
          chainId,
          "manual_trigger",
          null,
          days
        );
        break;

      case "run_ai_rule_monitor":
        result = await SyncCenter.runAiRuleMonitor(chainId, "manual_trigger", null);
        break;

      case "rebuild_roas_summary":
        result = await SyncCenter.rebuildRoasSummary(
          chainId,
          "manual_trigger",
          null,
          days
        );
        break;

      case "rebuild_store_summary":
        result = await SyncCenter.rebuildStoreSummary(
          chainId,
          "manual_trigger",
          null,
          days
        );
        break;

      case "rebuild_all":
        result = await SyncCenter.rebuildAll(chainId, "manual_trigger");
        break;

      default:
        throw new Error(`No handler for taskType: ${taskType}`);
    }

    console.log(
      `[SyncExecution] Task ${taskType} completed successfully for chain ${chainId}`,
      result
    );

    // 标记锁为成功
    await SyncLockManager.releaseLock(lockId);

    return result;
  } catch (error: any) {
    console.error(
      `[SyncExecution] Task ${taskType} failed for chain ${chainId}:`,
      error
    );
    throw error;
  }
}

// ============ 任务预估时长 ============
function getEstimatedDuration(taskType: string): number {
  const durations: Record<string, number> = {
    sync_meta_insights: 60,
    sync_store_orders: 120,
    sync_meta_structure: 90,
    sync_meta_accounts: 45,
    sync_meta_audience: 180,
    sync_meta_creatives: 150,
    run_ai_rule_monitor: 30,
    rebuild_roas_summary: 120,
    rebuild_store_summary: 90,
    rebuild_all: 300
  };
  return durations[taskType] || 60;
}

export default router;
export { SyncLockManager };
