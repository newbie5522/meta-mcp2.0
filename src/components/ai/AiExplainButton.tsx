import React from "react";
import { Sparkles, Loader2 } from "lucide-react";

export interface AiExplainButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function AiExplainButton({
  disabled = false,
  loading = false,
  onClick,
}: AiExplainButtonProps) {
  return (
    <button
      id="ai-explain-btn"
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200
        ${
          loading
            ? "bg-slate-50 border-slate-200 text-slate-500 cursor-not-allowed"
            : disabled
            ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed"
            : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 shadow-sm active:scale-95 cursor-pointer"
        }`}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
      ) : (
        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
      )}
      <span>{loading ? "加载中..." : "AI 解读"}</span>
    </button>
  );
}
