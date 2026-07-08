import React, { useState, useEffect } from "react";
import axios from "axios";
import { format } from "date-fns";
import { 
  Globe, 
  TrendingUp, 
  HelpCircle, 
  Coins, 
  ShoppingBag, 
  ShieldAlert, 
  BadgePercent, 
  LineChart, 
  Activity, 
  Calendar,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  AlertTriangle
} from "lucide-react";
import {
  CURRENT_RANGE_NOT_READY_MESSAGE,
  DATE_RANGE_MISMATCH_MESSAGE,
  responseDateRangeMatches,
  shouldPreserveLastGoodData
} from "@/lib/data-view-state";
import { DataViewTraceBar } from "./common/DataViewTraceBar";

interface CountryAnalyticsRecord {
  countryCode: string;
  countryName: string;
  
  orderRevenue: number | null;
  orderCount: number | null;
  orderProfit: number | null;
  refundRate: number | null;
  paidOrderCount: number | null;
  averageOrderValue: number | null;
  orderFirstAt: string | null;
  orderLastAt: string | null;

  metaSpend: number;
  metaImpressions: number;
  metaClicks: number;
  metaPurchases: number;
  metaPurchaseValue: number;
  metaRoas: number | null;
  ctr: number;
  cpc: number;
  cpm: number;

  accountIds: string[];
  mappedStoreIds: number[];
  dataSourceExplain: string;
}

interface CountryAnalyticsData {
  rows: CountryAnalyticsRecord[];
  summary: {
    countriesCount: number;
    orderCountriesCount: number;
    metaCountriesCount: number;
    totalOrderRevenue: number | null;
    totalOrderCount: number | null;
    totalMetaSpend: number;
    totalMetaPurchases: number;
    totalMetaPurchaseValue: number;
    unmappedMetaSpend: number;
    unmappedMetaSpendRate: number;
  };
  dataHealth: {
    orderCountryAvailable: boolean;
    metaCountryAvailable: boolean;
    unmappedAccountsCount: number;
    unmappedSpendRate: number;
    warnings: string[];
  };
  dataSourceExplain: {
    orderPrimarySource: string;
    metaPrimarySource: string;
    legacyInsightUsed: boolean;
    legacySummaryUsed: boolean;
    storeMappingUsed: boolean;
    countryJoinKey: string;
    storeRoasMeaning: string;
    orderUnavailableReason: string;
  };
}

