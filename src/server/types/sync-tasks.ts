// src/server/types/sync-tasks.ts
// ============================================
// 统一的同步任务类型定义
// ============================================

/**
 * 所有允许的同步任务类型
 * 前端必须通过 POST /api/sync/trigger 使用这些类型
 */
export enum SyncTaskType {
  // Meta 账户数据同步
  SYNC_META_INSIGHTS = 'sync_meta_insights',
  SYNC_META_STRUCTURE = 'sync_meta_structure',
  SYNC_META_ACCOUNTS = 'sync_meta_accounts',
  SYNC_META_AUDIENCE = 'sync_meta_audience',
  SYNC_META_CREATIVES = 'sync_meta_creatives',

  // 店铺订单数据同步
  SYNC_STORE_ORDERS = 'sync_store_orders',

  // 数据中心账本刷新
  REFRESH_STORE_DATACENTER_LEDGER = 'refresh_store_datacenter_ledger',
  REFRESH_META_DATACENTER_LEDGER = 'refresh_meta_datacenter_ledger',

  // Data center view-level atomic sync chains
  SYNC_VIEW_AD_HIERARCHY = 'sync_view_ad_hierarchy',
  SYNC_VIEW_AUDIENCE = 'sync_view_audience',
  SYNC_VIEW_CREATIVES = 'sync_view_creatives',
  SYNC_VIEW_ACCOUNT_DATA = 'sync_view_account_data',
  SYNC_VIEW_STORE_DATA = 'sync_view_store_data',
  SYNC_VIEW_PRODUCTS = 'sync_view_products'
}

export type CanonicalSyncStatus = "SUCCESS" | "NO_NEW_DATA" | "PARTIAL_SUCCESS" | "FAILED";

export interface SyncExecutionResult {
  recordsFetched: number;
  recordsSaved: number;
  recordsUpdated: number;
  failedAccounts: unknown[];
  failedSlices: unknown[];
  truncated: boolean;
  coverageComplete: boolean;
  status: CanonicalSyncStatus;
}

export function deriveCanonicalSyncStatus(input: {
  recordsFetched?: number;
  recordsSaved?: number;
  recordsUpdated?: number;
  failedAccounts?: unknown[];
  failedSlices?: unknown[];
  truncated?: boolean;
}): CanonicalSyncStatus {
  const hasRecords =
    Number(input.recordsFetched || 0) > 0 ||
    Number(input.recordsSaved || 0) > 0 ||
    Number(input.recordsUpdated || 0) > 0;
  const hasFailure =
    Boolean(input.truncated) ||
    Boolean(input.failedAccounts?.length) ||
    Boolean(input.failedSlices?.length);

  if (hasFailure) return hasRecords ? "PARTIAL_SUCCESS" : "FAILED";
  return hasRecords ? "SUCCESS" : "NO_NEW_DATA";
}

export function normalizeSyncExecutionResult(
  input: Partial<SyncExecutionResult> & Pick<SyncExecutionResult, "recordsFetched" | "recordsSaved">
): SyncExecutionResult {
  const failedAccounts = Array.isArray(input.failedAccounts) ? input.failedAccounts : [];
  const failedSlices = Array.isArray(input.failedSlices) ? input.failedSlices : [];
  const truncated = Boolean(input.truncated);
  const result = {
    recordsFetched: Number(input.recordsFetched || 0),
    recordsSaved: Number(input.recordsSaved || 0),
    recordsUpdated: Number(input.recordsUpdated || 0),
    failedAccounts,
    failedSlices,
    truncated,
    coverageComplete: input.coverageComplete !== false && !truncated && failedAccounts.length === 0 && failedSlices.length === 0
  };
  return {
    ...result,
    status: deriveCanonicalSyncStatus(result)
  };
}

/**
 * 前端请求体结构
 */
export interface SyncTriggerRequest {
  // 任务类型（必填）
  taskType: SyncTaskType;
  
  // 日期范围参数
  startDate?: string;
  endDate?: string;
  days?: number;
  
  // Meta 账户参数
  accountId?: string;
  accountIds?: string[];
  
  // 店铺参数
  storeId?: number | string;
  
  // 其他选项
  limit?: number;
  rebuild?: boolean;
  includeUnmapped?: boolean;
  baselineRevenue?: number;
}

/**
 * 前端响应体结构
 */
export interface SyncTriggerResponse {
  success: boolean;
  status?: 'started' | 'NO_NEW_DATA' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  message: string;
  chainId: string; // 统一的 chainId，用于追踪
  taskType: SyncTaskType;
  taskIds?: string[];
  error?: string;
  runningTask?: any;
  
  // 可选的统计数据
  recordsFetched?: number;
  recordsSaved?: number;
  targetAccounts?: any[];
  targetStores?: any[];
}
