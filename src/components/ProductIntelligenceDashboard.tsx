import React, { useState, useEffect } from "react";
import axios from "axios";
import { format } from "date-fns";
import { 
  PackageSearch, 
  Coins, 
  FileSpreadsheet, 
  HelpCircle, 
  BadgePercent, 
  LineChart, 
  Layers, 
  Activity, 
  Calendar,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Percent
} from "lucide-react";

interface ProductIntelligenceRecord {
  id: string;
  productId: string;
  storeId: number;
  productName: string;
  sku: string;
  category: string;
  revenue: number;
  orders: number;
  profit: number;
  averageOrderValue: number;
  refundRate: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  adSpend: number | null;
  productRoas: number | null;
  profitRoas: number | null;
  source: string;
  dataSourceExplain: {
    primarySource: string;
    productTableUsedForMetadataOnly: boolean;
    productPerformanceDailyUsed: boolean;
    revenueRule: string;
    invalidOrderExcluded: boolean;
    adSpendAvailable: boolean;
    adSpendReason: string;
  };
}

export function ProductIntelligenceDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const [products, setProducts] = useState<ProductIntelligenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductIntelligenceRecord | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/api/data-center/products", {
        params: {
          startDate: format(startDate, "yyyy-MM-dd"),
          endDate: format(endDate, "yyyy-MM-dd")
        }
      });
     const rows = Array.isArray(res.data?.data)
  ? res.data.data
  : Array.isArray(res.data?.products)
    ? res.data.products
    : Array.isArray(res.data)
      ? res.data
      : [];

