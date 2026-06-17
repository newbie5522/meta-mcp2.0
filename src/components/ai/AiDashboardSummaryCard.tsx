import React from "react";
import { Sparkles, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { AiExplanationEmptyState } from "./AiExplanationEmptyState";
import { AiModelBoundaryNotice } from "./AiModelBoundaryNotice";

export interface AiDashboardSummaryCardProps {
  loading: boolean;
  error?: string | null;
  response?: {
    success: boolean;
    mode?: string;
    enabled?: boolean;
    explanation?: any;
    error?: string;
    boundaryNotice?: string;
  } | null;
  onGenerate: () => void;
  onRetry?: () => void;
  disabled?: boolean;
}

export function AiDashboardSummaryCard({
  loading,
  error = null,
  response = null,
  onGenerate,
  onRetry,
  disabled = false,
}: AiDashboardSummaryCardProps) {
  return (
    <div id="ai-dashboard-summary-card" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 transition-all duration-300">
      {/* Header section of the AI Dashboard Summary */}
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <Sparkles className="w-5 h-5 text-indigo-500" />
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
          AI 老板摘要 (Executive Dashboard Analyzer)
        </h3>
      </div>

      {/* 1. Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-8 space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          <p className="text-xs text-slate-500 animate-pulse">正在请求 AI 解释网关...</p>
        </div>
      )}

      {/* 2. Error State */}
      {!loading && error && (
        <div className="p-4 bg-rose-50/50 border border-rose-100 rounded-lg space-y-3">
          <div className="flex items-start gap-2 text-rose-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h5 className="text-xs font-bold">获取 AI 摘要失败 (Request Failed)</h5>
              <p className="text-xs text-rose-600 leading-relaxed">{error}</p>
            </div>
          </div>
          {onRetry && (
            <button
              id="ai-dashboard-summary-retry-btn"
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-medium rounded transition-all cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>重试</span>
            </button>
          )}
        </div>
      )}

      {/* 3. Response State (Dry Run Mode) */}
      {!loading && !error && response && (response.mode === "dry_run" || response.enabled === false) && (
        <div className="space-y-3">
          {/* Always display not_enabled empty state under dry_run */}
          <AiExplanationEmptyState type="not_enabled" />

          {/* Always display model boundary notice */}
          <AiModelBoundaryNotice />
        </div>
      )}

      {/* 4. Default State (Prompting Generation) */}
      {!loading && !error && !response && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-slate-500 leading-relaxed">
              基于当前诊断 issues 生成管理层摘要。当前阶段为 dry_run，不接入真实模型。
            </p>
            {disabled && (
              <p className="text-[10px] text-amber-600 font-medium">
                AI 解释功能暂无可用诊断输入。
              </p>
            )}
          </div>
          <button
            id="ai-generate-summary-btn"
            type="button"
            disabled={disabled}
            onClick={onGenerate}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl border transition-all duration-200
              ${
                disabled
                  ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 border-indigo-600 text-white shadow-sm active:scale-95 cursor-pointer"
              }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>生成 AI 老板摘要</span>
          </button>
        </div>
      )}
    </div>
  );
}
