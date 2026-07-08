import React, { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, MessageSquare } from "lucide-react";
import { MetaAccountDisplay } from "@/components/common/MetaAccountDisplay";
import {
  funnelStageLabels,
  optimizationAreaLabels,
  problemStageLabels,
  toBusinessLabel
} from "@/lib/business-labels";

function getStoreIdLabel(id?: string | number | null) {
  if (id === null || id === undefined || id === "") return "";
  return String(id).replace(/^store_/i, "");
}

function cleanEntityId(id?: string | number | null) {
  const accountPrefix = new RegExp("^acc_" + "act_", "i");
  return String(id || "")
    .replace(accountPrefix, "")
    .replace(/^act_/i, "")
    .replace(/^store_/i, "");
}

export function DiagnosticIssueCard({ issue }: { issue: any }) {
  const [open, setOpen] = useState(false);

  const isAccount = issue.entityType === "account" || issue.entityType === "ad_account";
  const isStore = issue.entityType === "store";

  const entityBlock = isAccount ? (
    <MetaAccountDisplay
      name={issue.entityName}
      accountId={issue.entityId}
      nameClassName="text-xs font-semibold text-slate-800 truncate"
      idClassName="text-[10px] text-slate-500 font-mono truncate"
    />
  ) : isStore ? (
    <div title={`${issue.entityName || "未命名店铺"} / ${issue.entityId || ""}`}>
      <div className="text-xs font-semibold text-slate-800 truncate">
        {issue.entityName || "未命名店铺"}
      </div>
      {issue.entityId && (
        <div className="text-[10px] text-slate-500 font-mono truncate">
          Store ID: {getStoreIdLabel(issue.entityId)}
        </div>
      )}
    </div>
  ) : (
    <div>
      <div className="text-xs font-semibold text-slate-800 truncate">
        {issue.entityName || "未命名对象"}
      </div>
      {issue.entityId && (
        <div className="text-[10px] text-slate-500 font-mono truncate">
          {issue.entityType || "object"}: {cleanEntityId(issue.entityId)}
        </div>
      )}
    </div>
  );

  const severityLabel =
    issue.severity === "critical" ? "严重" :
    issue.severity === "warning" ? "需要关注" :
    "提醒";

  const businessLabels = [
    issue.problemStage ? `阶段：${toBusinessLabel(issue.problemStage, problemStageLabels)}` : null,
    issue.optimizationArea ? `领域：${toBusinessLabel(issue.optimizationArea, optimizationAreaLabels)}` : null,
    issue.funnelStage ? `漏斗：${toBusinessLabel(issue.funnelStage, funnelStageLabels)}` : null
  ].filter(Boolean);

  function askIssueAI() {
    const prompt = `请分析这个诊断问题，并给出投放/店铺运营处理建议：${issue.title}`;

    window.dispatchEvent(new CustomEvent("open-ai-context", {
      detail: {
        source: "diagnosis_issue",
        title: issue.title,
        prompt,
        context: {
          issueId: issue.issueId,
          entityType: issue.entityType,
          entityId: issue.entityId,
          entityName: issue.entityName,
          accountId: issue.accountId,
          accountName: issue.accountName,
          storeId: issue.storeId,
          storeName: issue.storeName,
          severity: issue.severity,
          problemStage: issue.problemStage,
          optimizationArea: issue.optimizationArea,
          funnelStage: issue.funnelStage,
          evidence: issue.evidence,
          suggestedActions: issue.suggestedActions
        }
      }
    }));
  }

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-bold text-slate-900">{issue.title}</h4>
          {entityBlock}
        </div>
        <span className="px-2 py-0.5 text-[10px] rounded bg-slate-100 text-slate-700 font-semibold">
          {severityLabel}
        </span>
      </div>

      <p className="text-xs text-slate-600 leading-relaxed">
        {issue.diagnosisReason || issue.oneLineReason}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {open ? "收起证据" : "查看证据"}
        </button>

        <button
          type="button"
          onClick={askIssueAI}
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
        >
          <MessageSquare className="w-3 h-3" />
          问 AI
        </button>

        {issue.route && (
          <button
            type="button"
            onClick={() => {
              window.history.pushState({}, "", issue.route);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ExternalLink className="w-3 h-3" />
            打开对象
          </button>
        )}
      </div>

      {open && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 space-y-2">
          {businessLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {businessLabels.map((label) => (
                <span key={label} className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                  {label}
                </span>
              ))}
            </div>
          )}

          {Array.isArray(issue.suggestedActions) && issue.suggestedActions.length > 0 && (
            <div>
              <div className="font-bold text-slate-800 mb-1">建议动作</div>
              <ul className="list-disc pl-4 space-y-1">
                {issue.suggestedActions.slice(0, 3).map((action: string, index: number) => (
                  <li key={index}>{action}</li>
                ))}
              </ul>
            </div>
          )}

          {issue.evidence && (
            <div>
              <div className="font-bold text-slate-800 mb-1">证据快照</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white border border-slate-200 p-2 text-[10px] text-slate-500">
                {JSON.stringify(issue.evidence, null, 2)}
              </pre>
            </div>
          )}

          <div className="font-mono text-[10px] text-slate-400">
            issueId: {issue.issueId}
            {issue.problemStage ? ` / problemStage: ${issue.problemStage}` : ""}
            {issue.optimizationArea ? ` / optimizationArea: ${issue.optimizationArea}` : ""}
            {issue.funnelStage ? ` / funnelStage: ${issue.funnelStage}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