setProducts(rows);
    } catch (err: any) {
      console.error("Failed to load product intelligence:", err);
      setError(err.response?.data?.details || err.message || "Failed to load product intelligence");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [startDate, endDate]);

  const currency = (val: number | null) => {
    if (val === null || val === undefined) return "N/A";
    return "$" + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const percentage = (val: number | null) => {
    if (val === null || val === undefined) return "N/A";
    return (val * 100).toFixed(1) + "%";
  };

  const formatNullableDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return format(new Date(dateStr), "yyyy-MM-dd HH:mm");
    } catch {
      return dateStr;
    }
  };

  // Top summary aggregation
  const totalRevenue = products.reduce((sum, p) => sum + (p.revenue || 0), 0);
  const totalOrders = products.reduce((sum, p) => sum + (p.orders || 0), 0);
  const totalProfit = products.reduce((sum, p) => sum + (p.profit || 0), 0);
  const avgRefundRate = products.length > 0 
    ? products.reduce((sum, p) => sum + (p.refundRate || 0), 0) / products.length 
    : 0;

  return (
  <div className="space-y-6">
      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-2xl border border-slate-100 p-8 space-y-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
          <span className="text-sm text-slate-500 font-medium">正在基于真实订单流水聚合计算商品情报...</span>
        </div>
      ) : error ? (
        <div className="p-8 bg-red-50 rounded-2xl border border-red-200 text-center space-y-3">
          <div className="text-lg font-bold text-red-800">聚合服务出错</div>
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={fetchProducts} className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-xl text-sm font-semibold transition-colors">
            重试加载
          </button>
        </div>
      ) : (
        <>
          {/* Top stats boxes */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">聚合有效总营收</span>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">{currency(totalRevenue)}</h3>
              <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                根据真实订单行计算 (orderTotal)
              </p>
            </div>
            
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">有效销售订单</span>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">{totalOrders} 笔</h3>
              <p className="text-xs text-slate-400 mt-2">已剔除未支付及退款订单</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">预估商品净利润</span>
              <h3 className="text-2xl font-bold text-slate-950 mt-1">{currency(totalProfit)}</h3>
              <p className="text-xs text-slate-400 mt-2">基于订单实付与生产成本差额</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">平均订单退款率</span>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">{percentage(avgRefundRate)}</h3>
              <p className="text-xs text-slate-400 mt-2">退款订单 / 进件总订单比例</p>
            </div>
          </div>

          {/* Main List Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                  <PackageSearch className="w-5 h-5 text-blue-600" />
                  真实商品订单表现排行榜
                </h3>
                <p className="text-slate-500 text-xs mt-1">
                  当前根据订单流入情况进行全量排名。未注入任何种子伪造数据。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full border border-slate-200">
                  发现真实商品款式: {products.length} 款
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-slate-50/85 text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3.5 font-semibold text-slate-700">商品名称与标识</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700">类目 / 店铺</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">有效订单</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">销售额</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">净利润</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">退款率</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">广告花费 (adSpend)</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">商品 ROAS</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700">数据追踪</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p, index) => (
                    
                      <tr key={p.productId} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1 max-w-[280px]">
                            <span 
                               className="text-[13.5px] font-semibold text-slate-900 truncate leading-tight"
                               title={p.productName}
                            >
                              {p.productName}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                SKU: {p.sku || p.productId}
                              </span>
                              
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-[11px] text-slate-500 font-medium uppercase">{p.category || "Uncategorized"}</span>
                            <span className="text-[11px] text-slate-400">店铺 ID: {p.storeId}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-slate-800">{p.orders}</td>
                        <td className="px-6 py-4 text-right text-emerald-600 font-bold">{currency(p.revenue)}</td>
                        <td className="px-6 py-4 text-right text-slate-600 font-medium">{currency(p.profit)}</td>
                        <td className="px-6 py-4 text-right text-slate-500 font-mono text-xs">{percentage(p.refundRate)}</td>
                        <td className="px-6 py-4 text-right font-mono text-xs text-slate-400">N/A</td>
                        <td className="px-6 py-4 text-right font-mono text-xs text-slate-400">N/A</td>
                        <td className="px-6 py-4">
                          <button 
                            onClick={() => setSelectedProduct(p)}
                            className="text-xs px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200/90 text-slate-700 font-semibold rounded-lg border border-slate-200 tracking-wide transition-all active:scale-[0.98]"
                          >
                            审计可信度
                          </button>
                        </td>
                      </tr>
                   ))}
                  
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                        当前时间区间内，由于对账规则已排除失效与未付款项，无符合筛选条件的产品销售流水。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Verification Modal / Side drawer for Trust and Transparency Auditing */}
          {selectedProduct && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    <div>
                      <h4 className="font-bold text-slate-950 text-base">商品级 AI 可信度合规审计</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">ProductId: {selectedProduct.productId}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedProduct(null)}
                    className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                  >
                    ×
                  </button>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto">
                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-400 uppercase font-semibold">对账商品</span>
                    <p className="text-slate-900 font-bold text-sm leading-snug">{selectedProduct.productName}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-xs text-slate-400 block">营收聚合路径 (Primary Source)</span>
                      <strong className="text-sm text-slate-900 capitalize font-semibold">{selectedProduct.source}</strong>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">第一单录入时间</span>
                      <strong className="text-xs text-slate-900 font-mono">{formatNullableDate(selectedProduct.firstOrderAt)}</strong>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">最末单录入时间</span>
                      <strong className="text-xs text-slate-900 font-mono">{formatNullableDate(selectedProduct.lastOrderAt)}</strong>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">退货数 vs 总进件笔数</span>
                      <strong className="text-xs text-indigo-700 font-mono font-semibold">
                        {percentage(selectedProduct.refundRate)} 退款率
                      </strong>
                    </div>
                  </div>

                  {/* Trust details */}
                  <div className="space-y-4">
                    <h5 className="text-[12.5px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 border-b border-dashed border-slate-200 pb-1.5">
                      <Calendar className="w-4 h-4 text-blue-500" /> 
                      可信对账与去伪装溯源机制 (Deterministic Trace)
                    </h5>

                    <div className="space-y-3.5 text-[12.5px] text-slate-600 leading-relaxed">
                      <div className="flex items-start gap-2.5">
                        <div className="p-1 bg-indigo-50 text-indigo-600 rounded-lg mt-0.5 font-mono text-xs font-semibold">A</div>
                        <div>
                          <strong className="text-slate-900">非伪造归因机制 (Strict Attribution Barrier):</strong>
                          <p className="text-slate-500 text-xs mt-0.5">
                            由于系统内未重建真实 Product-to-Ad mapping，故将商品级 <code>adSpend</code>/<code>ROAS</code> 直接声明为空。坚决防范由分摊估算机制带来的数据幻觉。
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <div className="p-1 bg-emerald-50 text-emerald-600 rounded-lg mt-0.5 font-mono text-xs font-semibold">B</div>
                        <div>
                          <strong className="text-slate-900">数据源合规机制 (Compliance Check):</strong>
                          <p className="text-slate-500 text-xs mt-0.5">
                            该商品 metadata 来自于数据库 Product 字典。订单排除包含待定、取消、被退回在内的明显无效记录。
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs text-slate-400 uppercase font-semibold">数据审计 JSON (dataSourceExplain)</span>
                    <pre className="bg-slate-950 text-[#86e2d5] text-xs p-4 rounded-xl font-mono overflow-auto max-h-[160px]">
                      {JSON.stringify(selectedProduct.dataSourceExplain, null, 2)}
                    </pre>
                  </div>
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex justify-end">
                  <button 
                    onClick={() => setSelectedProduct(null)}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs tracking-wider transition-all"
                  >
                    确认审计可信度
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
