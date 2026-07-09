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
  const status = String(data.status || "SUCCESS").toUpperCase();

  if (status === "RUNNING" || data.error === "SYNC_ALREADY_RUNNING") {
    return data.message || "已有同步任务正在运行，请稍后刷新查看。";
  }

  if (status === "NO_NEW_DATA" || status === "NO_NEW_DATA_OR_FAILED") {
    return data.message || `同步完成，但当前日期范围没有新数据。目标账户 ${targetAccounts} 个，拉取 ${fetched} 条，写入 ${saved} 条。`;
  }

  if (status === "PARTIAL_SUCCESS" || status === "PARTIAL") {
    return data.message || `同步部分完成：目标账户 ${targetAccounts} 个，拉取 ${fetched} 条，写入 ${saved} 条。`;
  }

  const parts = [
    data.message || `同步完成：目标账户 ${targetAccounts} 个，拉取 ${fetched} 条，写入 ${saved} 条，更新 ${updated} 条。`,
    data.recordsFetched !== undefined ? `拉取 ${data.recordsFetched}` : "",
    data.recordsSaved !== undefined ? `写入 ${data.recordsSaved}` : "",
    data.recordsUpdated !== undefined ? `更新 ${data.recordsUpdated}` : ""
  ].filter(Boolean);

  return parts.join(" | ");
}

export function getSyncErrorMessage(error: any): string {
  const data = error?.data || error?.response;
  const normalized = String(data?.status || data?.error || data?.code || "").toUpperCase();

  if (normalized === "RUNNING" || normalized === "SYNC_ALREADY_RUNNING") {
    return data?.message || "已有同步任务正在运行，请稍后刷新查看。";
  }

  return (
    data?.message ||
    data?.details ||
    data?.error ||
    error?.message ||
    "同步请求失败"
  );
}

function normalizePanelStatus(raw?: string) {
  const value = String(raw || "").toUpperCase();
  if (value === "SUCCESS") return "success" as const;
  if (value === "NO_NEW_DATA" || value === "NO_NEW_DATA_OR_FAILED") return "success" as const;
  if (value === "PARTIAL" || value === "PARTIAL_SUCCESS") return "warning" as const;
  if (value === "RUNNING" || value === "SYNC_ALREADY_RUNNING") return "running" as const;
  if (value === "FAILED" || value === "ERROR") return "error" as const;
  return "success" as const;
}

export function mapSyncResultToPanel(data: SyncTaskResponse) {
  const rawStatus = String(data?.status || data?.error || "").toUpperCase();
  const normalizedStatus = normalizePanelStatus(rawStatus);
  const fallbackPercent =
    normalizedStatus === "running" ? 15 :
    ["success", "warning"].includes(normalizedStatus) ? 100 :
    normalizedStatus === "error" ? 0 : null;

  return {
    status: normalizedStatus,
    message: formatSyncReceipt(data),
    chainId: data.chainId || null,
    taskIds: data.taskIds || null,
    recordsFetched: data.recordsFetched ?? null,
    recordsSaved: data.recordsSaved ?? null,
    recordsUpdated: data.recordsUpdated ?? null,
    targetAccountsCount: data.targetAccountsCount ?? null,
    failedAccounts: data.failedAccounts || null,
    runningTask: data.runningTask || null,
    progressPercent: data.progressPercent ?? fallbackPercent,
    currentStep: data.currentStep ?? null,
    totalSteps: data.totalSteps ?? null,
    stepLabel: data.stepLabel ?? null,
    processedAccounts: data.processedAccounts ?? null,
    totalAccounts: data.totalAccounts ?? data.targetAccountsCount ?? null,
    processedDimensions: data.processedDimensions ?? null,
    totalDimensions: data.totalDimensions ?? null,
    startedAt: data.startedAt ?? null,
    finishedAt: data.finishedAt ?? null
  };
}

export function mapSyncErrorToPanel(error: any) {
  const data = error?.response?.data || error?.data || error?.response || {};
  const code = data?.error || data?.code;
  const message = String(data?.message || error?.message || "");
  const normalized = String(data?.status || code || "").toUpperCase();
  const isRunning =
    error?.response?.status === 409 ||
    error?.status === 409 ||
    normalized === "RUNNING" ||
    normalized === "SYNC_ALREADY_RUNNING" ||
    message.includes("SYNC_ALREADY_RUNNING") ||
    message.includes("already running") ||
    message.includes("正在运行");

  if (isRunning) {
    return {
      status: "running" as const,
      message: data?.message || "已有同步任务正在运行，请等待当前任务完成。",
      chainId: data.chainId || data.runningTask?.taskChainId || null,
      taskIds: data.runningTask?.id ? [data.runningTask.id] : null,
      runningTask: data.runningTask || null,
      recordsFetched: null,
      recordsSaved: null,
      recordsUpdated: null,
      targetAccountsCount: null,
      failedAccounts: data.failedAccounts || null,
      progressPercent: data.progressPercent ?? 15,
      currentStep: data.currentStep ?? 1,
      totalSteps: data.totalSteps ?? 1,
      stepLabel: data.stepLabel || "已有同步任务正在运行",
      processedAccounts: data.processedAccounts ?? null,
      totalAccounts: data.totalAccounts ?? data.targetAccountsCount ?? null,
      processedDimensions: data.processedDimensions ?? null,
      totalDimensions: data.totalDimensions ?? null,
      startedAt: data.startedAt ?? null,
      finishedAt: data.finishedAt ?? null
    };
  }

  return {
    status: "error" as const,
    message: getSyncErrorMessage(error),
    chainId: data.chainId || data.runningTask?.taskChainId || null,
    taskIds: data.runningTask?.id ? [data.runningTask.id] : null,
    runningTask: data.runningTask || null,
    recordsFetched: null,
    recordsSaved: null,
    recordsUpdated: null,
    targetAccountsCount: null,
    failedAccounts: data.failedAccounts || null,
    progressPercent: data.progressPercent ?? 0,
    currentStep: data.currentStep ?? null,
    totalSteps: data.totalSteps ?? null,
    stepLabel: data.stepLabel ?? "同步失败",
    processedAccounts: data.processedAccounts ?? null,
    totalAccounts: data.totalAccounts ?? data.targetAccountsCount ?? null,
    processedDimensions: data.processedDimensions ?? null,
    totalDimensions: data.totalDimensions ?? null,
    startedAt: data.startedAt ?? null,
    finishedAt: data.finishedAt ?? null
  };
}
