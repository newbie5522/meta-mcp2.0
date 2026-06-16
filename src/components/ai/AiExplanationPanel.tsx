import React from "react";
import { AiExplanationEmptyState } from "./AiExplanationEmptyState";
import { AiModelBoundaryNotice } from "./AiModelBoundaryNotice";
import { AlertCircle, RefreshCw, Loader2 } from "lucide-react";

export interface AiExplanationPanelProps {
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
  onRetry?: () => void;
}

export function AiExplanationPanel({
  loading,
  error = null,
  response = null,
  onRetry,
}: AiExplanationPanelProps) {
  return (
    <div id="ai-explanation-panel" className="mt-3 p-4 bg-slate-50/30 border border-slate-100 rounded-xl space-y-3 transition-all duration-300">
      {/* 1. Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-8 space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          <p className="text-xs text-slate-500 animate-pulse">正在请求 AI 解释网关...</p>
        </div>
      )}

      {/* 2. Error state */}
      {!loading && error && (
        <div className="p-4 bg-rose-50/50 border border-rose-100 rounded-lg space-y-3">
          <div className="flex items-start gap-2 text-rose-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h5 className="text-xs font-bold">请求解释失败 (Request Failed)</h5>
              <p className="text-xs text-rose-600 leading-relaxed">{error}</p>
            </div>
          </div>
          {onRetry && (
            <button
              id="ai-explain-retry-btn"
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

      {/* 3. Dry Run / Not Enabled Response state */}
      {!loading && !error && response && (response.mode === "dry_run" || response.enabled === false) && (
        <div className="space-y-3">
          {/* Always display not_enabled empty state as dry run */}
          <AiExplanationEmptyState type="not_enabled" />

          {/* Always display AI Model Boundary Notice */}
          <AiModelBoundaryNotice />
        </div>
      )}

      {/* 4. Safeguard fallback logic for null responses or when not triggerred */}
      {!loading && !error && !response && (
        <div className="text-center py-4 text-xs text-slate-400">
          点击 “AI 解读” 开启数据特征诊断解释 (Dry Run)
        </div>
      )}
    </div>
  );
}
