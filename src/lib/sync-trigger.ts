export type SyncTaskPayload = {
  taskType: string;
  storeId?: string | number | null;
  accountId?: string | null;
  accountIds?: string[];
  startDate?: string;
  endDate?: string;
  days?: number;
  limit?: number;
  rebuild?: boolean;
  includeUnmapped?: boolean;
  baselineRevenue?: number;
};

export type SyncTaskResponse = {
  success: boolean;
  status?: string;
  message?: string;
  chainId?: string;
  taskType?: string;
  taskIds?: string[];
  recordsFetched?: number;
  recordsSaved?: number;
  recordsUpdated?: number;
  targetAccountsCount?: number;
  failedAccounts?: any[];
  requestedLimit?: number | null;
  appliedLimit?: number | null;
  error?: string;
  details?: string;
  runningTask?: any;
  targetAccounts?: any[];
  targetStores?: any[];
  [key: string]: any;
};

export async function triggerSyncTask(
  payload: SyncTaskPayload
): Promise<SyncTaskResponse> {
  const response = await fetch("/api/sync/trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.success === false) {
    const msg =
      data?.message ||
      data?.details ||
      data?.error ||
      `HTTP ${response.status}`;

    const error: any = new Error(msg);
    error.response = data;
    error.data = data;
    error.status = response.status;
    throw error;
  }

  return data;
}

export function formatSyncReceipt(data: SyncTaskResponse): string {
  const fetched = data.recordsFetched ?? "--";
  const saved = data.recordsSaved ?? "--";
  const updated = data.recordsUpdated ?? "--";
  const targetAccounts = data.targetAccountsCount ?? "--";
  const status = data.status || "SUCCESS";

  if (status === "NO_NEW_DATA") {
    return `同步完成，但当前日期范围没有新数据。目标账户 ${targetAccounts} 个，拉取 ${fetched} 条，写入 ${saved} 条。`;
  }

  const parts = [
    data.message || `同步完成：目标账户 ${targetAccounts} 个，拉取 ${fetched} 条，写入 ${saved} 条，更新 ${updated} 条。`,
    status ? `状态: ${status}` : "",
    data.chainId ? `chainId: ${data.chainId}` : "",
    Array.isArray(data.taskIds) && data.taskIds.length > 0
      ? `taskIds: ${data.taskIds.join(", ")}`
      : "",
    data.recordsFetched !== undefined
      ? `fetched: ${data.recordsFetched}`
      : "",
    data.recordsSaved !== undefined
      ? `saved: ${data.recordsSaved}`
      : "",
    data.recordsUpdated !== undefined
      ? `updated: ${data.recordsUpdated}`
      : ""
  ].filter(Boolean);

  return parts.join(" | ");
}

export function getSyncErrorMessage(error: any): string {
  const data = error?.data || error?.response;

  return (
    data?.message ||
    data?.details ||
    data?.error ||
    error?.message ||
    "同步请求失败"
  );
}

export function mapSyncResultToPanel(data: SyncTaskResponse) {
  const rawStatus = String(data?.status || "").toUpperCase();

  return {
    status:
      rawStatus === "NO_NEW_DATA" ? "no_new_data" as const :
      rawStatus === "PARTIAL_SUCCESS" ? "partial_success" as const :
      "success" as const,
    message: formatSyncReceipt(data),
    chainId: data.chainId || null,
    taskIds: data.taskIds || null,
    recordsFetched: data.recordsFetched ?? null,
    recordsSaved: data.recordsSaved ?? null,
    recordsUpdated: data.recordsUpdated ?? null,
    targetAccountsCount: data.targetAccountsCount ?? null,
    failedAccounts: data.failedAccounts || null
  };
}

export function mapSyncErrorToPanel(error: any) {
  const data = error?.data || error?.response || {};
  return {
    status: data.status === "RUNNING" ? "running" as const : "error" as const,
    message: getSyncErrorMessage(error),
    chainId: data.chainId || data.runningTask?.taskChainId || null,
    taskIds: data.runningTask?.id ? [data.runningTask.id] : null,
    recordsFetched: null,
    recordsSaved: null,
    recordsUpdated: null,
    targetAccountsCount: null,
    failedAccounts: data.failedAccounts || null
  };
}
