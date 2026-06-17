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

  const [showDebugIssues, setShowDebugIssues] = useState<boolean>(false);
  const [appliedIssues, setAppliedIssues] = useState<Record<string, boolean>>({});

  const toggleIssueApplied = (issueId: string) => {
    setAppliedIssues(prev => ({
      ...prev,
      [issueId]: !prev[issueId]
    }));
    toast.success("已更新作业项实施状态");
  };

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
    { type: "data_health_summary", label: "数据底层健康勾稽", desc: "汇总订单对账、像素抓单行一致性", icon: Database, severity: "healthy" },
    { type: "system_rule_diagnostics", label: "规则诊断引擎大盘", desc: "不依赖 AI，一键物理逻辑审计并进行诊断分析", icon: ShieldAlert, severity: "critical" }
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

      let response;
      if (selectedType === "system_rule_diagnostics") {
        response = await axios.post("/api/diagnostics/issues", {
          startDate: format(startDate, "yyyy-MM-dd"),
          endDate: format(endDate, "yyyy-MM-dd"),
          accountId: selectedAccount !== "all" ? selectedAccount : undefined,
          storeId: selectedStore ? Number(selectedStore) : undefined,
          includeDebug: true
        });

        const data = response.data;
        if (data.success) {
          setReport({
            isDiagnosticIssuesReport: true,
            title: "全链条规则诊断引擎离线质检报告",
            severity: data.summary.productionCount > 0 ? "critical" : (data.summary.noticeCount > 0 ? "warning" : "healthy"),
            summary: `【离线规则诊断引擎分析成果 - Offline Rule Engine】\n\n系统已全速解算分析周期为 ${format(startDate, "yyyy-MM-dd")} 至 ${format(endDate, "yyyy-MM-dd")} 的在账财务数据。\n\n检测到当前活跃投放广告账户数：${data.summary.activeAccountCount} 个。\n一键全链物理勾稽审计发现：符合生产安全卡片的主体建议共 ${data.summary.productionCount} 条；底层数据合规性通知与信道健康警告共 ${data.summary.noticeCount} 条；另外过滤拦截了 ${data.summary.debugInvalidCount} 条缺少物理证据或格式不合规的调试日志。`,
            metrics: {
              activeAccounts: data.summary.activeAccountCount,
              productionIssues: data.summary.productionCount,
              dataHealthNotices: data.summary.noticeCount,
              debugInvalidItems: data.summary.debugInvalidCount
            },
            issues: data.issues,
            summaryStats: data.summary,
            dataSourceExplain: "Offline Database Engine (Real Orders & Meta Performances Check)",
            generatedAt: new Date().toISOString()
          });
          toast.success("🎯 离线物理规则诊断引擎：一键质检完成！");
        } else {
          toast.error("离线规则诊断失败: " + (data.error || "未知故障"));
        }
      } else {
        response = await axios.post("/api/ai-analysis/generate", {
          type: selectedType,
          entityType: selectedType === "account_analysis" ? "account" : (selectedType === "store_analysis" ? "store" : "system"),
          entityId,
          startDate: format(startDate, "yyyy-MM-dd"),
          endDate: format(endDate, "yyyy-MM-dd")
        });

        setReport(response.data.report || response.data);
        toast.success("🎯 AI 诊断完成！报告已实时渲染并落库归档。");
      }
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
              {report.isDiagnosticIssuesReport ? (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-100 border border-slate-200 rounded-2xl p-4 gap-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs bg-indigo-150 text-indigo-700 font-black px-2.5 py-1 rounded-lg border border-indigo-200">
                        生产型主力建议 (Production): {report.summaryStats.productionCount} 条
                      </span>
                      <span className="text-xs bg-amber-100 text-amber-700 font-black px-2.5 py-1 rounded-lg border border-amber-200">
                        合规性对账通知 (Notice): {report.summaryStats.noticeCount} 条
                      </span>
                      <span className="text-xs bg-slate-200 text-slate-700 font-black px-2.5 py-1 rounded-lg border border-slate-300">
                        调试与安全拦截 (Debug): {report.summaryStats.debugInvalidCount} 条
                      </span>
                    </div>
                    <div>
                      <button 
                        onClick={() => setShowDebugIssues(prev => !prev)}
                        className="text-xs text-blue-600 hover:text-blue-750 underline font-black shrink-0 font-sans cursor-pointer"
                      >
                        {showDebugIssues ? "隐藏" : "展开"} Debug 级别安全拦截层
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {report.issues
                      .filter((is: any) => showDebugIssues ? true : is.category !== "debug_invalid")
                      .map((issue: any) => {
                        const isDone = !!appliedIssues[issue.issueId];
                        return (
                          <div 
                            key={issue.issueId} 
                            className={`p-5 border bg-white rounded-xl flex flex-col justify-between space-y-4 shadow-sm hover:shadow-md transition-all relative overflow-hidden ${
                              issue.category === "production_suggestion" 
                                ? "border-l-[6px] border-l-indigo-600 border-slate-200" 
                                : (issue.category === "data_health_notice" ? "border-l-[6px] border-l-amber-500 border-slate-200" : "border-l-[6px] border-l-slate-300 border-slate-200")
                            } ${isDone ? "opacity-60 bg-slate-50/50" : ""}`}
                          >
                            {isDone && (
                              <div className="absolute top-0 right-0 bg-emerald-500 text-white px-2 py-0.5 text-[8px] font-black uppercase font-mono tracking-wider">
                                已标记实施 / Completed
                              </div>
                            )}
                            <div className="space-y-3">
                              <div className="flex justify-between items-start gap-2">
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded font-mono ${
                                  issue.category === "production_suggestion" 
                                    ? "bg-indigo-50 text-indigo-600 border border-indigo-100" 
                                    : (issue.category === "data_health_notice" ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-slate-105 text-slate-500 border border-slate-200")
                                }`}>
                                  {issue.category === "production_suggestion" ? "生产型建议 / Production-Sugg" : (issue.category === "data_health_notice" ? "对账健康通知 / Data-Notice" : "拦截审计调试 / Debug-Invalid")}
                                </span>
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 font-mono">
                                  {issue.actionVerb} @ {issue.actionTarget}
                                </span>
                              </div>

                              <h4 className="text-sm font-black text-slate-900 leading-snug">
                                {issue.title}
                              </h4>
                              <p className="text-xs text-slate-650 font-medium leading-relaxed bg-slate-50/70 p-3 rounded-lg border border-slate-100 font-sans">
                                {issue.oneLineReason}
                              </p>

                              {/* Metrics details */}
                              {issue.evidence?.metrics && (
                                <div className="bg-indigo-50/20 border border-indigo-100/50 rounded-lg p-2.5 space-y-1.5 text-xs text-slate-600 font-mono">
                                  <div className="text-[10px] text-slate-450 font-black uppercase tracking-wide">
                                    物理事实依据 Snapshots:
                                  </div>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {Object.entries(issue.evidence.metrics)
                                      .filter(([_, v]) => typeof v === "number" || typeof v === "string")
                                      .slice(0, 6)
                                      .map(([k, v]) => {
                                        let strVal = String(v);
                                        if (k.toLowerCase().includes("spend") || k.toLowerCase().includes("value") || k.toLowerCase().includes("revenue")) {
                                          strVal = `$${Number(v).toFixed(0)}`;
                                        } else if (k.toLowerCase().includes("roas")) {
                                          strVal = `${Number(v).toFixed(1)}x`;
                                        } else if (k.toLowerCase().includes("ctr")) {
                                          strVal = `${Number(v).toFixed(1)}%`;
                                        } else if (k.toLowerCase().includes("rate")) {
                                          strVal = `${Number(v).toFixed(0)}%`;
                                        }
                                        return (
                                          <div key={k} className="bg-white/85 p-1.5 rounded border border-indigo-100/10 text-center text-[10px]">
                                            <p className="text-slate-400 font-semibold truncate leading-tight uppercase text-[9px]">{k}</p>
                                            <p className="text-slate-800 font-black truncate text-[10px]">{strVal}</p>
                                          </div>
                                        );
                                      })
                                    }
                                  </div>
                                </div>
                              )}

                              {/* Limitations check */}
                              {issue.limitations && issue.limitations.length > 0 && (
                                <div className="text-[10px] bg-amber-50 text-amber-700 rounded p-1.5 leading-relaxed flex items-start gap-1 font-sans border border-amber-100">
                                  <span className="font-bold shrink-0">⚠️ 局限限制:</span>
                                  <span>{issue.limitations.join(" ")}</span>
                                </div>
                              )}

                              {/* Entity references jump lock */}
                              {issue.entityRefs && issue.entityRefs.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {issue.entityRefs.map((ent: any, i: number) => (
                                    <div key={i} className="group/btn relative inline-block">
                                      <button disabled className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-400 text-[9px] font-bold rounded border border-slate-200 cursor-not-allowed flex items-center gap-1 shrink-0">
                                        <Lock className="w-3 h-3 text-slate-350" />
                                        <span>定位 {ent.entityName || ent.entityId} ({ent.entityType})</span>
                                      </button>
                                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] px-2 py-1 rounded shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-normal w-36 z-10 text-center mb-1 leading-normal font-sans">
                                        未开通前端跳转链路，禁止投流泄油。
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex gap-2 pt-2 border-t border-slate-100 select-none font-sans">
                              <button 
                                onClick={() => toggleIssueApplied(issue.issueId)}
                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                  isDone 
                                    ? "bg-slate-200 text-slate-700 hover:bg-slate-250" 
                                    : "bg-indigo-50 text-indigo-750 hover:bg-indigo-600 hover:text-white"
                                }`}
                              >
                                {isDone ? "恢复为未操作" : "确认人工操作并标记实施"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ) : report.recommendations && report.recommendations.length > 0 ? (() => {
                const safeRecs: any[] = [];
                const filteredDebugRecs: any[] = [];

                report.recommendations.forEach((rec: any) => {
                  let parsedMeta: any = null;
                  if (rec.metadata) {
                    try {
                      parsedMeta = typeof rec.metadata === "string" ? JSON.parse(rec.metadata) : rec.metadata;
                    } catch (e) {
                      console.warn("Failed parsing recommendation metadata", e);
                    }
                  }

                  const meta = parsedMeta;
                  const isTraceable = !!(
                    meta &&
                    meta.entityRefs && Array.isArray(meta.entityRefs) && meta.entityRefs.length > 0 &&
                    meta.evidence &&
                    meta.sourceTables && Array.isArray(meta.sourceTables) && meta.sourceTables.length > 0 &&
                    meta.route &&
                    meta.actionVerb &&
                    meta.actionTarget &&
                    meta.generationMode
                  );

                  // Guard forbidden codes and keywords
                  const textForScan = `${rec.action} ${rec.rationale} ${meta?.title || ""} ${meta ? JSON.stringify(meta.entityRefs) : ""}`.toLowerCase();
                  const hasMock = /cr0[1-5]/.test(textForScan);
                  const hasForbidden = /artificial|manual_intervention|manual_review|manual_adjustment|人工介入|人工审阅|人工调配/.test(textForScan);

                  if (isTraceable && !hasMock && !hasForbidden) {
                    safeRecs.push({ ...rec, parsedMeta });
                  } else {
                    filteredDebugRecs.push({ ...rec, parsedMeta });
                  }
                });

                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-blue-600" />
                      <h3 className="text-sm font-bold text-slate-800">人工确认建议行动方案 / Recommended Actions (Requiring Human Action)</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {safeRecs.map((rec: any, idx: number) => {
                        const isExecuted = rec.status === "applied";
                        const isIgnored = rec.status === "ignored";
                        const meta = rec.parsedMeta || {};

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
                                <span className="text-[9px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono font-bold">
                                  {meta.actionVerb?.toUpperCase()} @ {meta.actionTarget}
                                </span>
                              </div>

                              <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-600">
                                {meta.title || rec.action}
                              </h4>
                              <p className="text-xs text-slate-500 font-normal leading-relaxed">
                                {rec.rationale}
                              </p>

                              {/* Evidence metrics panel */}
                              {meta.evidence && (
                                <div className="mt-2 bg-indigo-50/20 border border-indigo-100/60 p-2.5 rounded-lg space-y-1.5">
                                  <div className="flex items-center gap-1 text-[10px] text-indigo-700 font-bold">
                                    <Database className="w-3.5 h-3.5" />
                                    <span>对账事实依据 (Evidence)</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1 text-center font-mono text-[9px] text-slate-600">
                                    <div className="bg-white p-1 rounded border border-indigo-100/30">
                                      <p className="text-slate-400">SPEND</p>
                                      <p className="font-bold">${Number(meta.evidence.metrics?.spend || 0).toLocaleString()}</p>
                                    </div>
                                    <div className="bg-white p-1 rounded border border-indigo-100/30">
                                      <p className="text-slate-400">ROAS</p>
                                      <p className="font-bold">{Number(meta.evidence.metrics?.roas || 0).toFixed(2)}x</p>
                                    </div>
                                    <div className="bg-white p-1 rounded border border-indigo-100/30">
                                      <p className="text-slate-400">CPA</p>
                                      <p className="font-bold">${Number(meta.evidence.metrics?.cpa || 0).toFixed(2)}</p>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Jumps Disabled Tooltip */}
                              {meta.entityRefs && (
                                <div className="pt-1 flex items-center gap-1">
                                  {meta.entityRefs.map((ent: any, i: number) => (
                                    <div key={i} className="group/btn relative inline-block">
                                      <button
                                        disabled
                                        className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-300 text-[9px] font-bold rounded border border-slate-200 cursor-not-allowed flex items-center gap-1"
                                      >
                                        <Lock className="w-3 h-3" />
                                        <span>跳转 {ent.entityName || ent.entityId} ({ent.entityType})</span>
                                      </button>
                                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] px-2 py-1 rounded shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-normal w-40 z-10 text-center mb-1 leading-normal font-sans">
                                        暂未接入详情页，无法作为正式建议。
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
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

                            {/* Fallback default actions action if DB doesn't have an ID yet */}
                            {!rec.id && (
                              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                  <Lock className="w-3 h-3 text-slate-300" />
                                  <span>在 [建议中心] 对标记此作业</span>
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {safeRecs.length === 0 && (
                        <div className="col-span-full border border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400 text-xs">
                          此项诊断未筛选出符合生产安全及证据完整的闭环作业建议。
                        </div>
                      )}
                    </div>

                    {/* Collapsible details for filtered out suggestions in the analysis center */}
                    {filteredDebugRecs.length > 0 && (
                      <div className="mt-4 bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-2">
                        <summary className="text-[11px] font-mono font-bold text-slate-500 cursor-pointer list-none select-none flex items-center gap-1.5">
                          <Settings className="w-3.5 h-3.5" />
                          <span>开发调试安全过滤拦截记录 (Hidden Filtered out recommendation counts: {filteredDebugRecs.length})</span>
                        </summary>
                        <div className="space-y-1 pt-1.5">
                          {filteredDebugRecs.map((rec: any, idx: number) => (
                            <div key={idx} className="text-[10px] font-mono text-slate-400 bg-white p-2 rounded border border-slate-150 flex justify-between items-center">
                              <span>「{rec.action}」-{rec.rationale}</span>
                              <span className="text-red-500 font-bold shrink-0">
                                [该建议缺少证据链，已安全隐藏，不参与实际经营决策]
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
