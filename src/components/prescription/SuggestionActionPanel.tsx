import React, { useState } from "react";
import { SuggestionStatusDetail, SuggestionStatusType } from "./useSuggestionStatus";
import { Check, X, Play, Smile, AlertCircle, FileText, User } from "lucide-react";

interface SuggestionActionPanelProps {
  issue: {
    issueId: string;
    category: "production_suggestion" | "data_health_notice" | "debug_invalid";
    humanConfirmationRequired: boolean;
    ownerUserName?: string | null;
  };
  statusDetail: SuggestionStatusDetail;
  onUpdateStatus: (status: SuggestionStatusType, extra?: any) => void;
}

export function SuggestionActionPanel({ issue, statusDetail, onUpdateStatus }: SuggestionActionPanelProps) {
  const [showIgnoreInput, setShowIgnoreInput] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState(statusDetail.ignoreReason || "");
  
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [targetNextStatus, setTargetNextStatus] = useState<SuggestionStatusType | null>(null);
  const [operatorNotes, setOperatorNotes] = useState(statusDetail.operatorNotes || "");

  const handleIgnoreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ignoreReason.trim()) {
      alert("请填写忽略原因");
      return;
    }
    onUpdateStatus("ignored", { ignoreReason });
    setShowIgnoreInput(false);
  };

  const handleNotesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetNextStatus) {
      onUpdateStatus(targetNextStatus, { operatorNotes });
      setShowNotesInput(false);
      setTargetNextStatus(null);
    }
  };

  // 1. debug_invalid cannot be executed at all
  if (issue.category === "debug_invalid") {
    return (
      <div className="bg-slate-100/80 border border-slate-200 rounded-xl p-3 text-center text-xs text-slate-500 font-semibold flex items-center justify-center gap-2">
        <AlertCircle className="w-4 h-4 text-slate-400" />
        规则命中记录，不可执行
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 pt-4 mt-2 space-y-3">
      {/* Current status display badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">当前流转状态:</span>
          {statusDetail.status === "pending" && (
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded">
              待处理
            </span>
          )}
          {statusDetail.status === "accepted" && (
            <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-250 text-emerald-800 text-xs font-bold rounded">
              已采纳
            </span>
          )}
          {statusDetail.status === "ignored" && (
            <span className="px-2 py-0.5 bg-red-50 border border-red-250 text-red-800 text-xs font-bold rounded">
              已忽略
            </span>
          )}
          {statusDetail.status === "in_progress" && (
            <span className="px-2 py-0.5 bg-blue-50 border border-blue-250 text-blue-800 text-xs font-bold rounded/animated">
              执行中
            </span>
          )}
          {statusDetail.status === "executed" && (
            <span className="px-2 py-0.5 bg-purple-50 border border-purple-250 text-purple-800 text-xs font-bold rounded">
              已执行
            </span>
          )}
        </div>

        {/* Display saved explanation metrics */}
        {statusDetail.status === "ignored" && statusDetail.ignoreReason && (
          <div className="text-xs bg-red-50 text-red-800 px-3 py-1 rounded-md border border-red-100 font-medium flex-1 max-w-sm break-words">
            <strong>忽略原因:</strong> {statusDetail.ignoreReason}
          </div>
        )}
        {statusDetail.status === "executed" && statusDetail.operatorNotes && (
          <div className="text-xs bg-purple-50 text-purple-800 px-3 py-1 rounded-md border border-purple-100 font-medium flex-1 max-w-sm break-words">
            <strong>操作备注:</strong> {statusDetail.operatorNotes}
          </div>
        )}
      </div>

      {/* Button groups */}
      {!showIgnoreInput && !showNotesInput ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Option A: Accept */}
          <button
            onClick={() => {
              onUpdateStatus("accepted");
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
              statusDetail.status === "accepted"
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 border border-slate-200"
            }`}
          >
            <Check className="w-3.5 h-3.5" /> 采纳
          </button>

          {/* Option B: Ignore */}
          <button
            onClick={() => {
              setShowIgnoreInput(true);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
              statusDetail.status === "ignored"
                ? "bg-red-600 text-white"
                : "bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 border border-slate-200"
            }`}
          >
            <X className="w-3.5 h-3.5" /> 忽略
          </button>

          {/* Option C: In Progress */}
          <button
            onClick={() => {
              onUpdateStatus("in_progress");
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
              statusDetail.status === "in_progress"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 border border-slate-200"
            }`}
          >
            <Play className="w-3.5 h-3.5" /> 标记执行中
          </button>

          {/* Option D: Executed (Only if not a simple notice. Actually, user requested data_health_notice can accept/ignore/in_progress but suggestion has all four) */}
          {issue.category === "production_suggestion" && (
            <button
              onClick={() => {
                setTargetNextStatus("executed");
                setShowNotesInput(true);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                statusDetail.status === "executed"
                  ? "bg-purple-600 text-white"
                  : "bg-slate-100 hover:bg-purple-50 hover:text-purple-700 text-slate-700 border border-slate-200"
              }`}
            >
              <Check className="w-3.5 h-3.5" /> 标记已执行
            </button>
          )}
        </div>
      ) : showIgnoreInput ? (
        <form onSubmit={handleIgnoreSubmit} className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <label className="block text-[11px] font-bold text-slate-700">请填写忽略原因 (必填):</label>
          <div className="flex gap-2">
            <input
              type="text"
              required
              placeholder="例如：预算不足 / 当前时效不合 / 受众已有其他策略覆盖..."
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-red-500 text-slate-800"
            />
            <div className="flex gap-1 shrink-0">
              <button
                type="submit"
                className="px-3 py-1.5 bg-red-650 hover:bg-red-700 text-white text-xs font-bold rounded-md"
              >
                确定
              </button>
              <button
                type="button"
                onClick={() => setShowIgnoreInput(false)}
                className="px-2 py-1.5 bg-slate-205 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-md border"
              >
                取消
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={handleNotesSubmit} className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <label className="block text-[11px] font-bold text-slate-700">请填写执行备注和反馈建议 (选填):</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="例如：已在 Meta 广告后台调低了对应广告组的预算、更改了国家定向..."
              value={operatorNotes}
              onChange={(e) => setOperatorNotes(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500 text-slate-800"
            />
            <div className="flex gap-1 shrink-0">
              <button
                type="submit"
                className="px-3 py-1.5 bg-purple-650 hover:bg-purple-700 text-white text-xs font-bold rounded-md"
              >
                提交执行
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNotesInput(false);
                  setTargetNextStatus(null);
                }}
                className="px-2 py-1.5 bg-slate-205 hover:bg-slate-350 text-slate-700 text-xs font-bold rounded-md border"
              >
                取消
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
