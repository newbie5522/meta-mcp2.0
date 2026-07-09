import React from "react";

export type SyncPanelStatus = {
  status: "idle" | "running" | "success" | "warning" | "no_new_data" | "partial_success" | "error";
  message?: string;
  chainId?: string | null;
  taskType?: string | null;
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
  const [showDetails, setShowDetails] = React.useState(false);

  if (!status || status.status === "idle") return null;

  const title =
    status.status === "running" ? "同步任务正在运行" :
    status.status === "success" ? "同步完成" :
    status.status === "warning" ? "部分同步完成" :
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
          : status.status === "warning"
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
  const hasTechnicalDetails = Boolean(
    status.chainId ||
      status.taskType ||
      (Array.isArray(status.taskIds) && status.taskIds.length > 0) ||
      status.runningTask ||
      (Array.isArray(status.failedAccounts) && status.failedAccounts.length > 0)
  );

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
      {hasCounters && (
        <div className="text-slate-500">
          拉取 {status.recordsFetched ?? "--"} / 写入 {status.recordsSaved ?? "--"} / 更新 {status.recordsUpdated ?? "--"}
        </div>
      )}
      {hasStep && (
        <div className="text-slate-500">步骤：{status.currentStep}/{status.totalSteps}</div>
      )}
      {hasAccountProgress && (
        <div className="text-slate-500">账户：{status.processedAccounts}/{status.totalAccounts}</div>
      )}
      {hasDimensionProgress && (
        <div className="text-slate-500">维度：{status.processedDimensions}/{status.totalDimensions}</div>
      )}
      {status.targetAccountsCount !== null && status.targetAccountsCount !== undefined && (
        <div className="text-slate-500">目标账户：{status.targetAccountsCount}</div>
      )}
      {hasTechnicalDetails ? (
        <div className="pt-1">
          <button
            type="button"
            className="text-xs text-slate-400 underline"
            onClick={() => setShowDetails((value) => !value)}
          >
            {showDetails ? "隐藏技术详情" : "查看技术详情"}
          </button>
        </div>
      ) : null}
      {showDetails ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-950 p-3 text-[11px] text-slate-100">
            {JSON.stringify({
              chainId: status.chainId,
              taskType: status.taskType,
              taskIds: status.taskIds,
              runningTask: status.runningTask,
              failedAccounts: status.failedAccounts
            }, null, 2)}
          </pre>
      ) : null}
    </div>
  );
}
