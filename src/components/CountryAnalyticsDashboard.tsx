import React, { useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { AlertTriangle, Globe } from "lucide-react";
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
import { DataCoverageBanner } from "./common/DataCoverageBanner";

interface StoreOption {
  id: number;
  name: string;
  platform?: string;
}

interface CountryAnalyticsRecord {
  countryCode: string;
  countryName: string;
  orderRevenue: number | null;
  orderCount: number | null;
  orderProfit: number | null;
  refundRate: number | null;
  metaSpend: number | null;
  metaPurchases: number | null;
  metaPurchaseValue: number | null;
  metaRoas: number | null;
}

interface CountryAnalyticsData {
  rows: CountryAnalyticsRecord[];
  summary: {
    orderCountriesCount: number | null;
    totalOrderRevenue: number | null;
    totalOrderCount: number | null;
    totalMetaSpend: number | null;
  };
  dataHealth: {
    orderCountryAvailable: boolean;
    metaCountryAvailable: boolean;
    warnings: string[];
    factRows?: number;
    structureRows?: number;
  };
}

const WARNING_LABELS: Record<string, string> = {
  ORDER_DEDUP_FALLBACK_USED: "部分订单使用数据库记录标识进行去重。",
  ORDER_STORE_SCOPE_UNAVAILABLE: "部分订单缺少店铺范围，未纳入统计。",
  PLATFORM_ORDER_RULE_UNAVAILABLE: "部分订单缺少可识别的平台规则，未纳入统计。",
  PAYMENT_STATUS_UNAVAILABLE: "部分订单缺少支付状态，未纳入统计。",
  PAYMENT_STATUS_UNRECOGNIZED: "部分订单支付状态无法识别，未纳入统计。",
  REFUND_AMOUNT_UNAVAILABLE: "部分退款订单缺少退款金额；退款订单率仍按订单数统计。",
  ORDER_BUSINESS_TIME_UNAVAILABLE: "部分订单缺少店铺本地业务日期。",
  PROFIT_UNAVAILABLE: "部分订单利润不可用，国家利润显示为 N/A。"
};

export function CountryAnalyticsDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const [data, setData] = useState<CountryAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string>("all");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [includeUnmapped, setIncludeUnmapped] = useState(true);
  const [lastGoodData, setLastGoodData] = useState<any | null>(null);
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [responseDateRange, setResponseDateRange] = useState<{ startDate: string; endDate: string; timezone?: string } | null>(null);
  const [storeCoverage, setStoreCoverage] = useState<any | null>(null);
  const [metaCoverage, setMetaCoverage] = useState<any | null>(null);
  const startStrKey = format(startDate, "yyyy-MM-dd");
  const endStrKey = format(endDate, "yyyy-MM-dd");
  const currentRequestKey = buildDataViewRequestKey({
    page: "country",
    startDate: startStrKey,
    endDate: endStrKey,
    storeId,
    includeUnmapped,
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
  }, [currentRequestKey]);

  const fetchCountryData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get("/api/data-center/countries", {
        params: {
          startDate: startStrKey,
          endDate: endStrKey,
          storeId,
          includeUnmappedSpend: includeUnmapped ? "true" : "false"
        }
      });
      const rows = response.data?.rows || [];
      setStoreCoverage(response.data?.storeCoverage || response.data?.coverage || null);
      setMetaCoverage(response.data?.metaCoverage || null);
      setResponseDateRange(response.data?.dateRange || response.data?.appliedFilters || null);
      if (isDateRangeMismatch(response.data, startStrKey, endStrKey)) {
        setData(null);
        setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
        return;
      }
      if (shouldPreserveLastGoodData(response.data, rows, lastGoodData, currentRequestKey)) {
        const safeData = getSafeLastGoodData(lastGoodData, currentRequestKey);
        if (safeData) {
          setData(safeData.data || null);
          setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
          return;
        }
      }
      setData(response.data);
      setLastGoodData(makeLastGoodData(currentRequestKey, response.data));
      setViewNotice(null);
    } catch (requestError: any) {
      setData(null);
      setStoreCoverage({ status: "ERROR" });
      setMetaCoverage({ status: "ERROR" });
      setViewNotice("当前国家筛选周期请求失败，未展示旧数据。");
      setError(requestError.response?.data?.details || requestError.message || "国家订单分析加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCountryData();
  }, [startStrKey, endStrKey, storeId, includeUnmapped]);

  const currency = (value: number | null | undefined) => value === null || value === undefined
    ? "N/A"
    : "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percentage = (value: number | null | undefined) => value === null || value === undefined
    ? "N/A"
    : (value * 100).toFixed(2) + "%";
  const numberValue = (value: number | null | undefined) => value === null || value === undefined
    ? "N/A"
    : value.toLocaleString();
  const rows = data?.rows || [];
  const healthStatus = data?.dataHealth?.orderCountryAvailable
    ? "READY"
    : rows.length > 0 ? "PARTIAL" : "EMPTY";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">店铺订单国家分析</h2>
          <p className="mt-1 text-sm text-slate-500">国家列表由店铺订单决定；Meta 指标仅作为同国家附属广告指标。</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          店铺
          <select
            value={storeId}
            onChange={event => setStoreId(event.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          >
            <option value="all">全部店铺</option>
            {stores.map(store => (
              <option key={store.id} value={String(store.id)}>{store.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <DataCoverageBanner coverage={storeCoverage} />
        <DataCoverageBanner coverage={metaCoverage} />
      </div>

      <DataViewTraceBar
        currentStartDate={startStrKey}
        currentEndDate={endStrKey}
        responseStartDate={responseDateRange?.startDate}
        responseEndDate={responseDateRange?.endDate}
        latestAvailableDate={storeCoverage?.latestAvailableDate}
        timezone={responseDateRange?.timezone || "America/Los_Angeles"}
        rowCount={rows.length}
        status={storeCoverage?.status || healthStatus}
        level="country"
        factRows={data?.dataHealth?.factRows}
        structureRows={data?.dataHealth?.structureRows}
        source="店铺订单 + Meta 国家附属指标"
        scope={storeId === "all" ? "全部店铺" : "已选店铺"}
      />

      {viewNotice && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{viewNotice}</div>}
      {loading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center text-sm text-slate-500">正在读取店铺订单国家数据...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-700">
          <p>{error}</p>
          <button onClick={fetchCountryData} className="mt-3 rounded-lg bg-red-100 px-4 py-2 text-sm font-semibold">重试</button>
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              ["店铺国家数", numberValue(data.summary.orderCountriesCount)],
              ["店铺订单销售额", currency(data.summary.totalOrderRevenue)],
              ["店铺订单数", numberValue(data.summary.totalOrderCount)],
              ["Meta 国家花费", currency(data.summary.totalMetaSpend)]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="text-sm font-medium text-slate-500">{label}</span>
                <h3 className="mt-1 text-2xl font-bold text-slate-900">{value}</h3>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end rounded-2xl border border-slate-200 bg-white p-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={includeUnmapped} onChange={event => setIncludeUnmapped(event.target.checked)} />
              包含未映射广告花费
            </label>
          </div>

          {(data.dataHealth.warnings || []).length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <ul className="list-disc space-y-1 pl-5">
                {data.dataHealth.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{WARNING_LABELS[warning] || "部分数据需要进一步核对。"}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-5">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Globe className="h-5 w-5 text-indigo-600" />店铺订单国家表现</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-6 py-3.5">国家</th>
                    <th className="px-6 py-3.5 text-right">Order Revenue</th>
                    <th className="px-6 py-3.5 text-right">Orders</th>
                    <th className="px-6 py-3.5 text-right">Profit</th>
                    <th className="px-6 py-3.5 text-right">Refund Rate</th>
                    <th className="px-6 py-3.5 text-right">Meta Spend</th>
                    <th className="px-6 py-3.5 text-right">Store ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(row => {
                    const storeRoas = row.orderRevenue !== null && row.metaSpend > 0
                      ? row.orderRevenue / row.metaSpend
                      : null;
                    return (
                      <tr key={row.countryCode} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-semibold text-slate-900">{row.countryName} <span className="text-xs text-slate-400">{row.countryCode}</span></td>
                        <td className="px-6 py-4 text-right">{currency(row.orderRevenue)}</td>
                        <td className="px-6 py-4 text-right">{numberValue(row.orderCount)}</td>
                        <td className="px-6 py-4 text-right">{currency(row.orderProfit)}</td>
                        <td className="px-6 py-4 text-right">{percentage(row.refundRate)}</td>
                        <td className="px-6 py-4 text-right">{currency(row.metaSpend)}</td>
                        <td className="px-6 py-4 text-right font-semibold text-indigo-700">{storeRoas === null ? "N/A" : storeRoas.toFixed(2) + "x"}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500"><AlertTriangle className="mx-auto mb-2 h-7 w-7" />当前范围暂无店铺订单国家数据。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
