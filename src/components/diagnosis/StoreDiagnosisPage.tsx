import React from "react";
import { 
  Building, 
  HelpCircle, 
  Percent, 
  DollarSign, 
  ShoppingBag, 
  Barcode, 
  TrendingUp, 
  Scale,
  Sparkles,
  Inbox,
  AlertCircle,
  RefreshCw,
  Layers,
  Activity,
  Award,
  BookOpen
} from "lucide-react";
import { isBusinessActionableIssue, useDiagnosticsIssues } from "./useDiagnosticsIssues";
import { DiagnosticIssueCard } from "./DiagnosticIssueCard";

export function StoreDiagnosisPage({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const {
    issues,
    loading,
    error,
    refetch
  } = useDiagnosticsIssues({ startDate, endDate });

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const businessIssues = issues.filter(isBusinessActionableIssue);

  // Filters based on requirements:
  // 1. 店铺经营结果: problemStage === "outcome"
  const outcomeIssues = businessIssues.filter(iss => iss.problemStage === "outcome");

  // 2. Meta 与 Store 对账: funnelStage === "meta_to_store_reconciliation"
  const reconciliationIssues = businessIssues.filter(iss => iss.funnelStage === "meta_to_store_reconciliation");

  // 3. 数据映射 / 追踪问题: optimizationArea in ["tracking", "mapping", "data_sync"]
  const trackingIssues = businessIssues.filter(iss =>
    ["tracking", "mapping", "data_sync"].includes(iss.optimizationArea || "")
  );

  // 4. 店铺相关 entity: entityType === "store"
  const storeIssues = businessIssues.filter(iss => iss.entityType === "store");

  // All store-relevant issues combined: outcome, reconciliation, tracking/mapping/data_sync, store entity
  const storeRelevantIssues = businessIssues.filter(iss =>
    iss.problemStage === "outcome" ||
    iss.funnelStage === "meta_to_store_reconciliation" ||
    ["tracking", "mapping", "data_sync"].includes(iss.optimizationArea || "") ||
    iss.entityType === "store"
  );

  // High priority list (top 5 store relevant sorted by priorityScore desc)
  const topStoreIssues = [...storeRelevantIssues]
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 5);

  const hasData = storeRelevantIssues.length > 0;

  // Find dynamic metrics from evidence.funnelSnapshot if present
  const firstFunnelSnapshot = storeRelevantIssues.find(iss => iss.evidence?.funnelSnapshot)?.evidence?.funnelSnapshot;
  const getStoreIssueLabel = (problemStage?: string | null, funnelStage?: string | null) => {
    const value = problemStage || funnelStage || "";
    const labels: Record<string, string> = {
      outcome: "经营结果",
      meta_to_store_reconciliation: "广告与店铺对账",
      tracking: "追踪问题",
      mapping: "账户映射",
      data_sync: "数据同步",
      data_health: "数据健康",
      ad_delivery: "广告投放",
      creative_attraction: "素材吸引力",
      product_page_intent: "产品承接",
      landing_page_arrival: "落地页到达",
      cart_to_checkout: "加购到结账",
      checkout_payment: "结账支付"
    };

    return value ? labels[value] || value.replace(/_/g, " ") : "店铺";
  };

  const getMetricLabel = (value: string) => {
    const labels: Record<string, string> = {
      linkClicks: "链接点击",
      landingPageViews: "落地页访问",
      addToCart: "加购",
      initiateCheckout: "发起结账",
      purchases: "购买",
      purchaseValue: "成交金额",
      roas: "广告回报",
      storeRoas: "店铺回报",
      storeOrders: "店铺订单",
      storeRevenue: "店铺成交额",
      metaStoreOrderGap: "广告与店铺订单差异"
    };

    return labels[value] || value.replace(/_/g, " ");
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      {/* Header section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">店铺经营诊断</h1>
          <p className="text-sm text-slate-500 mt-1">
            查看店铺订单、广告归因和经营结果，帮助团队发现店铺层面的异常问题。
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-500">
          当前统计期间：{formatDate(startDate)} 至 {formatDate(endDate)}
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <h4 className="text-sm font-bold text-slate-700">正在调取真实店铺经营异常结果...</h4>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-650 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">店铺诊断结果加载失败</h4>
              <p className="text-xs text-red-700 mt-1">{error.message}</p>
            </div>
          </div>
          <button 
            onClick={refetch}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </button>
        </div>
      ) : !hasData ? (
        <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-4 max-w-3xl mx-auto">
          <Inbox className="w-12 h-12 text-slate-400 mx-auto" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-700">暂无可执行店铺诊断建议。</h4>
            <p className="text-xs text-slate-400">
              当前日期范围内没有发现明显的店铺经营、归因对账或账户绑定异常。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Section: Category summary counters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">店铺经营相关</span>
              <div className="text-3xl font-extrabold text-slate-900">{storeRelevantIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">汇总的所有店铺关联异常</p>
            </div>
            
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">经营结果问题</span>
              <div className="text-3xl font-extrabold text-slate-900">{outcomeIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">经营转化及宏观毛利率问题</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">账户对账偏离</span>
              <div className="text-3xl font-extrabold text-slate-900">{reconciliationIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">物理归因与对账波动机理</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">追踪映射异常</span>
              <div className="text-3xl font-extrabold text-slate-900">{trackingIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">像素、映射配置或同步链路异常</p>
            </div>
          </div>

          {/* Dynamic funnel facts check from evidence.funnelSnapshot if populated */}
          {firstFunnelSnapshot && (
            <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-150 space-y-4">
              <h3 className="font-bold text-blue-900 text-sm flex items-center gap-2">
                <Scale className="w-5 h-5 text-blue-700" />
                当前店铺财务与对账参考数据
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {firstFunnelSnapshot.storeRoas !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">建议分析 ROAS</span>
                    <span className="text-xl font-bold text-blue-800">{firstFunnelSnapshot.storeRoas}</span>
                  </div>
                )}
                {firstFunnelSnapshot.storeOrders !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">对账建议真实订单数</span>
                    <span className="text-xl font-bold text-blue-800">{firstFunnelSnapshot.storeOrders}</span>
                  </div>
                )}
                {firstFunnelSnapshot.storeRevenue !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">对账建议总成交额</span>
                    <span className="text-xl font-bold text-blue-800">${firstFunnelSnapshot.storeRevenue}</span>
                  </div>
                )}
                {firstFunnelSnapshot.metaStoreOrderGap !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">未归因比例偏移</span>
                    <span className="text-xl font-bold text-blue-800">{firstFunnelSnapshot.metaStoreOrderGap}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Core breakdown row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: Top Store-related Issues */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-blue-600" />
                      当前高优先级店铺诊断处方
                    </h3>
                    <p className="text-xs text-slate-500">按优先级展示当前最需要处理的问题</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {topStoreIssues.map((iss) => (
                    <DiagnosticIssueCard key={String(iss.issueId)} issue={iss} />
                  ))}
                </div>

              </div>
            </div>

            {/* Right Column: Mini static facts or explanations */}
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 border-b pb-2 uppercase tracking-wider">
                  店铺对账说明
                </h3>
                <p className="text-xs text-slate-605 leading-relaxed">
                  通过匹配广告归因记录与店铺订单，帮助判断像素或转化回传缺失造成的对账偏差。
                </p>
                <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                  账户绑定越完整，对账结果越准确。
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
