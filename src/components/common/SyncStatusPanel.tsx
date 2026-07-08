import React from "react";

export type SyncPanelStatus = {
  status: "idle" | "running" | "success" | "no_new_data" | "partial_success" | "error";
  message?: string;
  chainId?: string | null;
  taskIds?: string[] | null;
  recordsFetched?: number | null;
  recordsSaved?: number | null;
  recordsUpdated?: number | null;
  targetAccountsCount?: number | null;
  failedAccounts?: Array<any> | null;
  runningTask?: {
    id?: string | null;
    taskType?: string | null;
    taskChainId?: string | null;
    startedAt?: string | null;
  } | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  progressPercent?: number | null;
  currentStep?: number | null;
  totalSteps?: number | null;
  stepLabel?: string | null;
  processedAccounts?: number | null;
  totalAccounts?: number | null;
  processedDimensions?: number | null;
  totalDimensions?: number | null;
};

export function SyncStatusPanel({ status }: { status: SyncPanelStatus }) {
  if (!status || status.status === "idle") return null;

  const title =
    status.status === "running" ? "同步任务正在运行" :
    status.status === "success" ? "同步完成" :
    status.status === "partial_success" ? "部分同步完成" :
    status.status === "no_new_data" ? "同步完成，但没有新数据" :
    status.status === "error" ? "同步失败" :
    "同步状态";

  const hasCounters =
    status.recordsFetched !== null && status.recordsFetched !== undefined ||
    status.recordsSaved !== null && status.recordsSaved !== undefined ||
    status.recordsUpdated !== null && status.recordsUpdated !== undefined;
  const percent =
    typeof status.progressPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(status.progressPercent)))
      : status.status === "running"
        ? 10
        : status.status === "success" || status.status === "no_new_data" || status.status === "partial_success"
          ? 100
          : null;

  const hasStep =
    status.currentStep !== null &&
    status.currentStep !== undefined &&
    status.totalSteps !== null &&
    status.totalSteps !== undefined;
  const hasAccountProgress =
    status.processedAccounts !== null &&
    status.processedAccounts !== undefined &&
    status.totalAccounts !== null &&
    status.totalAccounts !== undefined;
  const hasDimensionProgress =
    status.processedDimensions !== null &&
    status.processedDimensions !== undefined &&
    status.totalDimensions !== null &&
    status.totalDimensions !== undefined;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm space-y-1">
      <div className="font-bold text-slate-900">{title}</div>
      {status.message && <div>{status.message}</div>}
      {percent !== null && (
        <div className="space-y-1 pt-1">
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>{status.stepLabel || "同步进度"}</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
      {status.chainId && <div className="font-mono text-slate-400">chainId: {status.chainId}</div>}
      {status.runningTask && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2 font-mono text-[11px] text-slate-500 space-y-0.5">
          <div>runningTask: {status.runningTask.taskType || "unknown"}</div>
          {status.runningTask.id && <div>taskId: {status.runningTask.id}</div>}
          {status.runningTask.startedAt && <div>startedAt: {String(status.runningTask.startedAt)}</div>}
        </div>
      )}
      {Array.isArray(status.taskIds) && status.taskIds.length > 0 && (
        <div className="font-mono text-slate-400">taskIds: {status.taskIds.join(", ")}</div>
      )}
      {hasCounters && (
        <div className="font-mono text-slate-400">
          fetched: {status.recordsFetched ?? "--"} / saved: {status.recordsSaved ?? "--"} / updated: {status.recordsUpdated ?? "--"}
        </div>
      )}
      {hasStep && (
        <div className="font-mono text-slate-400">step: {status.currentStep}/{status.totalSteps}</div>
      )}
      {hasAccountProgress && (
        <div className="font-mono text-slate-400">accounts: {status.processedAccounts}/{status.totalAccounts}</div>
      )}
      {hasDimensionProgress && (
        <div className="font-mono text-slate-400">dimensions: {status.processedDimensions}/{status.totalDimensions}</div>
      )}
      {status.targetAccountsCount !== null && status.targetAccountsCount !== undefined && (
        <div className="font-mono text-slate-400">targetAccounts: {status.targetAccountsCount}</div>
      )}
      {Array.isArray(status.failedAccounts) && status.failedAccounts.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold text-rose-700">
            失败账户 {status.failedAccounts.length} 个
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-rose-50 p-2 text-[10px] text-rose-800">
            {JSON.stringify(status.failedAccounts.slice(0, 10), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
