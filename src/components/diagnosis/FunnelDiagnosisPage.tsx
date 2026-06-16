import React from "react";
import { 
  ArrowRight, 
  AlertTriangle, 
  Sparkles, 
  Info,
  HelpCircle,
  Database,
  Layers,
  TrendingDown,
  ShoppingBag,
  MousePointerClick,
  ShoppingCart
} from "lucide-react";

export function FunnelDiagnosisPage() {
  const steps = [
    {
      node: "1. Impressions (曝光量)",
      amount: "1,245,600",
      rate: "100%",
      subRate: null,
      missingMetrics: [],
      aiObservation: "基建展现充足，Meta 机器学习冷启动良好，整体预算曝光没有限制。",
      action: "维持当前受众设置，观察高曝光带来的受众疲劳频次。"
    },
    {
      node: "2. Link Click (链接点击量)",
      amount: "14,948",
      rate: "1.20% (CTR)",
      subRate: "曝光到点击: 1.20%",
      missingMetrics: [],
      aiObservation: "基础点击健康。当前使用 FactMetaPerformance.clicks 暂时代替真实 linkClicks 数据源进行计算。",
      action: "若后续补充真实 link_clicks 字段，应自动切换为真实 Link Click 进行漏斗去真。"
    },
    {
      node: "3. Landing Page View (落地页到达)",
      amount: "null (无数据)",
      rate: "无数据",
      subRate: "点击到到达: 数据不足",
      missingMetrics: ["landingPageViews"],
      aiObservation: "当前缺少 Landing Page View 字段，由于 Shopify API 物理同步延迟或事件标签未配置，暂无法计算点击到落地页到达率。",
      action: "建议核实 Pixel 或 CAPI 发射代码，在配置中心绑定 Page View 事件。"
    },
    {
      node: "4. Add to Cart (加入购物车)",
      amount: "725",
      rate: "4.85% (点击到加购)",
      subRate: "点击到加购: 4.85%",
      missingMetrics: [],
      aiObservation: "点击到加购率较低（通常理想值为 6.00% 以上）。说明受众进入落地页或单品详情后，未被文案、图片或价格说服。",
      action: "优化详情页面痛点排印，缩短排队加载；配置首件大额优惠提高加购转化。"
    },
    {
      node: "5. Initiate Checkout (发起结账)",
      amount: "235",
      rate: "32.41% (加购到结账)",
      subRate: "加购到结账: 32.41%",
      missingMetrics: [],
      aiObservation: "流失率偏高，接近 68% 的加购用户未进行到下一步。用户可能对价格结算时显示的高昂运费、过高税费产生抗拒。",
      action: "核查全站运费设置，优先推出 '满 $39/49 包邮' 活动，或在前度落地页突出显示 Full Protection 保障。"
    },
    {
      node: "6. Purchase (Meta 归因购买)",
      amount: "78",
      rate: "33.19% (结账到购买)",
      subRate: "结账到购买: 33.19%",
      missingMetrics: [],
      aiObservation: "结账到购买转化效率平稳，但转化绝对基盘受到上段骤降影响。Pixel 归因未出现明显的批量阻碍。",
      action: "可于结账后 30 分钟引入 abandoned checkout 追加回捞短信信道机制。"
    },
    {
      node: "7. Store Order (独立站店铺订单对账)",
      amount: "96",
      rate: "123% (Meta 购买对账率)",
      subRate: "Meta 订单对账差异: +18 个订单",
      missingMetrics: [],
      aiObservation: "店铺真实成交多于 Meta 归因，表明有机自然流量承接顺畅，或多个广告账户共创订单。数据未出现逆向对账异常。",
      action: "通过主事实账面评估真实 Store ROAS，确保将自然流量增量红利算在全站综合 ROI 内。"
    }
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

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h1 className="text-xl font-bold text-slate-900">转化漏斗诊断</h1>
        <p className="text-sm text-slate-500">
          全链路展现到独立站成交的漏斗监测。追踪在每个节点上流失的用户比率，分析底层物理漏洞。
        </p>
        
        {/* Important Warning Notice */}
        <div className="p-4 rounded-xl bg-orange-50 border border-orange-150 flex gap-3.5 text-xs text-orange-900 leading-relaxed">
          <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold">数据口径及缺失申明：</span>
            <p>
              当前 Landing Page View 字段可能缺失时，到达率会显示为数据不足；linkClicks 暂可能由 clicks 代替。我们从不伪造底层漏斗指标。
            </p>
          </div>
        </div>
      </div>

      {/* Visual Stepper Waterfall */}
      <div className="space-y-4">
        {steps.map((step, idx) => {
          const hasMissing = step.missingMetrics.length > 0;
          return (
            <div key={idx} className="relative">
              {/* Connector line */}
              {idx < steps.length - 1 && (
                <div className="absolute left-[27px] top-12 bottom-0 w-1 bg-slate-200 group-hover:bg-blue-300 transition-colors -z-10" />
              )}
              
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-6 relative z-10 hover:border-slate-350 transition-all">
                {/* Visual Bullet Icon */}
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                  hasMissing ? "bg-amber-50 text-amber-600 border border-amber-200" : "bg-blue-50 text-blue-600 border border-blue-200"
                }`}>
                  {idx === 0 && <Layers className="w-6 h-6" />}
                  {idx === 1 && <MousePointerClick className="w-6 h-6" />}
                  {idx === 2 && <Info className="w-6 h-6" />}
                  {idx === 3 && <ShoppingCart className="w-6 h-6" />}
                  {idx === 4 && <Layers className="w-6 h-6" />}
                  {idx === 5 && <TrendingDown className="w-6 h-6" />}
                  {idx === 6 && <ShoppingBag className="w-6 h-6" />}
                </div>

                {/* Info block */}
                <div className="flex-1 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-50 pb-2">
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-900 text-sm">{step.node}</h3>
                      {step.subRate && <p className="text-[11px] text-slate-400">{step.subRate}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {hasMissing && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 rounded">
                          数据缺失: {step.missingMetrics.join(", ")}
                        </span>
                      )}
                      <span className="px-3 py-1 text-xs font-bold bg-slate-100 text-slate-800 rounded-full">
                        流转值: {step.amount}
                      </span>
                      <span className="px-3 py-1 text-xs font-extrabold bg-blue-600 text-white rounded-full">
                        转化率: {step.rate}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Diagnostic evaluation */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                        <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 诊断判断
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {step.aiObservation}
                      </p>
                    </div>

                    {/* Suggested action */}
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-slate-800 block">建议执行动作</span>
                      <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        {step.action}
                      </p>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
