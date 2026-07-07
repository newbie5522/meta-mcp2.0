import React, { useState, useEffect } from "react";
import axios from "axios";
import { format, subDays } from "date-fns";
import { 
  TrendingUp, ShoppingBag, Percent, MousePointer, Eye, 
  Store as StoreIcon, Layers, User, Coins, Target, PackageSearch, RefreshCcw, Sparkles
} from "lucide-react";

export function OverviewDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const res = await axios.get("/api/dashboard", { 
        params: { 
          refresh,
          since: format(startDate, "yyyy-MM-dd"),
          until: format(endDate, "yyyy-MM-dd")
        } 
      });
      setSummary(res.data.data);
    } catch (error) {
      console.error("Dashboard fetch error:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [startDate, endDate]);

  if (loading) {
    return <div className="flex h-[400px] items-center justify-center text-slate-500">正在加载数据中心概览...</div>;
  }

  if (!summary) {
    return <div className="flex h-[400px] items-center justify-center text-rose-500">数据加载失败</div>;
  }

  const currency = (val: number) => "$" + (val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const roas = (val: number | null) => val ? val.toFixed(2) + "x" : "N/A";

  return (
    <div className="space-y-6">
      <div className="bg-blue-50/50 text-blue-800 p-4 rounded-xl border border-blue-100 flex items-center justify-between">
        <div>
          <strong className="block font-semibold">统计范围：{summary.range?.since} 至 {summary.range?.until}</strong>
          <span className="text-sm opacity-80">基于后台同步入库数据汇总。目前共提取 {summary.range?.days} 天数据。</span>
        </div>
        <button onClick={() => load(true)} className="px-4 py-2 bg-white rounded-lg border border-blue-200 hover:bg-blue-50 text-sm font-medium transition-colors">
          刷新概览
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">店铺销售额</p>
          <h3 className="text-2xl font-bold text-slate-900">{currency(summary.overview?.storeSales)}</h3>
          <p className="text-sm text-slate-400 mt-2">订单 {summary.overview?.storeOrderCount} 笔</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">Meta 花费</p>
          <h3 className="text-2xl font-bold text-slate-900">{currency(summary.overview?.metaSpend)}</h3>
          <p className="text-sm text-slate-400 mt-2">展示 {(summary.overview?.impressions || 0).toLocaleString()}，点击 {(summary.overview?.clicks || 0).toLocaleString()}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">真实 ROAS</p>
          <h3 className="text-2xl font-bold text-slate-900">{roas(summary.overview?.realRoas)}</h3>
          <p className="text-sm text-slate-400 mt-2">店铺销售额 / Meta 花费</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">Meta ROAS</p>
          <h3 className="text-2xl font-bold text-slate-900">{roas(summary.overview?.metaRoas)}</h3>
          <p className="text-sm text-slate-400 mt-2">Meta 订单 {summary.overview?.metaPurchases}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">店铺数</p>
          <h3 className="text-2xl font-bold text-slate-900">{summary.storeCount}</h3>
          <p className="text-sm text-slate-400 mt-2">启用 {summary.activeStoreCount}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">广告账户</p>
          <h3 className="text-2xl font-bold text-slate-900">{summary.adAccountCount}</h3>
          <p className="text-sm text-slate-400 mt-2">已映射 {summary.mappedAdAccountCount}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">同步失败</p>
          <h3 className="text-2xl font-bold text-slate-900">{summary.syncHealth?.failed || 0}</h3>
          <p className="text-sm text-slate-400 mt-2">运行中 {summary.syncHealth?.running || 0}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500 mb-1">待处理 AI 建议</p>
          <h3 className="text-2xl font-bold text-slate-900">{summary.ai?.pendingSuggestions || 0}</h3>
          <p className="text-sm text-slate-400 mt-2">AI 只给建议，不执行操作</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h2 className="font-bold text-slate-800 flex items-center gap-2"><StoreIcon className="w-4 h-4 text-indigo-500"/> 店铺数据排行榜</h2>
          </div>
          <div className="overflow-x-auto p-0">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="px-5 py-3 font-medium">店铺</th><th className="px-5 py-3 font-medium">状态</th><th className="px-5 py-3 font-medium text-right">订单</th><th className="px-5 py-3 font-medium text-right">销售额</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.stores || []).map((s: any) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{s.name}</td>
                    <td className="px-5 py-3"><span className="px-2 py-1 rounded bg-slate-100 text-slate-600 text-xs">{s.status}</span></td>
                    <td className="px-5 py-3 text-right">{s.orderCount}</td>
                    <td className="px-5 py-3 text-right text-emerald-600 font-medium">{currency(s.sales)}</td>
                  </tr>
                ))}
                {(summary.stores || []).length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">暂无店铺数据</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h2 className="font-bold text-slate-800 flex items-center gap-2"><Target className="w-4 h-4 text-blue-500"/> 账户数据排行榜</h2>
          </div>
          <div className="overflow-x-auto p-0">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="px-5 py-3 font-medium">账户</th><th className="px-5 py-3 font-medium">归属店铺</th><th className="px-5 py-3 font-medium text-right">花费</th><th className="px-5 py-3 font-medium text-right">Meta ROAS</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.accounts || []).map((a: any) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{a.name || a.metaAccountId}</td>
                    <td className="px-5 py-3 text-slate-500">{a.storeName || '-'}</td>
                    <td className="px-5 py-3 text-right">{currency(a.spend)}</td>
                    <td className="px-5 py-3 text-right font-medium">{roas(a.roas)}</td>
                  </tr>
                ))}
                {(summary.accounts || []).length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">暂无账户消耗数据</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="font-bold text-slate-800 flex items-center gap-2"><PackageSearch className="w-4 h-4 text-slate-500"/> 产品销售排行</h2>
        </div>
        <div className="overflow-x-auto p-0">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500">
              <tr><th className="px-5 py-3 font-medium">产品型号 (SKU)</th><th className="px-5 py-3 font-medium text-right">订单数</th><th className="px-5 py-3 font-medium text-right">销售数量</th><th className="px-5 py-3 font-medium text-right">总销售额</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(summary.products || []).map((p: any) => (
                <tr key={p.sku} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900 border-l-2 border-transparent hover:border-slate-400">{p.sku}</td>
                  <td className="px-5 py-3 text-right">{p.orderCount}</td>
                  <td className="px-5 py-3 text-right">{p.quantity}</td>
                  <td className="px-5 py-3 text-right text-emerald-600 font-medium">{currency(p.sales)}</td>
                </tr>
              ))}
              {(summary.products || []).length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">暂无产品排行数据</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