export function CountryAnalyticsDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const [data, setData] = useState<CountryAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minSpendFilter, setMinSpendFilter] = useState<number>(0);
  const [includeUnmapped, setIncludeUnmapped] = useState<boolean>(true);
  const [selectedRow, setSelectedRow] = useState<CountryAnalyticsRecord | null>(null);
  const [lastGoodData, setLastGoodData] = useState<CountryAnalyticsData | null>(null);
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [responseDateRange, setResponseDateRange] = useState<{ startDate: string; endDate: string; timezone?: string } | null>(null);

  const fetchCountryData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/api/data-center/countries", {
        params: {
          startDate: format(startDate, "yyyy-MM-dd"),
          endDate: format(endDate, "yyyy-MM-dd"),
          minSpend: minSpendFilter,
          includeUnmappedSpend: includeUnmapped ? "true" : "false"
        }
      });
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");
      const rows = res.data?.rows || [];
      setResponseDateRange(res.data?.dateRange || res.data?.appliedFilters || null);
      if (!responseDateRangeMatches(res.data, startStr, endStr) && lastGoodData) {
        setData(lastGoodData);
        setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
        return;
      }
      if (shouldPreserveLastGoodData(res.data, rows, lastGoodData)) {
        setData(lastGoodData);
        setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
        return;
      }
      setData(res.data);
      setLastGoodData(res.data);
      setViewNotice(null);
    } catch (err: any) {
      console.error("Failed to load country analytics:", err);
      if (lastGoodData) {
        setData(lastGoodData);
        setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
        setError(null);
      } else {
        setError(err.response?.data?.details || err.message || "Failed to load country analytics data");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCountryData();
  }, [startDate, endDate, minSpendFilter, includeUnmapped]);

  const currency = (val: number | null) => {
    if (val === null || val === undefined) return "N/A";
    return "$" + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const percentage = (val: number | null) => {
    if (val === null || val === undefined) return "N/A";
    return (val * 100).toFixed(2) + "%";
  };

  const numberFormat = (val: number | null) => {
    if (val === null || val === undefined) return "N/A";
    return val.toLocaleString();
  };

  const countryRows = data?.rows || [];
  const countryHealthStatus =
    data?.dataHealth?.metaCountryAvailable
      ? "READY"
      : countryRows.length > 0
        ? "PARTIAL"
        : "MISSING_META_BREAKDOWN";

  return (
    <div className="space-y-6">
      <DataViewTraceBar
        currentStartDate={format(startDate, "yyyy-MM-dd")}
        currentEndDate={format(endDate, "yyyy-MM-dd")}
        responseStartDate={responseDateRange?.startDate}
        responseEndDate={responseDateRange?.endDate}
        timezone={responseDateRange?.timezone || "America/Los_Angeles"}
        rowCount={countryRows.length}
        status={countryHealthStatus}
        level="country"
        source="受众国家事实数据 + 店铺订单"
      />
      {viewNotice && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {viewNotice}
        </div>
      )}
      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-2xl border border-slate-100 p-8 space-y-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
          <span className="text-sm text-slate-500 font-medium">正在读取受众国家事实源，进行合规多维计算...</span>
        </div>
      ) : error ? (
        <div className="p-8 bg-red-50 rounded-2xl border border-red-200 text-center space-y-3">
          <div className="text-lg font-bold text-red-800">国家服务出错</div>
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={fetchCountryData} className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-xl text-sm font-semibold transition-colors">
            重试加载
          </button>
        </div>
      ) : !data ? null : (
        <>
          {/* Top summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">发现覆盖国家</span>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">{data.summary.countriesCount} 个</h3>
              <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                按国家维度受众明细聚合
              </p>
            </div>
            
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">电商订单国家销售额</span>
              <h3 className="text-2xl font-bold text-slate-400 mt-1">N/A</h3>
              <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                订单国家字段不可用，暂无销售数据
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">Meta 国家投放花费</span>
              <h3 className="text-2xl font-bold text-indigo-950 mt-1">{currency(data.summary.totalMetaSpend)}</h3>
              <p className="text-xs text-slate-400 mt-2">受众投放层级国家明细</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <span className="text-sm text-slate-500 font-medium">未映射国家广告花费</span>
              <h3 className="text-2xl font-bold text-slate-700 mt-1">{currency(data.summary.unmappedMetaSpend)}</h3>
              <p className="text-xs text-slate-400 mt-2">
                占比约 {percentage(data.summary.unmappedMetaSpendRate)} (未映射广告账户)
              </p>
            </div>
          </div>

          {/* Warnings list */}
          {data.dataHealth.warnings.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 text-slate-700 p-4 rounded-xl text-xs space-y-1">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-slate-600" />
                数据健康与追踪警告 (Data Health Indicators):
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-slate-500 font-mono">
                {data.dataHealth.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Filtering Controls */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-600">更低花费过滤 (Min Spend):</label>
              <select 
                value={minSpendFilter} 
                onChange={(e) => setMinSpendFilter(Number(e.target.value))}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800"
              >
                <option value={0}>不限花费 (All)</option>
                <option value={10}>&gt;= $10.00</option>
                <option value={100}>&gt;= $100.00</option>
                <option value={1000}>&gt;= $1000.00</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="incUnmapped"
                checked={includeUnmapped}
                onChange={(e) => setIncludeUnmapped(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="incUnmapped" className="text-xs font-semibold text-slate-600 flex items-center gap-1 cursor-pointer">
                包含未映射店铺的广告表现 (Include Unmapped Spend)
              </label>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                  <Globe className="w-5 h-5 text-indigo-600" />
                  Meta 国家受众表现排行榜
                </h3>
                <p className="text-slate-500 text-xs mt-1">
                  当前根据 Meta 受众国家事实数据计算展现、点击与广告购买率。
                </p>
              </div>
            </div>

            {/* Error notifications regarding unavailability of some indicators */}
            {!data.dataHealth.orderCountryAvailable && (
              <div className="bg-slate-50 px-6 py-3 border-b border-slate-100 text-[11.5px] text-slate-600 font-medium">
                ⚠️ 订单国家字段不可用，当前仅展示 Meta 国家受众表现。
              </div>
            )}

            {!data.dataHealth.metaCountryAvailable && (
              <div className="bg-red-50 px-6 py-3 border-b border-red-100/70 text-[11.5px] text-red-800 font-medium">
                ⚠️ Meta 国家受众数据不可用，当前仅展示订单国家表现。
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-slate-50/85 text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3.5 font-semibold text-slate-700">国家名称 (Country)</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Order Revenue</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Orders</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Profit</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Meta Spend (花费)</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Meta Purchases (点击转化)</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Meta Purchase Value (销售值)</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Meta ROAS</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700 text-right">Store ROAS</th>
                    <th className="px-6 py-3.5 font-semibold text-slate-700">追踪合规审计</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {countryRows.map((row) => (
                    <tr key={row.countryCode} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{row.countryName}</span>
                          <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">
                            {row.countryCode}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-400 text-xs italic font-mono">N/A</td>
                      <td className="px-6 py-4 text-right text-slate-400 text-xs italic font-mono font-medium">N/A</td>
                      <td className="px-6 py-4 text-right text-slate-400 text-xs italic font-mono">N/A</td>
                      <td className="px-6 py-4 text-right font-medium text-slate-800">{currency(row.metaSpend)}</td>
                      <td className="px-6 py-4 text-right text-slate-700">{numberFormat(row.metaPurchases)}</td>
                      <td className="px-6 py-4 text-right text-emerald-600 font-semibold">{currency(row.metaPurchaseValue)}</td>
                      <td className="px-6 py-4 text-right font-mono font-semibold text-indigo-700">{percentage(row.metaRoas)}</td>
                      <td className="px-6 py-4 text-right text-slate-400 text-xs italic font-mono">N/A</td>
                      <td className="px-6 py-4">
                        <button 
                          onClick={() => setSelectedRow(row)}
                          className="text-xs px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200/90 text-slate-700 font-semibold rounded-lg border border-slate-200 tracking-wide transition-all active:scale-[0.98]"
                        >
                          核验
                        </button>
                      </td>
                    </tr>
                  ))}
                  {countryRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-6 py-10">
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                          <AlertTriangle className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                          当前日期范围暂无国家维度数据。Meta 受众国家来自受众 breakdown，订单国家来自订单 shipping/billing country。
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Verification Modal / Side drawer for Trust and Transparency Auditing */}
          {selectedRow && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    <div>
                      <h4 className="font-bold text-slate-950 text-base">国家级 广告受众合规核对</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">Country ISO Code: {selectedRow.countryCode}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedRow(null)}
                    className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                  >
                    ×
                  </button>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto">
                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-400 uppercase font-semibold">国家 / 地区</span>
                    <p className="text-slate-900 font-bold text-sm leading-snug">{selectedRow.countryName}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-xs text-slate-400 block">数据来源</span>
                      <strong className="text-sm text-slate-900 font-semibold">Meta 受众国家事实数据</strong>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">关联广告账户数量</span>
                      <strong className="text-sm text-slate-900 font-semibold">{selectedRow.accountIds.length} 个</strong>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">关联绑定店铺 ID 列表</span>
                      <strong className="text-xs text-indigo-700 font-mono font-semibold">
                        {selectedRow.mappedStoreIds.length > 0 ? selectedRow.mappedStoreIds.join(", ") : "无"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">CPM (千次展示花费)</span>
                      <strong className="text-xs text-slate-900 font-mono">
                        {currency(selectedRow.cpm)}
                      </strong>
                    </div>
                  </div>

                  {/* Trust details */}
                  <div className="space-y-4">
                    <h5 className="text-[12.5px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 border-b border-dashed border-slate-200 pb-1.5">
                      <Globe className="w-4 h-4 text-indigo-500" /> 
                      可信对账与去误差溯源机制 (Attribution Auditing Rule)
                    </h5>

                    <div className="space-y-3.5 text-[12.5px] text-slate-600 leading-relaxed">
                      <div className="flex items-start gap-2.5">
                        <div className="p-1 bg-indigo-50 text-indigo-600 rounded-lg mt-0.5 font-mono text-xs font-semibold">A</div>
                        <div>
                          <strong className="text-slate-900">非伪造归因机制 (Zero Faking Policy):</strong>
                          <p className="text-slate-500 text-xs mt-0.5">
                            由于系统内未捕获 Order 包含国家、省份、邮编等发货地址字段，我们坚决排除使用任何随机数硬编码或分摊比率手段伪造订单国家归属的操作。缺失指标均返回 N/A 保护数据的忠实度。
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <div className="p-1 bg-emerald-50 text-emerald-600 rounded-lg mt-0.5 font-mono text-xs font-semibold">B</div>
                        <div>
                          <strong className="text-slate-900">数据源合规机制 (Audience Origin Check):</strong>
                          <p className="text-slate-500 text-xs mt-0.5">
                            本报告所采用的 Meta 广告国家明细来自受众国家事实数据。不等同于订单归因国家。
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs text-slate-400 uppercase font-semibold">数据来源说明</span>
                    <pre className="bg-slate-950 text-[#86e2d5] text-xs p-4 rounded-xl font-mono overflow-auto max-h-[160px]">
                      {JSON.stringify(data.dataSourceExplain, null, 2)}
                    </pre>
                  </div>
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex justify-end">
                  <button 
                    onClick={() => setSelectedRow(null)}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs tracking-wider transition-all"
                  >
                    确认核对成功
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
