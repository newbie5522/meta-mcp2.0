import React from "react";
import { 
  AlertCircle, 
  TrendingDown, 
  DollarSign, 
  Layers, 
  Compass, 
  ShieldCheck, 
  CheckCircle2, 
  ArrowRight,
  TrendingUp,
  Activity,
  Award
} from "lucide-react";

export function DiagnosisOverviewPage() {
  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      {/* Introduction Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 rounded-2xl p-8 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-white/5 rounded-full blur-2xl" />
        <div className="absolute right-12 bottom-0 translate-y-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-xl" />
        <div className="relative z-10 max-w-4xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold uppercase tracking-wider text-blue-200">
            <Compass className="w-3.5 h-3.5" /> AI Engine Core
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">AI 诊断中心</h1>
          <p className="text-indigo-100 text-lg leading-relaxed max-w-3xl">
            AI 诊断中心基于 Meta 广告数据与店铺订单数据，定位流量和转化漏斗中的主要流失卡点。
          </p>
        </div>
      </div>

      {/* Overview Stats Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">P0 / P1 问题</span>
            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">14</span>
            <span className="text-xs text-red-600 font-semibold">2 P0 · 12 P1</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">亟需关注的异常警报</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">受影响预算</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">$2,410</span>
            <span className="text-xs text-blue-600 font-semibold">近7天</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">映射或低效受损消耗</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">受影响店铺</span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">4</span>
            <span className="text-xs text-purple-600 font-semibold">个店铺</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">异常或未映射店铺关联</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">受影响账户</span>
            <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">6</span>
            <span className="text-xs text-orange-600 font-semibold">个关联账户</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">部分账户涉及未同步状态</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">数据可信度</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">85%</span>
            <span className="text-xs text-emerald-600 font-semibold">良好良好</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">基于漏斗与归因对账完整度</p>
        </div>
      </div>

      {/* Main Bottleneck & Core Issues Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left column: Major Bottlenecks */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900">主要瓶颈定位</h3>
                <p className="text-xs text-slate-500">根据整站漏斗流失率与数据同步对账得出的最显著痛点</p>
              </div>
              <span className="px-2.5 py-1 text-xs font-semibold bg-red-100 text-red-800 rounded-full">高风险阻碍</span>
            </div>

            <div className="space-y-6">
              {/* Bottleneck 1 */}
              <div className="flex gap-4 p-4 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                  <TrendingDown className="w-6 h-6" />
                </div>
                <div className="space-y-2 flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">加购到发起结账（ATC to IC）率急剧下滑</h4>
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-orange-100 text-orange-850 rounded">Checkout Drop</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    在 active_bound_accounts 的近 7 天流水中，加购到发起结账比率相比前一个周期下滑了 28%，表明用户在选择商品后的购买阻碍或运费政策可能削弱了购买冲动。
                  </p>
                  <div className="flex items-center gap-4 text-[11px] text-slate-400">
                    <span>影响消耗：<strong className="text-slate-700">$1,350.50</strong></span>
                    <span>状态：<span className="text-orange-650 font-medium">诊断阻碍 (Outcome Blocked)</span></span>
                  </div>
                </div>
              </div>

              {/* Bottleneck 2 */}
              <div className="flex gap-4 p-4 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                  <Layers className="w-6 h-6" />
                </div>
                <div className="space-y-2 flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">未映射高消耗广告账户</h4>
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-red-100 text-red-850 rounded">Data Sync Risk</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    发现存在单日消耗超过 $500 的未绑定/未映射广告账户，这导致底层对账服务无法将这部分广告花费计入具体独立站店铺，Store ROAS 统计失真。
                  </p>
                  <div className="flex items-center gap-4 text-[11px] text-slate-400">
                    <span>影响消耗：<strong className="text-slate-700">$532.00 / 天</strong></span>
                    <span>状态：<span className="text-red-650 font-medium">P0 数据中断</span></span>
                  </div>
                </div>
              </div>

              {/* Bottleneck 3 */}
              <div className="flex gap-4 p-4 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                  <Activity className="w-6 h-6" />
                </div>
                <div className="space-y-2 flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">产品物理 ISO 国家代码未解析</h4>
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-blue-100 text-blue-800 rounded">Analysis Limit</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Order 数据表中 15% 的记录检测到 `order_country_missing` 状态，将阻碍多维度国家财务归回与纯订单地域表现比对。
                  </p>
                  <div className="flex items-center gap-4 text-[11px] text-slate-400">
                    <span>受阻比例：<strong className="text-slate-700">15.4% 订单量</strong></span>
                    <span>状态：<span className="text-blue-650 font-medium">数据不完整 (Data Health Notice)</span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: Today's Most Urgent Recommendations */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              今日最优先建议处方
            </h3>
            
            <div className="space-y-4">
              {/* Suggestion 1 */}
              <div className="p-4 rounded-xl bg-red-50/50 border border-red-150/50 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-red-100 text-red-800 rounded">
                    PR 1 · 极紧急
                  </span>
                  <span className="text-xs text-slate-500">数据健康</span>
                </div>
                <h4 className="text-xs font-bold text-slate-900">
                  绑定未映射高消耗账户 act_unknown
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  检测到有未绑定的消费账户，建议立即前往配置中心关联到对应独立站。
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400">优先级得分: 98</span>
                  <button className="text-[11px] font-semibold text-blue-600 flex items-center gap-1 hover:underline">
                    去处理 <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Suggestion 2 */}
              <div className="p-4 rounded-xl bg-orange-50/50 border border-orange-150/50 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-orange-100 text-orange-850 rounded">
                    PR 2 · 高优先
                  </span>
                  <span className="text-xs text-slate-500">预算与点击流失</span>
                </div>
                <h4 className="text-xs font-bold text-slate-900">
                  优化 Landing Page 的高跳出与加载时长
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  在转化漏斗诊断中，点击到页面到达阶段流失重大。可能存在移动端页面排版或脚本阻塞。
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400">优先级得分: 82</span>
                  <button className="text-[11px] font-semibold text-blue-600 flex items-center gap-1 hover:underline">
                    查看漏斗 <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Suggestion 3 */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700 rounded">
                    PR 3 · 中等
                  </span>
                  <span className="text-xs text-slate-500">转化优化</span>
                </div>
                <h4 className="text-xs font-bold text-slate-900">
                  排除国家受众 GB 高消耗低 ROAS
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  国家受众分析报告表明 GB 近期 ROAS 大幅滑落，建议调整定向或缩减定向预算。
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400">优先级得分: 64</span>
                  <button className="text-[11px] font-semibold text-blue-600 flex items-center gap-1 hover:underline">
                    去看国家 <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
