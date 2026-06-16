import React from "react";
import { 
  Sparkles, 
  HelpCircle, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle,
  Activity,
  Package,
  Calendar,
  RefreshCw,
  Inbox
} from "lucide-react";
import { useDiagnosticsIssues } from "./useDiagnosticsIssues";

export function ProductDiagnosisPage() {
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

  // Filter criteria from prompt instructions:
  // 1. problemStage === "product_page_intent"
  // 2. optimizationArea === "product_page"
  // 3. optimizationArea === "pricing"
  // 4. optimizationArea === "trust"
  // 5. entityType === "product"
  // 6. category === "production_suggestion" 且与产品承接相关
  const relevantIssues = issues.filter(iss => {
    const isStageOrArea = 
      iss.problemStage === "product_page_intent" || 
      ["product_page", "pricing", "trust"].includes(iss.optimizationArea || "") ||
      iss.entityType === "product";

    const isProdSuggestion = 
      iss.category === "production_suggestion" && (
        String(iss.title || "").includes("产品") ||
        String(iss.title || "").includes("商品") ||
        String(iss.oneLineReason || "").includes("产品") ||
        String(iss.oneLineReason || "").includes("商品") ||
        String(iss.diagnosisReason || "").includes("产品") ||
        String(iss.diagnosisReason || "").includes("商品")
      );

    return isStageOrArea || isProdSuggestion;
  });

  const productPageIntentCount = relevantIssues.filter(iss => iss.problemStage === "product_page_intent").length;
  const productAreaCount = relevantIssues.filter(iss => ["product_page", "pricing", "trust"].includes(iss.optimizationArea || "")).length;
  const productEntityCount = relevantIssues.filter(iss => iss.entityType === "product").length;

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
              当前页面已接入离线规则诊断引擎。若数据库为空或所选日期范围内没有可诊断记录，将显示空状态，不会展示演示数据。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900">产品表现诊断</h1>
          <p className="text-sm text-slate-500">
            基于全量订单商品条目解构单品维度的物理表现。提炼产品及详情交互承接层级的经营价值。
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

      {/* Important Warning Notice */}
      <div className="p-4 rounded-xl bg-blue-50 border border-blue-150 flex gap-3 text-xs text-blue-900 leading-relaxed">
        <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold">产品归置限度申明：</span>
          <p>
            当前产品分析基于规则诊断 issues 展示，不输出产品级广告 ROAS 或产品级广告预算建议，除非后续打通产品广告归因链。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <h4 className="text-sm font-bold text-slate-700">正在生成产品承接与转化诊断分析...</h4>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">产品诊断调取失败</h4>
              <p className="text-xs text-red-750 mt-1">{error.message}</p>
            </div>
          </div>
          <button 
            onClick={refetch}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重新连接并刷新
          </button>
        </div>
      ) : !hasData ? (
        <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-4 max-w-3xl mx-auto">
          <Inbox className="w-12 h-12 text-slate-400 mx-auto" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-705">暂无产品表现诊断数据。当前数据库可能为空，或尚未同步产品 / 订单 / 广告归因数据。</h4>
            <p className="text-xs text-slate-400">
              底层的规则引擎在所选日期区间内，未捕获到任何针对产品实体 [product_page_intent / product_page / pricing / trust] 满足触发条件的诊断异常。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Categories Grid counts */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">产品相关诊断</span>
              <div className="text-2xl font-extrabold text-slate-900">{relevantIssues.length} 个</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">详情意向卡点 (intent)</span>
              <div className="text-2xl font-extrabold text-slate-900">{productPageIntentCount} 个</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">页面/价格/信任问题</span>
              <div className="text-2xl font-extrabold text-slate-900">{productAreaCount} 个</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">产品物理实体层</span>
              <div className="text-2xl font-extrabold text-slate-900">{productEntityCount} 个</div>
            </div>
          </div>

          {/* Issue lists */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              当前活跃的产品表现及溢漏异常 (最高 PriorityScore 前 5 条)
            </h3>

            <div className="space-y-4">
              {topIssues.map((iss) => (
                <div key={iss.issueId} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-50 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded">
                          ID: {iss.issueId}
                        </span>
                        <span className="text-xs text-slate-500 font-semibold uppercase">
                          {iss.problemStage || iss.optimizationArea || "产品"}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm mt-1">{iss.title}</h4>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-white bg-blue-600 px-2.5 py-1 rounded-full">
                      Priority Score: {iss.priorityScore ?? "--"}
                    </span>
                  </div>

                  {/* diagnosis reasoning */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 诊断意见
                    </div>
                    <p className="text-xs text-slate-650 leading-relaxed bg-blue-50/10 p-3 rounded-lg border border-blue-50/50 italic">
                      {iss.diagnosisReason || iss.oneLineReason}
                    </p>
                  </div>

                  {/* suggested actions */}
                  {iss.suggestedActions && iss.suggestedActions.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-800 block">推荐优化行动:</span>
                      <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100/80">
                        {iss.suggestedActions.join(" | ")}
                      </div>
                    </div>
                  )}

                  {/* indicators threshold */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-2 text-[11px] text-slate-505 border-t border-slate-100 border-dashed">
                    <div>
                      <span className="font-bold text-slate-700">限制级别(limitations):</span>{" "}
                      <span className="font-mono text-slate-800">
                        {Array.isArray(iss.limitations) ? iss.limitations.join(", ") : String(iss.limitations || "无")}
                      </span>
                    </div>

                    <div>
                      <span className="font-bold text-slate-700">基准流失校验(validationMetrics):</span>{" "}
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
