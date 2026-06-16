import React from "react";
import { 
  History, 
  TrendingUp, 
  Activity, 
  HelpCircle, 
  CheckCircle2, 
  DollarSign, 
  ChevronRight, 
  ArrowUpRight,
  Clock,
  Check,
  X,
  Play,
  AlertCircle,
  Calendar,
  Layers,
  Sparkles
} from "lucide-react";
import { useSuggestionStatus } from "./useSuggestionStatus";

export function PrescriptionReviewPage() {
  const { statusMap } = useSuggestionStatus();
  
  // Convert our storage status map into an array
  const statusList = Object.values(statusMap);
  
  // Count states
  const acceptedCount = statusList.filter(s => s.status === "accepted").length;
  const inProgressCount = statusList.filter(s => s.status === "in_progress").length;
  const executedCount = statusList.filter(s => s.status === "executed").length;
  const ignoredCount = statusList.filter(s => s.status === "ignored").length;

  const totalActions = statusList.filter(s => ["accepted", "in_progress", "executed", "ignored"].includes(s.status)).length;

  // Helper to translate backtest review status to human label/color classes
  const getBacktestBadge = (val: string | undefined) => {
    switch (val) {
      case "improved":
        return (
          <span className="px-2 py-1 text-[10px] sm:text-xs font-bold rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
            ✅ 改善/提升 (Improved)
          </span>
        );
      case "no_change":
        return (
          <span className="px-2 py-1 text-[10px] sm:text-xs font-bold rounded bg-slate-100 text-slate-700 border border-slate-200">
            📊 无变化 (No Change)
          </span>
        );
      case "worse":
        return (
          <span className="px-2 py-1 text-[10px] sm:text-xs font-bold rounded bg-red-100 text-red-800 border border-red-200">
            ⚠️ 偏离恶化 (Worse)
          </span>
        );
      case "waiting":
        return (
          <span className="px-2 py-1 text-[10px] sm:text-xs font-bold rounded bg-blue-100 text-blue-800 border border-blue-200 animate-pulse">
            ⏳ 等待对账数据 (Waiting)
          </span>
        );
      case "not_started":
      default:
        return (
          <span className="px-2 py-1 text-[10px] sm:text-xs font-bold rounded bg-slate-100 text-slate-400 border border-slate-150">
            🌙 未开始 (Not Started)
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      
      {/* Disclaimer Banner */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-sm">
        <div className="flex">
          <div className="flex-shrink-0">
            <span className="text-amber-500 font-bold">⚠️</span>
          </div>
          <div className="ml-3">
            <p className="text-xs text-amber-800 font-bold">
              当前 STEP 13-D-Lite 仅记录人工执行状态。真实 3 / 7 / 14 天数据回测将在后续版本接入。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">执行回测 (Prescription Backtesting)</h1>
          <p className="text-sm text-slate-500 mt-1">
            追踪和回溯已被采纳、执行或在执行中建议的实操状态，提供多周期回测效果观察占位。
          </p>
        </div>
      </div>

      {totalActions === 0 ? (
        <div className="bg-white border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-4 max-w-2xl mx-auto">
          <Clock className="w-12 h-12 text-slate-300 mx-auto" />
          <div className="space-y-2">
            <h4 className="text-base font-bold text-slate-700">暂无执行回测记录。请先在建议处方中心采纳或执行建议。</h4>
            <p className="text-xs text-slate-400">
              一旦您在建议处方中心对处方卡片点击“采纳”、“忽略”、“标记执行中”或“标记已执行”，此处将自动捕获并展示流转进度和轻量级回测控制台。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* Section: Status aggregation counters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] text-slate-400 font-extrabold block uppercase tracking-wider mb-1">已采纳</span>
              <div className="text-3xl font-black text-emerald-700">{acceptedCount} 条</div>
              <p className="text-[10px] text-slate-400 mt-2">已采纳但尚未标记执行的提案</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] text-slate-400 font-extrabold block uppercase tracking-wider mb-1">执行中</span>
              <div className="text-3xl font-black text-blue-700">{inProgressCount} 条</div>
              <p className="text-[10px] text-slate-400 mt-2">正在操作及测试组调优的提案</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] text-slate-400 font-extrabold block uppercase tracking-wider mb-1">已执行</span>
              <div className="text-3xl font-black text-purple-700">{executedCount} 条</div>
              <p className="text-[10px] text-slate-400 mt-2">人工标记在广告或独立站完成实操的提案</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] text-slate-400 font-extrabold block uppercase tracking-wider mb-1">已忽略</span>
              <div className="text-3xl font-black text-slate-500">{ignoredCount} 条</div>
              <p className="text-[10px] text-slate-400 mt-2">因不可控、越位或环境影响而放弃的提案</p>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              当前活跃流转的建议与轻量级回测控制台 (3 / 7 / 14 天占位)
            </h3>

            <div className="space-y-4">
              {statusList.map((item) => (
                <div key={item.issueId} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 hover:shadow-md transition-shadow">
                  {/* Title and main status details */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded">
                          ID: {item.issueId}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">
                          流转分类: {
                            item.status === "accepted" ? "已采纳" :
                            item.status === "in_progress" ? "执行中" :
                            item.status === "executed" ? "已执行" : "已忽略"
                          }
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm mt-1">处方建议：{item.issueId}</h4>
                    </div>
                  </div>

                  {/* Multi-cycle backtesting display states */}
                  <div className="bg-slate-50 border border-slate-150/60 rounded-xl p-4 space-y-3">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      多维度周期回测占位监测：
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                      <div className="p-3 bg-white rounded-lg border border-slate-100 space-y-1.5 shadow-sm">
                        <span className="text-[10px] text-slate-400 block font-semibold">📅 3 天效果校验期</span>
                        <div>{getBacktestBadge(item.review3dStatus)}</div>
                      </div>

                      <div className="p-3 bg-white rounded-lg border border-slate-100 space-y-1.5 shadow-sm">
                        <span className="text-[10px] text-slate-400 block font-semibold">📅 7 天效果校验期</span>
                        <div>{getBacktestBadge(item.review7dStatus)}</div>
                      </div>

                      <div className="p-3 bg-white rounded-lg border border-slate-100 space-y-1.5 shadow-sm">
                        <span className="text-[10px] text-slate-400 block font-semibold">📅 14 天效果校验期</span>
                        <div>{getBacktestBadge(item.review14dStatus)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Execution detail outputs */}
                  {item.status === "ignored" && item.ignoreReason && (
                    <div className="text-xs bg-red-50 text-red-800 p-3 rounded-lg border border-red-100 leading-relaxed">
                      <strong>忽略原因记录:</strong> {item.ignoreReason}
                      {item.ignoredAt && <span className="block text-[10px] text-red-500 mt-1">忽略时间: {item.ignoredAt}</span>}
                    </div>
                  )}

                  {item.status === "executed" && item.operatorNotes && (
                    <div className="text-xs bg-purple-50 text-purple-800 p-3 rounded-lg border border-purple-100 leading-relaxed">
                      <strong>人工实操执行备注:</strong> {item.operatorNotes}
                      {item.executedAt && <span className="block text-[10px] text-purple-500 mt-1">执行时间: {item.executedAt}</span>}
                    </div>
                  )}

                  {item.status === "in_progress" && (
                    <div className="text-xs bg-blue-50 text-blue-800 p-3 rounded-lg border border-blue-100 leading-relaxed flex items-center justify-between">
                      <div>
                        <strong>执行状态中：</strong> 建议已被标记为实操跟进，基线对账期启动。
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
