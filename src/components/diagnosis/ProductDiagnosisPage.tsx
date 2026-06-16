import React from "react";
import { 
  Building, 
  HelpCircle, 
  Sparkles, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle,
  Activity,
  Package
} from "lucide-react";

export function ProductDiagnosisPage() {
  const products = [
    {
      sku: "PROD-YOGA-01",
      name: "透气高弹提臀瑜伽裤 (Transp Yoga Leggings)",
      type: "高销量产品 / 高 AOV 关联",
      orders: 45,
      revenue: "$3,105.00",
      refundRate: "1.2%",
      conversionStatus: "高转化 · 低退款",
      aiEval: "由于详情页排版干练且用户好评率达 4.9，具有出色的购买说服力。推荐维持当前店铺主力推荐位置。",
    },
    {
      sku: "PROD-JACKET-02",
      name: "防水户外保暖冲锋衣 (Outdoor Jacket PRO)",
      type: "高退款产品 / 低承接警告",
      orders: 22,
      revenue: "$1,980.00",
      refundRate: "18.5%",
      conversionStatus: "低承接 · 严重客诉",
      aiEval: "退款率偏高（18.5% 严重超过安全阈值）。退款原因大多集中在‘尺码不符’与‘颜色色差偏大’上。",
    },
    {
      sku: "PROD-SWEATER-03",
      name: "轻奢针织带帽套头衫 (Knit Hoodie Lite)",
      type: "中规中矩 / 低承接拉低产出",
      orders: 14,
      revenue: "$686.00",
      refundRate: "2.1%",
      conversionStatus: "低承接 · 转化卡点",
      aiEval: "流量不低但下单率微弱，用户大多在颜色选择卡位上退出，可能说明商品选项加载失败或尺码缺货严重。",
    }
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h1 className="text-xl font-bold text-slate-900">产品表现诊断</h1>
        <p className="text-sm text-slate-500">
          基于全量订单商品条目解构单品维度的物理表现。提炼产品经营价值。
        </p>
        
        {/* Important Warning Notice */}
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-150 flex gap-3 text-xs text-blue-900 leading-relaxed">
          <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold">产品归置限度申明：</span>
            <p>
              当前产品分析基于店铺订单数据，不输出产品级广告 ROAS 或产品级广告预算建议，除非后续打通产品广告归因链。
            </p>
          </div>
        </div>
      </div>

      {/* Product List Grid */}
      <div className="space-y-6">
        {products.map((p, idx) => (
          <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-50 pb-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded">
                    SKU: {p.sku}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    p.refundRate.startsWith("18") ? "bg-red-50 text-red-800 border border-red-100" : "bg-emerald-50 text-emerald-800 border border-emerald-100"
                  }`}>
                    {p.type}
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 text-sm mt-1">{p.name}</h3>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                p.conversionStatus.includes("严重") ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
              }`}>
                {p.conversionStatus}
              </span>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-[10px] text-slate-400 block">成交数量</span>
                <span className="text-base font-bold text-slate-800">{p.orders} 件</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-[10px] text-slate-400 block">产生销售额</span>
                <span className="text-base font-bold text-slate-800">{p.revenue}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-[10px] text-slate-400 block">产品退款率</span>
                <span className="text-base font-bold text-red-650">{p.refundRate}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-[10px] text-slate-400 block">平均关联客单</span>
                <span className="text-base font-bold text-slate-800">${(parseFloat(p.revenue.replace(/[^0-9.]/g, '')) / p.orders).toFixed(2)}</span>
              </div>
            </div>

            {/* AI opinion */}
            <div className="pt-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI 产品诊股建议
              </div>
              <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/20 p-3 rounded-lg border border-blue-50/40 mt-1">
                {p.aiEval}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
