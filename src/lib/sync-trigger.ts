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
    error.status = response.status;
    throw error;
  }

  return data;
}

export function formatSyncReceipt(data: SyncTaskResponse): string {
  const parts = [
    data.message || "任务完成",
    data.status ? `状态: ${data.status}` : "",
    data.chainId ? `chainId: ${data.chainId}` : "",
    Array.isArray(data.taskIds) && data.taskIds.length > 0
      ? `taskIds: ${data.taskIds.join(", ")}`
      : "",
    data.recordsFetched !== undefined
      ? `fetched: ${data.recordsFetched}`
      : "",
    data.recordsSaved !== undefined
      ? `saved: ${data.recordsSaved}`
      : ""
  ].filter(Boolean);

  return parts.join(" | ");
}

export function getSyncErrorMessage(error: any): string {
  const data = error?.response;

  return (
    data?.message ||
    data?.details ||
    data?.error ||
    error?.message ||
    "同步请求失败"
  );
}
