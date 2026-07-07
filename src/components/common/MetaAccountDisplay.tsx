import React from "react";

export interface MetaAccountDisplayProps {
  name?: string | null;
  accountId?: string | null;
  className?: string;
  nameClassName?: string;
  idClassName?: string;
  compact?: boolean;
}

export function cleanAccountId(accountId?: string | null) {
  const value = String(accountId || "").trim();
  if (!value) return "";
  return value.toLowerCase().startsWith("act_") ? value.slice(4) : value;
}

export function metaAccountOptionLabel(name?: string | null, accountId?: string | null) {
  const cleanId = cleanAccountId(accountId);
  const rawName = String(name || "").trim();
  const rawId = String(accountId || "").trim();
  const lowerName = rawName.toLowerCase();
  const displayName = rawName && lowerName !== rawId.toLowerCase() && lowerName !== cleanId.toLowerCase() ? rawName : "未命名 Meta 账号";
  return cleanId ? `${displayName} / ${cleanId}` : displayName;
}

export function metaAccountSearchText(name?: string | null, accountId?: string | null) {
  const displayName = String(name || "").trim().toLowerCase();
  const rawId = String(accountId || "").trim().toLowerCase();
  const cleanId = cleanAccountId(rawId).toLowerCase();
  const actId = cleanId ? `act_${cleanId}` : "";
  return `${displayName} ${rawId} ${cleanId} ${actId}`.trim();
}

export function MetaAccountDisplay({
  name,
  accountId,
  className,
  nameClassName,
  idClassName,
  compact = false
}: MetaAccountDisplayProps) {
  const displayId = cleanAccountId(accountId);
  const rawName = String(name || "").trim();
  const rawId = String(accountId || "").trim();
  const lowerName = rawName.toLowerCase();
  const displayName = rawName && lowerName !== rawId.toLowerCase() && lowerName !== displayId.toLowerCase() ? rawName : "未命名 Meta 账号";

  return (
    <div className={className} title={`${displayName} / ${accountId || ""}`}>
      <div className={nameClassName || "font-semibold text-slate-900 truncate"}>
        {displayName}
      </div>
      {!compact && (
        <div className={idClassName || "text-[11px] text-slate-500 font-mono truncate"}>
          {displayId}
        </div>
      )}
      {compact && displayId && (
        <div className={idClassName || "text-[11px] text-slate-500 font-mono truncate"}>
          {displayId}
        </div>
      )}
    </div>
  );
}
