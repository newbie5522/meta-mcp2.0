import React from "react";
import { ShieldAlert, Info } from "lucide-react";

export interface AiModelBoundaryNoticeProps {
  className?: string;
}

export function AiModelBoundaryNotice({ className = "" }: AiModelBoundaryNoticeProps) {
  return (
    <div className={`p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 ${className}`}>
      <div className="flex items-center gap-2 text-slate-800">
        <ShieldAlert className="w-4 h-4 text-slate-600 shrink-0" />
        <h5 className="text-xs font-bold uppercase tracking-wider">AI 模型安全解释边界 (AI Safety Boundary)</h5>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        该模型解释仅基于系统传入的结构化诊断字段生成，不拥有自动读取账户、修改广告或执行操作的权限。所有优化行为必须经由运营人员在“建议处方中心”评估、手动采纳并线下确认完毕后再行推进。
      </p>
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
        <Info className="w-3.5 h-3.5" />
        <span>当前系统状态：严禁自动投放 · 严格人工授权保护 · 离线规则安全隔离</span>
      </div>
    </div>
  );
}
