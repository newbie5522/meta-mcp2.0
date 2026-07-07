import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle,
  Database,
  HelpCircle,
  RefreshCw,
  Send,
  ShoppingBag,
  User
} from "lucide-react";
import { toast } from "sonner";
import { MetaAccountDisplay, metaAccountOptionLabel } from "./common/MetaAccountDisplay";

interface AIAnalysisCenterProps {
  startDate: Date;
  endDate: Date;
  defaultType?: string;
}

type AiMode = "ai_model" | "rule_fallback";
type EntityType = "account" | "store" | "creative" | "system";

interface AiWorkbenchCard {
  id: string;
  source: "auto" | "manual";
  analysisType: string;
  entityType: EntityType;
  entityId: string;
  entityName?: string;
  priority: "high" | "medium" | "low";
  title: string;
  summary: string;
  evidence: {
    startDate: string;
    endDate: string;
    metrics: Record<string, any>;
    dataSources: string[];
  };
  recommendation: {
    judgment: string;
    action: string;
    budgetAction?: string;
    observationWindow: string;
    riskControl: string;
    nextCheck: string;
  };
  aiMode: AiMode;
  createdAt: string;
}

interface AiWorkbenchOverview {
  success: true;
  generatedAt: string;
  dateRange: { startDate: string; endDate: string };
  aiSummary: string;
  coverage: {
    activeAccountsScanned: number;
    activeStoresScanned: number;
    businessCardsGenerated: number;
    dataHealthNotices: number;
  };
  cards: AiWorkbenchCard[];
  dataHealthNotices: any[];
  aiRuntime: {
    enabled: boolean;
    mode: AiMode;
  };
}

const analysisTypeOptions = [
  { value: "account_performance", label: "账户表现分析" },
  { value: "store_performance", label: "店铺经营分析" },
  { value: "creative_performance", label: "素材表现分析" },
  { value: "funnel_diagnosis", label: "转化漏斗诊断" },
  { value: "data_health", label: "数据健康检测" }
];

const entityTypeOptions: { value: EntityType; label: string }[] = [
  { value: "account", label: "广告账户" },
  { value: "store", label: "店铺" },
  { value: "creative", label: "素材 / 广告" },
  { value: "system", label: "系统数据健康" }
];

function mapDefaultType(defaultType?: string): string {
  if (defaultType === "store_analysis") return "store_performance";
  if (defaultType === "creative_analysis") return "creative_performance";
  if (defaultType === "data_health_summary" || defaultType === "system_rule_diagnostics") return "data_health";
  return "account_performance";
}

function getAccountId(account: any): string {
  return String(account.fb_account_id || account.account_id || account.accountId || account.id || "").trim();
}

function getAccountName(account: any): string {
  return String(account.fb_account_name || account.name || account.accountName || getAccountId(account));
}

