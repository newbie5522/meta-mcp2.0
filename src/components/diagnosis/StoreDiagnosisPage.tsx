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
  Sparkles
} from "lucide-react";

export function StoreDiagnosisPage() {
  const storeMetrics = [
    { label: "综合店面 ROAS (Store ROAS)", value: "1.42", desc: "店铺总销售额 / Meta 广告总消耗", status: "warning" },
    { label: "独立站真实订单 (Store Orders)", value: "96", desc: "ERP 交易对账拉取的真实付款订单量", status: "normal" },
    { label: "店面总销售额 (Store Revenue)", value: "$7,356.40", desc: "不含运费、抵扣税点后的净成交额", status: "normal" },
    { label: "平均客单价 (AOV)", value: "$76.63", desc: "Store Revenue / Store Orders", status: "normal" },
    { label: "订单退款率 (Refund Rate)", value: "3.12%", desc: "退款订单数占最近 30 天订单比例", status: "normal" },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">店铺经营诊断</h1>
        <p className="text-sm text-slate-500 mt-1">
          连接真实独立站店铺数据（Shopify / Shopyy）的账面经营表现，深度评估全盘变现合理性。
        </p>
      </div>

      {/* Grid of Store Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        {storeMetrics.map((item, idx) => (
          <div key={idx} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">{item.label}</span>
            <div className="my-2">
              <span className="text-2xl font-extrabold text-slate-900">{item.value}</span>
            </div>
            <p className="text-[10px] text-slate-450 mt-1 border-t border-slate-50 pt-2">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Comparison discrepancy section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Discrepancy Card */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Meta Purchase 与 Store Order 差异对账</h3>
              <p className="text-xs text-slate-500">用于诊断 Pixel 丢失或 CAPI 缺失引起的漏斗脱节</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs text-slate-500">Meta Pixel 归因购买数</span>
              <div className="text-2xl font-bold text-slate-900 mt-1">78 笔</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs text-slate-500">Store 真实对账付款订单</span>
              <div className="text-2xl font-bold text-slate-900 mt-1">96 笔</div>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
              <span className="text-xs text-emerald-800">未归因比例 (Gap)</span>
              <div className="text-2xl font-bold text-emerald-700 mt-1">+23.08%</div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-600 bg-slate-50 p-4 rounded-xl leading-relaxed border border-slate-100">
            <span className="font-bold text-slate-800 block">对账现象释义：</span>
            <p>
              Meta Pixel 记录的订单数为 78，而同期独立站订单为 96。差异率为 23.08%。
              表明有多达 18 笔真实交易由自然流导入、或 Meta 算法在移动应用浏览器未记录到，未导致逆向归因失调（即 Pixel 伪造数量大于真实交易量），归因安全。
            </p>
          </div>
        </div>

        {/* Right Column: AI Action Guide */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-slate-900 text-sm">经营诊断建议</h3>
            </div>
            <div className="space-y-3.5 mt-2">
              <div className="p-3 rounded-lg bg-red-50 text-xs text-red-800">
                <strong>综合 ROAS 倒挂:</strong> 当前综合 ROAS (1.42) 低于纯 Meta 内核 ROAS (1.85)，显示有高额未映射推广账户在侵蚀利润。
              </div>
              <div className="p-3 rounded-lg bg-orange-50 text-xs text-orange-850">
                <strong>退款率提示:</strong> 退款率 3.12% 低于 5.0% 的安全预警线，表明产品售前体验及客诉状况基本平稳。
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400">
            绑定全部账户是计算准确 Store ROAS 的唯一前提。
          </div>
        </div>
      </div>
    </div>
  );
}
