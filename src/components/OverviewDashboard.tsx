import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import {
  Store as StoreIcon,
  Target,
  PackageSearch,
  RefreshCcw
} from "lucide-react";
import { toast } from "sonner";
import { DataCoverageBanner } from "./common/DataCoverageBanner";
import { isCanceledRequest, isDateRangeMismatch, shouldApplyLatestRequest } from "../lib/data-view-state";

export function buildOverviewRequestKey(startDate: Date, endDate: Date) {
  return JSON.stringify({
    since: format(startDate, "yyyy-MM-dd"),
    until: format(endDate, "yyyy-MM-dd")
  });
}

export function overviewCoverageAvailable(status?: string) {
  return ["READY", "PARTIAL_COVERAGE", "TRUE_EMPTY"].includes(String(status || ""));
}

export function resolveOverviewResponseState(payload: any, startDate: string, endDate: string) {
  if (isDateRangeMismatch(payload, startDate, endDate)) {
    return {
      stale: true,
      summary: null,
      storeCoverage: null,
      metaCoverage: null,
      productCoverage: null,
      notice: "Response date range mismatch"
    };
  }
  return {
    stale: false,
    summary: payload?.data || null,
    storeCoverage: payload?.storeCoverage || payload?.data?.storeCoverage || null,
    metaCoverage: payload?.metaCoverage || payload?.data?.metaCoverage || null,
    productCoverage: payload?.productCoverage || payload?.data?.productCoverage || null,
    notice: payload?.freshness?.refreshing ? "Dashboard refresh is still running" : null
  };
}

