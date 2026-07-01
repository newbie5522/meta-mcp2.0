import React from "react";
import { 
  Sparkles, 
  Activity, 
  AlertCircle,
  Inbox,
  RefreshCw,
  TrendingDown,
  Layers,
  Award,
  DollarSign,
  Calendar
} from "lucide-react";
import { useDiagnosticsIssues } from "./useDiagnosticsIssues";

export function AdPerformanceDiagnosisPage() {
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

  // Categorize issues based on the requirements:
  // 1. ad_delivery 相关 issues
  const deliveryIssues = issues.filter(
    (iss) => 
      iss.issueType === "ad_delivery" || 
      iss.problemStage === "ad_delivery" ||
      iss.optimizationArea === "delivery"
  );

  // 2. creative_attraction 相关 issues
  const creativeIssues = issues.filter(
    (iss) => 
      iss.issueType === "creative_attraction" || 
      iss.problemStage === "creative_attraction" ||
      iss.optimizationArea === "creative"
  );

  // 3. outcome 相关 issues
  const outcomeIssues = issues.filter(
    (iss) => 
      iss.issueType === "outcome" || 
      iss.problemStage === "outcome" ||
      iss.optimizationArea === "budget"
  );

  // 4. budget / audience 相关 issues (or other general optimizationAreas)
  const budgetAudienceIssues = issues.filter(
    (iss) => 
      iss.optimizationArea === "budget" || 
      iss.optimizationArea === "audience"
  );

  // Check if we have any relevant ad performance issues at all
  const hasData = deliveryIssues.length > 0 || creativeIssues.length > 0 || outcomeIssues.length > 0 || budgetAudienceIssues.length > 0;
  const getSeverityLabel = (value?: string | null) => {
    const labels: Record<string, string> = {
      critical: "严重",
      warning: "需要关注",
      info: "提醒"
    };
  
    return value ? labels[value] || value : "提醒";
  };

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
              当前页面仅展示真实诊断结果；如果所选时间内没有异常，会显示为空状态。
            </p>
          </div>
        </div>
      </div>

      {/* Title Header with date search */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">广告表现诊断</h1>
          <p className="text-sm text-slate-500 mt-1">
            汇总广告投放、素材吸引力和转化效果相关问题，帮助团队判断下一步处理方向。
          </p>
        </div>

        {/* Date picking box */}
        <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs text-slate-705">
          <div className="flex items-center gap-1">
            <span>开始:</span>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-800"
            />
          </div>
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-1">
            <span>结束:</span>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-800"
            />
          </div>
          <button 
            onClick={refetch}
            disabled={loading}
            className="p-1 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:bg-blue-300"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <h4 className="text-sm font-bold text-slate-700">正在加载诊断结果，请稍候...</h4>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">诊断数据加载失败</h4>
              <p className="text-xs text-red-700 mt-1">数据暂时无法加载，请稍后重试或检查后端服务状态。</p>
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
        <div className="bg-white/50 border border-slate-205 border-dashed rounded-2xl p-16 text-center space-y-3">
          <Inbox className="w-12 h-12 text-slate-400 mx-auto" />
          <h4 className="text-sm font-bold text-slate-700">暂无可执行广告诊断建议。</h4>
          <p className="text-xs text-slate-400">当前日期范围内没有发现明显的投放、素材或转化异常。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* 投放效率 */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 text-sm">加购与投放效率 </h3>
              <span className="px-2 py-0.5 bg-blue-105 text-blue-800 text-[10px] font-bold rounded">
                数量: {deliveryIssues.length}
              </span>
            </div>
            
            <div className="p-5 space-y-4 flex-1">
              {deliveryIssues.length === 0 ? (
                <p className="text-xs text-slate-400 italic">当前日期范围内未发现明显的投放效率问题。</p>
              ) : (
                <div className="space-y-4">
                  {deliveryIssues.map((iss) => (
                    <div key={iss.issueId} className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/40 space-y-2">
                       <div className="flex items-center justify-between">
                         <span className="text-[10px] font-mono text-slate-420 font-bold uppercase">{iss.issueId}</span>
                         <span className={`px-1.5 py-0.5 text-[9px] rounded font-bold uppercase ${
                           {getSeverityLabel(iss.severity)} ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                         }`}>
                           {iss.severity}
                         </span>
                       </div>
                       <h4 className="text-xs font-bold text-slate-905">{iss.title}</h4>
                       <div className="text-xs text-slate-600 bg-white p-2.5 rounded border border-slate-100 italic">
                         <strong>诊断分析: </strong>{iss.diagnosisReason || iss.oneLineReason}
                       </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 素材吸引力 */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 text-sm">素材吸引力</h3>
              <span className="px-2 py-0.5 bg-purple-105 text-purple-800 text-[10px] font-bold rounded">
                数量: {creativeIssues.length}
              </span>
            </div>
            
            <div className="p-5 space-y-4 flex-1">
              {creativeIssues.length === 0 ? (
                <p className="text-xs text-slate-400 italic">当前日期范围内未发现明显的素材吸引力问题。</p>
              ) : (
                <div className="space-y-4">
                  {creativeIssues.map((iss) => (
                    <div key={iss.issueId} className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/40 space-y-2">
                       <div className="flex items-center justify-between">
                         <span className="text-[10px] font-mono text-slate-420 font-bold uppercase">{iss.issueId}</span>
                         <span className={`px-1.5 py-0.5 text-[9px] rounded font-bold uppercase bg-purple-100 text-purple-800`}>
                           {iss.severity}
                         </span>
                       </div>
                       <h4 className="text-xs font-bold text-slate-905">{iss.title}</h4>
                       <div className="text-xs text-slate-600 bg-white p-2.5 rounded border border-slate-100 italic">
                         <strong>诊断分析: </strong>{iss.diagnosisReason || iss.oneLineReason}
                       </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 转化效果 */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 text-sm">购买结局与效果归因</h3>
              <span className="px-2 py-0.5 bg-emerald-105 text-emerald-800 text-[10px] font-bold rounded">
                数量: {outcomeIssues.length}
              </span>
            </div>
            
            <div className="p-5 space-y-4 flex-1">
              {outcomeIssues.length === 0 ? (
                <p className="text-xs text-slate-400 italic">当前日期范围内未发现明显的转化效果预警。</p>
              ) : (
                <div className="space-y-4">
                  {outcomeIssues.map((iss) => (
                    <div key={iss.issueId} className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/40 space-y-2">
                       <div className="flex items-center justify-between">
                         <span className="text-[10px] font-mono text-slate-420 font-bold uppercase">{iss.issueId}</span>
                         <span className={`px-1.5 py-0.5 text-[9px] rounded font-bold uppercase bg-emerald-100 text-emerald-800`}>
                           {iss.severity}
                         </span>
                       </div>
                       <h4 className="text-xs font-bold text-slate-905">{iss.title}</h4>
                       <div className="text-xs text-slate-600 bg-white p-2.5 rounded border border-slate-100 italic">
                         <strong>诊断分析: </strong>{iss.diagnosisReason || iss.oneLineReason}
                       </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 预算与受众 */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 text-sm">预算控制与定向优化</h3>
              <span className="px-2 py-0.5 bg-amber-105 text-amber-800 text-[10px] font-bold rounded">
                数量: {budgetAudienceIssues.length}
              </span>
            </div>
            
            <div className="p-5 space-y-4 flex-1">
              {budgetAudienceIssues.length === 0 ? (
                <p className="text-xs text-slate-400 italic">当前日期范围内未发现明显的预算或受众问题。</p>
              ) : (
                <div className="space-y-4">
                  {budgetAudienceIssues.map((iss) => (
                    <div key={iss.issueId} className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/40 space-y-2">
                       <div className="flex items-center justify-between">
                         <span className="text-[10px] font-mono text-slate-420 font-bold uppercase">{iss.issueId}</span>
                         <span className={`px-1.5 py-0.5 text-[9px] rounded font-bold uppercase bg-amber-100 text-amber-800`}>
                           {iss.severity}
                         </span>
                       </div>
                       <h4 className="text-xs font-bold text-slate-905">{iss.title}</h4>
                       <div className="text-xs text-slate-600 bg-white p-2.5 rounded border border-slate-100 italic">
                         <strong>诊断分析: </strong>{iss.diagnosisReason || iss.oneLineReason}
                       </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
