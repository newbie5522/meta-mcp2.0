import React from "react";
import { 
  Building, 
  HelpCircle, 
  Percent, 
  DollarSign, 
  ShoppingBag, 
  Barcode, 
  TrendingUp, 
  Scale,
  Sparkles,
  Inbox,
  AlertCircle,
  RefreshCw,
  Calendar,
  Layers,
  Activity,
  Award,
  BookOpen
} from "lucide-react";
import { useDiagnosticsIssues } from "./useDiagnosticsIssues";

export function StoreDiagnosisPage() {
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

  // Filters based on requirements:
  // 1. 店铺经营结果: problemStage === "outcome"
  const outcomeIssues = issues.filter(iss => iss.problemStage === "outcome");

  // 2. Meta 与 Store 对账: funnelStage === "meta_to_store_reconciliation"
  const reconciliationIssues = issues.filter(iss => iss.funnelStage === "meta_to_store_reconciliation");

  // 3. 数据映射 / 追踪问题: optimizationArea in ["tracking", "mapping", "data_sync"]
  const trackingIssues = issues.filter(iss => 
    ["tracking", "mapping", "data_sync"].includes(iss.optimizationArea || "")
  );

  // 4. 店铺相关 entity: entityType === "store"
  const storeIssues = issues.filter(iss => iss.entityType === "store");

  // All store-relevant issues combined: outcome, reconciliation, tracking/mapping/data_sync, store entity
  const storeRelevantIssues = issues.filter(iss => 
    iss.problemStage === "outcome" ||
    iss.funnelStage === "meta_to_store_reconciliation" ||
    ["tracking", "mapping", "data_sync"].includes(iss.optimizationArea || "") ||
    iss.entityType === "store"
  );

  // High priority list (top 5 store relevant sorted by priorityScore desc)
  const topStoreIssues = [...storeRelevantIssues]
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 5);

  const hasData = storeRelevantIssues.length > 0;

  // Find dynamic metrics from evidence.funnelSnapshot if present
  const firstFunnelSnapshot = storeRelevantIssues.find(iss => iss.evidence?.funnelSnapshot)?.evidence?.funnelSnapshot;

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

      {/* Header section with date selection */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">店铺经营诊断</h1>
          <p className="text-sm text-slate-500 mt-1">
            连接真实独立站店铺数据的账面经营表现，深度评估全盘变现合理性。店铺经营诊断基于规则诊断引擎 issues 和 funnelSnapshot 展示，不直接生成经营结论。
          </p>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border text-xs text-slate-705 shrink-0">
          <Calendar className="w-4 h-4 text-slate-400" />
          <div className="flex items-center gap-1">
            <span>开始:</span>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-1">
            <span>结束:</span>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button 
            onClick={refetch}
            disabled={loading}
            className="p-1 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:bg-blue-300"
            title="手动刷新"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          <h4 className="text-sm font-bold text-slate-700">正在调取真实店铺经营异常结果...</h4>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-650 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">店铺经营诊断拉取失败 (API Connections Failed)</h4>
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
      ) : !hasData ? (
        <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-4 max-w-3xl mx-auto">
          <Inbox className="w-12 h-12 text-slate-400 mx-auto" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-700">暂无店铺经营诊断数据。当前数据库可能为空，或尚未同步店铺订单 / Meta 账户映射数据。</h4>
            <p className="text-xs text-slate-400">
              底层的规则引擎在所选日期区间内，未捕获到任何符合 [店铺经营结果 / 归因对账 / 映射限制] 的诊断异常。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Section: Category summary counters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">店铺经营相关 (Total)</span>
              <div className="text-3xl font-extrabold text-slate-900">{storeRelevantIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">汇总的所有店铺关联异常</p>
            </div>
            
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">经营结果问题 (outcome)</span>
              <div className="text-3xl font-extrabold text-slate-900">{outcomeIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">经营转化及宏观毛利率问题</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">账户对账偏离 (reconciliation)</span>
              <div className="text-3xl font-extrabold text-slate-900">{reconciliationIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">物理归因与对账波动机理</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">追踪映射异常 (tracking/mapping)</span>
              <div className="text-3xl font-extrabold text-slate-900">{trackingIssues.length} 个</div>
              <p className="text-[10px] text-slate-400 mt-1 pt-2 border-t border-slate-50">Pixel、映射配置或 API 链路障碍</p>
            </div>
          </div>

          {/* Dynamic funnel facts check from evidence.funnelSnapshot if populated */}
          {firstFunnelSnapshot && (
            <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-150 space-y-4">
              <h3 className="font-bold text-blue-900 text-sm flex items-center gap-2">
                <Scale className="w-5 h-5 text-blue-700" />
                提取自最新诊断快照的财务和对账基本参数
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {firstFunnelSnapshot.storeRoas !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">建议分析 ROAS</span>
                    <span className="text-xl font-bold text-blue-800">{firstFunnelSnapshot.storeRoas}</span>
                  </div>
                )}
                {firstFunnelSnapshot.storeOrders !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">对账建议真实订单数</span>
                    <span className="text-xl font-bold text-blue-800">{firstFunnelSnapshot.storeOrders}</span>
                  </div>
                )}
                {firstFunnelSnapshot.storeRevenue !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">对账建议总成交额</span>
                    <span className="text-xl font-bold text-blue-800">${firstFunnelSnapshot.storeRevenue}</span>
                  </div>
                )}
                {firstFunnelSnapshot.metaStoreOrderGap !== undefined && (
                  <div className="bg-white p-4 rounded-xl border border-blue-100">
                    <span className="text-xs text-slate-500 block">未归因比例偏移 (Gap)</span>
                    <span className="text-xl font-bold text-blue-800">{firstFunnelSnapshot.metaStoreOrderGap}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Core breakdown row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: Top Store-related Issues */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-blue-600" />
                      当前高优先级店铺诊断处方 (最高 PriorityScore 前 5 条)
                    </h3>
                    <p className="text-xs text-slate-500">规则诊断自研引擎实时归回判定</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {topStoreIssues.map((iss) => (
                    <div key={iss.issueId} className="p-4 rounded-xl hover:bg-slate-50 border border-slate-150/40 transition-colors space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-700 font-bold rounded-md font-mono uppercase">
                            {iss.issueId}
                          </span>
                          <span className="text-xs text-slate-500 font-semibold uppercase">{iss.problemStage || iss.funnelStage || "店铺实体"}</span>
                        </div>
                        <span className="text-[11px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                          Priority: {iss.priorityScore ?? "--"}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-slate-950">{iss.title}</h4>
                      <p className="text-xs text-slate-600 bg-white p-3 rounded border border-slate-100 leading-relaxed italic">
                        <strong>诊断结论:</strong> {iss.diagnosisReason || iss.oneLineReason}
                      </p>

                      {iss.suggestedActions && iss.suggestedActions.length > 0 && (
                        <div className="text-[11px] text-slate-705 bg-slate-100/50 p-2.5 rounded border border-slate-200/50">
                          <strong>推荐改进动作:</strong> {iss.suggestedActions.join(" | ")}
                        </div>
                      )}

                      {iss.validationMetrics && (
                        <div className="text-[11px] text-indigo-700 bg-indigo-50/40 p-2 rounded">
                          <strong>验证阈值指标:</strong> {Array.isArray(iss.validationMetrics) ? iss.validationMetrics.join(", ") : iss.validationMetrics}
                        </div>
                      )}

                      {iss.limitations && iss.limitations.length > 0 && (
                        <div className="text-[11px] text-red-700 bg-red-50/50 p-2 rounded">
                          <strong>风控限制:</strong> {iss.limitations.join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

              </div>
            </div>

            {/* Right Column: Mini static facts or explanations */}
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 border-b pb-2 uppercase tracking-wider">
                  店铺对账说明
                </h3>
                <p className="text-xs text-slate-605 leading-relaxed">
                  通过匹配 Meta 广告归因记录与第三方独立站系统，诊断 Pixel 丢失或 CAPI 缺失引起的漏斗脱节。
                </p>
                <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                  绑定全部账户是计算准确 Store ROAS 的唯一前提。
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