export const overviewCurrency = (val: number | null | undefined) =>
  val === null || val === undefined
    ? "N/A"
    : `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const overviewRoas = (val: number | null | undefined) =>
  val === null || val === undefined ? "N/A" : `${Number(val).toFixed(2)}x`;

export function OverviewDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const [summary, setSummary] = useState<any>(null);
  const [storeCoverage, setStoreCoverage] = useState<any>(null);
  const [metaCoverage, setMetaCoverage] = useState<any>(null);
  const [productCoverage, setProductCoverage] = useState<any>(null);
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequestId = useRef(0);
  const latestRequestKey = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  async function load() {
    const sourceRequestKey = buildOverviewRequestKey(startDate, endDate);
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    latestRequestKey.current = sourceRequestKey;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setSummary(null);
    setStoreCoverage(null);
    setMetaCoverage(null);
    setProductCoverage(null);
    setViewNotice(null);

    try {
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");
      const res = await axios.get("/api/dashboard", {
        params: {
          since: startStr,
          until: endStr
        },
        signal: controller.signal
      });
      if (!shouldApplyLatestRequest({
        requestId,
        latestRequestId: latestRequestId.current,
        sourceRequestKey,
        latestRequestKey: latestRequestKey.current
      })) {
        return;
      }
      const nextState = resolveOverviewResponseState(res.data, startStr, endStr);
      if (nextState.stale) {
        setSummary(null);
        setStoreCoverage(null);
        setMetaCoverage(null);
        setProductCoverage(null);
        setViewNotice(nextState.notice);
        return;
      }
      setSummary(nextState.summary);
      setStoreCoverage(nextState.storeCoverage);
      setMetaCoverage(nextState.metaCoverage);
      setProductCoverage(nextState.productCoverage);
      if (res.data.freshness?.refreshing) {
        setViewNotice("后台刷新仍在运行中，本页仅展示当前已入库数据。");
      }
    } catch (error: any) {
      if (isCanceledRequest(error)) return;
      if (!shouldApplyLatestRequest({
        requestId,
        latestRequestId: latestRequestId.current,
        sourceRequestKey,
        latestRequestKey: latestRequestKey.current
      })) {
        return;
      }
      setViewNotice(error?.response?.data?.details || error?.message || "Dashboard 数据加载失败。");
    } finally {
      if (shouldApplyLatestRequest({
        requestId,
        latestRequestId: latestRequestId.current,
        sourceRequestKey,
        latestRequestKey: latestRequestKey.current
      })) {
        setLoading(false);
      }
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const result = await axios.post("/api/dashboard/refresh", {
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd")
      });
      const status = String(result.data?.status || "").toUpperCase();
      if (status === "SUCCESS") {
        toast.success("概览数据刷新完成。");
      } else if (status === "PARTIAL" || status === "PARTIAL_SUCCESS") {
        toast.warning("概览数据部分刷新完成，正在展示已入库数据。");
      } else if (["RUNNING", "SKIPPED", "NO_NEW_DATA"].includes(status)) {
        toast.info("刷新未产生新的完整数据，继续展示当前数据。");
      } else if (status === "FAILED" || status === "ERROR") {
        toast.error("概览数据刷新失败。");
      } else {
        toast.info("刷新请求已完成，正在重新加载概览。");
      }
      await load();
    } catch (error: any) {
      toast.error(error?.response?.data?.details || error?.message || "概览数据刷新失败。");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [startDate, endDate]);

  const currency = overviewCurrency;
  const integer = (val: number | null | undefined) =>
    val === null || val === undefined ? "N/A" : Number(val).toLocaleString();
  const roas = overviewRoas;

  if (loading) {
    return <div className="flex h-[400px] items-center justify-center text-slate-500">正在加载数据中心概览...</div>;
  }

  if (!summary) {
    return <div className="flex h-[400px] items-center justify-center text-rose-500">{viewNotice || "数据加载失败"}</div>;
  }

  const overview = summary.overview || {};
  const storeMetricsAvailable = overviewCoverageAvailable(storeCoverage?.status);
  const metaMetricsAvailable = overviewCoverageAvailable(metaCoverage?.status);
  const productMetricsAvailable = overviewCoverageAvailable(productCoverage?.status);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-blue-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <strong className="block font-semibold">
              统计范围：{summary.dateRange?.startDate || summary.range?.since} 至 {summary.dateRange?.endDate || summary.range?.until}
            </strong>
            <span className="text-sm opacity-80">基于已入库事实数据展示；不可用覆盖范围显示为 N/A。</span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-blue-50 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "刷新中" : "刷新概览"}
          </button>
        </div>
        {viewNotice ? <div className="mt-3 text-xs text-blue-700">{viewNotice}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <DataCoverageBanner coverage={storeCoverage} />
        <DataCoverageBanner coverage={metaCoverage} />
        <DataCoverageBanner coverage={productCoverage} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard label="店铺销售额" value={currency(overview.storeSales)} note={`订单 ${integer(overview.storeOrderCount)}`} />
        <MetricCard label="Meta 花费" value={currency(overview.metaSpend)} note={`展示 ${integer(overview.impressions)}，点击 ${integer(overview.clicks)}`} />
        <MetricCard label="真实 ROAS" value={roas(overview.realRoas)} note="店铺销售额 / Meta 花费" />
        <MetricCard label="Meta ROAS" value={roas(overview.metaRoas)} note={`Meta 订单 ${integer(overview.metaPurchases)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard label="店铺数" value={integer(summary.storeCount)} note={`启用 ${integer(summary.activeStoreCount)}`} />
        <MetricCard label="广告账户" value={integer(summary.adAccountCount)} note={`已映射 ${integer(summary.mappedAdAccountCount)}`} />
        <MetricCard label="同步失败" value={integer(summary.syncHealth?.failed || 0)} note={`运行中 ${integer(summary.syncHealth?.running || 0)}`} />
        <MetricCard label="待处理 AI 建议" value={integer(summary.ai?.pendingSuggestions || 0)} note="AI 只给建议，不执行动作" />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <OverviewTable
          title="店铺数据排行"
          icon={<StoreIcon className="h-4 w-4 text-indigo-500" />}
          headers={["店铺", "状态", "订单", "销售额"]}
          rows={(summary.stores || []).map((store: any) => [
            store.name,
            store.status,
            storeMetricsAvailable ? integer(store.orderCount) : "N/A",
            storeMetricsAvailable ? currency(store.sales) : "N/A"
          ])}
          empty="暂无店铺数据"
        />
        <OverviewTable
          title="账户数据排行"
          icon={<Target className="h-4 w-4 text-blue-500" />}
          headers={["账户", "归属店铺", "花费", "Meta ROAS"]}
          rows={(summary.accounts || []).map((account: any) => [
            account.name || account.metaAccountId || account.id,
            account.storeName || "-",
            metaMetricsAvailable ? currency(account.spend) : "N/A",
            metaMetricsAvailable ? roas(account.roas) : "N/A"
          ])}
          empty="暂无账户消耗数据"
        />
      </div>

      <OverviewTable
        title="产品销售排行"
        icon={<PackageSearch className="h-4 w-4 text-slate-500" />}
        headers={["产品型号 (SKU)", "订单数", "销售数量", "总销售额"]}
        rows={(summary.products || []).map((product: any) => [
          product.sku || product.productName || product.productId,
          productMetricsAvailable ? integer(product.orderCount) : "N/A",
          productMetricsAvailable ? (product.quantity === null || product.quantity === undefined ? "N/A" : integer(product.quantity)) : "N/A",
          productMetricsAvailable ? currency(product.sales) : "N/A"
        ])}
        empty="暂无产品排行数据"
      />
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-1 text-sm text-slate-500">{label}</p>
      <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
      <p className="mt-2 text-sm text-slate-400">{note}</p>
    </div>
  );
}

function OverviewTable({
  title,
  icon,
  headers,
  rows,
  empty
}: {
  title: string;
  icon: React.ReactNode;
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  empty: string;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-4">
        <h2 className="flex items-center gap-2 font-bold text-slate-800">{icon} {title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {headers.map(header => <th key={header} className="px-5 py-3 font-medium">{header}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-slate-50">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`px-5 py-3 ${cellIndex === 0 ? "font-medium text-slate-900" : "text-slate-600"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="px-5 py-8 text-center text-slate-400">{empty}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
