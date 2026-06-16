import React, { useState, useEffect } from "react";
import { 
  Sparkles, 
  HelpCircle, 
  Briefcase, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  ChevronRight,
  TrendingUp,
  Inbox,
  AlertCircle,
  EyeOff,
  User,
  Database,
  X
} from "lucide-react";
import { useSuggestionStatus } from "./useSuggestionStatus";
import { SuggestionActionPanel } from "./SuggestionActionPanel";
import { AiExplainButton } from "../ai/AiExplainButton";
import { AiExplanationPanel } from "../ai/AiExplanationPanel";

interface UniformIssue {
  issueId: string;
  issueType: string;
  category: "production_suggestion" | "data_health_notice" | "debug_invalid";
  severity: "critical" | "warning" | "info" | "healthy";
  entityType: string;
  entityId: string;
  entityName: string;
  title: string;
  oneLineReason: string;
  actionVerb: string;
  actionTarget: string;
  evidence: any;
  entityRefs: Array<{
    entityType: string;
    entityId: string;
    entityName: string;
    route: string;
    sourceTable: string;
  }>;
  route: string;
  limitations: string[];
  generationMode: string;
  humanConfirmationRequired: boolean;
  status: string;
  problemStage?: string | null;
  optimizationArea?: string | null;
  funnelStage?: string | null;
  diagnosisReason?: string | null;
  suggestedActions?: string[];
  validationMetrics?: string[] | string;
  priorityScore?: number;
  confidenceScore?: number;
  impactScore?: number;
  urgencyScore?: number;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
}

