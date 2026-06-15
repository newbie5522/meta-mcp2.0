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
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";

interface SuggestionCard {
  id: string;
  reportId: string;
  action: string;
  rationale: string;
  priority: number; // 1 = Critical, 2 = High, 3 = Medium, 4 = Low
  executionChecklist: any; // parsed JSON array of checklist items
  status: "pending" | "applied" | "ignored";
  createdAt: string;
  report: {
    id: string;
    type: string;       // "risk_control" | "creative_fatigue" | "campaign_optimization" etc
    entityType: string; // "campaign" | "ad" | "store" | "global"
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

  const fetchCards = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/suggestions");
      if (res.ok) {
        const data = await res.json();
        // Handle parsing of checklist strings if needed
        const parsedData = data.map((item: any) => {
          let checklistParsed = [];
          if (item.executionChecklist) {
            try {
              checklistParsed = typeof item.executionChecklist === "string" 
                ? JSON.parse(item.executionChecklist) 
                : item.executionChecklist;
            } catch (e) {
              // fallback
              checklistParsed = String(item.executionChecklist).split(";").map(s => s.trim()).filter(Boolean);
            }
          }
          if (!Array.isArray(checklistParsed)) {
            checklistParsed = [];
          }
          return {
            ...item,
            executionChecklist: checklistParsed
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
      const res = await fetch(`/api/intelligence/suggestions/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        toast.success(`推荐已标记为: ${newStatus === "applied" ? "已实施" : newStatus === "ignored" ? "已忽略" : "待处理"}`);
        // Update local state directly for speedy feedback
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

  const getPriorityLabel = (p: number) => {
    if (p <= 1) return { text: "极高 / Urgent", css: "bg-red-500/10 text-red-500 border-red-500/20" };
    if (p === 2) return { text: "高 / High", css: "bg-amber-500/10 text-amber-500 border-amber-500/20" };
    if (p === 3) return { text: "中 / Medium", css: "bg-blue-500/10 text-blue-500 border-blue-500/20" };
    return { text: "低 / Low", css: "bg-slate-500/10 text-slate-500 border-slate-500/20" };
  };

  const filterCards = cards.filter(c => {
    const matchStatus = filterStatus === "all" || c.status === filterStatus;
    const matchPriority = selectedPriority === "all" || c.priority === Number(selectedPriority);
    return matchStatus && matchPriority;
  });

  return (
    <div className="space-y-6 font-sans">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">AI Suggestions / 建议中心</h1>
          <p className="text-slate-500 text-sm mt-1">
            由 Sync Center 后端 AI 风控引擎（AI Rule Monitor）根据每日订单异常、素材疲劳和 ROAS 斜率自动产出的战役执行卡片。
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

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/60 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex flex-wrap gap-2">
          {(["pending", "applied", "ignored", "all"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize border transition ${
                filterStatus === st
                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              {st === "pending" ? "待处理 (Pending)" : st === "applied" ? "已激活实施 (Applied)" : st === "ignored" ? "已忽略 (Ignored)" : "全部 (All)"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold text-slate-500">优先级筛选 (Priority):</span>
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5 font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">全量显示</option>
            <option value="1">Urgent (级别 1)</option>
            <option value="2">High (级别 2)</option>
            <option value="3">Medium (级别 3)</option>
            <option value="4">Low (级别 4)</option>
          </select>
        </div>
      </div>

      {/* Suggestions List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filterCards.map((card) => {
          const priorityInfo = getPriorityLabel(card.priority);
          return (
            <div
              key={card.id}
              className={`bg-white rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-sm hover:scale-[1.01] ${
                card.status === "applied"
                  ? "border-emerald-300 bg-emerald-50/5 opacity-85"
                  : card.status === "ignored"
                  ? "border-slate-200 opacity-60 bg-slate-50/40"
                  : card.priority <= 1
                  ? "border-red-200 border-l-[6px] border-l-red-500"
                  : card.priority === 2
                  ? "border-amber-200 border-l-[6px] border-l-amber-500"
                  : "border-slate-200"
              }`}
            >
              <div className="p-6 space-y-4">
                {/* Badge Meta line */}
                <div className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md border ${priorityInfo.css}`}>
                      {priorityInfo.text}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      #{card.id.substring(0,6)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium">
                    {new Date(card.createdAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Main Action heading */}
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    {card.action}
                  </h3>
                  <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600 font-medium border border-slate-100 leading-relaxed">
                    <span className="font-bold text-slate-700">优化依据：</span>
                    {card.rationale}
                  </div>
                </div>

                {/* Analysis basis & risks */}
                {card.report && (
                  <div className="p-3 bg-red-50/30 rounded-lg border border-red-100/40 text-xs space-y-1.5 text-slate-600" id={`card-report-container-${card.id}`}>
                    <div className="font-bold text-rose-800 flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5" />
                      触发体检异常：{card.report.conclusion}
                    </div>
                    {(() => {
                      const rp = card.report?.riskPoints as any;
                      let parsedPoints: string[] = [];
                      if (rp) {
                        if (Array.isArray(rp)) {
                          parsedPoints = rp;
                        } else if (typeof rp === "string") {
                          const trimmed = rp.trim();
                          if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                            try {
                              const parsed = JSON.parse(trimmed);
                              if (Array.isArray(parsed)) {
                                parsedPoints = parsed;
                              }
                            } catch (e) {
                              parsedPoints = [trimmed];
                            }
                          } else {
                            parsedPoints = trimmed.split("\n").map(s => s.trim()).filter(Boolean);
                          }
                        }
                      }
                      if (parsedPoints.length === 0) return null;
                      return (
                        <ul className="list-disc list-inside text-[11px] text-slate-500 space-y-0.5" id={`list-riskpoints-${card.id}`}>
                          {parsedPoints.map((pt, i) => (
                            <li key={i} id={`pt-${card.id}-${i}`}>{pt}</li>
                          ))}
                        </ul>
                      );
                    })()}
                    <div className="text-[10px] text-slate-400">
                      历史观察窗口: {card.report.observationWindow} | 实体类别: {card.report.entityType} ({card.report.entityId})
                    </div>
                  </div>
                )}

                {/* Execution Checklist */}
                {card.executionChecklist && card.executionChecklist.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
                      执行确认步骤 (Execution Checklist)
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
                <span className="text-[10px] text-slate-400 font-mono uppercase">
                  状态: {card.status === "applied" ? "已执行" : card.status === "ignored" ? "已忽略" : "待处理"}
                </span>

                <div className="flex gap-2">
                  {card.status !== "applied" ? (
                    <button
                      onClick={() => handleUpdateStatus(card.id, "applied")}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
                    >
                      已部署实施
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateStatus(card.id, "pending")}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold transition"
                    >
                      撤回重置
                    </button>
                  )}

                  {card.status === "pending" && (
                    <button
                      onClick={() => handleUpdateStatus(card.id, "ignored")}
                      className="px-3 py-1.5 bg-white hover:bg-rose-50 hover:text-rose-600 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold transition"
                    >
                      忽略
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filterCards.length === 0 && (
          <div className="col-span-full bg-white p-20 rounded-2xl border border-slate-200/60 shadow-sm text-center text-slate-400">
            <Activity className="w-12 h-12 mx-auto mb-2.5 text-slate-200" />
            <span className="text-sm font-bold block mb-1">无对应状态的 AI 优化建议</span>
            <span className="text-xs block text-slate-400">
              去“数据同步中心”手动发起一键 “AI 风控分析与体检扫描”，系统即会立即扫描多维指标产生推荐！
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
