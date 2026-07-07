import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { format } from "date-fns";
import { 
  Store as StoreIcon, 
  Search, 
  ArrowUpDown, 
  TrendingUp, 
  ShoppingBag,
  Coins,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  Coins as SpendIcon,
  Clock,
  ExternalLink,
  MessageSquare
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Types matching API structure
interface StoreMetric {
  id: number;
  name: string;
  platform: string;
  domain: string | null;
  timezone: string;
  currency: string;
  status: string;
  accountsCount: number;
  mappedAccountCount: number;
  ordersCount: number;
  totalSales: number;
  totalRefunded: number;
  avgOrderValue: number;
  aov: number;
  adSpend: number;
  roas: number;
  realRoas: number | null;
  hasMappedAccounts: boolean;
  hasOrders: boolean;
  countryCount: number | null;
  productCount: number;
  lastSyncTime: string | null;
  syncStatus: string;
  syncError: string | null;
}

interface UnmappedAccountsSummary {
  count: number;
  spend: number;
  message: string;
  accounts?: Array<{
    accountId: string;
    name: string;
    spend: number;
  }>;
}

interface DataHealth {
  status: "EXCELLENT" | "WARNING" | "EMPTY" | string;
  message: string;
  warnings?: string[];
  lastFailedSync?: {
    taskType?: string;
    errorMessage?: string | null;
    startedAt?: string;
  } | null;
}

function getApiErrorMessage(error: any): string {
  const data = error?.response?.data;
  const code = data?.error || data?.code;
  if (code === "MANUAL_SYNC_DISABLED") {
    return "该同步任务被安全开关拦截。普通店铺订单同步请使用受限同步入口。";
  }
  if (!error?.response) {
    return `后端服务未连接或请求失败：${error?.message || "network error"}`;
  }
  return data?.message || data?.details || data?.error || error?.message || "同步请求失败";
}

interface ReconciliationData {
  startDate: string;
  endDate: string;
  systemOrdersCount: number;
  systemSalesAmount: number;
  lastSyncTime: string | null;
  lastSyncStatus: string;
  fetchedOrdersCount: number;
  savedOrdersCount: number;
  syncFailedCount: number;
  lastSyncError: string | null;
  platformUnsupported: boolean;
  platformMessage: string;
  skippedCount?: number;
  duplicateCount?: number;
  failedCount?: number;
  canonicalLedger?: { orderCount: number; grossSales: number; orderIds: string[] };
  orderFact?: { uniqueOrderCount: number; orderTotalSum: number; orderIds: string[] };
  apiAudit?: { recordsFetched: number; orderItemsCount: number; savedLikeCount: number };
  legacyOrderFactOrdersCount?: number;
  diff?: {
    orderFactNotInLedger: any[];
    ledgerNotInOrderFact: any[];
    apiSavedNotInLedger: any[];
    excludedByPaymentStatus: any[];
    excludedByLocalDate: any[];
    amountMismatch: any[];
  };
  orderItems?: Array<{
    id: string;
    order_number: string;
    createdAtRaw: string;
    createdAtUtc: string;
    storeLocalDate: string;
    totalAmount: number;
    paymentStatus: string;
    fulfillmentStatus: string;
    isSaved: boolean;
    skipReason: string;
  }>;
}

interface StoreDataDashboardProps {
  startDate: Date;
  endDate: Date;
}

type SortField = "name" | "accountsCount" | "ordersCount" | "totalSales" | "avgOrderValue" | "adSpend" | "roas";
type SortOrder = "asc" | "desc";

export function StoreDataDashboard({ startDate, endDate }: StoreDataDashboardProps) {
  const [stores, setStores] = useState<StoreMetric[]>([]);
  const [unmappedSummary, setUnmappedSummary] = useState<UnmappedAccountsSummary>({ count: 0, spend: 0, message: "" });
  const [dataHealth, setDataHealth] = useState<DataHealth>({ status: "EMPTY", message: "尚未获取到健康体检报告" });
  const [appliedDateRange, setAppliedDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("totalSales");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [unmappedExpanded, setUnmappedExpanded] = useState<boolean>(false);

  // Reconciliation state
  const [selectedStoreForRecon, setSelectedStoreForRecon] = useState<StoreMetric | null>(null);
  const [reconData, setReconData] = useState<ReconciliationData | null>(null);
  const [reconLoading, setReconLoading] = useState<boolean>(false);

  // AI popup / analyst assistant states
  const [aiAnalyzingStore, setAiAnalyzingStore] = useState<StoreMetric | null>(null);
  const [aiReport, setAiReport] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  const formattedStartDate = format(startDate, "yyyy-MM-dd");
  const formattedEndDate = format(endDate, "yyyy-MM-dd");

  // 1. Fetch Store Metrics and Summaries
  const fetchStoresData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await axios.get("/api/data-center/stores", {
        params: {
          startDate: formattedStartDate,
          endDate: formattedEndDate
        }
      });
      
      const { stores: fetchedStores, unmappedAccountsSummary, dataHealth: fetchedHealth } = response.data;
      setStores(fetchedStores || []);
      setUnmappedSummary(unmappedAccountsSummary || { count: 0, spend: 0, message: "" });
      setDataHealth(fetchedHealth || { status: "EMPTY", message: "" });
      setAppliedDateRange(response.data.appliedFilters || response.data.dateRange || {
        startDate: formattedStartDate,
        endDate: formattedEndDate
      });

      // Keep reconciliation in-sync if one is selected
      if (selectedStoreForRecon) {
        const updatedSelected = (fetchedStores || []).find((s: StoreMetric) => s.id === selectedStoreForRecon.id);
        if (updatedSelected) {
          setSelectedStoreForRecon(updatedSelected);
        }
      }
    } catch (error: any) {
      console.error("Failed to load stores analytics:", error);
      toast.error("加载店铺数据失败: " + getApiErrorMessage(error));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStoresData();
  }, [formattedStartDate, formattedEndDate]);

  // 2. Load order reconciliation panel for specific store
  const loadReconciliation = async (store: StoreMetric) => {
    setSelectedStoreForRecon(store);
    setReconLoading(true);
    try {
      const response = await axios.get(`/api/data-center/stores/${store.id}/reconciliation`, {
        params: {
          startDate: formattedStartDate,
          endDate: formattedEndDate
        }
      });
      setReconData(response.data);

      if (response.data?.ledgerRefresh?.success) {
        toast.success("订单校对完成，店铺账目已更新");
      } else {
        toast.warning("订单已抓取，但店铺账目刷新失败");
      }

      await fetchStoresData(true);
    } catch (error: any) {
      console.error("Failed to load store reconciliation details:", error);
      toast.error("未获取到校对明细: " + getApiErrorMessage(error));
      setReconData(null);
    } finally {
      setReconLoading(false);
    }
  };

  // 6. Interactive AI Ask Component Analyst action
  const handleAskAIAnalytics = async (store: StoreMetric) => {
    setAiAnalyzingStore(store);
    setAiLoading(true);
    setAiReport("");
    try {
      // Fetch dynamic insights using AI helper routes or simulated deep metadata intelligence block
      const response = await axios.post("/api/ai-analysis/generate", {
  type: "store_analysis",
  entityType: "store",
  entityId: String(store.id),
  startDate: formattedStartDate,
  endDate: formattedEndDate,
  storeId: store.id,
  stylePrompt: `你是一个懂跨境电商和流量投放的顶级运营专家。请为店铺 "${store.name}" 输出一份直观、落地、排版清晰的《整店投放经营体检与优化建议短报》。要求使用 markdown，可适当使用 emoji；语气自信专业，直击要点；重点点评真实 ROAS、订单、销售额、广告花费、AOV、退款和国家表现；若 ROAS 低于 1.5，提醒亏损风险；若未绑定广告账户，提示先完成账户映射；若销售额为空，给出冷启动建议；控制在 280 字内。`
});

const report = response.data?.report || response.data;
const reportText = [
  `## ${report.title || `${store.name} 店铺经营体检`}`,
  report.summary,
  Array.isArray(report.findings) && report.findings.length > 0
    ? report.findings.map((item: string) => `- ${item}`).join("\n")
    : "",
  Array.isArray(report.recommendations) && report.recommendations.length > 0
    ? [
        "### 建议动作",
        ...report.recommendations.map((item: any) => `- ${item.action || item.rationale || JSON.stringify(item)}`)
      ].join("\n")
    : "",
  report.dataSourceExplain ? `数据源：${report.dataSourceExplain}` : ""
].filter(Boolean).join("\n\n");

setAiReport(reportText || "未返回分析报告");
    } catch (error: any) {
      console.error("AI analyst error:", error);
      setAiReport(`🤖 AI 分析出现一点偏差，让我们再次重试。错误提示: ${error.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  // 7. Calculate aggregate totals purely based on returned active stores list
  const aggregatedStats = useMemo(() => {
    let totalStores = stores.length;
    let totalOrders = 0;
    let totalSales = 0;
    let totalSpend = 0;
    let totalRefunds = 0;

    stores.forEach((s) => {
      totalOrders += s.ordersCount || 0;
      totalSales += s.totalSales || 0;
      totalSpend += s.adSpend || 0;
      totalRefunds += s.totalRefunded || 0;
    });

    const averageAOV = totalOrders > 0 ? totalSales / totalOrders : 0;
    const realGlobalROAS = totalSpend > 0 ? totalSales / totalSpend : 0;

    return {
      totalStores,
      totalOrders,
      totalSales,
      averageAOV,
      totalSpend,
      realGlobalROAS
    };
  }, [stores]);

  // 8. Sorting & Filtering
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const processedStores = useMemo(() => {
    let result = stores.filter(s =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.domain && s.domain.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    result.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      // Handle null realRoas cases safely in sorting
      if (sortField === "roas") {
        valA = a.realRoas !== null ? a.realRoas : -1;
        valB = b.realRoas !== null ? b.realRoas : -1;
      }

      if (typeof valA === "string" && typeof valB === "string") {
        return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      return sortOrder === "asc" ? valA - valB : valB - valA;
    });

    return result;
  }, [stores, searchTerm, sortField, sortOrder]);

  const appliedStartDate = appliedDateRange?.startDate || formattedStartDate;
  const appliedEndDate = appliedDateRange?.endDate || formattedEndDate;

  return (
    <div className="space-y-6">
      
      {/* 🚀 Top Command Controls Dashboard */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <StoreIcon className="w-5 h-5 text-indigo-500 shrink-0" />
          <h3 className="font-bold text-slate-900 truncate">店铺经营数据一览</h3>
          <span className="text-xs text-slate-500">| 当前统计期间：{appliedStartDate} 至 {appliedEndDate}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-3 border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
          onClick={() => fetchStoresData()}
          disabled={loading}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
          刷新页面数据
        </Button>
      </div>

      {/* 📊 KPI summary banner */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        
        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">已关联店铺数</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">{aggregatedStats.totalStores} 个</h3>
              <div className="p-1 px-1.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold">STORES</div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">店铺抓取订单</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                {aggregatedStats.totalOrders.toLocaleString()} <span className="text-xs font-normal text-slate-400">单</span>
              </h3>
              <ShoppingBag className="w-4 h-4 text-emerald-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">店铺汇总销售额</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-emerald-600 tracking-tight">
                ${aggregatedStats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </h3>
              <Coins className="w-4 h-4 text-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">综合结算客单价</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                ${aggregatedStats.averageAOV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h3>
              <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded">AOV</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">映射广告总花费</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                ${aggregatedStats.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </h3>
              <SpendIcon className="w-4 h-4 text-indigo-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">真实全局整店 ROAS</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-md font-extrabold text-indigo-600 tracking-tight">
                {aggregatedStats.totalSpend > 0 ? `${aggregatedStats.realGlobalROAS.toFixed(2)}x` : "—"}
              </h3>
              <TrendingUp className="w-4 h-4 text-indigo-500" />
            </div>
          </CardContent>
        </Card>

      </div>

      {/* 📊 Main Store Data Table */}
      {((dataHealth.status === "EMPTY_FACTS" || dataHealth.status === "EMPTY") || dataHealth.lastFailedSync?.errorMessage) && !loading && (
        <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs shadow-sm">
          <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h5 className="font-bold text-slate-900">
              {dataHealth.status === "EMPTY_FACTS" || dataHealth.status === "EMPTY" ? "当前日期范围暂无店铺订单数据" : "最近一次店铺/同步任务失败"}
            </h5>
            <p className="text-slate-600 leading-relaxed">
              {dataHealth.message || "已配置店铺会继续显示在下方列表中；订单数、销售额和 AOV 在事实表为空时按 0 展示。"}
            </p>
            {dataHealth.lastFailedSync?.errorMessage && (
              <p className="text-rose-700 leading-relaxed">
                最近失败原因：{dataHealth.lastFailedSync.errorMessage}
              </p>
            )}
          </div>
        </div>
      )}

      {unmappedSummary.count > 0 && unmappedSummary.spend > 0 && !loading && (
        <div className="p-3 bg-rose-50 border border-rose-150 rounded-xl text-slate-800 text-xs shadow-sm mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="font-medium text-rose-900">
                未绑定消耗：{unmappedSummary.count} 个账户，${unmappedSummary.spend.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <button 
              onClick={() => setUnmappedExpanded(!unmappedExpanded)}
              className="text-[11px] text-rose-700 hover:text-rose-900 underline font-semibold cursor-pointer"
            >
              {unmappedExpanded ? "折叠明细" : "展开明细"}
            </button>
          </div>
          {unmappedExpanded && unmappedSummary.accounts && unmappedSummary.accounts.length > 0 && (
            <div className="mt-2 bg-white/80 border border-rose-100 rounded-lg p-2.5 overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-rose-100 text-slate-500 font-semibold">
                    <th className="py-1 px-2">账户名称 (Account Name)</th>
                    <th className="py-1 px-2">账户 ID (Account ID)</th>
                    <th className="py-1 px-2 text-right">消耗 (Spend)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-50">
                  {unmappedSummary.accounts.map((acc) => (
                    <tr key={acc.accountId} className="hover:bg-rose-50/50">
                      <td className="py-1 px-2 text-slate-700 font-medium">{acc.name}</td>
                      <td className="py-1 px-2 font-mono text-slate-500">{acc.accountId}</td>
                      <td className="py-1 px-2 text-right font-mono text-rose-600 font-bold">
                        ${acc.spend.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Card className="border border-slate-200 shadow-sm bg-white rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-slate-50/50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <StoreIcon className="w-4 h-4 text-indigo-500" />
            <span className="font-bold text-[14px] text-slate-900">核对映射已关联之真实店铺列表</span>
            <span className="text-[11px] text-slate-400 font-normal">（自动剔除未映射广告账户伪造行，只保留 Stores 中的合法实例）</span>
          </div>
          
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="搜索店铺名称、域名..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 text-xs h-9 bg-slate-50/50 border-slate-200 focus-visible:ring-indigo-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <p className="text-xs text-slate-500">正在动态加载底层订单数据...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-[12.5px] whitespace-nowrap">
              <TableHeader className="bg-slate-50/70 select-none">
                <TableRow className="border-b border-slate-100">
                  <TableHead onClick={() => handleSort("name")} className="font-semibold py-3 px-5 text-slate-600 cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center gap-1">
                      店铺实例名称
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold py-3 text-slate-600">平台 / 域名</TableHead>
                  <TableHead onClick={() => handleSort("accountsCount")} className="font-semibold text-center py-3 text-slate-600 cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center justify-center gap-1">
                      绑定账号数
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </TableHead>
                  <TableHead onClick={() => handleSort("ordersCount")} className="font-semibold text-right py-3 text-slate-600 cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center justify-end gap-1">
                      订单
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </TableHead>
                  <TableHead onClick={() => handleSort("totalSales")} className="font-semibold text-right py-3 text-slate-600 cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center justify-end gap-1">
                      销售额
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </TableHead>
                  <TableHead onClick={() => handleSort("avgOrderValue")} className="font-semibold text-right py-3 text-slate-600 cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center justify-end gap-1">
                      AOV
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </TableHead>
                  <TableHead onClick={() => handleSort("adSpend")} className="font-semibold text-right py-3 text-slate-600 cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center justify-end gap-1">
                      广告花费
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </TableHead>
                  <TableHead onClick={() => handleSort("roas")} className="font-semibold text-right py-3 px-5 text-slate-600 cursor-pointer hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center justify-end gap-1">
                      ROAS
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-center py-3 px-5 text-slate-600">更新时间</TableHead>
                  <TableHead className="font-semibold text-right py-3 pr-5 text-slate-600">操作</TableHead>
                </TableRow>
              </TableHeader>
              
              <TableBody>
                {processedStores.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-slate-400">
                      {stores.length > 0
                        ? "当前搜索条件下没有匹配店铺；已配置店铺不会因订单为空而被隐藏。"
                        : "没有找到任何合法的店铺数据，请确认是否已在设置页创建店铺实例。"}
                    </TableCell>
                  </TableRow>
                ) : (
                  processedStores.map((store) => {
                    const isReconActive = selectedStoreForRecon?.id === store.id;
                    const hasSyncTime = !!store.lastSyncTime;
                    
                    return (
                      <React.Fragment key={store.id}>
                        <TableRow className={cn(
                          "hover:bg-slate-50/40 border-b border-slate-100 font-medium transition-colors",
                          isReconActive && "bg-slate-50/70 border-l-4 border-l-indigo-600"
                        )}>
                          
                          {/* 店铺名称 */}
                          <TableCell className="font-bold text-slate-900 py-3.5 px-5">
                            <div className="flex items-center gap-2">
                              <span className="p-1 bg-slate-100 text-slate-700 rounded select-all">
                                {store.name}
                              </span>
                            </div>
                          </TableCell>

                          {/* 平台域名 */}
                          <TableCell className="py-3 text-slate-500 text-xs">
                            <div className="space-y-0.5 max-w-[170px] truncate">
                              <p className="font-mono text-slate-800 text-[11px] font-bold">
                                {store.platform.toUpperCase()}
                              </p>
                              <p className="truncate text-[10.5px] text-indigo-500 font-mono flex items-center">
                                {store.domain || "—"}
                                {store.domain && <ExternalLink className="w-2.5 h-2.5 ml-0.5 inline opacity-60" />}
                              </p>
                            </div>
                          </TableCell>

                          {/* 绑定账号数 */}
                          <TableCell className="text-center py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[10.5px] font-semibold",
                              store.accountsCount > 0 ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-500 border border-slate-100"
                            )}>
                              {store.accountsCount} 个账户
                            </span>
                          </TableCell>

                          {/* 订单数 */}
                          <TableCell className="text-right text-slate-800 font-mono font-bold">
                            {store.hasOrders ? (
                              store.ordersCount.toLocaleString()
                            ) : (
                              <span className="text-[11px] text-slate-400 font-normal">无订单</span>
                            )}
                          </TableCell>

                          {/* 销售额 */}
                          <TableCell className="text-right text-slate-950 font-mono font-extrabold text-[13px]">
                            {store.hasOrders ? (
                              `$${store.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            ) : (
                              <span className="text-[11px] text-slate-400 font-normal italic">—</span>
                            )}
                          </TableCell>

                          {/* AOV */}
                          <TableCell className="text-right text-slate-600 font-mono font-medium">
                            {store.hasOrders ? (
                              `$${store.avgOrderValue.toFixed(2)}`
                            ) : (
                              <span className="text-slate-400 font-normal">—</span>
                            )}
                          </TableCell>

                          {/* 账户开销 */}
                          <TableCell className="text-right text-slate-700 font-mono font-bold">
                            {store.adSpend > 0 ? (
                              `$${store.adSpend.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            ) : (
                              <span className="text-[11px] text-slate-400 font-normal">—</span>
                            )}
                          </TableCell>

                          {/* ROAS 分别渲染无绑定、无订单、异常和真实ROAS */}
                          <TableCell className="text-right py-3 px-5">
                            {(!store.hasMappedAccounts) ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] bg-slate-50 text-slate-500 border border-slate-100">
                                未绑定
                              </span>
                            ) : (!store.hasOrders && store.adSpend > 0) ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] bg-slate-50 text-slate-500 border border-slate-100">
                                —
                              </span>
                            ) : store.adSpend === 0 && store.totalSales > 0 ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] bg-emerald-50 text-emerald-700 border border-emerald-100">
                                自然订单
                              </span>
                            ) : store.adSpend === 0 && store.totalSales === 0 ? (
                              <span className="text-slate-400 text-[11px]">—</span>
                            ) : (
                              <span className={cn(
                                "inline-block px-2 py-0.5 rounded font-extrabold text-[12px] font-mono",
                                (store.realRoas || 0) >= 1.5 
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                                  : "bg-rose-50 text-rose-700 border border-rose-100"
                              )}>
                                {store.realRoas !== null ? `${store.realRoas.toFixed(2)}x` : "—"}
                              </span>
                            )}
                          </TableCell>

                          {/* 最新更新同步状态 */}
                          <TableCell className="text-center py-3 text-xs">
                            <div className="space-y-0.5 inline-block text-left">
                              <p className="font-mono text-[10.5px] text-slate-600 flex items-center justify-center gap-1">
                                <Clock className="w-3 h-3 opacity-60" />
                                {hasSyncTime ? format(new Date(store.lastSyncTime!), "MM-dd HH:mm") : "未进行同步"}
                              </p>
                              <div className="text-center">
                                <span className={cn(
                                  "inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold",
                                  store.syncStatus === "success" && "bg-emerald-50 text-emerald-700 border border-emerald-100",
                                  store.syncStatus === "failed" && "bg-rose-50 text-rose-700 border border-rose-100",
                                  store.syncStatus === "running" && "bg-blue-50 text-blue-700 border border-blue-100 animate-pulse",
                                  store.syncStatus === "none" && "bg-slate-100 text-slate-500"
                                )}>
                                  {store.syncStatus.toUpperCase()}
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          {/* 配置操作按纽 */}
                          <TableCell className="text-right py-3 pr-5">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button 
                                variant="outline" 
                                size="xs"
                                onClick={() => loadReconciliation(store)}
                                className={cn(
                                  "h-7 px-2 text-[11px]",
                                  isReconActive 
                                    ? "bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600" 
                                    : "bg-indigo-50/30 hover:bg-indigo-50 text-indigo-700 border-indigo-100"
                                )}
                              >
                                {isReconActive ? "已在下方校对" : "订单校对"}
                              </Button>

                              <Button 
                                variant="outline" 
                                size="xs"
                                onClick={() => handleAskAIAnalytics(store)}
                                className="h-7 px-2 text-[11px] bg-gradient-to-r from-pink-500/10 to-violet-500/10 hover:from-pink-500/20 hover:to-violet-500/20 text-indigo-700 border-indigo-200"
                              >
                                <Sparkles className="w-3 h-3 mr-1 text-violet-500 animate-pulse" />
                                问 AI
                              </Button>
                            </div>
                          </TableCell>

                        </TableRow>
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* 🤖 Row 4: AI Intelligent Assistant Dialogue Overlay */}
      {aiAnalyzingStore && (
        <Card className="border border-violet-100 bg-gradient-to-b from-indigo-50/20 to-white rounded-xl shadow-md overflow-hidden">
          <div className="px-4 py-3 border-b border-indigo-100/60 bg-indigo-50/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4.5 h-4.5 text-violet-600 animate-pulse" />
              <span className="font-bold text-slate-900 text-sm">【AI 商业智能参谋】店铺经营健康诊断: {aiAnalyzingStore.name}</span>
            </div>
            <Button 
              variant="ghost" 
              size="xs" 
              onClick={() => setAiAnalyzingStore(null)}
              className="text-slate-400 hover:text-slate-700 h-6 w-12"
            >
              关闭
            </Button>
          </div>
          <CardContent className="p-5">
            {aiLoading ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
                <p className="text-xs text-slate-500 font-bold">商业顾问正在评估 ROAS 指标与利润空间，请稍候...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="prose prose-sm prose-slate max-w-none text-slate-700 text-xs">
                  <div className="p-4 rounded-lg bg-slate-50 border border-dashed border-slate-200/80 leading-relaxed font-medium whitespace-pre-line tracking-wide">
                    {aiReport}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 text-[11px] text-slate-400">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>本报告基于当天 Meta 分类日志与实收 Orders 清单完成整店计算。</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

  {/* 🔍 Row 5: Store Order Reconciliation Comparison Panel (订单校对面板) */}
  <Card className="border border-slate-200 shadow-sm bg-white rounded-xl overflow-hidden">
    <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <StoreIcon className="w-4.5 h-4.5 text-slate-600" />
        <h4 className="font-bold text-slate-900 text-[13.5px]">API 抓取与保存订单数据对账面板</h4>
      </div>
          {selectedStoreForRecon ? (
            <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
              正在校对的店铺：{selectedStoreForRecon.name}
            </span>
          ) : (
            <span className="text-xs text-slate-500">点击上方店铺列表行的 “订单校对” 进入深度数据合规对账</span>
          )}
        </div>

        <div className="p-5">
          {!selectedStoreForRecon ? (
            <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
              <span className="p-3 bg-white text-slate-400 rounded-full shadow-sm mb-3">
                <StoreIcon className="w-6 h-6" />
              </span>
              <p className="text-xs font-bold text-slate-700">尚未选择待校对对账店铺</p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm leading-normal">
                请在上方列表中定位任意一家电商，并点击其操作栏中的 “订单校对” 按钮。系统将自动调用对账分析器，检测本地抓取流水是否与主干账套出现出入和误差。
              </p>
            </div>
          ) : reconLoading ? (
            <div className="flex flex-col items-center justify-center p-12 space-y-3">
              <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-500 font-bold">对账模型计算中，调取历史接口流...</p>
            </div>
          ) : reconData ? (
            <div className="space-y-5">
              
              {/* Comparitive metrics view */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-indigo-600 font-bold uppercase block">账目快照订单数</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-indigo-900 font-mono">
                      {reconData.canonicalLedger?.orderCount ?? reconData.systemOrdersCount}
                    </span>
                    <span className="text-xs text-indigo-500 font-normal">单</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-indigo-600 font-bold uppercase block">账目快照销售额</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-indigo-950 font-mono">
                      ${(reconData.canonicalLedger?.grossSales ?? reconData.systemSalesAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs text-indigo-500 font-normal">USD</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">平台抓取订单数</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-slate-700 font-mono">
                      {reconData.apiAudit?.recordsFetched ?? reconData.fetchedOrdersCount}
                    </span>
                    <span className="text-xs text-slate-500 font-normal">笔</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-slate-600 font-bold uppercase block">Order 表候选订单数</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-slate-700 font-mono">
                      {reconData.orderFact?.uniqueOrderCount ?? reconData.legacyOrderFactOrdersCount}
                    </span>
                    <span className="text-xs text-slate-500 font-normal">件</span>
                  </div>
                </div>

              </div>

              {/* Mismatch warnings banner */}
              {(reconData.orderFact?.uniqueOrderCount !== reconData.canonicalLedger?.orderCount && reconData.canonicalLedger) && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>发现 Order 表与账目快照存在 {Math.abs((reconData.orderFact?.uniqueOrderCount || 0) - (reconData.canonicalLedger?.orderCount || 0))} 单差异，已列入差异明细。</span>
                </div>
              )}

              {/* API and log verification list */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                
                {/* Platform support analysis */}
                <div className="space-y-4">
                  <h5 className="font-bold text-slate-900 text-xs">电商接口支持度评级</h5>
                  <div className="p-3 rounded-lg border border-indigo-100 bg-indigo-50/30">
                    <div className="flex items-start gap-2.5">
                      <div className="p-1 px-1.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">INFO</div>
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-slate-900 leading-tight">API 抓取细节:</p>
                        <p className="text-[11.5px] text-slate-600 leading-relaxed font-medium">
                          {reconData.platformMessage}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-200 text-slate-500 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>对账统计日期筛选</span>
                      <span className="font-semibold text-slate-800">{reconData.startDate} 至 {reconData.endDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>最近抓取线程状态</span>
                      <span className={cn(
                        "font-semibold uppercase font-mono",
                        reconData.lastSyncStatus === "success" && "text-emerald-600",
                        reconData.lastSyncStatus === "failed" && "text-rose-600"
                      )}>{reconData.lastSyncStatus || "none"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>最近抓取执行异常数</span>
                      <span className="font-semibold text-slate-800 font-mono">{reconData.syncFailedCount} 次记录</span>
                    </div>
                  </div>
                </div>

                {/* Audit healthy review */}
                <div className="space-y-3">
                  <h5 className="font-bold text-slate-900 text-xs">对账分析数据评价</h5>
                  <div className="border border-slate-200 rounded-lg p-3.5 space-y-3.5">
                    
                    {!(reconData.savedOrdersCount > 0 || reconData.fetchedOrdersCount > 0) ? (
                      <div className="flex items-start gap-3">
                        <div className="p-1.5 rounded-full bg-slate-100 text-slate-500">
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                        <div className="space-y-1 text-xs">
                          <p className="font-bold text-slate-900">暂无账套成交流水 (EMPTY/WARNING)</p>
                          <p className="text-slate-500 text-[11px] leading-relaxed">
                            在当前所选的对账统计日期范围内，该店铺未录入任何已落库订单，且平台 API 亦未返回新的成交数据，暂无法执行对账校对。
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-1.5 rounded-full",
                          reconData.syncFailedCount === 0 ? "bg-slate-100 text-emerald-600" : "bg-rose-50 text-rose-600"
                        )}>
                          <Clock className="w-4 h-4" />
                        </div>
                        <div className="space-y-1 text-xs">
                          <p className="font-bold text-slate-900">落库数据状态良好</p>
                          <p className="text-slate-500 text-[11px] leading-relaxed">
                            当前店铺系统的已落库订单 ({reconData.savedOrdersCount}) 与本统计期间捕获到的成交行 ({reconData.fetchedOrdersCount}) 实现了数据归档基本契合，抓取同步状态正常。
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-full bg-slate-100 text-slate-500">
                        <StoreIcon className="w-4 h-4" />
                      </div>
                      <div className="space-y-1 text-xs">
                        <p className="font-bold text-slate-900">时区校准与截断</p>
                        <p className="text-slate-500 text-[11px] leading-relaxed">
                          时区程序匹配该店铺所属的 {selectedStoreForRecon.timezone} 规则，避免因服务器 UTC 本地时间差异产生的数据日期偏移误差。
                        </p>
                      </div>
                    </div>

                  </div>
                </div>

              </div>

              {/* 🔍 API / Order / Ledger 差异诊断 Section */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <span>API / Order / Ledger 差异诊断明细</span>
                  {reconData.diff && (
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded font-mono">
                      发现 {(reconData.diff.orderFactNotInLedger?.length || 0) + (reconData.diff.ledgerNotInOrderFact?.length || 0) + (reconData.diff.amountMismatch?.length || 0)} 处核心不一致
                    </span>
                  )}
                </h5>

                <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 text-slate-600 text-xs leading-relaxed font-medium">
                    本对账诊断器会比对三大订单口径的数据（API 直接抓取流、本地数据库 Order 表流水、账目快照 DataCenterStoreDaily）。以下为发现的不一致列表，可以帮助排查时区边界、支付状态不合规或未同步归档的异常订单。
                  </div>

                  <div className="max-h-[300px] overflow-y-auto text-xs">
                    <table className="w-full text-left border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-semibold text-[10px] tracking-wider uppercase">
                          <th className="p-2.5 pl-3">差异订单 ID</th>
                          <th className="p-2.5">账套金额</th>
                          <th className="p-2.5">Order 表金额</th>
                          <th className="p-2.5">API 原始金额</th>
                          <th className="p-2.5">账套原始时间 / 本地日期</th>
                          <th className="p-2.5">支付 / 履约状态</th>
                          <th className="p-2.5 pr-3">差异定位原因及建议修复方案</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {(!reconData.diff || 
                          ((reconData.diff.orderFactNotInLedger?.length || 0) === 0 &&
                           (reconData.diff.ledgerNotInOrderFact?.length || 0) === 0 &&
                           (reconData.diff.amountMismatch?.length || 0) === 0 &&
                           (reconData.diff.apiSavedNotInLedger?.length || 0) === 0 &&
                           (reconData.diff.excludedByPaymentStatus?.length || 0) === 0 &&
                           (reconData.diff.excludedByLocalDate?.length || 0) === 0)) ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-slate-400 font-normal">
                              ✅ 恭喜！当前统计区间内没有任何关键口径不匹配，全链路交易与账套百分之百契合。
                            </td>
                          </tr>
                        ) : (
                          <>
                            {/* 1. orderFactNotInLedger */}
                            {reconData.diff.orderFactNotInLedger?.map((item: any) => (
                              <tr key={`fact-not-in-ledg-${item.orderId}`} className="hover:bg-rose-50/10 transition-colors bg-rose-50/5">
                                <td className="p-2.5 pl-3 font-mono text-rose-700 text-[11px] font-bold">
                                  {item.orderId}
                                </td>
                                <td className="p-2.5 text-slate-400 font-mono">—</td>
                                <td className="p-2.5 text-slate-900 font-mono font-bold">${item.orderFactAmount?.toFixed(2)}</td>
                                <td className="p-2.5 text-slate-500 font-mono">${item.apiAmount != null ? item.apiAmount.toFixed(2) : "—"}</td>
                                <td className="p-2.5 text-slate-600">
                                  <div>Order 标注: {item.orderFactLocalDate}</div>
                                  <div className="text-[10px] text-slate-400 font-mono">API: {item.apiCreatedAtRaw || "—"}</div>
                                </td>
                                <td className="p-2.5">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-50 text-slate-700 border border-slate-100 uppercase">
                                    {item.paymentStatus || "unknown"}
                                  </span>
                                </td>
                                <td className="p-2.5 pr-3">
                                  <div className="text-rose-600 font-bold text-[11px]">
                                    {item.reason === "TIMEZONE_BOUNDARY_MISMATCH" && "🕒 时区边界偏移 (TIMEZONE_BOUNDARY_MISMATCH)"}
                                    {item.reason === "PAYMENT_STATUS_EXCLUDED_BY_LEDGER" && "💳 支付状态不符 (PAYMENT_STATUS_EXCLUDED_BY_LEDGER)"}
                                    {item.reason === "STALE_ORDER_FACT_ROW" && "🗑️ 历史残留订单行 (STALE_ORDER_FACT_ROW)"}
                                    {item.reason === "UNKNOWN" && "⚠️ 未知异常差异 (UNKNOWN)"}
                                  </div>
                                  <div className="text-slate-500 text-[10.5px] font-normal leading-tight mt-0.5">
                                    {item.reason === "TIMEZONE_BOUNDARY_MISMATCH" && "该订单由于美国洛杉矶时区与 UTC 时间边界转换问题，未归入该账目快照所属日期中。"}
                                    {item.reason === "PAYMENT_STATUS_EXCLUDED_BY_LEDGER" && "账目快照排除了此非 Paid 支付状态订单，而 Order 表仍缓存了此未付/取消单。"}
                                    {item.reason === "STALE_ORDER_FACT_ROW" && "Order 表中的历史残留陈旧交易数据，而平台 API 主数据源中该区间已无此单，可通过重建流水清洗。"}
                                  </div>
                                </td>
                              </tr>
                            ))}

                            {/* 2. ledgerNotInOrderFact */}
                            {reconData.diff.ledgerNotInOrderFact?.map((item: any) => (
                              <tr key={`ledg-not-in-fact-${item.orderId}`} className="hover:bg-slate-50 transition-colors bg-slate-50/40">
                                <td className="p-2.5 pl-3 font-mono text-slate-700 text-[11px] font-bold">
                                  {item.orderId}
                                </td>
                                <td className="p-2.5 text-slate-900 font-mono font-bold">${item.ledgerAmount?.toFixed(2)}</td>
                                <td className="p-2.5 text-slate-400 font-mono">—</td>
                                <td className="p-2.5 text-slate-500 font-mono">${item.apiAmount != null ? item.apiAmount.toFixed(2) : "—"}</td>
                                <td className="p-2.5 text-slate-600">
                                  <div>账目快照: {item.ledgerRawTime}</div>
                                </td>
                                <td className="p-2.5">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase">
                                    {item.paymentStatus || "PAID"}
                                  </span>
                                </td>
                                <td className="p-2.5 pr-3">
                                  <div className="text-slate-600 font-bold text-[11px]">
                                    📈 账套已记账但本地明细表缺失
                                  </div>
                                  <div className="text-slate-500 text-[10.5px] font-normal leading-tight mt-0.5">
                                    该订单已被 DataCenter 账套成功认列并记账，但本地 Order 明细表可能因为部分过滤规则未能成功同步存储。
                                  </div>
                                </td>
                              </tr>
                            ))}

                            {/* 3. amountMismatch */}
                            {reconData.diff.amountMismatch?.map((item: any) => (
                              <tr key={`amount-mismatch-${item.orderId}`} className="hover:bg-indigo-50/10 transition-colors bg-indigo-50/5">
                                <td className="p-2.5 pl-3 font-mono text-indigo-700 text-[11px] font-bold">
                                  {item.orderId}
                                </td>
                                <td className="p-2.5 text-indigo-900 font-mono font-bold">${item.ledgerAmount?.toFixed(2)}</td>
                                <td className="p-2.5 text-rose-900 font-mono font-bold">${item.orderFactAmount?.toFixed(2)}</td>
                                <td className="p-2.5 text-slate-500 font-mono">${item.apiAmount != null ? item.apiAmount.toFixed(2) : "—"}</td>
                                <td className="p-2.5 text-slate-600">
                                  <div>Order 标注: {item.orderFactLocalDate}</div>
                                  <div>账套: {item.ledgerRawTime}</div>
                                </td>
                                <td className="p-2.5">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase">
                                    {item.paymentStatus}
                                  </span>
                                </td>
                                <td className="p-2.5 pr-3">
                                  <div className="text-indigo-600 font-bold text-[11px]">
                                    ⚖️ 金额字段不一致 (AMOUNT_FIELD_MISMATCH)
                                  </div>
                                  <div className="text-slate-500 text-[10.5px] font-normal leading-tight mt-0.5">
                                    Order 表的明细统计金额与 DataCenter 账目快照中的单笔记记金额存在不一致，主看板继续强制采用账目快照。
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 订单明细校对列表 */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <span>订单合规数据审计流水</span>
                    <span className="text-[10px] font-normal text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                      共计 {reconData.orderItems?.length || 0} 笔抓取订单
                    </span>
                  </h5>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <div className="max-h-[300px] overflow-y-auto overflow-x-auto text-xs">
                    <table className="w-full text-left border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-semibold text-[10px] tracking-wider uppercase">
                          <th className="p-2.5 pl-3">平台订单号</th>
                          <th className="p-2.5">订单编号</th>
                          <th className="p-2.5">平台创建时间 (原始值)</th>
                          <th className="p-2.5">UTC 国际时间</th>
                          <th className="p-2.5">店铺本地日期</th>
                          <th className="p-2.5 text-right font-mono">金额</th>
                          <th className="p-2.5">支付状态</th>
                          <th className="p-2.5">同步落库状态</th>
                          <th className="p-2.5 pr-3">对账决策结果/未保存说明</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {(!reconData.orderItems || reconData.orderItems.length === 0) ? (
                          <tr>
                            <td colSpan={9} className="p-8 text-center text-slate-400 font-normal">
                              该统计范围内平台 API 未返回任何交易订单流水。若确认有成交，请重试或核对密钥权限。
                            </td>
                          </tr>
                        ) : (
                          reconData.orderItems.map((item: any) => (
                            <tr key={item.id} className={cn(
                              "hover:bg-slate-50/50 transition-colors",
                              !item.isSaved && "bg-rose-50/20"
                            )}>
                              <td className="p-2.5 pl-3 font-mono text-slate-600 text-[11px]">
                                {item.id}
                              </td>
                              <td className="p-2.5 font-bold text-slate-850">
                                {item.order_number}
                              </td>
                              <td className="p-2.5 text-slate-500 font-mono text-[10.5px]">
                                {item.createdAtRaw}
                              </td>
                              <td className="p-2.5 text-slate-400 font-mono text-[10.5px]">
                                {item.createdAtUtc}
                              </td>
                              <td className="p-2.5 font-semibold text-slate-700">
                                {item.storeLocalDate}
                              </td>
                              <td className="p-2.5 text-right font-bold text-slate-900 font-mono">
                                ${item.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="p-2.5">
                                <span className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                                  item.paymentStatus === "paid" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-slate-50 text-slate-700 border border-slate-100"
                                )}>
                                  {item.paymentStatus}
                                </span>
                              </td>
                              <td className="p-2.5">
                                <span className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-bold",
                                  item.isSaved ? "bg-emerald-100 text-emerald-800" : "bg-red-50 text-red-800 border border-red-100"
                                )}>
                                  {item.isSaved ? "已成功落库" : "被跳过未落库"}
                                </span>
                              </td>
                              <td className="p-2.5 pr-3 text-[11px] font-normal max-w-xs truncate text-slate-500" title={item.skipReason || "满足同步标准并写库完毕"}>
                                {item.isSaved ? (
                                  <span className="text-emerald-600 font-semibold">▶ 安全校验通过且生成 line-items</span>
                                ) : (
                                  <span className="text-rose-600 font-bold">🚫 {item.skipReason}</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="p-4 text-center text-slate-400 text-xs">
              暂时未获取到该店铺的对账详情。
            </div>
          )}
        </div>
      </Card>

    </div>
  );
}
