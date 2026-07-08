import React from "react";

export type DataViewTraceBarProps = {
  currentStartDate: string;
  currentEndDate: string;
  responseStartDate?: string | null;
  responseEndDate?: string | null;
  timezone?: string | null;
  rowCount?: number | null;
  factRows?: number | null;
  structureRows?: number | null;
  status?: string | null;
  level?: string | null;
  source?: string | null;
  extra?: React.ReactNode;
};

function clean(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export function DataViewTraceBar({
  currentStartDate,
  currentEndDate,
  responseStartDate,
  responseEndDate,
  timezone = "America/Los_Angeles",
  rowCount,
  factRows,
  structureRows,
  status,
  level,
  source,
  extra
}: DataViewTraceBarProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-2">
      <span>当前筛选周期：{currentStartDate} ~ {currentEndDate}</span>
      <span>接口返回周期：{clean(responseStartDate)} ~ {clean(responseEndDate)}</span>
      <span>时区：{clean(timezone)}</span>
      <span>数据行数：{rowCount ?? 0}</span>
      {factRows !== null && factRows !== undefined && <span>事实行数：{factRows}</span>}
      {structureRows !== null && structureRows !== undefined && <span>结构行数：{structureRows}</span>}
      {status && <span>状态：{status}</span>}
      {level && <span>层级：{level}</span>}
      {source && <span>来源：{source}</span>}
      {extra}
    </div>
  );
}
