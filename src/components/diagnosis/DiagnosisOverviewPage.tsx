import React, { useState } from "react";
import { 
  AlertCircle, 
  TrendingDown, 
  DollarSign, 
  Layers, 
  Compass, 
  CheckCircle2, 
  ArrowRight,
  TrendingUp,
  Activity,
  Award,
  RefreshCw,
  Inbox,
  User,
  Heart,
  Sparkles
} from "lucide-react";
import { useDiagnosticsIssues } from "./useDiagnosticsIssues";
import { AiDashboardSummaryCard } from "../ai/AiDashboardSummaryCard";

export function DiagnosisOverviewPage({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const {
    issues,
    summary,
    loading,
    error,
    reportMeta,
    refetch
  } = useDiagnosticsIssues({ startDate, endDate });

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);

  const compactIssues = issues
    .filter(issue =>
      issue.category === "production_suggestion" &&
      issue.severity !== "healthy"
    )
    .slice(0, 10)
    .map(issue => ({
      issueId: issue.issueId,
      category: issue.category,
      severity: issue.severity,
      entityType: issue.entityType,
      entityId: issue.entityId,
      entityName: issue.entityName,
      title: issue.title,
      oneLineReason: issue.oneLineReason,
      diagnosisReason: issue.diagnosisReason,
      suggestedActions: Array.isArray(issue.suggestedActions) ? issue.suggestedActions.slice(0, 3) : [],
      priorityScore: issue.priorityScore,
      confidenceScore: issue.confidenceScore
    }));

  // Dashboard-level AI dry-run state
  const [dashboardAiState, setDashboardAiState] = useState<{
    loading: boolean;
    error: string | null;
    response: any | null;
  }>({
    loading: false,
    error: null,
    response: null,
  });

  const handleGenerateDashboardSummary = async () => {
    setDashboardAiState({
      loading: true,
      error: null,
      response: null,
    });

    try {
      const res = await fetch("/api/ai/explain-dashboard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "auto",
          model: "",
          issues: compactIssues,
          context: {
            dateRange: {
              startDate: startDateStr,
              endDate: endDateStr,
            },
            currentPage: "diagnosis_overview",
            userRole: "admin",
            targetLanguage: "zh-CN",
          },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP error ${res.status}`);
      }

      const data = await res.json();
      setDashboardAiState({
        loading: false,
        error: null,
        response: data,
      });
    } catch (err: any) {
      console.error("[AI EXPLAIN DASHBOARD ERROR]", err);
      setDashboardAiState({
        loading: false,
        error: err.message || "生成 AI 辅助解读失败",
        response: null,
      });
    }
  };

  const hasPartialDataNotice = Boolean(reportMeta?.diagnosticsDegraded);
  const reportMessage = reportMeta?.message || "";
  const hasNoIssues = !loading && !error && issues.length === 0;

  const getProblemStageLabel = (value?: string | null) => {
    const labels: Record<string, string> = {
      ad_delivery: "广告投放",
      creative_attraction: "素材吸引力",
      outcome: "转化结果",
      product_page_intent: "产品承接",
      landing_page_arrival: "落地页到达",
      cart_to_checkout: "加购到结账",
      checkout_payment: "结账支付",
      meta_to_store_reconciliation: "广告与店铺对账",
      data_health: "数据健康"
    };

    return value ? labels[value] || value.replace(/_/g, " ") : "";
  };

  const getOptimizationAreaLabel = (value?: string | null) => {
    const labels: Record<string, string> = {
      delivery: "投放效率",
      creative: "素材创意",
      budget: "预算控制",
      audience: "受众定向",
      product_page: "产品详情页",
      pricing: "价格",
      trust: "信任承接",
      tracking: "追踪",
      mapping: "账户映射",
      data_sync: "数据同步"
    };

    return value ? labels[value] || value.replace(/_/g, " ") : "";
  };
   
  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      {/* Intro block */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 rounded-2xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute right-12 bottom-0 translate-y-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />
        
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold uppercase tracking-wider text-blue-200">
            <Compass className="w-3.5 h-3.5" />经营诊断
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">AI 诊断中心</h1>
          <p className="text-indigo-105 text-sm sm:text-base leading-relaxed">
            基于广告数据与店铺订单，帮助团队发现异常、定位问题并给出处理建议。
          </p>
        </div>

        <div className="relative z-10 bg-white/10 backdrop-blur-md p-3 rounded-xl border border-white/10 shrink-0 text-xs font-semibold">
          当前统计期间：{startDateStr} 至 {endDateStr}
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-700">正在生成全新离线诊断分析汇总...</h4>
            <p className="text-xs text-slate-400">我们将重新拉取并校验所选时间范围内的所有诊断结果。</p>
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">诊断结果加载失败</h4>
              <p className="text-xs text-red-700 mt-1">{error.message}</p>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-red-200/40">
            <button 
              onClick={refetch}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 重新加载
            </button>
          </div>
        </div>
    ) : hasNoIssues ? (
      <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4 max-w-3xl mx-auto">
        <Inbox className="w-12 h-12 text-slate-400 mx-auto" />
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-slate-700">暂无可执行诊断建议</h4>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {reportMessage || "当前日期范围内没有发现需要处理的异常项。"}
          </p>
          {hasPartialDataNotice && (
            <p className="text-[11px] text-slate-400 max-w-md mx-auto">
              部分数据暂未参与本次分析，结果可继续查看。
            </p>
          )}
        </div>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> 重新生成诊断
        </button>
      </div>
    ) : (
        <>
          {/* Overview Stats Dashboard Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            
            {/* Stat 1: Production suggestions */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">待处理建议</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{summary.productionSuggestionCount}</span>
                <span className="text-xs text-emerald-600 font-semibold">{summary.criticalCount} 严重 · {summary.warningCount} 警示</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">正式诊断出的优化建议数量</p>
            </div>

            {/* Stat 4: Store list impact */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">受关联店铺</span>
                <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{summary.storeCount}</span>
                <span className="text-xs text-purple-600 font-semibold">个独立站</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">涉及该批规则的店铺集合数</p>
            </div>

            {/* Stat 5: Ad accounts impact */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">涉及广告账户</span>
                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Activity className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{summary.adAccountCount}</span>
                <span className="text-xs text-orange-600 font-semibold">个账户</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">涉及的广告账户数量</p>
            </div>

          </div>

          {/* AI dashboard summary section */}
          <AiDashboardSummaryCard
            loading={dashboardAiState.loading}
            error={dashboardAiState.error}
            response={dashboardAiState.response}
            onGenerate={handleGenerateDashboardSummary}
            onRetry={handleGenerateDashboardSummary}
            disabled={compactIssues.length === 0}
          />

          {/* Core breakdowns and lists */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Prioritized issues column */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-blue-600" />
                      高优先级风险 / 建议一览
                    </h3>
                    <p className="text-xs text-slate-500">按优先级展示当前最需要处理的问题</p>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">
                    建议优先
                  </span>
                </div>

                <div className="space-y-5">
                  {summary.sortedIssues.slice(0, 5).map((iss) => (
                    <div key={iss.issueId} className="flex gap-4 p-4 rounded-xl hover:bg-slate-50 border border-slate-100/50 transition-colors">
                      <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                        <TrendingDown className="w-5 h-5" />
                      </div>
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <h4 className="text-sm font-bold text-slate-900 break-words">{iss.title}</h4>
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded uppercase font-mono">
                            优先级：{iss.priorityScore ?? "--"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          {iss.diagnosisReason || iss.oneLineReason}
                        </p>
                        
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
                          {iss.problemStage && (
                            <span>阶段: <strong className="text-slate-650">{getProblemStageLabel(iss.problemStage)}</strong></span>
                          )}
                          {iss.optimizationArea && (
                            <span>领域: <strong className="text-slate-650">{getOptimizationAreaLabel(iss.optimizationArea)}</strong></span>
                          )}
                          {iss.ownerUserName && (
                            <span className="flex items-center gap-1 font-semibold text-slate-705">
                              <User className="w-3 h-3" /> 负责人: {iss.ownerUserName || "暂未分配"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column: Distribution analysis charts & lists */}
            <div className="space-y-6">
              
              {/* Problem stage distribution list */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                  问题阶段分布 (problemStage)
                </h3>
                <div className="space-y-3">
                  {Object.entries(summary.problemStages).map(([stage, count]) => (
                    <div key={stage} className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-600 font-mono">{stage}</span>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded-md font-mono">{count} 项</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Optimization Area distribution list */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                  优化领域分布 (optimizationArea)
                </h3>
                <div className="space-y-3">
                  {Object.entries(summary.optimizationAreas).map(([area, count]) => (
                    <div key={area} className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-600 font-mono">{area}</span>
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 rounded-md font-mono">{count} 项</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Funnel Stage distribution list */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                  漏斗阶段分布 (funnelStage)
                </h3>
                <div className="space-y-3">
                  {Object.entries(summary.funnelStages).map(([stage, count]) => (
                    <div key={stage} className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-600 font-mono">{stage}</span>
                      <span className="px-2 py-0.5 bg-slate-50 text-slate-700 border border-slate-100 rounded-md font-mono">{count} 项</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>

        </>
      )}
    </div>
  );
}
