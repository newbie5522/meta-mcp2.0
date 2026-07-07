import React from "react";
import { 
  Sparkles, 
  HelpCircle, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle,
  Activity,
  Package,
  RefreshCw,
  Inbox
} from "lucide-react";
import { isBusinessActionableIssue, useDiagnosticsIssues } from "./useDiagnosticsIssues";
import { DiagnosticIssueCard } from "./DiagnosticIssueCard";

export function ProductDiagnosisPage({ startDate, endDate }: { startDate: Date; endDate: Date }) {
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

  // Filter criteria from prompt instructions:
  // 1. problemStage === "product_page_intent"
  // 2. optimizationArea === "product_page"
  // 3. optimizationArea === "pricing"
  // 4. optimizationArea === "trust"
  // 5. entityType === "product"
  // 6. category === "production_suggestion" 且与产品承接相关
  const businessIssues = issues.filter(isBusinessActionableIssue);
  const relevantIssues = businessIssues.filter(iss => {
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
  const getProductFieldLabel = (value?: string | null) => {
    const labels: Record<string, string> = {
      product_page_intent: "产品承接",
      product_page: "产品详情页",
      pricing: "价格",
      trust: "信任承接",
      product: "产品",
      production_suggestion: "经营建议"
    };

    return value ? labels[value] || value.replace(/_/g, " ") : "产品";
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

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900">产品表现诊断</h1>
          <p className="text-sm text-slate-500">
            基于订单和广告表现，查看产品承接、价格和信任相关问题。
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-500">
          当前统计期间：{formatDate(startDate)} 至 {formatDate(endDate)}
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
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </button>
        </div>
      ) : !hasData ? (
        <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-4 max-w-3xl mx-auto">
          <Inbox className="w-12 h-12 text-slate-400 mx-auto" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-705">暂无可执行产品诊断建议</h4>
            <p className="text-xs text-slate-400">
              当前日期范围内没有发现明显的产品承接、价格或信任问题。
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
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">详情页承接问题</span>
              <div className="text-2xl font-extrabold text-slate-900">{productPageIntentCount} 个</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">页面/价格/信任问题</span>
              <div className="text-2xl font-extrabold text-slate-900">{productAreaCount} 个</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">产品实体问题</span>
              <div className="text-2xl font-extrabold text-slate-900">{productEntityCount} 个</div>
            </div>
          </div>

          {/* Issue lists */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              当前优先处理的产品问题
            </h3>

            <div className="space-y-4">
              {topIssues.map((iss) => (
                <DiagnosticIssueCard key={String(iss.issueId)} issue={iss} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
