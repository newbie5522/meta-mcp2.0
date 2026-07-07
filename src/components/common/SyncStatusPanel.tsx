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
  startedAt?: string | null;
  finishedAt?: string | null;
};

export function SyncStatusPanel({ status }: { status: SyncPanelStatus }) {
  if (!status || status.status === "idle") return null;

  const title =
    status.status === "running" ? "同步中" :
    status.status === "success" ? "同步完成" :
    status.status === "partial_success" ? "部分同步完成" :
    status.status === "no_new_data" ? "同步完成，但没有新数据" :
    status.status === "error" ? "同步失败" :
    "同步状态";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm space-y-1">
      <div className="font-bold text-slate-900">{title}</div>
      {status.message && <div>{status.message}</div>}
      {status.chainId && <div className="font-mono text-slate-400">chainId: {status.chainId}</div>}
      {Array.isArray(status.taskIds) && status.taskIds.length > 0 && (
        <div className="font-mono text-slate-400">taskIds: {status.taskIds.join(", ")}</div>
      )}
      {(status.recordsFetched !== null || status.recordsSaved !== null || status.recordsUpdated !== null) && (
        <div className="font-mono text-slate-400">
          fetched: {status.recordsFetched ?? "--"} / saved: {status.recordsSaved ?? "--"} / updated: {status.recordsUpdated ?? "--"}
        </div>
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
