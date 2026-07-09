import React from "react";

export type DataViewTraceBarProps = {
  debug?: boolean;
  compactScopeLabel?: string;
  currentStartDate?: string;
  currentEndDate?: string;
  responseStartDate?: string | null;
  responseEndDate?: string | null;
  timezone?: string | null;
  rowCount?: number | null;
  factRows?: number | null;
  structureRows?: number | null;
  status?: string | null;
  level?: string | null;
  source?: string | null;
  scope?: string | null;
  includeUnmapped?: boolean | null;
  includeZeroSpend?: boolean | null;
  mappedOnly?: boolean | null;
  storeId?: string | number | null;
  accountId?: string | null;
  queryDebug?: Record<string, any> | null;
  extra?: React.ReactNode;
};

function clean(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function getScopeLabel(scope: unknown) {
  const value = String(scope || "").toLowerCase();
  if (value === "current_account" || value === "account") return "当前账户";
  if (value === "current_store" || value === "store") return "当前店铺";
  if (value === "mapped_store_accounts" || value === "mapped_only" || value === "bound_accounts") {
    return "已绑定店铺账户";
  }
  if (value === "all_stores") return "全部店铺";
  return "全部账户";
}

function boolLabel(value: unknown) {
  return value ? "包含" : "不包含";
}

export function DataViewTraceBar({
  debug = false,
  compactScopeLabel,
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
  scope,
  includeUnmapped,
  includeZeroSpend,
  mappedOnly,
  storeId,
  accountId,
  queryDebug,
  extra
}: DataViewTraceBarProps) {
  const trace = queryDebug || {};
  const resolvedSource = source || trace.source;
  const resolvedScope = scope || trace.scope;
  const resolvedMappedOnly = mappedOnly ?? trace.mappedOnly ?? false;
  const resolvedIncludeUnmapped = includeUnmapped ?? trace.includeUnmapped;
  const resolvedIncludeZeroSpend = includeZeroSpend ?? trace.includeZeroSpend;
  const resolvedStoreId = storeId ?? trace.storeId;
  const resolvedAccountId = accountId ?? trace.accountId;

  if (!debug) {
    if (!compactScopeLabel && !resolvedSource && !resolvedScope) return null;

    return (
      <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1 leading-5">
        {compactScopeLabel ? <span>{compactScopeLabel}</span> : null}
        {resolvedSource ? <span>数据源：{resolvedSource}</span> : null}
        {resolvedScope ? <span>口径：{getScopeLabel(resolvedScope)}</span> : null}
        {resolvedIncludeUnmapped !== null && resolvedIncludeUnmapped !== undefined ? (
          <span>{resolvedIncludeUnmapped && !resolvedMappedOnly ? "含未绑定账户" : "仅绑定账户"}</span>
        ) : null}
        {resolvedIncludeZeroSpend !== null && resolvedIncludeZeroSpend !== undefined ? (
          <span>{resolvedIncludeZeroSpend ? "含零消耗对象" : "仅有消耗对象"}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-2">
      <span>当前筛选周期：{clean(currentStartDate)} ~ {clean(currentEndDate)}</span>
      <span>接口返回周期：{clean(responseStartDate)} ~ {clean(responseEndDate)}</span>
      <span>时区：{clean(timezone)}</span>
      <span>数据口径：{getScopeLabel(resolvedScope)}</span>
      <span>未绑定账户：{boolLabel(Boolean(resolvedIncludeUnmapped && !resolvedMappedOnly))}</span>
      <span>零消耗对象：{boolLabel(Boolean(resolvedIncludeZeroSpend))}</span>
      <span>数据行数：{rowCount ?? 0}</span>
      {factRows !== null && factRows !== undefined && <span>事实行数：{factRows}</span>}
      {structureRows !== null && structureRows !== undefined && <span>结构行数：{structureRows}</span>}
      {status && <span>状态：{status}</span>}
      {level && <span>层级：{level}</span>}
      {resolvedStoreId && resolvedStoreId !== "all" && <span>店铺：{clean(resolvedStoreId)}</span>}
      {resolvedAccountId && resolvedAccountId !== "all" && <span>账户：{clean(resolvedAccountId)}</span>}
      {resolvedSource && <span>来源：{resolvedSource}</span>}
      {extra}
    </div>
  );
}
