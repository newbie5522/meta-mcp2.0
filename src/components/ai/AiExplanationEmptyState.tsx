import React from "react";
import { Sparkles, AlertCircle, Database } from "lucide-react";

export interface AiExplanationEmptyStateProps {
  type: "no_issues" | "not_enabled";
  className?: string;
}

export function AiExplanationEmptyState({ type, className = "" }: AiExplanationEmptyStateProps) {
  return (
    <div className={`p-6 border border-dashed border-slate-200 rounded-xl bg-slate-50/50 flex flex-col items-center text-center space-y-3 ${className}`}>
      <div className="p-3 bg-white rounded-full shadow-sm border border-slate-100">
        {type === "no_issues" ? (
          <Database className="w-6 h-6 text-slate-400" />
        ) : (
          <Sparkles className="w-6 h-6 text-slate-400" />
        )}
      </div>
      
      <div className="max-w-md space-y-1">
        <h4 className="text-sm font-bold text-slate-800">
          {type === "no_issues" ? "AI 解释功能暂无可用诊断输入" : "AI 解释层 Schema 空跑中"}
        </h4>
        <p className="text-xs text-slate-500 leading-relaxed">
          {type === "no_issues"
            ? "当前数据库可能为空，或选定范围内没有可用诊断记录 (issues)，因此未生成可用输入事实。"
            : "AI 解释功能尚未启用。当前阶段仅完成 Schema 与安全校验设计。系统坚守人工确认屏障，禁止自动修改 Meta 账户或执行未知指令。"}
        </p>
      </div>

      <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] text-slate-500 font-medium">
        <AlertCircle className="w-3.5 h-3.5 text-slate-405 shrink-0" />
        <span>Schema &amp; Safe Validator Dry Run Enabled</span>
      </div>
    </div>
  );
}
