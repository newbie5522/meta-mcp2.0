import React from "react";
import { Sparkles, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { AiExplanationEmptyState } from "./AiExplanationEmptyState";
import { AiModelBoundaryNotice } from "./AiModelBoundaryNotice";

export interface AiReviewTemplatePanelProps {
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

export function AiReviewTemplatePanel({
  loading,
  error = null,
  response = null,
  onGenerate,
  onRetry,
  disabled = false,
}: AiReviewTemplatePanelProps) {
  return (
    <div id="ai-review-template-panel" className="border border-slate-200 bg-white rounded-xl p-4 md:p-5 space-y-4">
      {/* Panel title and status indicator */}
      <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
        <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
        <span className="text-xs font-bold text-slate-800">
          AI 复盘模板 (Post-Performance Analyzer)
        </span>
      </div>

      {/* 1. Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-6 space-y-2">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          <p className="text-xs text-slate-500">正在请求 AI 解释网关...</p>
        </div>
      )}

      {/* 2. Error state */}
      {!loading && error && (
        <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg space-y-2">
          <div className="flex items-start gap-2 text-rose-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <h5 className="text-xs font-semibold">生成 AI 复盘模板失败</h5>
              <p className="text-[11px] text-rose-600 leading-relaxed">{error}</p>
            </div>
          </div>
          {onRetry && (
            <button
              id="ai-review-template-retry"
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-medium rounded transition-all cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>重试</span>
            </button>
          )}
        </div>
      )}

      {/* 3. Dry-run success response state */}
      {!loading && !error && response && (response.mode === "dry_run" || response.enabled === false) && (
        <div className="space-y-3">
          <AiExplanationEmptyState type="not_enabled" />
          
          <AiModelBoundaryNotice />
        </div>
      )}

      {/* 4. Default state */}
      {!loading && !error && !response && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            基于当前建议、人工状态与 operatorNotes 生成复盘模板。当前阶段为 dry_run，不接入真实模型。
          </p>
          <button
            id="ai-generate-review-btn"
            type="button"
            disabled={disabled}
            onClick={onGenerate}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all duration-200
              ${
                disabled
                  ? "bg-slate-50 border-slate-105 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 border-indigo-600 text-white shadow-sm active:scale-95 cursor-pointer"
              }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>生成 AI 复盘模板</span>
          </button>
        </div>
      )}
    </div>
  );
}
