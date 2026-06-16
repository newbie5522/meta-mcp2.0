import React from "react";
import { 
  ShieldCheck, 
  Database, 
  HelpCircle, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  History, 
  RefreshCw,
  Inbox
} from "lucide-react";
import { useDiagnosticsIssues } from "./useDiagnosticsIssues";

export function DataHealthDiagnosisPage() {
  const {
    issues,
    loading,
    error,
    refetch,
    startDate,
    endDate,
    setStartDate,
    setEndDate
  } = useDiagnosticsIssues();

  // Filter issues based on requirements:
  // 1. category = data_health_notice
  // 2. category = debug_invalid
  // 3. problemStage = data_health
  // 4. optimizationArea = tracking / mapping / data_sync
  const matchedIssues = issues.filter(
    (iss) => 
      iss.category === "data_health_notice" ||
      iss.category === "debug_invalid" ||
      iss.problemStage === "data_health" ||
      iss.optimizationArea === "tracking" ||
      iss.optimizationArea === "mapping" ||
      iss.optimizationArea === "data_sync"
  );

  // 5. Gather missingMetrics from matched issues
  const allMissingMetrics = Array.from(new Set(
    issues.flatMap(iss => {
      const snapshot = iss.evidence?.funnelSnapshot;
      if (!snapshot || !snapshot.missingMetrics) return [];
      return Array.isArray(snapshot.missingMetrics) ? snapshot.missingMetrics : [String(snapshot.missingMetrics)];
    })
  ));

  // 6. Gather limitations from all matched issues
  const allLimitations = Array.from(new Set(
    matchedIssues.flatMap(iss => {
      const lim = iss.limitations;
      if (!lim) return [];
      return Array.isArray(lim) ? lim : [String(lim)];
    })
  ));

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
              当前页面已接入离线规则诊断引擎。若数据库为空，将不会展示演示建议。后续 STEP 13-D-Lite 将接入采纳、执行和回测状态。
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">数据健康诊断</h1>
          <p className="text-sm text-slate-500 mt-1">
            实时查验系统与 Meta 广告链路、多级独立站 ERP、API 同步队列的数据流对账状况。
          </p>
        </div>

        {/* Date search */}
        <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border text-xs text-slate-705">
          <div className="flex items-center gap-1">
            <span>开始:</span>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded"
            />
          </div>
          <span>|</span>
          <div className="flex items-center gap-1">
            <span>结束:</span>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded"
            />
          </div>
          <button 
            onClick={refetch}
            disabled={loading}
            className="p-1 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border rounded-2xl p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <h4 className="text-sm font-bold text-slate-700">正在核对全域物理链路与对账状态...</h4>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-650 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">诊断拉取失败 (API Connections Failed)</h4>
              <p className="text-xs text-red-700 mt-1">{error.message}</p>
            </div>
          </div>
          <button 
            onClick={refetch}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重新连接并刷新
          </button>
        </div>
      ) : matchedIssues.length === 0 ? (
        <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h4 className="text-sm font-bold text-slate-705">暂无诊断数据。当前数据库可能为空，或所选日期范围内没有可诊断记录。</h4>
          <p className="text-xs text-slate-400">目前没有捕获到任何针对 Tracking 追踪、对账映射、多渠道同步中断的警示记录。</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Missing metrics and limitations overall summary panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-200">
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">漏斗指标缺失汇总 (missingMetrics)</span>
              {allMissingMetrics.length === 0 ? (
                <p className="text-xs text-slate-450 italic">检测通过。所有六段核心节点指标全部齐备。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {allMissingMetrics.map((m, i) => (
                    <span key={i} className="px-2 py-0.5 bg-red-50 border border-red-150 text-red-800 text-xs font-mono font-bold rounded">
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">数据限制汇总 (limitations)</span>
              {allLimitations.length === 0 ? (
                <p className="text-xs text-slate-450 italic">无历史时效性、授权失效阻碍或其他限制阻碍。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {allLimitations.map((l, i) => (
                    <span key={i} className="px-2 py-0.5 bg-amber-50 border border-amber-150 text-amber-900 text-xs font-mono rounded">
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Issues list rendering */}
          <div className="space-y-4">
            {matchedIssues.map((item) => {
              const isWarning = item.severity === "warning";
              const isDanger = item.severity === "critical";

              return (
                <div key={item.issueId} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        isDanger ? "bg-red-500" :
                        isWarning ? "bg-amber-500" : "bg-blue-500"
                      }`} />
                      <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold font-mono">
                        {item.issueId}
                      </span>
                      <span className="text-xs text-slate-400 capitalize">
                        {item.category.replace(/_/g, " ")}
                      </span>
                    </div>
                    
                    <h4 className="font-bold text-slate-900 text-sm">{item.title}</h4>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-4xl italic">
                      {item.diagnosisReason || item.oneLineReason}
                    </p>

                    {item.limitations && item.limitations.length > 0 && (
                      <p className="text-[11px] text-red-800 bg-red-50/50 p-2 rounded">
                        <strong>时效性限制:</strong> {item.limitations.join(", ")}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-4 shrink-0 self-end md:self-auto">
                    <div className="text-right">
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-50 text-slate-700 border">
                        Score: {item.priorityScore ?? "--"}
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1">
                        置信: {item.confidenceScore ? `${Math.round(item.confidenceScore * 100)}%` : "--"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}
