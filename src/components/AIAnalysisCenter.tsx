import React, { useState, useEffect } from "react";
import axios from "axios";
import { format, subDays } from "date-fns";
import {
  Brain,
  ShieldAlert,
  Activity,
  Package,
  Heart,
  Globe,
  Settings,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  User,
  ShoppingBag,
  ArrowRight,
  Flame,
  UserCheck2,
  Lock
} from "lucide-react";
import { toast } from "sonner";

interface AIAnalysisCenterProps {
  startDate: Date;
  endDate: Date;
  defaultType?: string;
}

export function AIAnalysisCenter({ startDate, endDate, defaultType = "account_analysis" }: AIAnalysisCenterProps) {
  // 1. Diagnostics configuration state
  const [selectedType, setSelectedType] = useState<string>(defaultType);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("");
  
  // Lists for dropdowns
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [storesList, setStoresList] = useState<any[]>([]);
  
  // Loading & reporting state
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMsg, setLoadingMsg] = useState<string>("");
  const [report, setReport] = useState<any | null>(null);

  // Synchronize menu type selection when prop changes
  useEffect(() => {
    setSelectedType(defaultType);
    setReport(null);
  }, [defaultType]);

  // Fetch accounts and stores lists on startup
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [resAccounts, resStores] = await Promise.all([
          axios.get("/api/data-center/accounts-performance").catch(() => ({ data: { rows: [] } })),
          axios.get("/api/stores").catch(() => ({ data: [] }))
        ]);
        
        if (resAccounts.data && resAccounts.data.rows) {
          setAccountsList(resAccounts.data.rows);
        } else if (Array.isArray(resAccounts.data)) {
          setAccountsList(resAccounts.data);
        }

        if (Array.isArray(resStores.data)) {
          setStoresList(resStores.data);
          if (resStores.data.length > 0) {
            setSelectedStore(String(resStores.data[0].id));
          }
        }
      } catch (err) {
        console.error("Error fetching analysis center metadata:", err);
      }
    };
    fetchMetadata();
  }, []);

  const diagnosticScopes = [
    { type: "account_analysis", label: "广告账户投放提效", desc: "诊断花费累积与 ROAS 控制率", icon: Activity, severity: "healthy" },
    { type: "store_analysis", label: "店铺整店成效体检", desc: "交叉比对消费与独立站订单", icon: ShoppingBag, severity: "warning" },
    { type: "creative_analysis", label: "素材饱和衰退审计", desc: "对爆量素材深度疲劳检测", icon: Flame, severity: "info" },
    { type: "product_analysis", label: "爆款商品毛利归因", desc: "核查热卖商品退款与商业利润", icon: Package, severity: "healthy" },
    { type: "country_analysis", label: "受众国家转化差异", desc: "探照全球投放单价严重出超区", icon: Globe, severity: "warning" },
    { type: "unmapped_spend_risk", label: "漏油失控花费审计", desc: "自检未绑定账号的静默消耗", icon: ShieldAlert, severity: "critical" },
    { type: "token_api_health", label: "Meta API 信道侦测", desc: "探照授权凭证及同步时限", icon: Settings, severity: "healthy" },
    { type: "data_health_summary", label: "数据底层健康勾稽", desc: "汇总订单对账、像素抓单行一致性", icon: Database, severity: "healthy" }
  ];

  const handleRunDiagnostic = async () => {
    setLoading(true);
    setReport(null);

    const steps = [
      "正在收集物理数据维度...",
      "正在交叉勾稽 FactMetaPerformance 事实源...",
      "正在抽调关联 Orders 交易流水...",
      "正在加载 Token 令牌健康状态...",
      "正在调度 AI 决策模型评测指标..."
    ];

    let i = 0;
    setLoadingMsg(steps[0]);
    const interval = setInterval(() => {
      i++;
      if (i < steps.length) {
        setLoadingMsg(steps[i]);
      }
    }, 600);

    try {
      const entityId = selectedType === "account_analysis" 
        ? selectedAccount 
        : (selectedType === "store_analysis" ? selectedStore : "global");

      const response = await axios.post("/api/ai-analysis/generate", {
        type: selectedType,
        entityType: selectedType === "account_analysis" ? "account" : (selectedType === "store_analysis" ? "store" : "system"),
        entityId,
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd")
      });

      setReport(response.data.report || response.data);
      toast.success("🎯 AI 诊断完成！报告已实时渲染并落库归档。");
    } catch (err: any) {
      console.error(err);
      toast.error(`诊断失败: ${err.response?.data?.error || err.message}`);
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  const updateSuggestionStatus = async (suggId: string, newStatus: string) => {
    try {
      await axios.post(`/api/intelligence/suggestions/${suggId}/status`, { status: newStatus });
      toast.success(`建议已标记为 ${newStatus === "applied" ? "已实施" : "已忽略"}`);
      // Update local report suggestion state
      if (report && report.recommendations) {
        setReport({
          ...report,
          recommendations: report.recommendations.map((r: any) => 
            r.id === suggId ? { ...r, status: newStatus } : r
          )
        });
      }
    } catch (err) {
      toast.error("建议状态更新失败");
    }
  };

  const getSeverityColors = (sev: string) => {
    switch (sev?.toLowerCase()) {
      case "critical":
        return { text: "text-red-700 bg-red-50 border-red-200", badge: "bg-red-500 text-white" };
      case "warning":
        return { text: "text-amber-700 bg-amber-50 border-amber-200", badge: "bg-amber-500 text-slate-900" };
      case "healthy":
        return { text: "text-emerald-700 bg-emerald-50 border-emerald-200", badge: "bg-emerald-500 text-white" };
      default:
        return { text: "text-blue-700 bg-blue-50 border-blue-200", badge: "bg-blue-500 text-white" };
    }
  };

  const getSeverityText = (sev: string) => {
    switch (sev?.toLowerCase()) {
      case "critical": return "极高危风险 / CRITICAL";
      case "warning": return "中重度警告 / WARNING";
      case "healthy": return "成效优秀 / HEALTHY";
      default: return "常规诊断 / INFORMATIONAL";
    }
  };

  const activeScope = diagnosticScopes.find(s => s.type === selectedType);

  return (
    <div className="space-y-6 font-sans text-slate-900">
      {/* Top Description Hub */}
      <div className="border border-slate-200 rounded-2xl bg-white p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-500 font-mono">
              AI Buy-Side OS Analysis Engine
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            AI Analysis Center / 智能诊断中心
          </h1>
          <p className="text-slate-500 text-sm max-w-3xl">
            系统深度对账、成效归因及投放风控的最高决策中枢。汇集 8 种事实源指标交叉验算，不采用任何模拟虚无指标，生成由可信事实支撑的人工可作业建议。
          </p>
        </div>
        <div className="flex items-center gap-2 p-2 bg-slate-100 rounded-xl text-xs font-mono text-slate-500">
          <span>📅 时段: {format(startDate, "yyyy/MM/dd")} - {format(endDate, "yyyy/MM/dd")}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Targets Menu Control */}
        <div className="lg:col-span-4 space-y-4">
          <div className="border border-slate-200 bg-white rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider font-mono">
              Diagnostic Dimens / 诊断靶向维度
            </h3>

            <div className="space-y-1">
              {diagnosticScopes.map((scope) => {
                const Icon = scope.icon;
                const isSelected = selectedType === scope.type;
                return (
                  <button
                    key={scope.type}
                    onClick={() => {
                      setSelectedType(scope.type);
                      setReport(null);
                    }}
                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-left ${
                      isSelected
                        ? "bg-slate-900 text-white shadow-md ring-2 ring-slate-900/10"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isSelected ? "bg-slate-800 text-blue-400" : "bg-slate-100 text-slate-500"}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className={`text-[13px] font-bold ${isSelected ? "text-white" : "text-slate-800"}`}>
                          {scope.label}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate max-w-[180px] mt-0.5">
                          {scope.desc}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 opacity-50 ${isSelected ? "text-blue-400" : ""}`} />
                  </button>
                );
              })}
            </div>

            {/* Config target parameters dynamically if applicable */}
            {selectedType === "account_analysis" && (
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <label className="text-xs font-bold text-slate-700">选择诊断广告账户</label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-900/10 focus:outline-none focus:border-slate-400 transition-colors"
                >
                  <option value="all">- 所有在录广告账户 / All Mapped -</option>
                  {accountsList.map((act) => (
                    <option key={act.id || act.fb_account_id} value={act.fb_account_id}>
                      {act.fb_account_name || act.fb_account_id} ({act.fb_account_id})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedType === "store_analysis" && (
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <label className="text-xs font-bold text-slate-700">选择诊断 Shopify 店铺</label>
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-900/10 focus:outline-none focus:border-slate-400 transition-colors"
                >
                  {storesList.length === 0 ? (
                    <option value="">(当前暂无店铺记录)</option>
                  ) : (
                    storesList.map((store) => (
                      <option key={store.id} value={store.id}>
                        🏢 {store.name} ({store.platform})
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {/* Diagnostic Button */}
            <button
              onClick={handleRunDiagnostic}
              disabled={loading}
              className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-bold rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "执行 AI 全账体检中..." : "启动 AI 智能对账体检"}
            </button>
          </div>
        </div>

        {/* Right Side: Terminals / Core analysis reports display */}
        <div className="lg:col-span-8 space-y-6">
          {loading && (
            <div className="border border-slate-200 bg-white rounded-2xl p-12 shadow-sm flex flex-col items-center justify-center text-center space-y-4 min-h-[450px]">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-blue-105 border-t-blue-600 animate-spin"></div>
                <Brain className="w-8 h-8 text-blue-600 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-pulse" />
              </div>
              <div className="space-y-1.5 pt-2">
                <h4 className="text-md font-bold text-slate-900">正在生成高精度交叉审计报告...</h4>
                <p className="text-xs text-slate-500 font-mono italic animate-pulse">{loadingMsg}</p>
              </div>
            </div>
          )}

          {!loading && !report && (
            <div className="border border-slate-200 bg-white/50 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-4 min-h-[450px]">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                <Brain className="w-8 h-8 text-slate-400" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h4 className="text-sm font-bold text-slate-800">就绪：等待调配 AI 提效雷达</h4>
                <p className="text-xs text-slate-500">
                  请在左侧选择需要审计的维度参数（如 <b>{activeScope?.label}</b>），点击“启动 AI 智能对账体检”按钮。AI 将实时对数据库进行全量交叉审计，寻找漏失预算并提出人工作业建议。
                </p>
              </div>
            </div>
          )}

          {!loading && report && (
            <div className="space-y-6">
              {/* Primary Report Card Panel */}
              <div className="border border-slate-200 bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Header Row banner */}
                <div className={`p-5 border-b flex items-center justify-between ${getSeverityColors(report.severity).text}`}>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold tracking-wider uppercase opacity-80 font-mono">
                      诊断结论评测等级 / DIAGNOSTIC RANK
                    </span>
                    <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                      {report.title}
                    </h2>
                  </div>
                  <span className={`px-3 py-1 text-xs font-black rounded-full font-mono shadow-sm ${getSeverityColors(report.severity).badge}`}>
                    {getSeverityText(report.severity)}
                  </span>
                </div>

                {/* Limitations and Data Basis Alert */}
                {report.limitations && report.limitations.length > 0 && (
                  <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 space-y-2">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Lock className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-bold uppercase tracking-wider font-mono">物理归因限制与数据说明 / Limitations & Warnings</span>
                    </div>
                    <ul className="space-y-1.5">
                      {report.limitations.map((lim: string, idx: number) => (
                        <li key={idx} className="text-xs text-slate-600 flex items-start gap-1.5">
                          <span className="text-slate-400 font-mono font-bold">[{idx + 1}]</span>
                          <span>{lim}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Report Core Summary Block */}
                <div className="p-6 space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xs font-black uppercase text-slate-400 font-mono">诊断摘要 / Diagnostic Summary</h3>
                    <div className="text-sm text-slate-800 bg-slate-50 p-4 rounded-xl leading-relaxed whitespace-pre-wrap font-sans border border-slate-100">
                      {report.summary}
                    </div>
                  </div>

                  {/* Scientific True Metrics Block */}
                  {report.metrics && Object.keys(report.metrics).length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-black uppercase text-slate-400 font-mono">演算核心事实参数 / Core Metrics Evaluated</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {Object.entries(report.metrics)
                          .filter(([key, val]) => typeof val === "number")
                          .map(([key, value]: [string, any]) => {
                            let formattedVal = String(value);
                            if (key.toLowerCase().includes("spend") || key.toLowerCase().includes("sales") || key.toLowerCase().includes("revenue") || key.toLowerCase().includes("value") || key.toLowerCase().includes("profit")) {
                              formattedVal = `$${Number(value).toFixed(2)}`;
                            } else if (key.toLowerCase().includes("roas")) {
                              formattedVal = `${Number(value).toFixed(2)}x`;
                            } else if (key.toLowerCase().includes("ctr")) {
                              formattedVal = `${Number(value).toFixed(2)}%`;
                            } else if (key.toLowerCase().includes("refundrate")) {
                              formattedVal = `${Number(value).toFixed(1)}%`;
                            } else if (value % 1 !== 0) {
                              formattedVal = Number(value).toFixed(2);
                            } else {
                              formattedVal = Number(value).toLocaleString();
                            }

                            // Humanize metric label keys
                            let displayKey = key.replace(/([A-Z])/g, " $1").trim();
                            if (key === "totalSales") displayKey = "整店销售额";
                            if (key === "adSpend") displayKey = "Meta 广告花费";
                            if (key === "realRoas") displayKey = "整店真实 ROAS";
                            if (key === "ordersCount") displayKey = "系统交易订单数";
                            if (key === "spend") displayKey = "广告消耗";
                            if (key === "roas") displayKey = "Meta 账面 ROAS";
                            if (key === "ctr") displayKey = "点击率 (CTR)";
                            if (key === "clicks") displayKey = "点击数";
                            if (key === "purchases") displayKey = "购买数";

                            return (
                              <div key={key} className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                                <span className="text-[10px] font-semibold text-slate-400 block truncate uppercase">{displayKey}</span>
                                <span className="text-sm font-black text-slate-800 font-mono">{formattedVal}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Findings Bullet Points */}
                  {report.findings && report.findings.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-black uppercase text-slate-400 font-mono">底层勾稽专项发现 / Specific Findings</h3>
                      <div className="space-y-1.5">
                        {report.findings.map((find: string, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                            <span className="text-red-500 font-bold mt-0.5">•</span>
                            <span>{find}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Data Source verification */}
                <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>🛰️ 对账数据流: {report.dataSourceExplain}</span>
                  <span>生成时间: {report.generatedAt ? format(new Date(report.generatedAt), "HH:mm:ss") : format(new Date(), "HH:mm:ss")}</span>
                </div>
              </div>

              {/* Actionable recommendations card board */}
              {report.recommendations && report.recommendations.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-blue-600" />
                    <h3 className="text-sm font-bold text-slate-800">人工确认建议行动方案 / Recommended Actions (Requiring Human Action)</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {report.recommendations.map((rec: any, idx: number) => {
                      const isExecuted = rec.status === "applied";
                      const isIgnored = rec.status === "ignored";

                      return (
                        <div 
                          key={idx} 
                          className={`p-5 border rounded-xl flex flex-col justify-between space-y-4 transition-all bg-white relative overflow-hidden ${
                            isExecuted ? "border-emerald-200 opacity-80" : isIgnored ? "border-slate-200 opacity-60" : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          {/* Banner background status tags */}
                          {isExecuted && (
                            <div className="absolute top-0 right-0 bg-emerald-500 text-white px-2 py-0.5 text-[8px] font-black uppercase tracking-wider font-mono">
                              已标记实施 / Completed
                            </div>
                          )}
                          {isIgnored && (
                            <div className="absolute top-0 right-0 bg-slate-400 text-white px-2 py-0.5 text-[8px] font-black uppercase tracking-wider font-mono">
                              已忽略 / Ignored
                            </div>
                          )}

                          <div className="space-y-2">
                            <div className="flex items-start justify-between">
                              <span className={`px-2 py-0.5 text-[9px] font-black rounded font-mono ${
                                rec.priority === 1 ? "bg-red-50 text-red-600" : (rec.priority === 2 ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600")
                              }`}>
                                {rec.priority === 1 ? "紧急 / Urgent" : (rec.priority === 2 ? "重要 / High" : "日常 / Medium")}
                              </span>
                            </div>

                            <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-600">
                              {rec.action}
                            </h4>
                            <p className="text-xs text-slate-500 font-normal leading-relaxed">
                              {rec.rationale}
                            </p>
                          </div>

                          {/* Human Action buttons */}
                          {!isExecuted && !isIgnored && rec.id && (
                            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                              <button
                                onClick={() => updateSuggestionStatus(rec.id, "applied")}
                                className="flex-1 py-1.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 text-[11px] font-bold rounded-lg transition-all"
                              >
                                确认标记已实施
                              </button>
                              <button
                                onClick={() => updateSuggestionStatus(rec.id, "ignored")}
                                className="px-2 py-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 text-[11px] font-bold rounded-lg transition-all"
                              >
                                忽略
                              </button>
                            </div>
                          )}

                          {/* Fallback mock actions action if DB doesn't have an ID yet (offline rule card tags representation) */}
                          {!rec.id && (
                            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                <Lock className="w-3 h-3 text-slate-300" />
                                <span>在 [建议中心] 对应标记此作业</span>
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
