import React from "react";
import { 
  Sparkles, 
  HelpCircle, 
  TrendingUp, 
  ArrowDownIcon, 
  RefreshCw, 
  AlertTriangle,
  Info,
  Calendar,
  AlertCircle,
  Inbox,
  Activity
} from "lucide-react";
import { useDiagnosticsIssues } from "./useDiagnosticsIssues";

export function CreativeFatigueDiagnosisPage() {
  const {
    issues,
    loading,
    error,
    refetch,
    startDate,
    endDate,
    setStartDate,
    setEndDate
  } = useDiagnosticsIssues();

  // Filter requirements:
  // 1. problemStage === "creative_attraction"
  // 2. optimizationArea === "creative"
  // 3. issueType 包含 creative
  // 4. entityType === "creative"
  // 5. entityType === "ad"
  // 6. 其他与素材疲劳、CTR 下滑、Frequency、CPC 上升相关的 issues
  const relevantIssues = issues.filter(iss => {
    const isPrimaryMatch = 
      iss.problemStage === "creative_attraction" ||
      iss.optimizationArea === "creative" ||
      String(iss.issueType || "").includes("creative") ||
      iss.entityType === "creative" ||
      iss.entityType === "ad";

    const isKeywordMatch = 
      String(iss.title || "").includes("素材") ||
      String(iss.title || "").includes("疲劳") ||
      String(iss.title || "").includes("频次") ||
      String(iss.title || "").includes("CTR") ||
      String(iss.title || "").includes("CPC") ||
      String(iss.title || "").includes("Click") ||
      String(iss.title || "").includes("ROAS") ||
      String(iss.oneLineReason || "").includes("素材") ||
      String(iss.oneLineReason || "").includes("疲劳") ||
      String(iss.oneLineReason || "").includes("频次") ||
      String(iss.oneLineReason || "").includes("CTR") ||
      String(iss.oneLineReason || "").includes("CPC") ||
      String(iss.diagnosisReason || "").includes("素材") ||
      String(iss.diagnosisReason || "").includes("疲劳") ||
      String(iss.diagnosisReason || "").includes("频次") ||
      String(iss.diagnosisReason || "").includes("CTR") ||
      String(iss.diagnosisReason || "").includes("CPC");

    return isPrimaryMatch || isKeywordMatch;
  });

  const creativeAttractionCount = relevantIssues.filter(iss => iss.problemStage === "creative_attraction").length;
  const creativeOptimizationCount = relevantIssues.filter(iss => iss.optimizationArea === "creative").length;

  const topIssues = [...relevantIssues]
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 5);

  const hasData = relevantIssues.length > 0;

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
              当前页面仅展示真实诊断结果；如果所选时间内没有异常，会显示为空状态。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900">素材疲劳诊断</h1>
          <p className="text-sm text-slate-500">
            查看素材点击表现、频次变化和转化异动，帮助团队判断是否需要更换素材。
          </p>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border text-xs text-slate-705 shrink-0">
          <Calendar className="w-4 h-4 text-slate-400" />
          <div className="flex items-center gap-1">
            <span>开始:</span>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-1">
            <span>结束:</span>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button 
            onClick={refetch}
            disabled={loading}
            className="p-1 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:bg-blue-300"
            title="手动刷新"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <h4 className="text-sm font-bold text-slate-700">正在生成广告素材及频次疲劳诊断分析...</h4>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">素材诊断调取失败</h4>
              <p className="text-xs text-red-750 mt-1">{error.message}</p>
            </div>
          </div>
          <button 
            onClick={refetch}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </button>
        </div>
      ) : !hasData ? (
        <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-4 max-w-3xl mx-auto">
          <Inbox className="w-12 h-12 text-slate-400 mx-auto" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-705">暂无可执行素材诊断建议。</h4>
            <p className="text-xs text-slate-400">
              当前日期范围内没有发现明显的素材疲劳、点击下降或转化异常。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Main Stats Grid from issues overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-rose-500" />
                <h4 className="text-xs font-bold text-slate-500 uppercase">检测到素材异动总数</h4>
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-2">{relevantIssues.length} 项</div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">全量已被引擎标识需要调整或疲劳度激增的物料</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <h4 className="text-xs font-bold text-slate-500 uppercase">创意吸引阶段 (creative_attraction)</h4>
              </div>
              <div className="text-2xl font-extrabold text-amber-600 mt-2">{creativeAttractionCount} 项</div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">在展现、频次压迫和初期点击率维度流失预警</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-orange-500" />
                <h4 className="text-xs font-bold text-slate-500 uppercase">文案/创意定位领域 (creative)</h4>
              </div>
              <div className="text-2xl font-extrabold text-orange-600 mt-2">{creativeOptimizationCount} 项</div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium font-sans">素材多维度交叉归因导致点击漏洞的领域专项数</p>
            </div>
          </div>

          {/* Issues list */}
          <div className="space-y-6">
            <h3 className="font-bold text-slate-900 text-sm">疲劳与转化异动素材列表 (最高 PriorityScore 前 5 条)</h3>
            
            <div className="space-y-4">
              {topIssues.map((iss) => (
                <div key={iss.issueId} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 hover:shadow-md transition-shadow">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-705 text-[10px] font-bold rounded mr-2">
                        ID: {iss.issueId}
                      </span>
                      <span className="font-bold text-slate-900 text-sm">{iss.title}</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-white bg-blue-600 px-2.5 py-1 rounded-full">
                      Priority Score: {iss.priorityScore ?? "--"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                        <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 诊断意见
                      </div>
                      <p className="text-xs text-slate-650 leading-relaxed bg-blue-50/10 p-3 rounded-lg border border-blue-50/50 italic">
                        {iss.diagnosisReason || iss.oneLineReason}
                      </p>
                    </div>

                    {iss.suggestedActions && iss.suggestedActions.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-bold text-slate-800 block">建议应对手段:</span>
                        <div className="text-xs text-slate-650 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-150">
                          {iss.suggestedActions.join(" | ")}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* indicators threshold */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 text-[10px] text-slate-505 border-t border-slate-100 border-dashed">
                    <div>
                      <span className="font-bold text-slate-750">限制级别(limitations):</span>{" "}
                      <span className="font-mono text-slate-800">
                        {Array.isArray(iss.limitations) ? iss.limitations.join(", ") : String(iss.limitations || "无")}
                      </span>
                    </div>

                    <div>
                      <span className="font-bold text-slate-750">基准转化校验(validationMetrics):</span>{" "}
                      <span className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">
                        {Array.isArray(iss.validationMetrics) ? iss.validationMetrics.join("; ") : String(iss.validationMetrics || "未配置")}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
