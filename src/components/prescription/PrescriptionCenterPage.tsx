import React, { useState, useEffect } from "react";
import { 
  Sparkles, 
  HelpCircle, 
  Briefcase, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  CheckSquare, 
  UserPlus, 
  ChevronRight,
  TrendingUp,
  Inbox
} from "lucide-react";

interface Prescription {
  id: string;
  hashId: string;
  ruleCode: string;
  ruleName: string;
  problemStage: string;
  optimizationArea: string;
  funnelStage: string;
  metrics: string;
  diagnosisReason: string;
  suggestedActions: string[];
  validationMetrics: string;
  priorityScore: number;
  confidenceScore: number;
  ownerUserName: string;
  status: "pending" | "health" | "accepted" | "debug";
  createdTime: string;
}

export function PrescriptionCenterPage({ currentSubTab }: { currentSubTab?: string }) {
  const [activeSubTab, setActiveSubTab] = useState<string>("rx-pending");

  useEffect(() => {
    if (currentSubTab) {
      setActiveSubTab(currentSubTab);
    }
  }, [currentSubTab]);

  const prescriptions: Prescription[] = [
    {
      id: "RX-101",
      hashId: "h_atc_ic_drop",
      ruleCode: "RULE_FUNNEL_ATC_IC_DROP_01",
      ruleName: "加购到结算（ATC-IC）转化断崖监测",
      problemStage: "Conversion Bottleneck",
      optimizationArea: "Checkout Process Optimization",
      funnelStage: "initiate_checkout_abandonment",
      metrics: "ATC to IC Rate = 32.41% (Threshold > 40.0%)",
      diagnosisReason: "多账户加购数量充盈，但是拉起填写地址页面有巨大滑坡。极可能有物理原因如：新增附加运费险/结算慢导致跳出率倍数上升。",
      suggestedActions: [
        "临时在站内展示满 $39 全球免费包邮 Banner 以打消末端运费顾虑；",
        "使用轻量级 JS 脚本压缩详情页与结算脚本缓存，优化加载耗时；",
        "使用 checkout 页面单页快捷结账设置简化买单步骤。"
      ],
      validationMetrics: "观察接下来的 72 小时，看 Initiate Checkout 转化占比是否止跌回升到 38% 以上。",
      priorityScore: 92,
      confidenceScore: 88,
      ownerUserName: "暂未分配",
      status: "pending",
      createdTime: "2026-06-15 14:32"
    },
    {
      id: "RX-102",
      hashId: "h_unmapped_alert",
      ruleCode: "RULE_MUT_UNMAPPED_SPEND_99",
      ruleName: "多账户未映射或流失广告消耗警报",
      problemStage: "System Mapping Warning",
      optimizationArea: "Discrepancy Control",
      funnelStage: "not_applicable",
      metrics: "Unmapped Account Spend = $532.00 / 天",
      diagnosisReason: "在 Meta performance 汇总队列拉取到无归结的账号消耗，这将严重侵蚀店铺的真实综合利润对账，导致 ROAS 水分过重。",
      suggestedActions: [
        "前往配置中心 -> 店铺与 Meta 绑定一列，将该消耗账号进行强耦合映射；",
        "对于测试账号，可在同步中心忽略名单内将其忽略剔除。"
      ],
      validationMetrics: "绑定后等待新一期同步，校验店铺主视图综合 ROAS 是否校正（排除背离）。",
      priorityScore: 98,
      confidenceScore: 100,
      ownerUserName: "暂未分配",
      status: "health",
      createdTime: "2026-06-15 10:15"
    },
    {
      id: "RX-103",
      hashId: "h_freq_saturation",
      ruleCode: "RULE_CREATIVE_FREQ_SATURATE_02",
      ruleName: "主力素材受众疲劳期过饱警告",
      problemStage: "Creative Fatigue",
      optimizationArea: "Creative Iteration",
      funnelStage: "attractiveness_decay",
      metrics: "Ad-level Frequency = 4.15 (Target < 3.0)",
      diagnosisReason: "爆款视频 vid_01 触达频次超警戒，点击率 CTR 衰退 48%，单次点击成本翻倍。机器学习已难以挖掘全新去重人群。",
      suggestedActions: [
        "调低该素材对应广告组 15% 预算；",
        "复制该组，利用‘素材变体建议’，批量补充 2 组对比色新主图冷启动。"
      ],
      validationMetrics: "更换后 48 小时，新素材冷启动 CTR 回升至 2.0% 以上，频次降回安全线。",
      priorityScore: 78,
      confidenceScore: 85,
      ownerUserName: "暂未分配",
      status: "accepted",
      createdTime: "2026-06-14 18:20"
    },
    {
      id: "RX-104",
      hashId: "h_rule_hit_record",
      ruleCode: "RULE_PRODUCT_HIGH_REFUND_98",
      ruleName: "高退款风险产品预警触发",
      problemStage: "Product Return Risk",
      optimizationArea: "Quality Control",
      funnelStage: "not_applicable",
      metrics: "SKU PROD-JACKET-02 Refund Rate = 18.5% (Threshold > 8.0%)",
      diagnosisReason: "订单返还报表显示户外保暖衣退款集中在退换尺码和色差上。已连续命中产品质量高退款兜底触发线。",
      suggestedActions: [
        "详情页显著添加身高尺码对照图；",
        "在订单客服通知中，随邮件主动探询用户尺码是否选错，并在发货前进行人工电话/短邮拦截校正。"
      ],
      validationMetrics: "后续半月退款占比曲线回降至 6.0% 水平。",
      priorityScore: 85,
      confidenceScore: 90,
      ownerUserName: "暂未分配",
      status: "debug",
      createdTime: "2026-06-15 11:45"
    }
  ];

  const tabsConfig = [
    { id: "rx-pending", label: "待处理建议", badge: prescriptions.filter(r => r.status === "pending").length },
    { id: "rx-health", label: "数据健康提醒", badge: prescriptions.filter(r => r.status === "health").length },
    { id: "rx-accepted", label: "已采纳 / 执行中", badge: prescriptions.filter(r => r.status === "accepted").length },
    { id: "rx-debug", label: "规则命中记录", badge: prescriptions.filter(r => r.status === "debug").length }
  ];

  const filteredPrescriptions = prescriptions.filter(r => r.status === activeSubTab.replace("rx-", "") || r.status === activeSubTab);

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">建议处方中心</h1>
        <p className="text-sm text-slate-500 mt-1">
          整合规则诊断引擎产生的预警结果，一键提炼建议动作、责任机制与预期成效率回溯。
        </p>
      </div>

      {/* Selector Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        {tabsConfig.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSubTab(item.id)}
            className={`px-5 py-3 text-sm font-semibold relative transition-all duration-200 ${
              activeSubTab === item.id || activeSubTab.replace("rx-", "") === item.id.replace("rx-", "")
                ? "text-blue-600 border-b-2 border-blue-600 font-extrabold"
                : "text-slate-500 hover:text-slate-950 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2">
              {item.label}
              {item.badge > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-800 font-bold">
                  {item.badge}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Master List */}
      <div className="space-y-6">
        {filteredPrescriptions.length === 0 ? (
          <div className="bg-white/50 border border-slate-200 border-dashed rounded-2xl p-16 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-xl flex items-center justify-center mx-auto">
              <Inbox className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-700">暂无匹配记录</h4>
            <p className="text-xs text-slate-400">选择其他建议状态或等待底层诊断结果更新推送。</p>
          </div>
        ) : (
          filteredPrescriptions.map((item) => (
            <div key={item.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5 hover:shadow-md transition-shadow">
              
              {/* Header block */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-50 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded">
                      ID: {item.id}
                    </span>
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-800 text-[10px] font-bold rounded border border-blue-100">
                      代码: {item.ruleCode}
                    </span>
                    <span className="text-slate-400 text-xs">生成时间: {item.createdTime}</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm mt-1">{item.ruleName}</h3>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 text-[11px] font-semibold bg-gray-100 text-slate-800 rounded-full">
                    负责人: {item.ownerUserName}
                  </span>
                </div>
              </div>

              {/* 3 Categories block */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-medium text-slate-500">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">问题阶段 (problemStage)</span>
                  <span className="text-slate-800 font-bold">{item.problemStage}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">优化方向 (optimizationArea)</span>
                  <span className="text-slate-800 font-bold">{item.optimizationArea}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">漏斗阶段 (funnelStage)</span>
                  <span className="text-slate-800 font-mono font-bold">{item.funnelStage}</span>
                </div>
              </div>

              {/* Affected / Deviation metrics */}
              <div className="text-xs bg-red-50/40 p-3 rounded-lg border border-red-100/50">
                <span className="font-bold text-red-800 block mb-1">成交异常指标：</span>
                <span className="font-bold text-slate-900 font-mono">{item.metrics}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Reason & diagnostic evaluation */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 诊断意见 (diagnosisReason)
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/10 p-3 rounded-lg border border-blue-50">
                    {item.diagnosisReason}
                  </p>
                </div>

                {/* Suggestions Actions */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-800 block">建议动作 (suggestedActions)</span>
                  <ul className="space-y-1.5">
                    {item.suggestedActions.map((action, actionIdx) => (
                      <li key={actionIdx} className="flex gap-2 text-xs text-slate-650 leading-relaxed">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Validation indicators */}
              <div className="border-t border-slate-50 pt-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="text-xs text-slate-500">
                  <span className="font-bold text-slate-800">验证指标 (validationMetrics):</span> {item.validationMetrics}
                </div>
                <div className="flex gap-4 text-xs font-medium text-slate-500 shrink-0">
                  <span>优先级 (priorityScore): <strong className="text-slate-900">{item.priorityScore}</strong></span>
                  <span>置信度 (confidenceScore): <strong className="text-slate-900">{item.confidenceScore}</strong></span>
                </div>
              </div>

            </div>
          ))
        )}
      </div>
    </div>
  );
}