function getLocalDateString(offsetDays = 0) {
  const today = new Date();
  today.setDate(today.getDate() - offsetDays);
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function NonConfirmedActionPanel({
  issue,
  statusDetail,
  onUpdateStatus
}: {
  issue: UniformIssue;
  statusDetail: { status: string; ignoreReason?: string };
  onUpdateStatus: (status: "ignored", extra?: any) => void;
}) {
  const [showIgnoreInput, setShowIgnoreInput] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState(statusDetail.ignoreReason || "");

  const handleIgnoreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ignoreReason.trim()) {
      alert("请填写忽略原因");
      return;
    }
    onUpdateStatus("ignored", { ignoreReason });
    setShowIgnoreInput(false);
  };

  return (
    <div className="border-t border-slate-100 pt-4 mt-2 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">当前流转状态:</span>
          {statusDetail.status === "ignored" ? (
            <span className="px-2 py-0.5 bg-red-50 border border-red-250 text-red-800 text-xs font-bold rounded">
              已忽略
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded">
              待处理
            </span>
          )}
        </div>

        {statusDetail.status === "ignored" && statusDetail.ignoreReason && (
          <div className="text-xs bg-red-50 text-red-800 px-3 py-1 rounded-md border border-red-100 font-medium flex-1 max-w-sm break-words">
            <strong>忽略原因:</strong> {statusDetail.ignoreReason}
          </div>
        )}
      </div>

      {!showIgnoreInput ? (
        <div className="flex flex-wrap items-center gap-2">
          {statusDetail.status !== "ignored" && (
            <button
              onClick={() => setShowIgnoreInput(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 border border-slate-200"
            >
              <X className="w-3.5 h-3.5" /> 忽略
            </button>
          )}
          <span className="text-xs font-medium text-red-505 bg-red-50 px-2.5 py-1 rounded-md border border-red-100 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> 该建议缺少人工确认标记，已阻止执行
          </span>
        </div>
      ) : (
        <form onSubmit={handleIgnoreSubmit} className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <label className="block text-[11px] font-bold text-slate-700">请填写忽略原因 (必填):</label>
          <div className="flex gap-2">
            <input
              type="text"
              required
              placeholder="例如：策略不合 / 待核对后再行处理..."
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-red-500 text-slate-800"
            />
            <div className="flex gap-1 shrink-0">
              <button
                type="submit"
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-md"
              >
                确定
              </button>
              <button
                type="button"
                onClick={() => setShowIgnoreInput(false)}
                className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-md border"
              >
                取消
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

export function PrescriptionCenterPage({ currentSubTab }: { currentSubTab?: string }) {
  const [activeSubTab, setActiveSubTab] = useState<string>("rx-pending");
  const [startDate, setStartDate] = useState<string>(() => getLocalDateString(29));
  const [endDate, setEndDate] = useState<string>(() => getLocalDateString(0));
  
  // Local storage statuses hook
  const { statusMap, updateStatus, getStatusDetail } = useSuggestionStatus();

  // States for API call
  const [issues, setIssues] = useState<UniformIssue[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);

  // AI dry-run explanation state
  const [aiPanelStates, setAiPanelStates] = useState<{
    [issueId: string]: {
      loading: boolean;
      error: string | null;
      response: any | null;
      expanded: boolean;
    }
  }>({});

  const handleExplainIssue = async (item: UniformIssue) => {
    const issueId = item.issueId;
    const currentStatusDetail = getStatusDetail(issueId);

    // Initial state setup to trigger panel show & loader
    setAiPanelStates(prev => ({
      ...prev,
      [issueId]: {
        loading: true,
        error: null,
        response: null,
        expanded: true
      }
    }));

    try {
      const res = await fetch("/api/ai/explain-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "auto",
          model: "",
          issue: item,
          statusDetail: currentStatusDetail,
          context: {
            dateRange: {
              startDate,
              endDate
            },
            currentPage: "prescription_center",
            userRole: "admin",
            targetLanguage: "zh-CN"
          }
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP error ${res.status}`);
      }

      const data = await res.json();
      setAiPanelStates(prev => ({
        ...prev,
        [issueId]: {
          loading: false,
          error: null,
          response: data,
          expanded: true
        }
      }));
    } catch (err: any) {
      console.error("[AI EXPLAIN ERROR]", err);
      setAiPanelStates(prev => ({
        ...prev,
        [issueId]: {
          loading: false,
          error: err.message || "请求 AI 解释失败",
          response: null,
          expanded: true
        }
      }));
    }
  };

  useEffect(() => {
    if (currentSubTab) {
      setActiveSubTab(currentSubTab);
    }
  }, [currentSubTab]);

  const fetchIssues = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/diagnostics/issues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          includeDebug: true
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || `HTTP error ${response.status}`);
      }

      const report = await response.json();
      if (report && report.success) {
        setIssues(report.issues || []);
      } else {
        throw new Error(report.error || "获取异常：接口返回 success = false");
      }
    } catch (err: any) {
      console.error("[PrescriptionCenterPage FETCH ERROR]", err);
      setError({
        message: err.message || "请求诊断数据失败",
        details: err?.stack || "检查网络连接或后端服务状态"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, [startDate, endDate]);

  const pendingIssuesCount = issues.filter(r => {
    const s = getStatusDetail(r.issueId).status;
    return r.category === "production_suggestion" && (s === "pending" || !s);
  }).length;

  const healthIssuesCount = issues.filter(r => r.category === "data_health_notice").length;

  const acceptedIssuesCount = issues.filter(r => {
    const s = getStatusDetail(r.issueId).status;
    return ["accepted", "in_progress", "executed"].includes(s);
  }).length;

  const debugIssuesCount = issues.filter(r => r.category === "debug_invalid").length;

  const tabsConfig = [
    { id: "rx-pending", label: "待处理建议", badge: pendingIssuesCount },
    { id: "rx-health", label: "数据健康提醒", badge: healthIssuesCount },
    { id: "rx-accepted", label: "已采纳 / 执行中", badge: acceptedIssuesCount },
    { id: "rx-debug", label: "规则命中记录", badge: debugIssuesCount }
  ];

  // Helper to filter items for current tab
  const getFilteredIssues = () => {
    if (activeSubTab === "rx-pending") {
      return issues.filter(r => {
        const s = getStatusDetail(r.issueId).status;
        return r.category === "production_suggestion" && (s === "pending" || !s);
      });
    }
    if (activeSubTab === "rx-health") {
      return issues.filter(r => r.category === "data_health_notice");
    }
    if (activeSubTab === "rx-accepted") {
      return issues.filter(r => {
        const s = getStatusDetail(r.issueId).status;
        return ["accepted", "in_progress", "executed"].includes(s);
      });
    }
    if (activeSubTab === "rx-debug") {
      return issues.filter(r => r.category === "debug_invalid");
    }
    return [];
  };

  const filteredIssues = getFilteredIssues();

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
              当前页面已接入离线规则诊断引擎并成功连接 [STEP 13-D-Lite] 处方流转与回测机制。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">建议处方中心</h1>
          <p className="text-sm text-slate-500 mt-1">
            整合规则诊断引擎产生的预警结果，进行本地采纳、忽略、执行中与已执行流转。
          </p>
        </div>

        {/* Date Selector and Manual Refresh Button */}
        <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
          <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium">
            <span>开始:</span>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded-md shadow-inner text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium">
            <span>结束:</span>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded-md shadow-inner text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button 
            onClick={fetchIssues}
            disabled={loading}
            className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:bg-blue-300"
            title="手动刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Selector Tabs */}
      <div className="flex border-b border-slate-200 gap-2 overflow-x-auto scrollbar-none">
        {tabsConfig.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSubTab(item.id)}
            className={`px-5 py-3 text-sm font-semibold relative transition-all duration-200 shrink-0 ${
              activeSubTab === item.id
                ? "text-blue-600 border-b-2 border-blue-600 font-extrabold"
                : "text-slate-500 hover:text-slate-950 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2 m-0">
              {item.label}
              {item.badge >= 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-800 font-bold">
                  {item.badge}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Active Tab Contents */}
      <div className="space-y-6">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto bg-blue-50 text-blue-600 border border-blue-100">
              <RefreshCw className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-700">正在加载离线规则诊断结果...</h4>
              <p className="text-xs text-slate-400 mt-1">正在请求 /api/diagnostics/issues 并读取规则诊断结果...</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-red-900">接口加载失败 (HTTP API Error)</h4>
                <p className="text-xs text-red-700 mt-1">{error.message}</p>
                {error.details && (
                  <pre className="text-[10px] font-mono bg-red-100/50 p-2.5 rounded-lg border border-red-200/50 text-red-800 mt-3 overflow-x-auto whitespace-pre-wrap max-h-40">
                    {error.details}
                  </pre>
                )}
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-red-200/40">
              <button 
                onClick={fetchIssues}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 重新连接并刷新
              </button>
            </div>
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-xl flex items-center justify-center mx-auto">
              <Inbox className="w-6 h-6" />
            </div>
            {issues.length === 0 ? (
              <>
                <h4 className="text-sm font-bold text-slate-700">暂无诊断数据。当前数据库可能为空，或所选日期范围内没有可诊断记录。</h4>
                <p className="text-xs text-slate-400">系统没有加载到任何具有诊断资格的记录。当前阶段不支持自动注入假测试数据。</p>
              </>
            ) : (
              <>
                <h4 className="text-sm font-bold text-slate-705">暂未发现该类型的诊断记录。</h4>
                <p className="text-xs text-slate-400">底层的规则引擎未在这个条件下触及相关的分类。试着微调上方的诊断日期。</p>
              </>
            )}
          </div>
        ) : (
          filteredIssues.map((item) => {
            // Severity tags color classes
            const getSeverityColor = (sv: string) => {
              switch (sv) {
                case "critical":
                  return "bg-red-50 border-red-200 text-red-700";
                case "warning":
                  return "bg-amber-50 border-amber-200 text-amber-700";
                case "healthy":
                  return "bg-emerald-50 border-emerald-200 text-emerald-700";
                default:
                  return "bg-blue-50 border-blue-200 text-blue-700";
              }
            };

            const getSeverityLabel = (sv: string) => {
              switch (sv) {
                case "critical": return "严重 (Critical)";
                case "warning": return "警示 (Warning)";
                case "healthy": return "健康 (Healthy)";
                default: return "一栏 (Info)";
              }
            };

            const renderCategoryBadge = (cat: string) => {
              if (cat === "production_suggestion") {
                return (
                  <span className="flex items-center gap-1 bg-emerald-100/80 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-900 font-extrabold rounded">
                    正式建议
                  </span>
                );
              }
              if (cat === "data_health_notice") {
                return (
                  <span className="flex items-center gap-1 bg-indigo-100/80 border border-indigo-200 px-2 py-0.5 text-[10px] text-indigo-950 font-extrabold rounded">
                    数据健康提醒
                  </span>
                );
              }
              return (
                <span className="flex items-center gap-1 bg-slate-105 border border-slate-205 px-2 py-0.5 text-[10px] text-slate-700 font-extrabold rounded">
                  规则命中记录，不可执行
                </span>
              );
            };

            const statusDetail = getStatusDetail(item.issueId);

            return (
              <div key={item.issueId} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5 hover:shadow-md transition-shadow relative">
                
                {/* Header block */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-150/50 pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded">
                        ID: {item.issueId}
                      </span>
                      {renderCategoryBadge(item.category)}
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${getSeverityColor(item.severity)}`}>
                        {getSeverityLabel(item.severity)}
                      </span>
                      {item.category === "production_suggestion" && (
                        item.humanConfirmationRequired === true ? (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-bold rounded border border-purple-200">
                            需要人工确认及执行
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 text-[10px] font-bold rounded border border-red-200">
                            该建议缺少人工确认标记，已阻止执行
                          </span>
                        )
                      )}
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm mt-1">{item.title}</h3>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2.5 py-1 text-[11px] font-semibold bg-gray-100 text-slate-800 rounded-full flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-500" />
                      负责人: {item.ownerUserName || "暂未分配"}
                    </span>
                  </div>
                </div>

                {/* Classification items */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-medium text-slate-500">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">问题阶段 (problemStage)</span>
                    <span className="text-slate-800 font-bold">{item.problemStage || "未判定"}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">优化方向 (optimizationArea)</span>
                    <span className="text-slate-800 font-bold">{item.optimizationArea || "未分类"}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">漏斗阶段 (funnelStage)</span>
                    <span className="text-slate-800 font-mono font-bold">{item.funnelStage || "无"}</span>
                  </div>
                </div>

                {/* One line Reason & AI Opinion */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 诊断意见 (diagnosisReason)
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/10 p-3 rounded-lg border border-blue-50">
                      {item.diagnosisReason || item.oneLineReason}
                    </p>
                  </div>

                  {/* Suggest Actions */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-800 block">建议动作 (suggestedActions)</span>
                    {Array.isArray(item.suggestedActions) && item.suggestedActions.length > 0 ? (
                      <ul className="space-y-1.5">
                        {item.suggestedActions.map((act, idx) => (
                          <li key={idx} className="flex gap-2 text-xs text-slate-600 leading-relaxed">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                            <span>{act}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400 italic">暂无具体建议动作分部。</p>
                    )}
                  </div>
                </div>

                {/* Evidence Snapshot */}
                {item.evidence?.funnelSnapshot && (
                  <div className="text-xs bg-amber-50/50 p-3 rounded-lg border border-amber-200/50 mt-2 space-y-1">
                    <p className="font-bold text-amber-900 flex items-center gap-1 select-none">
                      ⚠️ 漏斗快照数据异常提示 (funnelSnapshot)
                    </p>
                    {item.evidence.funnelSnapshot.missingMetrics && (
                      <p className="text-amber-850">
                        <strong>缺漏流损指标:</strong> {Array.isArray(item.evidence.funnelSnapshot.missingMetrics) ? item.evidence.funnelSnapshot.missingMetrics.join(", ") : String(item.evidence.funnelSnapshot.missingMetrics)}
                      </p>
                    )}
                    {item.evidence.funnelSnapshot.notes && (
                      <p className="text-amber-800 whitespace-pre-wrap">
                        <strong>快照备忘:</strong> {item.evidence.funnelSnapshot.notes}
                      </p>
                    )}
                  </div>
                )}

                {/* Metadata details, verification, limits */}
                <div className="border-t border-slate-100 pt-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-1.5 text-xs text-slate-500 w-full md:max-w-[70%]">
                    <div>
                      <span className="font-bold text-slate-700">验证指标 (validationMetrics):</span>{" "}
                      <span className="font-medium text-slate-800 font-mono">
                        {Array.isArray(item.validationMetrics) ? item.validationMetrics.join("; ") : String(item.validationMetrics || "未设置")}
                      </span>
                    </div>
                    {Array.isArray(item.limitations) && item.limitations.length > 0 && (
                      <div>
                        <span className="font-bold text-red-700">数据限制 (limitations):</span>{" "}
                        <span className="text-red-800 bg-red-50 px-1 py-0.5 rounded font-mono">
                          {item.limitations.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-500 shrink-0 self-end md:self-center">
                    <span>优先级Score: <strong className="text-slate-900 font-mono">{item.priorityScore ?? "--"}</strong></span>
                    <span>置信度: <strong className="text-slate-900 font-mono">{item.confidenceScore ? `${Math.round(item.confidenceScore * 100)}%` : "--"}</strong></span>
                    
                    {item.route && (
                      <div className="relative group shrink-0">
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-md transition-colors text-[11px] font-bold inline-flex items-center gap-1 cursor-help"
                        >
                          查看详情 <ChevronRight className="w-3 h-3" />
                        </button>
                        <span className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block bg-slate-900 text-white text-[10px] p-2 rounded-lg shadow-lg w-48 text-center leading-tight z-10 font-normal">
                          目标路径为 {item.route}。诊断为人工建议，此操作仅供对照，无法进行自动操作跳转。
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Explanation Interface (STEP 13-AI-R1-UI-DryRun) */}
                <div id={`ai-explain-area-${item.issueId}`} className="border-t border-dashed border-slate-200 pt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <Sparkles className="w-4 h-4 text-indigo-500" />
                      <span>AI 安全解释辅助 (Offline Boundary Monitor)</span>
                    </div>

                    <AiExplainButton 
                      loading={aiPanelStates[item.issueId]?.loading}
                      onClick={() => handleExplainIssue(item)}
                    />
                  </div>

                  {aiPanelStates[item.issueId]?.expanded && (
                    <AiExplanationPanel
                      loading={aiPanelStates[item.issueId]?.loading || false}
                      error={aiPanelStates[item.issueId]?.error}
                      response={aiPanelStates[item.issueId]?.response}
                      onRetry={() => handleExplainIssue(item)}
                    />
                  )}
                </div>

                {/* Suggestion Action panel & Status flows */}
                {item.category === "production_suggestion" && item.humanConfirmationRequired !== true ? (
                  <NonConfirmedActionPanel 
                    issue={item} 
                    statusDetail={statusDetail} 
                    onUpdateStatus={(status, extra) => updateStatus(item.issueId, status, extra)}
                  />
                ) : (
                  <SuggestionActionPanel 
                    issue={item} 
                    statusDetail={statusDetail} 
                    onUpdateStatus={(status, extra) => updateStatus(item.issueId, status, extra)}
                  />
                )}

              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
