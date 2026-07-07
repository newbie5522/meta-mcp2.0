import React from "react";
import { 
  ArrowRight, 
  AlertTriangle, 
  Sparkles, 
  Info,
  HelpCircle,
  Database,
  Layers,
  TrendingDown,
  ShoppingBag,
  MousePointerClick,
  ShoppingCart,
  Inbox,
  RefreshCw,
  Clock,
  AlertCircle
} from "lucide-react";
import { useDiagnosticsIssues } from "./useDiagnosticsIssues";

export function FunnelDiagnosisPage({ startDate, endDate }: { startDate: Date; endDate: Date }) {
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

  // Extract all funnel snapshots
  const snapshotIssues = issues.filter(iss => iss.evidence?.funnelSnapshot);

  // 1. missingMetrics 汇总
  const allMissingMetrics = Array.from(new Set(
    snapshotIssues.flatMap(iss => {
      const ms = iss.evidence.funnelSnapshot.missingMetrics;
      if (!ms) return [];
      return Array.isArray(ms) ? ms : [String(ms)];
    })
  ));

  // 2. notes 汇总
  const allNotes = Array.from(new Set(
    snapshotIssues.map(iss => iss.evidence.funnelSnapshot.notes).filter(Boolean)
  ));

  // Filter issues by the specified stages/kinds:
  // 3. landing_page_arrival 相关 issues
  const landingPageArrivalIssues = issues.filter(
    iss => 
      iss.funnelStage === "landing_page_arrival" || 
      String(iss.problemStage).includes("landing_page") || 
      String(iss.optimizationArea).includes("landing_page")
  );

  // 4. product_page_intent 相关 issues
  const productPageIntentIssues = issues.filter(
    iss => 
      iss.funnelStage === "product_page_intent" || 
      String(iss.problemStage).includes("product_page") || 
      String(iss.optimizationArea).includes("product_page")
  );

  // 5. cart_to_checkout 相关 issues
  const cartToCheckoutIssues = issues.filter(
    iss => 
      iss.funnelStage === "cart_to_checkout" || 
      String(iss.problemStage).includes("cart") || 
      String(iss.optimizationArea).includes("cart")
  );

  // 6. checkout_payment 相关 issues
  const checkoutPaymentIssues = issues.filter(
    iss => 
      iss.funnelStage === "checkout_payment" || 
      String(iss.problemStage).includes("checkout") || 
      String(iss.optimizationArea).includes("checkout") ||
      String(iss.problemStage).includes("payment")
  );

  // 7. meta_to_store_reconciliation 相关 issues
  const metaToStoreReconciliationIssues = issues.filter(
    iss => 
      iss.funnelStage === "meta_to_store_reconciliation" || 
      String(iss.problemStage).includes("reconciliation") || 
      String(iss.optimizationArea).includes("mapping") ||
      String(iss.optimizationArea).includes("tracking")
  );

  const hasFunnelSnapshot = snapshotIssues.length > 0;
  const getSeverityLabel = (value?: string | null) => {
    const labels: Record<string, string> = {
      critical: "严重",
      warning: "需要关注",
      info: "提醒"
    };

    return value ? labels[value] || value : "提醒";
  };

  const getMetricLabel = (value: string) => {
    const labels: Record<string, string> = {
      linkClicks: "链接点击",
      landingPageViews: "落地页访问",
      addToCart: "加购",
      initiateCheckout: "发起结账",
      purchases: "购买",
      purchaseValue: "成交金额",
      roas: "广告回报"
    };

    return labels[value] || value.replace(/_/g, " ");
  };

  const renderIssueList = (title: string, list: typeof issues) => {
    return (
      <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
          {title} ({list.length})
        </h3>
        {list.length === 0 ? (
          <p className="text-xs text-slate-400 italic">该转化卡点暂未扫出明显诊断异常。</p>
        ) : (
          <div className="space-y-3">
            {list.map((iss) => (
              <div key={iss.issueId} className="p-3 bg-slate-50 rounded-lg border border-slate-150/50 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono font-bold text-slate-500 uppercase">{iss.issueId}</span>
                  <span className={`px-1 rounded font-bold uppercase ${
                    iss.severity === "critical" ? "text-red-700 bg-red-50" : "text-slate-700 bg-slate-100"
                  }`}>
                     {getSeverityLabel(iss.severity)}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-slate-900">{iss.title}</h4>
                <p className="text-xs text-slate-650 leading-relaxed bg-white p-2.5 rounded border border-slate-100 italic">
                  {iss.diagnosisReason || iss.oneLineReason}
                </p>
                {Array.isArray(iss.suggestedActions) && iss.suggestedActions.length > 0 && (
                  <div className="text-[11px] text-slate-600 bg-blue-50/20 p-2 rounded">
                    <strong>建议对策:</strong> {iss.suggestedActions.join(" | ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">转化漏斗诊断</h1>
          <p className="text-sm text-slate-500 mt-1">
            查看从广告点击到下单成交的关键环节，帮助团队发现转化流失位置。
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-500">
          当前统计期间：{formatDate(startDate)} 至 {formatDate(endDate)}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <h4 className="text-sm font-bold text-slate-700">正在加载诊断结果，请稍候...</h4>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-650 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">诊断数据加载失败</h4>
              <p className="text-xs text-red-750 mt-1">数据暂时无法加载，请稍后重试或检查后端服务状态。</p>
            </div>
          </div>
          <button 
            onClick={refetch}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold font-mono inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </button>
        </div>
      ) : !hasFunnelSnapshot ? (
        <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-4 max-w-3xl mx-auto">
          <Database className="w-12 h-12 text-slate-400 mx-auto" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-700">暂无可执行漏斗诊断建议</h4>
            <p className="text-xs text-slate-400">
              当前日期范围内没有发现明显的转化流失异常。请确认广告数据和店铺订单已同步。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Snapshots aggregated Info Card */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-slate-500" />
              聚合漏斗对账诊断结果
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <span className="font-bold text-slate-900 block">缺失指标：</span>
                {allMissingMetrics.length === 0 ? (
                  <p className="text-slate-500 italic">当前没有缺失指标。</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {allMissingMetrics.map((m, idx) => (
                      <span key={idx} className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-800 rounded font-mono font-bold">
                        {getMetricLabel(String(m))}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <span className="font-bold text-slate-900 block">异常说明：</span>
                {allNotes.length === 0 ? (
                  <p className="text-slate-500 italic">当前没有额外异常说明。</p>
                ) : (
                  <ul className="list-disc list-inside space-y-1 text-slate-600">
                    {allNotes.map((n, idx) => (
                      <li key={idx}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Grouped lists */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {renderIssueList("Landing Page 广告直达页卡点 (landing_page_arrival)", landingPageArrivalIssues)}
            {renderIssueList("落地页加购率意向评估 (product_page_intent)", productPageIntentIssues)}
            {renderIssueList("购物车流失至结账分析 (cart_to_checkout)", cartToCheckoutIssues)}
            {renderIssueList("发起结账到支付转换 (checkout_payment)", checkoutPaymentIssues)}
            {renderIssueList("Meta 归因对账单波动 (meta_to_store_reconciliation)", metaToStoreReconciliationIssues)}

          </div>

        </div>
      )}
    </div>
  );
}
