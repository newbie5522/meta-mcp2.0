import React from "react";
import { 
  ShieldCheck, 
  Database, 
  HelpCircle, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  History, 
  RefreshCw 
} from "lucide-react";

export function DataHealthDiagnosisPage() {
  const healthIndicators = [
    {
      name: "Meta Token 校验状态 (Meta Token Status)",
      status: "正常可用 (Healthy)",
      healthScore: "100%",
      desc: "Meta Graph API 长效 Token 剩余有效期 45 天，鉴权处于完备绿灯期。",
      type: "auth"
    },
    {
      name: "本地数据同步延迟 (Sync Latency)",
      status: "3 小时前 (Normal)",
      healthScore: "95%",
      desc: "Meta Fact 表和 Shopify 销售表单今天定时触发已执行成功，无滞后堆积，队列深度为 0。",
      type: "sync"
    },
    {
      name: "未绑定/未映射广告账户 (Unmapped Accounts)",
      status: "发现 1 个未关联 (Alert)",
      healthScore: "70%",
      desc: "检测到一个产生小额消耗（$23）的广告账户未关联到任何已知独立站，造成微型归因阻碍。",
      type: "mapping"
    },
    {
      name: "订单国家字段缺失状况 (Missing Countries)",
      status: "影响 5 笔订单 (Notify)",
      healthScore: "92%",
      desc: "最近一期拉取的原始订单中，有 5 个订单的国家物理代码解析遇到 fallback（空字符串），导致国家级 ROAS 计算时出现 fallback 归类。",
      type: "order"
    },
    {
      name: "单品级广告归 attribution 链 (Product Ad Attribution)",
      status: "尚未打通 (Not Connected)",
      healthScore: "0%",
      desc: "由于 Meta 素材中没有配置 SKU 物理锚标或未添加参数追踪，目前产品级广告归因链无法形成，系统目前仅通过订单解析产品总销量。",
      type: "attribution"
    },
    {
      name: "转化漏斗字段完整度 (Funnel Metric Integrity)",
      status: "LandingPageViews 丢失 (Alert)",
      healthScore: "80%",
      desc: "转化漏斗六节点中 LandingPageViews 数据流为 null，前端展现将自动提示数据缺失与到达率评估不足。其他加购和结账字段由 AdInsight 备用提供，运转完备。",
      type: "funnel"
    },
    {
      name: "物理路点配置 (Route Integrity)",
      status: "正常绑定 (Healthy)",
      healthScore: "100%",
      desc: "后台多租户分表、诊断数据收集控制器路由（/api/diagnostics/issues）全线正常挂载，接受对账引擎输出结果。",
      type: "route"
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

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 font-sans">数据健康诊断</h1>
        <p className="text-sm text-slate-500 mt-1">
          深度查验系统与 Meta 广告链路、多级独立站 ERP、API Token 同步队列的数据流对账状况，拦截零值噪声。
        </p>
      </div>

      <div className="space-y-4">
        {healthIndicators.map((item, idx) => {
          const isWarning = item.healthScore !== "100%" && item.healthScore !== "95%";
          const isDanger = item.healthScore === "0%";
          return (
            <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    isDanger ? "bg-red-500 animate-pulse" :
                    isWarning ? "bg-amber-500" : "bg-emerald-500"
                  }`} />
                  <h4 className="font-bold text-slate-900 text-sm">{item.name}</h4>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed max-w-3xl pr-4">{item.desc}</p>
              </div>

              <div className="flex items-center gap-4 shrink-0 self-end md:self-auto">
                <div className="text-right">
                  <span className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                    isDanger ? "bg-red-50 text-red-800" :
                    isWarning ? "bg-amber-50 text-amber-850" : "bg-emerald-50 text-emerald-850"
                  }`}>
                    {item.status}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">完整度得分: {item.healthScore}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