function formatMetricValue(key: string, value: any): string {
  if (value === null || value === undefined || value === "") return "暂无";
  const numberValue = typeof value === "number" ? value : Number(value);
  const lowerKey = key.toLowerCase();

  if (Number.isFinite(numberValue)) {
    if (lowerKey.includes("spend") || lowerKey.includes("revenue") || lowerKey.includes("value") || lowerKey.includes("cpa") || lowerKey.includes("cpc")) {
      return `$${numberValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    if (lowerKey.includes("roas")) {
      return `${numberValue.toFixed(2)}x`;
    }
    if (lowerKey.includes("ctr")) {
      return `${numberValue.toFixed(2)}%`;
    }
    return numberValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return String(value);
}

function priorityLabel(priority: AiWorkbenchCard["priority"]): string {
  if (priority === "high") return "高优先级";
  if (priority === "medium") return "中优先级";
  return "低优先级";
}

function priorityClass(priority: AiWorkbenchCard["priority"]): string {
  if (priority === "high") return "bg-red-50 text-red-700 border-red-200";
  if (priority === "medium") return "bg-slate-50 text-slate-700 border-slate-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

function aiModeLabel(mode: AiMode): string {
  return mode === "ai_model" ? "AI模型增强" : "规则兜底，未配置 AI Key";
}

function metricEntries(metrics: Record<string, any> | undefined) {
  if (!metrics) return [];
  const preferred = ["spend", "roas", "realRoas", "purchases", "ctr", "cpc", "cpa", "revenue", "ordersCount"];
  const seen = new Set<string>();
  const entries: [string, any][] = [];

  preferred.forEach((key) => {
    if (metrics[key] !== undefined && metrics[key] !== null) {
      entries.push([key, metrics[key]]);
      seen.add(key);
    }
  });

  Object.entries(metrics).forEach(([key, value]) => {
    if (!seen.has(key) && entries.length < 9 && value !== null && value !== undefined && value !== "") {
      entries.push([key, value]);
    }
  });

  return entries.slice(0, 9);
}

export function AIAnalysisCenter({ startDate, endDate, defaultType = "account_analysis" }: AIAnalysisCenterProps) {
  const startDateStr = useMemo(() => format(startDate, "yyyy-MM-dd"), [startDate]);
  const endDateStr = useMemo(() => format(endDate, "yyyy-MM-dd"), [endDate]);

  const [overview, setOverview] = useState<AiWorkbenchOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [storesList, setStoresList] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedStore, setSelectedStore] = useState("");
  const [creativeEntityId, setCreativeEntityId] = useState("");

  const [manualAnalysisType, setManualAnalysisType] = useState(mapDefaultType(defaultType));
  const [manualEntityType, setManualEntityType] = useState<EntityType>("account");
  const [manualQuestion, setManualQuestion] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualCard, setManualCard] = useState<AiWorkbenchCard | null>(null);

  const [openFollowUpCardId, setOpenFollowUpCardId] = useState<string | null>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<Record<string, string>>({});
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  const [followUpLoading, setFollowUpLoading] = useState<Record<string, boolean>>({});
  const [rerunCardId, setRerunCardId] = useState<string | null>(null);

  useEffect(() => {
    setManualAnalysisType(mapDefaultType(defaultType));
  }, [defaultType]);

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [accountsResponse, storesResponse] = await Promise.all([
          axios.get("/api/data-center/accounts-performance").catch(() => ({ data: { rows: [] } })),
          axios.get("/api/stores").catch(() => ({ data: [] }))
        ]);

        const accounts = Array.isArray(accountsResponse.data?.rows)
          ? accountsResponse.data.rows
          : (Array.isArray(accountsResponse.data) ? accountsResponse.data : []);
        const stores = Array.isArray(storesResponse.data) ? storesResponse.data : [];

        setAccountsList(accounts);
        setStoresList(stores);

        if (!selectedAccount && accounts.length > 0) {
          setSelectedAccount(getAccountId(accounts[0]));
        }
        if (!selectedStore && stores.length > 0) {
          setSelectedStore(String(stores[0].id));
        }
      } catch (error) {
        console.error("Failed to load AI workbench metadata", error);
      }
    };

    fetchMetadata();
  }, []);

  const fetchOverview = async () => {
    setOverviewLoading(true);
    setOverviewError(null);

    try {
      const response = await axios.get("/api/ai-analysis/workbench/overview", {
        params: {
          startDate: startDateStr,
          endDate: endDateStr
        }
      });
      setOverview(response.data);
    } catch (error: any) {
      const message = error.response?.data?.error || error.message || "加载自动扫描结果失败";
      setOverviewError(message);
      toast.error(message);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [startDateStr, endDateStr]);

  const manualEntityId = useMemo(() => {
    if (manualEntityType === "account") return selectedAccount;
    if (manualEntityType === "store") return selectedStore;
    if (manualEntityType === "creative") return creativeEntityId.trim();
    return "system";
  }, [creativeEntityId, manualEntityType, selectedAccount, selectedStore]);

  const runManualAnalysis = async (override?: Partial<{ analysisType: string; entityType: EntityType; entityId: string; question: string }>) => {
    const analysisType = override?.analysisType || manualAnalysisType;
    const entityType = override?.entityType || manualEntityType;
    const entityId = override?.entityId || manualEntityId;
    const question = override?.question ?? manualQuestion;

    if (!entityId) {
      toast.error("请先选择或输入分析对象");
      return;
    }

    setManualLoading(true);
    try {
      const response = await axios.post("/api/ai-analysis/workbench/manual", {
        analysisType,
        entityType,
        entityId,
        startDate: startDateStr,
        endDate: endDateStr,
        question
      });
      setManualCard(response.data.card);
      toast.success("AI 分析已生成");
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || "生成 AI 分析失败");
    } finally {
      setManualLoading(false);
      setRerunCardId(null);
    }
  };

  const handleRerunCard = async (card: AiWorkbenchCard) => {
    setRerunCardId(card.id);
    await runManualAnalysis({
      analysisType: card.analysisType,
      entityType: card.entityType,
      entityId: card.entityId,
      question: "请基于最新数据重新分析这张诊断卡片。"
    });
  };

  const handleFollowUp = async (card: AiWorkbenchCard) => {
    const question = (followUpQuestions[card.id] || "").trim();
    if (!question) {
      toast.error("请输入追问内容");
      return;
    }

    setFollowUpLoading((prev) => ({ ...prev, [card.id]: true }));
    try {
      const response = await axios.post("/api/ai-analysis/workbench/follow-up", {
        card,
        question
      });
      setFollowUpAnswers((prev) => ({ ...prev, [card.id]: response.data.answer }));
      toast.success("追问已返回");
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || "追问失败");
    } finally {
      setFollowUpLoading((prev) => ({ ...prev, [card.id]: false }));
    }
  };

  const renderCard = (card: AiWorkbenchCard) => {
    const isFollowUpOpen = openFollowUpCardId === card.id;

    return (
      <div key={card.id} className="border border-slate-200 bg-white rounded-lg p-5 space-y-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center px-2 py-1 rounded-md border text-[11px] font-bold ${priorityClass(card.priority)}`}>
                {priorityLabel(card.priority)}
              </span>
              <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-600">
                {card.entityType === "store" ? "店铺" : card.entityType === "account" ? "账户" : card.entityType === "creative" ? "素材" : "系统"}
              </span>
              <span className="inline-flex items-center px-2 py-1 rounded-md bg-indigo-50 border border-indigo-100 text-[11px] font-semibold text-indigo-700">
                {aiModeLabel(card.aiMode)}
              </span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{card.title}</h3>
              {card.entityType === "account" ? (
                <MetaAccountDisplay
                  name={card.entityName}
                  accountId={card.entityId}
                  className="mt-1"
                  nameClassName="text-xs text-slate-600 font-semibold truncate"
                  idClassName="text-[11px] text-slate-500 font-mono truncate"
                />
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  {card.entityName || card.entityId}
                  <span className="mx-1 text-slate-300">/</span>
                  <span className="font-mono">{card.entityId}</span>
                </p>
              )}
            </div>
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            {format(new Date(card.createdAt), "yyyy/MM/dd HH:mm")}
          </div>
        </div>

        <p className="text-sm text-slate-700 leading-relaxed">{card.summary}</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {metricEntries(card.evidence.metrics).map(([key, value]) => (
            <div key={key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] uppercase font-semibold text-slate-400 truncate">{key}</p>
              <p className="text-sm font-bold text-slate-900 truncate">{formatMetricValue(key, value)}</p>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase">判断</p>
              <p className="text-slate-800 leading-relaxed">{card.recommendation.judgment}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase">建议动作</p>
              <p className="text-slate-800 leading-relaxed">{card.recommendation.action}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase">预算/操作幅度</p>
              <p className="text-slate-800 leading-relaxed">{card.recommendation.budgetAction || "本轮不建议做大幅调整。"}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase">观察周期</p>
              <p className="text-slate-800 leading-relaxed">{card.recommendation.observationWindow}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase">风险控制</p>
              <p className="text-slate-800 leading-relaxed">{card.recommendation.riskControl}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase">下一步检查</p>
              <p className="text-slate-800 leading-relaxed">{card.recommendation.nextCheck}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 pt-2 border-t border-slate-200">
            <span className="text-[11px] font-bold text-slate-400">证据来源</span>
            {card.evidence.dataSources.map((source) => (
              <span key={source} className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-600">
                {source}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpenFollowUpCardId(isFollowUpOpen ? null : card.id)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            继续追问
          </button>
          <button
            type="button"
            disabled={rerunCardId === card.id}
            onClick={() => handleRerunCard(card)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${rerunCardId === card.id ? "animate-spin" : ""}`} />
            重新分析
          </button>
          <button
            type="button"
            onClick={() => toast.info("运营任务中心将在下一阶段接入。")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            转运营任务
          </button>
        </div>

        {isFollowUpOpen && (
          <div className="rounded-md border border-slate-200 bg-white p-3 space-y-3">
            <textarea
              value={followUpQuestions[card.id] || ""}
              onChange={(event) => setFollowUpQuestions((prev) => ({ ...prev, [card.id]: event.target.value }))}
              placeholder="例如：这个账户是直接加预算还是复制广告组？"
              className="w-full min-h-[96px] rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={followUpLoading[card.id]}
                onClick={() => handleFollowUp(card)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                {followUpLoading[card.id] ? "提交中..." : "提交追问"}
              </button>
            </div>
            {followUpAnswers[card.id] && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {followUpAnswers[card.id]}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 text-slate-900">
      <section className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-600">
              <Brain className="w-4 h-4" />
              AI诊断中心 / 主动分析工作台
            </div>
            <h1 className="text-2xl font-bold text-slate-950">今日自动扫描与主动分析</h1>
            <p className="text-sm text-slate-600 max-w-3xl">
              系统每天自动扫描活跃账户与活跃店铺，也支持手动选择对象进行深度追问。
            </p>
          </div>
          <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
            {format(startDate, "yyyy/MM/dd")} - {format(endDate, "yyyy/MM/dd")}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">今日自动扫描</h2>
                <p className="text-xs text-slate-500 mt-1">只扫描当前日期范围内有投放或订单信号的对象。</p>
              </div>
              <button
                type="button"
                onClick={fetchOverview}
                disabled={overviewLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${overviewLoading ? "animate-spin" : ""}`} />
                刷新扫描
              </button>
            </div>

            {overviewLoading && (
              <div className="border border-dashed border-slate-200 rounded-lg p-8 text-center text-sm text-slate-500">
                正在加载今日自动扫描结果...
              </div>
            )}

            {!overviewLoading && overviewError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {overviewError}
              </div>
            )}

            {!overviewLoading && overview && (
              <>
                <div className="rounded-md bg-slate-50 border border-slate-200 p-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">AI摘要</p>
                      <p className="text-sm text-slate-700 leading-relaxed mt-1">{overview.aiSummary}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="rounded-md bg-white border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-400 font-bold">活跃账户</p>
                      <p className="text-xl font-bold">{overview.coverage.activeAccountsScanned}</p>
                    </div>
                    <div className="rounded-md bg-white border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-400 font-bold">活跃店铺</p>
                      <p className="text-xl font-bold">{overview.coverage.activeStoresScanned}</p>
                    </div>
                    <div className="rounded-md bg-white border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-400 font-bold">业务建议卡片</p>
                      <p className="text-xl font-bold">{overview.coverage.businessCardsGenerated}</p>
                    </div>
                    <div className="rounded-md bg-white border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-400 font-bold">数据健康提醒</p>
                      <p className="text-xl font-bold">{overview.coverage.dataHealthNotices}</p>
                    </div>
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">
                    <Activity className="w-3.5 h-3.5" />
                    AI模式：{aiModeLabel(overview.aiRuntime.mode)}
                  </div>
                </div>

                {overview.cards.length === 0 ? (
                  <div className="border border-dashed border-slate-200 rounded-lg p-8 text-center text-sm text-slate-500">
                    当前日期范围暂无活跃账户/店铺可分析，请先同步数据或扩大日期范围。
                  </div>
                ) : (
                  <div className="space-y-4">
                    {overview.cards.map(renderCard)}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-slate-600" />
              <h2 className="text-lg font-bold text-slate-900">数据健康检测</h2>
            </div>
            {!overview || overview.dataHealthNotices.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center text-sm text-slate-500">
                当前日期范围暂无数据健康提醒。
              </div>
            ) : (
              <div className="space-y-3">
                {overview.dataHealthNotices.map((notice, index) => (
                  <div key={`${notice.type}-${notice.entityId}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-4 h-4 text-slate-600 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-slate-900">{notice.title}</p>
                        <p className="text-sm text-slate-700 leading-relaxed">{notice.message}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {notice.entityType}: {notice.entityId}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">主动分析</h2>
              <p className="text-xs text-slate-500 mt-1">选择账户、店铺、素材或系统数据健康对象进行分析。</p>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">分析类型</span>
                <select
                  value={manualAnalysisType}
                  onChange={(event) => setManualAnalysisType(event.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  {analysisTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">对象类型</span>
                <select
                  value={manualEntityType}
                  onChange={(event) => setManualEntityType(event.target.value as EntityType)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  {entityTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              {manualEntityType === "account" && (
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-600">账户</span>
                  <select
                    value={selectedAccount}
                    onChange={(event) => setSelectedAccount(event.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    {accountsList.length === 0 ? (
                      <option value="">暂无账户</option>
                    ) : (
                      accountsList.map((account) => {
                        const accountId = getAccountId(account);
                        return (
                          <option key={accountId} value={accountId}>
                            {metaAccountOptionLabel(getAccountName(account), accountId)}
                          </option>
                        );
                      })
                    )}
                  </select>
                </label>
              )}

              {manualEntityType === "store" && (
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-600">店铺</span>
                  <select
                    value={selectedStore}
                    onChange={(event) => setSelectedStore(event.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    {storesList.length === 0 ? (
                      <option value="">暂无店铺</option>
                    ) : (
                      storesList.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name} ({store.platform || "store"})
                        </option>
                      ))
                    )}
                  </select>
                </label>
              )}

              {manualEntityType === "creative" && (
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-600">素材 / 广告 ID</span>
                  <input
                    value={creativeEntityId}
                    onChange={(event) => setCreativeEntityId(event.target.value)}
                    placeholder="输入 creative_id、ad_id 或 entity_id"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              )}

              {manualEntityType === "system" && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  系统数据健康会分析当前日期范围的活跃账户、绑定关系和事实表覆盖。
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">追问 / 关注点</span>
                <textarea
                  value={manualQuestion}
                  onChange={(event) => setManualQuestion(event.target.value)}
                  placeholder="例如：这个对象是否适合扩量？需要先看哪些风险？"
                  className="w-full min-h-[96px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <button
                type="button"
                disabled={manualLoading}
                onClick={() => runManualAnalysis()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Brain className="w-4 h-4" />
                {manualLoading ? "生成中..." : "生成AI分析"}
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              {manualCard?.entityType === "store" ? (
                <ShoppingBag className="w-5 h-5 text-blue-600" />
              ) : manualCard?.entityType === "account" ? (
                <User className="w-5 h-5 text-blue-600" />
              ) : (
                <Database className="w-5 h-5 text-blue-600" />
              )}
              <h2 className="text-lg font-bold text-slate-900">主动分析结果</h2>
            </div>

            {manualCard ? (
              renderCard(manualCard)
            ) : (
              <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center text-sm text-slate-500">
                选择对象并点击生成后，分析结果会显示在这里。
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
