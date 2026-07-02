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
  REFRESH_META_DATACENTER_LEDGER = 'refresh_meta_datacenter_ledger'
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
  status?: 'started' | 'NO_NEW_DATA' | 'SUCCESS' | 'FAILED';
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
