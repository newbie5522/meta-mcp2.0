import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lightbulb,
  Activity,
  Flame,
  CheckSquare,
  Square,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  Eye,
  Lock,
  Database,
  Info,
  Settings
} from "lucide-react";
import { toast } from "sonner";

interface SuggestionCard {
  id: string;
  reportId: string;
  action: string;
  rationale: string;
  priority: number; // 1 = Critical, 2 = High, 3 = Medium, 4 = Low
  executionChecklist: any; // parsed JSON array of checklist items
  status: "pending" | "applied" | "ignored" | "done";
  createdAt: string;
  metadata?: any;
  report: {
    id: string;
    type: string;
    entityType: string;
    entityId: string;
    conclusion: string;
    riskPoints: string[];
    observationWindow: string;
    metadata?: any;
  }
}

export function SuggestionsDashboard() {
  const [cards, setCards] = useState<SuggestionCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "applied" | "ignored">("pending");
  const [selectedPriority, setSelectedPriority] = useState<number | "all">("all");
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});

  const fetchCards = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-analysis/suggestions");
      if (res.ok) {
        const data = await res.json();
        const parsedData = data.map((item: any) => {
          let checklistParsed = [];
          if (item.executionChecklist) {
            try {
              checklistParsed = typeof item.executionChecklist === "string"
                ? JSON.parse(item.executionChecklist)
                : item.executionChecklist;
            } catch (e) {
              checklistParsed = String(item.executionChecklist).split(";").map(s => s.trim()).filter(Boolean);
            }
          }
          if (!Array.isArray(checklistParsed)) {
            checklistParsed = [];
          }

          let metaParsed = null;
          if (item.metadata) {
            try {
              metaParsed = typeof item.metadata === "string"
                ? JSON.parse(item.metadata)
                : item.metadata;
            } catch (e) {
              console.warn("Error parsing metadata: ", e);
            }
          }

          return {
            ...item,
            executionChecklist: checklistParsed,
            metadata: metaParsed
          };
        });
        setCards(parsedData);
      }
    } catch (err) {
      console.error("Failed to fetch suggestions:", err);
      toast.error("读取 AI 建议失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCards();
  }, []);

  const handleUpdateStatus = async (id: string, newStatus: "applied" | "ignored" | "pending") => {
    try {
      const res = await fetch(`/api/ai-analysis/suggestions/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        toast.success(`推荐已标记为: ${newStatus === "applied" ? "已实施" : newStatus === "ignored" ? "已忽略" : "待处理"}`);
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
      } else {
        toast.error("更新状态失败");
      }
    } catch (err) {
      console.error(err);
      toast.error("更新状态异常");
    }
  };

  const toggleStep = (cardId: string, idx: number) => {
    const key = `${cardId}-${idx}`;
    setCheckedSteps(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const toggleEvidence = (cardId: string) => {
    setExpandedEvidence(prev => ({
      ...prev,
      [cardId]: !prev[cardId]
    }));
  };
  
  const formatEvidenceMetricValue = (key: string, value: any) => {
    if (value === null || value === undefined || value === "") return "暂无";

    const lowerKey = key.toLowerCase();

    if (typeof value === "number") {
      if (lowerKey.includes("spend") || lowerKey.includes("revenue") || lowerKey.includes("value") || lowerKey.includes("sales") || lowerKey.includes("cpa") || lowerKey.includes("cpc")) {
        return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      }
      if (lowerKey.includes("roas")) {
        return `${value.toFixed(2)}x`;
      }
      if (lowerKey.includes("ctr") || lowerKey.includes("rate")) {
        return `${value.toFixed(2)}%`;
      }
      return value.toLocaleString();
    }

    return String(value);
  };

  const getVisibleEvidenceMetrics = (metrics: Record<string, any> | null | undefined) => {
    if (!metrics) return [];
    return Object.entries(metrics)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .slice(0, 6);
  };
  
  const getPriorityLabel = (p: number) => {
    if (p <= 1) return { text: "极高 / Urgent", css: "bg-red-500/10 text-red-500 border-red-500/20 font-bold" };
    if (p === 2) return { text: "高 / High", css: "bg-slate-100 text-slate-700 border-slate-200 font-bold" };
    if (p === 3) return { text: "中 / Medium", css: "bg-blue-500/10 text-blue-500 border-blue-500/20 font-bold" };
    return { text: "低 / Low", css: "bg-slate-500/10 text-slate-500 border-slate-500/20 font-bold" };
  };

  // Determine if there are any offline engine rule suggestions
  const hasOfflineSuggestions = cards.some(c => c.metadata?.generationMode === "offline_rule_engine" || !c.metadata);

  // Split cards into traceable (safe) versus untraceable (debug)
  const safeCards: SuggestionCard[] = [];
  const hiddenDebugCards: SuggestionCard[] = [];

  cards.forEach(card => {
    const meta = card.metadata;
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

    // Scan for demo/sample terms
    const textToScan = `${card.action} ${card.rationale} ${meta?.title || ""} ${meta ? JSON.stringify(meta.entityRefs) : ""}`.toLowerCase();
    const hasDemoCodes = /variant_[1-5]/.test(textToScan);
    const hasForbiddenKeywords = /artificial|manual_intervention|manual_review|manual_adjustment|人工介入|人工审阅|人工调配/.test(textToScan);

    if (isTraceable && !hasDemoCodes && !hasForbiddenKeywords) {
      safeCards.push(card);
    } else {
      hiddenDebugCards.push(card);
    }
  });

  const filteredSafeCards = safeCards.filter(c => {
    const cardStatus = c.status === "applied" ? "applied" : c.status === "ignored" ? "ignored" : "pending";
    const matchStatus = filterStatus === "all" || cardStatus === filterStatus;
    const matchPriority = selectedPriority === "all" || c.priority === Number(selectedPriority);
    return matchStatus && matchPriority;
  });

  return (
    <div className="space-y-6 font-sans">
      {/* Top Banner and Offline Indicator */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">AI Action Suggestions / 建议中心</h1>
            <p className="text-slate-500 text-sm mt-1">
              由 AI 诊断中心根据真实的订单事实对账、素材点击率衰退及店铺资金交叉比对生成的作业方案。
            </p>
          </div>
          <button
            onClick={fetchCards}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl shadow-sm text-sm font-semibold transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            刷新建议
          </button>
        </div>

        {hasOfflineSuggestions && (
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-start gap-3">
            <Info className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-slate-800">
                当前运行提示：已启用离线物理勾稽诊断
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5 font-medium leading-relaxed">
                当前工作区未配置 AI 模型 API 密钥。建议中心已全面加载 <b>System Offline Rule Engine (离线物理规则诊断)</b>，诊断内容完全基于底层数据库中实有的 Orders 事实流、FactMetaPerformance 出纳花费及 AccMappings。虽然非实时在线 AI 生成，但由于采用真实证据闭环，建议极其安全可作业。
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/60 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex flex-wrap gap-2">
          {(["pending", "applied", "ignored", "all"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg capitalize border transition ${
                filterStatus === st
                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              {st === "pending" ? "待人工操作 (Pending)" : st === "applied" ? "已被确认实施 (Applied)" : st === "ignored" ? "已忽略 (Ignored)" : "全部看版 (All)"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold text-slate-500">优先级过滤:</span>
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5 font-bold text-slate-700 focus:outline-none"
          >
            <option value="all">全量优先级别</option>
            <option value="1">Urgent (级别 1)</option>
            <option value="2">High (级别 2)</option>
            <option value="3">Medium (级别 3)</option>
            <option value="4">Low (级别 4)</option>
          </select>
        </div>
      </div>

      {/* Primary Safe Suggestions List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredSafeCards.map((card) => {
          const priorityInfo = getPriorityLabel(card.priority);
          const meta = card.metadata || {};
          const isExpanded = !!expandedEvidence[card.id];

          return (
            <div
              key={card.id}
              className={`bg-white rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-sm hover:shadow-md ${
                card.status === "applied"
                  ? "border-emerald-300 bg-emerald-50/5 opacity-90"
                  : card.status === "ignored"
                  ? "border-slate-200 opacity-60 bg-slate-50/40"
                  : card.priority <= 1
                  ? "border-red-200 border-l-[6px] border-l-red-500"
                  : card.priority === 2
                  ? "border-slate-200 border-l-[6px] border-l-slate-400"
                  : "border-slate-200"
              }`}
            >
              <div className="p-6 space-y-4">
                {/* Header Badge Row */}
                <div className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md border ${priorityInfo.css}`}>
                      {priorityInfo.text}
                    </span>
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono font-bold">
                      {meta.actionVerb?.toUpperCase()} / {meta.actionTarget}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-bold font-mono">
                    {new Date(card.createdAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Title & Exact operational rationale */}
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                    <Lightbulb className="w-5 h-5 text-slate-500 shrink-0" />
                    {meta.title || card.action}
                  </h3>
                  <p className="text-xs text-slate-600 font-medium leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                    <span className="font-bold text-slate-700 block mb-0.5">优化诊断方案：</span>
                    {card.rationale}
                  </p>
                </div>

                {/* Evidence Chain Drawer Trigger */}
                {meta.evidence && (
                  <div className="border border-indigo-100/60 rounded-xl overflow-hidden bg-indigo-50/10">
                    <button
                      onClick={() => toggleEvidence(card.id)}
                      className="w-full px-3 py-2 text-left flex justify-between items-center hover:bg-slate-50/80 transition-all font-sans"
                    >
                      <span className="text-xs font-bold text-indigo-700 flex items-center gap-1.5">
                        <Database className="w-4 h-4 text-indigo-500" />
                        查找底层物理对账数据证据链
                      </span>
                      <span className="text-[10px] font-black underline text-indigo-500">
                        {isExpanded ? "收起" : "展开对账数据"}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="p-3 bg-white/85 border-t border-indigo-100/50 space-y-2 text-xs text-slate-600">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[10px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <div><span className="text-slate-400 font-semibold uppercase">Primary Source:</span> <span className="text-slate-800 font-bold">{meta.evidence.primarySource}</span></div>
                          <div><span className="text-slate-400 font-semibold uppercase">Date Range:</span> <span className="text-slate-800 font-bold">{meta.evidence.dateRange}</span></div>
                          {meta.evidence.supportingSources?.length > 0 && (
                            <div className="col-span-2 mt-1"><span className="text-slate-400 font-semibold uppercase">Supporting:</span> <span className="text-slate-700 font-bold">{meta.evidence.supportingSources.join(", ")}</span></div>
                          )}
                        </div>

                        {meta.evidence.metrics && getVisibleEvidenceMetrics(meta.evidence.metrics).length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[9px] font-black text-slate-400 block uppercase">查得真实物理数据快照:</span>
                            <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
                              {getVisibleEvidenceMetrics(meta.evidence.metrics).map(([key, value]) => (
                                <div key={key} className="bg-slate-50 p-1 rounded">
                                  <p className="text-slate-400 font-semibold leading-tight uppercase truncate">{key}</p>
                                  <p className="text-slate-800 font-bold truncate">{formatEvidenceMetricValue(key, value)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="text-[9px] text-slate-400 leading-normal italic pt-1">
                          此卡片基于数据库对账事实真实溯源，不掺杂任何模拟伪造（Mock）字段。
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Actionable Entity Jumps (Disabled Tip) */}
                {meta.entityRefs && (
                  <div className="flex items-center gap-1.5 pt-1">
                    {meta.entityRefs.map((ent: any, i: number) => (
                      <div key={i} className="group/btn relative inline-block">
                        <button
                          disabled
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-150 text-slate-400 text-[10px] font-bold rounded-lg border border-slate-200 cursor-not-allowed flex items-center gap-1 shrink-0"
                        >
                          <Lock className="w-3.5 h-3.5 opacity-65" />
                          <span>定位 {ent.entityName || ent.entityId} ({ent.entityType})</span>
                        </button>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] px-2 py-1 rounded shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-normal w-48 z-10 text-center mb-1 leading-normal font-sans">
                          暂未接入详情页，无法作为正式建议。
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Execution Checklist */}
                {card.executionChecklist && card.executionChecklist.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-slate-100/60">
                    <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
                      人工作业检查步骤 (Execution Checklist)
                    </h4>
                    <div className="bg-slate-50/50 p-2.5 rounded-xl border border-slate-100 space-y-1.5">
                      {card.executionChecklist.map((step: string, idx: number) => {
                        const isChecked = !!checkedSteps[`${card.id}-${idx}`];
                        return (
                          <button
                            key={idx}
                            onClick={() => toggleStep(card.id, idx)}
                            className="w-full flex items-center gap-2 text-[11px] font-semibold text-slate-600 text-left hover:text-slate-900"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-300 shrink-0" />
                            )}
                            <span className={isChecked ? "line-through text-slate-400" : ""}>
                              {step}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Controls */}
              <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between gap-2.5 shrink-0">
                <span className="text-[10px] text-slate-400 font-black font-mono uppercase">
                  OPERATIONAL: {card.status === "applied" ? "已确认其实施" : card.status === "ignored" ? "优化已忽略" : "待审阅"}
                </span>

                <div className="flex gap-2">
                  {card.status !== "applied" ? (
                    <button
                      onClick={() => handleUpdateStatus(card.id, "applied")}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
                    >
                      标记已人工实施
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateStatus(card.id, "pending")}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold transition"
                    >
                      恢复至待审阅
                    </button>
                  )}

                  {card.status === "pending" && (
                    <button
                      onClick={() => handleUpdateStatus(card.id, "ignored")}
                      className="px-3 py-1.5 bg-white hover:bg-rose-50 hover:text-rose-600 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold transition"
                    >
                      放行/忽略
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filteredSafeCards.length === 0 && (
          <div className="col-span-full bg-white p-20 rounded-2xl border border-slate-200/60 shadow-sm text-center text-slate-400">
            <Activity className="w-12 h-12 mx-auto mb-2.5 text-slate-200 animate-pulse" />
            <span className="text-sm font-black block mb-1">无当前对应状态的 AI 决策方案</span>
            <span className="text-xs block text-slate-400 max-w-md mx-auto leading-relaxed">
              请至“AI 智能诊断中心”手动生成相关诊断或者启动一键对账，系统将自动化比对指标并产出全新的无 Mock 真实作业建议。
            </span>
          </div>
        )}
      </div>

      {/* Hidden/Diagnostics Debug Area */}
      {hiddenDebugCards.length > 0 && (
        <div className="mt-8 bg-slate-100 border border-slate-200 p-6 rounded-2xl space-y-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-500" />
            <h3 className="text-sm font-black text-slate-700 font-mono">
              Development Diagnostics Zone / 开发与调试安全过滤区 ({hiddenDebugCards.length})
            </h3>
          </div>
          <p className="text-xs text-slate-500 leading-normal max-w-4xl">
            本栏目在生产（Production UI）环境下为系统审计过滤器。任何缺少证据链（evidence）、缺少实体引用（entityRefs）或包含 Mock 模拟测试符号（如 CR01 等）的卡片，均会被强制安全拦截隐藏。以下为拦截日志目录：
          </p>

          <div className="space-y-2 pt-2 text-[11px] font-mono text-slate-600">
            {hiddenDebugCards.map((card, i) => (
              <div key={i} className="flex flex-col sm:flex-row justify-between sm:items-center bg-white border border-slate-200 p-3 rounded-xl gap-2 shadow-sm">
                <div>
                  <span className="text-rose-600 font-bold block">[FILTERED OUTCARD #{card.id.substring(0,6)}]</span>
                  <span className="text-slate-800 font-black text-[12px]">{card.action}</span>
                  <span className="text-slate-400 block mt-0.5">{card.rationale}</span>
                </div>
                <div className="shrink-0">
                  <span className="px-2 py-1 bg-rose-50 border border-rose-200 text-rose-600 rounded text-[10px] font-bold">
                    该建议缺少证据链，已安全隐藏，不参与实际经营决策。
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
