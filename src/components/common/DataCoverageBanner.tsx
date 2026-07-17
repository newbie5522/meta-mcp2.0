import React from "react";

export function coverageClass(status: string) {
  switch (status) {
    case "ERROR":
      return "border-red-200 bg-red-50 text-red-800";
    case "PARTIAL_COVERAGE":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "TRUE_EMPTY":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "SYNC_RUNNING":
    case "NOT_SYNCED":
    default:
      return "border-blue-200 bg-blue-50 text-blue-800";
  }
}

export function DataCoverageBanner({ coverage }: { coverage?: any }) {
  if (!coverage?.status) return null;
  const showCurrentDayNotice = Boolean(coverage.currentDayInProgress && coverage.asOfTime);
  if (coverage.status === "READY" && !showCurrentDayNotice) return null;

  const latest = coverage.latestAvailableDate || "未知";
  const requestedEnd = coverage.requestedEndDate || "当前截止日";
  const copy: Record<string, string> = {
    READY: "当前周期数据已覆盖。",
    PARTIAL_COVERAGE: `请求截止 ${requestedEnd}，当前事实只覆盖至 ${latest}`,
    NOT_SYNCED: `当前周期尚未同步，数据最新至 ${latest}`,
    TRUE_EMPTY: "当前周期已完整同步，确认没有业务数据。",
    SYNC_RUNNING: "当前周期正在同步；仅在同一筛选范围显式允许时保留上次成功结果。",
    ERROR: "当前周期数据查询失败，未展示旧数据。"
  };

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${coverageClass(coverage.status)}`}>
      {copy[coverage.status] || `数据覆盖状态：${coverage.status}`}
      {showCurrentDayNotice ? `（今日数据进行中，统计截至 ${coverage.asOfTime}）` : ""}
    </div>
  );
}
