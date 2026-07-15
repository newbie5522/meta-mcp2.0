import React, { useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { AlertTriangle, PackageSearch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  buildDataViewRequestKey,
  CURRENT_RANGE_NOT_READY_MESSAGE,
  DATE_RANGE_MISMATCH_MESSAGE,
  getSafeLastGoodData,
  isDateRangeMismatch,
  makeLastGoodData,
  shouldPreserveLastGoodData
} from "@/lib/data-view-state";
import { DataViewTraceBar } from "./common/DataViewTraceBar";
import { SyncStatusPanel, type SyncPanelStatus } from "./common/SyncStatusPanel";
import { mapSyncErrorToPanel, mapSyncResultToPanel, triggerSyncTask } from "@/lib/sync-trigger";

interface StoreOption {
  id: number;
  name: string;
  platform?: string;
}

interface ProductIntelligenceRecord {
  id: string;
  productId: string;
  storeId: number | null;
  productName: string;
  sku: string;
  category: string;
  revenue: number | null;
  revenueAvailable: boolean;
  orders: number;
  refundedOrders: number;
  profit: null;
  averageOrderValue: number | null;
  refundRate: number | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  warnings: string[];
  source: "Order";
}

interface ProductSummary {
  productsCount: number;
  totalOrders: number;
  refundedOrders: number;
  refundRate: number | null;
  totalProductLineRevenue: number | null;
  revenueComplete: boolean;
  profitAvailable: false;
}

const PRODUCT_WARNING_LABELS: Record<string, string> = {
  PRODUCT_REVENUE_UNAVAILABLE: "部分商品订单行缺少可确认的销售额，该商品销售额显示为 N/A。",
  PRODUCT_PROFIT_ALLOCATION_UNAVAILABLE: "商品利润分配规则尚未建立，商品利润显示为 N/A。"
};

export function ProductIntelligenceDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const [products, setProducts] = useState<ProductIntelligenceRecord[]>([]);
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState("all");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [lastGoodData, setLastGoodData] = useState<any | null>(null);
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [responseDateRange, setResponseDateRange] = useState<{ startDate: string; endDate: string; timezone?: string } | null>(null);
  const [dataHealthStatus, setDataHealthStatus] = useState("UNKNOWN");
  const [dataHealth, setDataHealth] = useState<any | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncPanelStatus>({ status: "idle" });
  const startStrKey = format(startDate, "yyyy-MM-dd");
  const endStrKey = format(endDate, "yyyy-MM-dd");
  const currentRequestKey = buildDataViewRequestKey({
    page: "products",
    startDate: startStrKey,
    endDate: endStrKey,
    storeId,
    scope: storeId === "all" ? "all_stores" : `store:${storeId}`,
    includeZeroSpend: true
  });

  useEffect(() => {
    let active = true;
    axios.get("/api/data-center/detail", {
      params: { startDate: startStrKey, endDate: endStrKey }
    }).then(response => {
      if (active) setStores(response.data?.filters?.stores || []);
    }).catch(() => {
      if (active) setStores([]);
    });
    return () => { active = false; };
  }, [startStrKey, endStrKey]);

  useEffect(() => {
    setViewNotice(null);
    setResponseDateRange(null);
    setSyncStatus({ status: "idle" });
  }, [currentRequestKey]);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get("/api/data-center/products", {
        params: { startDate: startStrKey, endDate: endStrKey, storeId }
      });
      const rows = Array.isArray(response.data?.products) ? response.data.products : [];
      setResponseDateRange(response.data?.dateRange || response.data?.appliedFilters || null);
      setDataHealthStatus(response.data?.dataHealth?.status || (rows.length > 0 ? "READY" : "EMPTY"));
      setDataHealth(response.data?.dataHealth || null);
      setSummary(response.data?.summary || null);

      if (isDateRangeMismatch(response.data, startStrKey, endStrKey)) {
        const safeData = getSafeLastGoodData(lastGoodData, currentRequestKey);
        setProducts(safeData?.data || []);
        setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
        return;
      }
      if (shouldPreserveLastGoodData(response.data, rows, lastGoodData, currentRequestKey)) {
        const safeData = getSafeLastGoodData(lastGoodData, currentRequestKey);
        if (safeData) {
          setProducts(safeData.data || []);
          setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
          return;
        }
      }
      setProducts(rows);
      setLastGoodData(makeLastGoodData(currentRequestKey, rows));
      setViewNotice(null);
    } catch (requestError: any) {
      const safeData = getSafeLastGoodData(lastGoodData, currentRequestKey);
      if (safeData) {
        setProducts(safeData.data || []);
        setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
      } else {
        setProducts([]);
        setSummary(null);
        setDataHealthStatus("REQUEST_FAILED");
        setError(requestError.response?.data?.details || requestError.message || "商品订单分析加载失败");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [startStrKey, endStrKey, storeId]);

  const handleSyncProducts = async () => {
    setSyncing(true);
    const toastId = toast.loading("正在执行商品视图同步...");
    setSyncStatus({ status: "running", message: "正在执行商品视图同步...", progressPercent: 15 });
    try {
      const result = await triggerSyncTask({
        taskType: "sync_view_products",
        startDate: startStrKey,
        endDate: endStrKey,
        storeId: storeId === "all" ? undefined : storeId,
        days: Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1),
        limit: 200
      });
      setSyncStatus(mapSyncResultToPanel(result));
      toast.success(result.message || "商品视图同步完成。", { id: toastId });
      await fetchProducts();
    } catch (syncError: any) {
      const panel = mapSyncErrorToPanel(syncError);
      setSyncStatus(panel);
      toast.error(panel.message || "商品视图同步失败。", { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  const currency = (value: number | null | undefined) => value === null || value === undefined
    ? "N/A"
    : "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percentage = (value: number | null | undefined) => value === null || value === undefined
    ? "N/A"
    : (value * 100).toFixed(1) + "%";
  const weightedRefundRate = summary?.refundRate ?? (
    products.reduce((sum, product) => sum + product.orders, 0) > 0
      ? products.reduce((sum, product) => sum + product.refundedOrders, 0) /
        products.reduce((sum, product) => sum + product.orders, 0)
      : null
  );
  const revenueComplete = summary?.revenueComplete ?? products.every(product => product.revenue !== null);
  const totalRevenue = revenueComplete
    ? summary?.totalProductLineRevenue ?? products.reduce((sum, product) => sum + Number(product.revenue), 0)
    : null;
  const totalOrders = summary?.totalOrders ?? products.reduce((sum, product) => sum + product.orders, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900"><PackageSearch className="h-5 w-5 text-blue-600" />商品订单分析</h2>
          <p className="mt-1 text-sm text-slate-500">销售额仅统计商品订单行；不使用整单金额分摊。</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={storeId} onChange={event => setStoreId(event.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <option value="all">全部店铺</option>
            {stores.map(store => <option key={store.id} value={String(store.id)}>{store.name}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={handleSyncProducts} disabled={loading || syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />同步数据
          </Button>
        </div>
      </div>

      <SyncStatusPanel status={syncStatus} />
      <DataViewTraceBar
        compactScopeLabel="商品订单口径"
        currentStartDate={startStrKey}
        currentEndDate={endStrKey}
        responseStartDate={responseDateRange?.startDate}
        responseEndDate={responseDateRange?.endDate}
        timezone={responseDateRange?.timezone || "America/Los_Angeles"}
        rowCount={products.length}
        status={dataHealthStatus}
        factRows={dataHealth?.factRows}
        structureRows={dataHealth?.structureRows}
        source="Order 商品行"
        scope={storeId === "all" ? "全部店铺" : "已选店铺"}
      />
      {viewNotice && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{viewNotice}</div>}

      {loading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center text-sm text-slate-500">正在聚合商品订单行...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-700">
          <p>{error}</p><button onClick={fetchProducts} className="mt-3 rounded-lg bg-red-100 px-4 py-2 text-sm font-semibold">重试</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              ["商品行销售额", currency(totalRevenue)],
              ["商品订单数", `${totalOrders.toLocaleString()} 笔`],
              ["商品退款订单率", percentage(weightedRefundRate)],
              ["商品利润", "N/A"]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="text-sm font-medium text-slate-500">{label}</span>
                <h3 className="mt-1 text-2xl font-bold text-slate-900">{value}</h3>
                {label === "商品利润" && <p className="mt-2 text-xs text-amber-700">商品利润分配规则尚未建立</p>}
                {label === "商品行销售额" && !revenueComplete && <p className="mt-2 text-xs text-amber-700">部分商品行销售额不可用</p>}
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-5"><h3 className="text-lg font-bold text-slate-900">商品订单行表现</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-6 py-3.5">商品</th>
                    <th className="px-6 py-3.5">类目</th>
                    <th className="px-6 py-3.5 text-right">商品订单</th>
                    <th className="px-6 py-3.5 text-right">退款订单</th>
                    <th className="px-6 py-3.5 text-right">商品行销售额</th>
                    <th className="px-6 py-3.5 text-right">平均订单行销售额</th>
                    <th className="px-6 py-3.5 text-right">退款率</th>
                    <th className="px-6 py-3.5">数据提示</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map(product => (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4"><div className="font-semibold text-slate-900">{product.productName}</div><div className="text-xs text-slate-400">SKU: {product.sku}</div></td>
                      <td className="px-6 py-4 text-slate-500">{product.category}</td>
                      <td className="px-6 py-4 text-right">{product.orders}</td>
                      <td className="px-6 py-4 text-right">{product.refundedOrders}</td>
                      <td className="px-6 py-4 text-right font-semibold text-emerald-700">{currency(product.revenue)}</td>
                      <td className="px-6 py-4 text-right">{currency(product.averageOrderValue)}</td>
                      <td className="px-6 py-4 text-right">{percentage(product.refundRate)}</td>
                      <td className="max-w-[260px] whitespace-normal px-6 py-4 text-xs text-slate-500">
                        {product.warnings.map(warning => PRODUCT_WARNING_LABELS[warning] || "部分数据需要进一步核对。").join(" ")}
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500"><AlertTriangle className="mx-auto mb-2 h-7 w-7" />当前范围暂无商品订单数据。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
