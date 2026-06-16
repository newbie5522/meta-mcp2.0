import React from "react";
import { 
  DollarSign, 
  Eye, 
  MousePointerClick, 
  ShoppingCart, 
  Sparkles, 
  TrendingUp, 
  Activity,
  Heart
} from "lucide-react";

export function AdPerformanceDiagnosisPage() {
  const diagnosticCards = [
    {
      title: "效率 Cost Efficiency",
      keyMetrics: [
        { label: "CPM", value: "$12.45", benchmark: "< $15.00", status: "excellent" },
        { label: "CPC", value: "$0.84", benchmark: "< $1.00", status: "excellent" },
        { label: "Frequency", value: "2.14", benchmark: "< 3.00", status: "warning" },
      ],
      aiConclusion: "展现花费覆盖均衡。Frequency 微升在近期高消耗高频触达下属于正常震荡，但应谨防老素材过度盘剥导致的买不进人。",
      suggestion: "暂不需高干扰调整；可为高消耗组合适度引入 10%-15% 的国家地理交叉排除受众。"
    },
    {
      title: "吸引力 Attractiveness",
      keyMetrics: [
        { label: "Overall CTR", value: "2.15%", benchmark: "> 1.50%", status: "excellent" },
        { label: "Link CTR", value: "0.98%", benchmark: "> 1.20%", status: "danger" },
      ],
      aiConclusion: "创意整体吸引力尚可，但 Link CTR（链接点击率）偏低，表明用户虽停留在广告卡片上，但在文案末尾或引导按钮处的点击动力不足。",
      suggestion: "重点优化 CTA（Call-To-Action）文案与直达页标题，采用更短、更具号召力的行动词。引入高转化对比色标签。"
    },
    {
      title: "意向度 Intent",
      keyMetrics: [
        { label: "ATC Rate", value: "4.85%", benchmark: "> 6.00%", status: "danger" },
        { label: "IC Rate", value: "32.40%", benchmark: "> 40.00%", status: "danger" },
      ],
      aiConclusion: "到达产品落地页后，加购率（ATC）和发起结账率（IC）双重承压。表明买量受众在承接页上遇到了价格阻碍，或者商品信任感（ trust rating ）过低。",
      suggestion: "优化落地页文案，提高评价可读性，并在前三屏提供醒目的安全结算徽章及真实的退款换货承诺。"
    },
    {
      title: "结局 Outcome",
      keyMetrics: [
        { label: "CPA (Meta)", value: "$28.50", benchmark: "$25.00", status: "warning" },
        { label: "ROAS (Meta)", value: "1.85", benchmark: "2.20", status: "danger" },
        { label: "Store ROAS", value: "1.42", benchmark: "1.80", status: "danger" },
      ],
      aiConclusion: "结局性指标显示买量处于微幅亏损或微利边缘。主因是加购到结账流失漏失。Store ROAS 与 Meta 归因存在背离，反映了有未映射账号消耗或多通道混合转化现象。",
      suggestion: "在未大幅度扭转漏斗中段的前提下，建议全链降低 10% 预算，避免盲目买量，同步核查未映射消耗。"
    }
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">广告表现诊断</h1>
        <p className="text-sm text-slate-500 mt-1">
          对广告消耗、流量表现、结账流程进行四维解构，快速指出问题卡点与干预手段
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {diagnosticCards.map((card, idx) => (
          <div key={idx} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-bold text-slate-900 text-base">{card.title}</h3>
            </div>

            {/* Metrics List */}
            <div className="p-6 space-y-4 flex-1">
              <div className="grid grid-cols-3 gap-4 border-b border-slate-100 pb-5">
                {card.keyMetrics.map((m, mIdx) => (
                  <div key={mIdx} className="space-y-1">
                    <span className="text-[11px] text-slate-400 font-medium tracking-wide uppercase">{m.label}</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold text-slate-900">{m.value}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`w-2 h-2 rounded-full ${
                        m.status === "excellent" ? "bg-emerald-500" :
                        m.status === "warning" ? "bg-amber-500" : "bg-rose-500"
                      }`} />
                      <span className="text-[10px] text-slate-450 font-medium">健康线 {m.benchmark}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* AI conclusion */}
              <div className="space-y-2 mt-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 诊断意见
                </div>
                <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/40 p-3 rounded-lg border border-blue-50">
                  {card.aiConclusion}
                </p>
              </div>
            </div>

            {/* Suggestions Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 mt-auto">
              <div className="flex items-start gap-2">
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-[9px] uppercase tracking-wider shrink-0 mt-0.5">
                  建议对策
                </span>
                <p className="text-[11px] text-slate-500 leading-normal">
                  {card.suggestion}
                </p>
              </div>
            </div>

          </div>
        ))}
      </div>
    </div>
  );
}
