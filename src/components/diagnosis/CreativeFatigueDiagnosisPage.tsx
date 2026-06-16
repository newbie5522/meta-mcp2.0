import React from "react";
import { 
  Sparkles, 
  HelpCircle, 
  TrendingUp, 
  ArrowDownIcon, 
  RefreshCw, 
  AlertTriangle,
  Info
} from "lucide-react";

export function CreativeFatigueDiagnosisPage() {
  const creativeIssues = [
    {
      creativeId: "vid_01",
      title: "【爆款衰退】夏季短袖清凉短视频",
      metrics: {
        frequency: "4.15 (+32%)",
        ctr: "1.12% (-48%)",
        cpc: "$1.42 (+85%)",
        roas: "1.10 (-52%)"
      },
      status: "严重疲劳 (High Fatigue)",
      aiJudgement: "该创意频次高达 4.15，在主要受众集群中多次重复触达，导致 CTR 骤降、CPA 加倍。典型的素材疲劳期。",
      suggestion: "立即调低该素材广告组预算，引入 2 项新主推视频素材进行轮替。"
    },
    {
      creativeId: "vid_02",
      title: "【高点击低购买】高对比度痛点解析图",
      metrics: {
        frequency: "1.85 (+2.3%)",
        ctr: "3.45% (高吸引力)",
        cpc: "$0.45 (极低成本)",
        roas: "0.22 (无成交)"
      },
      status: "高点击低购买 / 高 CTR 低 ATC",
      aiJudgement: "引流能力极强，但落地页至加购漏斗出现全链断崖。表明广告展示具有诱导性或落地页内容未承载素材传达的信息。",
      suggestion: "重点核对详情页首图描述与主张是否与该广告高度对应。修改详情页承接重点或排查错误跳转。"
    },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      {/* Disclaimer Banner */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-sm">
        <div className="flex">
          <div className="flex-shrink-0">
            <span className="text-amber-500">⚠️</span>
          </div>
          <div className="ml-3">
            <p className="text-xs text-amber-800 font-bold">
              当前页面为 UI 骨架占位示例，展示数据为占位示例，不代表真实店铺或广告账户表现。下一阶段将接入 /api/diagnostics/issues。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">素材疲劳诊断</h1>
        <p className="text-sm text-slate-500 mt-1">
          智能识别广告视频、图片在投放生命周期中的衰热状态，提前预警 CTR 下滑与频次压迫阻碍。
        </p>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-rose-500" />
            <h4 className="text-xs font-bold text-slate-500 uppercase">Frequency 警报</h4>
          </div>
          <div className="text-xl font-extrabold text-rose-600 mt-2">频次上升 15.3%</div>
          <p className="text-[10px] text-slate-400 mt-2">同受众下曝光多次触发，会导致点击率急剧衰弱</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <ArrowDownIcon className="w-4 h-4 text-amber-500" />
            <h4 className="text-xs font-bold text-slate-500 uppercase">点击率 & ROAS 衰变</h4>
          </div>
          <div className="text-xl font-extrabold text-amber-600 mt-2">CTR 下降 34%</div>
          <p className="text-[10px] text-slate-400 mt-2">近 14 天对比上周期，CPC 从 $0.78 下滑到高点</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <h4 className="text-xs font-bold text-slate-500 uppercase">漏斗断层</h4>
          </div>
          <div className="text-xl font-extrabold text-orange-600 mt-2">2 个高吸引力低转化</div>
          <p className="text-[10px] text-slate-400 mt-2">高点击引流、极度缺乏落地加购承接</p>
        </div>
      </div>

      {/* Issues list */}
      <div className="space-y-6">
        <h3 className="font-bold text-slate-900 text-sm">疲劳与转化异动素材列表</h3>
        {creativeIssues.map((cr, idx) => (
          <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-3">
              <div>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded mr-2">
                  ID: {cr.creativeId}
                </span>
                <span className="font-bold text-slate-900 text-sm">{cr.title}</span>
              </div>
              <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                idx === 0 ? "bg-red-100 text-red-800" : "bg-orange-100 text-orange-850"
              }`}>
                {cr.status}
              </span>
            </div>

            {/* Metrics sub-grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl">
              <div>
                <span className="text-[10px] text-slate-400 font-medium block">频次 Frequency</span>
                <span className="text-sm font-bold text-slate-800">{cr.metrics.frequency}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-medium block">转化点击率 CTR</span>
                <span className="text-sm font-bold text-slate-800">{cr.metrics.ctr}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-medium block">单次点击成本 CPC</span>
                <span className="text-sm font-bold text-slate-800">{cr.metrics.cpc}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-medium block">素材层级 ROAS</span>
                <span className="text-sm font-bold text-slate-850">{cr.metrics.roas}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 判断结论
                </div>
                <p className="text-xs text-slate-650 leading-relaxed bg-blue-50/20 p-3 rounded-lg border border-blue-50/40">
                  {cr.aiJudgement}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-800 block">建议应对手段</span>
                <div className="text-xs text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {cr.suggestion}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
