import React, { useState, useEffect, useMemo, useRef } from "react";
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
import { MetaAccountDisplay } from "./common/MetaAccountDisplay";
import { SyncStatusPanel, type SyncPanelStatus } from "./common/SyncStatusPanel";
import { mapSyncErrorToPanel, mapSyncResultToPanel, triggerSyncTask } from "@/lib/sync-trigger";
import {
  buildDataViewRequestKey,
  isCanceledRequest,
  isDateRangeMismatch,
  shouldApplyLatestRequest
} from "@/lib/data-view-state";

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
  ordersCount: number | null;
  totalSales: number | null;
  totalRefunded: number | null;
  avgOrderValue: number | null;
  aov: number | null;
  adSpend: number | null;
  roas: number | null;
  realRoas: number | null;
  hasMappedAccounts: boolean;
  hasOrders: boolean | null;
  countryCount: number | null;
  productCount: number;
  lastSyncTime: string | null;
  latestFetchedAt?: string | null;
  syncStatus: string;
  syncError: string | null;
  timezoneSource?: string | null;
  temporaryTimezoneFallback?: boolean;
  timezoneNotice?: string | null;
}

interface UnmappedAccountsSummary {
  count: number | null;
  spend: number | null;
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

function formatStoreCurrency(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatStoreOrderText(row: { orderCount?: number | null; ordersCount?: number | null }) {
  const orderCount = row.orderCount ?? row.ordersCount;
  if (orderCount === null || orderCount === undefined) return "未同步";
  return `${Number(orderCount).toLocaleString()} 单`;
}

export function formatStoreSalesText(row: { grossSales?: number | null; totalSales?: number | null }) {
  const grossSales = row.grossSales ?? row.totalSales;
  if (grossSales === null || grossSales === undefined) return "未同步";
  return formatStoreCurrency(Number(grossSales));
}

export function formatStoreAovText(row: { aov?: number | null; avgOrderValue?: number | null }) {
  const aov = row.aov ?? row.avgOrderValue;
  if (aov === null || aov === undefined) return "未同步";
  return formatStoreCurrency(Number(aov));
}

export function getStoreSyncStatusLabel(status: string | null | undefined) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "READY" || normalized === "COVERED" || normalized === "SUCCESS" || normalized === "SUCCESSFUL") return "已同步";
  if (normalized === "NO_NEW_DATA") return "已同步，无新数据";
  if (normalized === "PARTIAL_SUCCESS" || normalized === "PARTIAL_COVERAGE") return "部分完成";
  if (normalized === "RUNNING" || normalized === "PENDING") return "同步中";
  if (normalized === "FAILED" || normalized === "ERROR") return "同步失败";
  if (normalized === "NONE" || !normalized) return "未同步";
  return "状态待确认";
}

export function getStoreTimezoneNotice(row: {
  timezoneSource?: string | null;
  temporaryTimezoneFallback?: boolean | null;
  timezoneNotice?: string | null;
}) {
  if (row.timezoneSource === "system_default" || row.temporaryTimezoneFallback === true) {
    return row.timezoneNotice || "店铺未提供时区，当前按系统时区统计。";
  }
  return null;
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
  status?: string;
  difference?: {
    orderCount?: number;
    grossSales?: number;
  };
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

export function hasReconciliationMismatch(data: Pick<ReconciliationData, "status" | "difference" | "diff" | "canonicalLedger" | "orderFact"> | null | undefined) {
  if (!data) return false;
  const status = String(data.status || "").toUpperCase();
  if (status && status !== "MATCHED" && status !== "TRUE_EMPTY") return true;
  if (Math.abs(Number(data.difference?.orderCount || 0)) > 0) return true;
  if (Math.abs(Number(data.difference?.grossSales || 0)) > 0.01) return true;
  if (data.orderFact && data.canonicalLedger && data.orderFact.uniqueOrderCount !== data.canonicalLedger.orderCount) return true;
  const diff: any = data.diff || {};
  return (
    (diff.orderFactNotInLedger?.length || 0) > 0 ||
    (diff.ledgerNotInOrderFact?.length || 0) > 0 ||
    (diff.apiSavedNotInLedger?.length || 0) > 0 ||
    (diff.amountMismatch?.length || 0) > 0
  );
}

interface OrderConsistencyAnomaly {
  orderNumber: string;
  anomalyType: string;
  description: string;
  suggestion: string;
}

interface OrderConsistencyView {
  orderCountText: string;
  salesAmountText: string;
  statusLabel: string;
  statusTone: "success" | "warning";
  lastCheckedText: string;
  ledgerOrderCountText: string;
  orderFactCountText: string;
  orderCountDifferenceText: string;
  grossSalesDifferenceText: string;
  anomalyOrderCountText: string;
  amountConsistencyText: string;
  differenceText: string;
  resultMessage: string;
  anomalies: OrderConsistencyAnomaly[];
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function formatOrderCountValue(value: unknown) {
  return toFiniteNumber(value).toLocaleString();
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).slice(0, 10);
  }
  return format(parsed, "yyyy-MM-dd");
}

function buildDiffAnomalyRows(diff: ReconciliationData["diff"] | undefined): OrderConsistencyAnomaly[] {
  if (!diff) return [];
  const rows: OrderConsistencyAnomaly[] = [];
  const addRows = (
    items: any[] | undefined,
    anomalyType: string,
    description: string,
    suggestion: string
  ) => {
    (items || []).forEach((item) => {
      rows.push({
        orderNumber: String(item.orderNumber || item.order_number || item.orderId || item.id || "整体订单"),
        anomalyType,
        description,
        suggestion
      });
    });
  };

  addRows(
    diff.amountMismatch,
    "订单金额异常",
    "该订单的销售金额与系统汇总金额不一致。",
    "请优先核对订单实收金额、退款记录与所选日期范围。"
  );
  addRows(
    diff.orderFactNotInLedger,
    "订单状态异常",
    "该订单未进入当前销售汇总。",
    "请确认订单是否已最终付款，以及付款日期是否属于当前范围。"
  );
  addRows(
    diff.ledgerNotInOrderFact,
    "订单同步异常",
    "销售汇总中存在一笔未能在订单明细中对应的订单。",
    "请重新校验该日期范围，必要时联系技术支持复核同步任务。"
  );
  addRows(
    diff.apiSavedNotInLedger,
    "订单归属异常",
    "该订单已保存，但未纳入当前销售汇总。",
    "请确认订单付款状态与付款日期是否符合统计口径。"
  );
  addRows(
    diff.excludedByPaymentStatus,
    "付款状态异常",
    "该订单付款状态不满足成功付款标准。",
    "请核对平台后台付款状态；未成功付款订单不计入销售。"
  );
  addRows(
    diff.excludedByLocalDate,
    "日期归属异常",
    "该订单不属于当前选择的销售日期范围。",
    "请切换到订单最终付款日期所在范围后再次查看。"
  );

  return rows;
}

export function buildOrderConsistencyView(data: ReconciliationData | null | undefined): OrderConsistencyView {
  const orderCount = toFiniteNumber(data?.canonicalLedger?.orderCount ?? data?.systemOrdersCount);
  const salesAmount = toFiniteNumber(data?.canonicalLedger?.grossSales ?? data?.systemSalesAmount);
  const ledgerOrderCount = toFiniteNumber(data?.canonicalLedger?.orderCount ?? orderCount);
  const orderFactOrderCount = toFiniteNumber(data?.orderFact?.uniqueOrderCount ?? ledgerOrderCount);
  const grossSalesDifference = toFiniteNumber(
    data?.difference?.grossSales ??
    (data?.orderFact && data?.canonicalLedger
      ? data.canonicalLedger.grossSales - data.orderFact.orderTotalSum
      : 0)
  );
  const orderCountDifference = toFiniteNumber(data?.difference?.orderCount ?? (ledgerOrderCount - orderFactOrderCount));
  const anomalies = buildDiffAnomalyRows(data?.diff);
  const anomalyOrderIds = new Set(
    anomalies
      .map((item) => item.orderNumber)
      .filter((value) => value && !value.includes("鏁翠綋"))
  );

  if (Math.abs(orderCountDifference) > 0) {
    anomalies.unshift({
      orderNumber: "整体订单数量",
      anomalyType: "订单数量不一致",
      description: "平台确认订单数量与系统订单数量不一致。",
      suggestion: "请确认日期范围是否正确，必要时重新执行官方校验。"
    });
  }

  if (Math.abs(grossSalesDifference) > 0.01) {
    anomalies.unshift({
      orderNumber: "整体销售金额",
      anomalyType: "销售金额不一致",
      description: "平台确认销售金额与系统销售金额不一致。",
      suggestion: "请核对异常订单列表中的金额与退款记录。"
    });
  }

  const hasMismatch = hasReconciliationMismatch(data);
  const hasAnomalies = hasMismatch || anomalies.length > 0;
  const lastCheckedText = formatDateOnly(data?.lastSyncTime) || data?.endDate || "未校验";

  return {
    orderCountText: `${formatOrderCountValue(orderCount)} 单`,
    salesAmountText: formatStoreCurrency(salesAmount),
    statusLabel: hasAnomalies ? "⚠ 存在异常" : "✓ 已同步",
    statusTone: hasAnomalies ? "warning" : "success",
    lastCheckedText,
    ledgerOrderCountText: formatOrderCountValue(ledgerOrderCount),
    orderFactCountText: formatOrderCountValue(orderFactOrderCount),
    orderCountDifferenceText: formatOrderCountValue(orderCountDifference),
    grossSalesDifferenceText: Math.abs(grossSalesDifference) <= 0.01 ? "涓€鑷?" : `鐩稿樊 ${formatStoreCurrency(Math.abs(grossSalesDifference))}`,
    anomalyOrderCountText: formatOrderCountValue(anomalyOrderIds.size),
    amountConsistencyText: Math.abs(grossSalesDifference) <= 0.01 ? "涓€鑷?" : `鐩稿樊 ${formatStoreCurrency(Math.abs(grossSalesDifference))}`,
    differenceText: formatOrderCountValue(orderCountDifference),
    resultMessage: hasAnomalies ? `发现 ${anomalies.length} 笔订单异常，请检查` : "✓ 当前订单数据校验通过",
    anomalies
  };
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
  const [storeCoverage, setStoreCoverage] = useState<any | null>(null);
  const [metaCoverage, setMetaCoverage] = useState<any | null>(null);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("totalSales");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [unmappedExpanded, setUnmappedExpanded] = useState<boolean>(false);
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [viewSyncStatus, setViewSyncStatus] = useState<SyncPanelStatus>({ status: "idle" });

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
  const currentRequestKey = buildDataViewRequestKey({
    page: "stores",
    startDate: formattedStartDate,
    endDate: formattedEndDate,
    scope: "all_stores"
  });
  const latestRequestIdRef = useRef(0);
  const latestRequestKeyRef = useRef(currentRequestKey);
  const requestAbortRef = useRef<AbortController | null>(null);
  latestRequestKeyRef.current = currentRequestKey;
  const reconRequestIdRef = useRef(0);
  const reconRequestKeyRef = useRef("");
  const reconAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setViewNotice(null);
    setViewSyncStatus({ status: "idle" });
  }, [currentRequestKey]);

  // 1. Fetch Store Metrics and Summaries
  const fetchStoresData = async (silent = false) => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    const sourceRequestKey = currentRequestKey;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const isCurrent = () => shouldApplyLatestRequest({
      requestId,
      latestRequestId: latestRequestIdRef.current,
      sourceRequestKey,
      latestRequestKey: latestRequestKeyRef.current
    });
    if (!silent) setLoading(true);
    if (!silent) {
      setStores([]);
      setUnmappedSummary({ count: 0, spend: 0, message: "" });
      setAppliedDateRange(null);
      setStoreCoverage(null);
      setMetaCoverage(null);
      setViewNotice(null);
    }
    try {
      const response = await axios.get("/api/data-center/stores", {
        params: {
          startDate: formattedStartDate,
          endDate: formattedEndDate,
          platformProbe: true
        },
        signal: controller.signal
      });
      if (!isCurrent()) return;
      
      if (isDateRangeMismatch(response.data, formattedStartDate, formattedEndDate)) {
        setStores([]);
        setUnmappedSummary({ count: 0, spend: 0, message: "" });
        setDataHealth(response.data?.dataHealth || { status: "DATE_RANGE_MISMATCH", message: "Response date range mismatch" });
        setAppliedDateRange(null);
        setViewNotice("接口返回周期与当前筛选周期不一致，未使用跨周期旧数据。");
        return;
      }

      const { stores: fetchedStores, unmappedAccountsSummary, dataHealth: fetchedHealth } = response.data;
      setStoreCoverage(response.data.storeCoverage || response.data.coverage || null);
      setMetaCoverage(response.data.metaCoverage || null);
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
      if (!isCurrent() || isCanceledRequest(error)) return;
      console.error("Failed to load stores analytics:", error);
      setStores([]);
      setUnmappedSummary({ count: 0, spend: 0, message: "" });
      setDataHealth({ status: "ERROR", message: "当前店铺筛选周期请求失败，未使用旧店铺数据。", warnings: ["FETCH_FAILED_FOR_CURRENT_REQUEST"] });
      setStoreCoverage({ status: "ERROR" });
      setMetaCoverage({ status: "ERROR" });
      setAppliedDateRange({ startDate: formattedStartDate, endDate: formattedEndDate });
      setViewNotice("当前店铺筛选周期请求失败，未展示旧数据。");
      toast.error("加载店铺数据失败: " + getApiErrorMessage(error));
    } finally {
      if (isCurrent() && !silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStoresData();
    return () => requestAbortRef.current?.abort();
  }, [formattedStartDate, formattedEndDate]);

  // 2. Load order reconciliation panel for specific store
  const loadReconciliation = async (store: StoreMetric) => {
    const sourceRequestKey = buildDataViewRequestKey({
      page: "store-reconciliation",
      storeId: store.id,
      startDate: formattedStartDate,
      endDate: formattedEndDate
    });
    reconAbortRef.current?.abort();
    const controller = new AbortController();
    reconAbortRef.current = controller;
    const requestId = ++reconRequestIdRef.current;
    reconRequestKeyRef.current = sourceRequestKey;
    const isCurrent = () => shouldApplyLatestRequest({
      requestId,
      latestRequestId: reconRequestIdRef.current,
      sourceRequestKey,
      latestRequestKey: reconRequestKeyRef.current
    });
    setSelectedStoreForRecon(store);
    setReconData(null);
    setReconLoading(true);
    try {
      const response = await axios.get(`/api/data-center/stores/${store.id}/reconciliation`, {
        params: {
          startDate: formattedStartDate,
          endDate: formattedEndDate
        },
        signal: controller.signal
      });
      if (!isCurrent()) return;
      const responseStoreId = response.data?.storeId ?? response.data?.store?.id;
      const responseDateRange = response.data?.dateRange || response.data?.appliedFilters || {};
      if (
        String(responseStoreId) !== String(store.id)
        || responseDateRange.startDate !== formattedStartDate
        || responseDateRange.endDate !== formattedEndDate
      ) {
        setReconData(null);
        toast.error("Reconciliation response does not match the selected store/date range");
        return;
      }
      setReconData(response.data);

      toast.success("只读校对完成，未执行同步或账目写入。");
    } catch (error: any) {
      if (!isCurrent() || isCanceledRequest(error)) return;
      console.error("Failed to load store reconciliation details:", error);
      toast.error("未获取到校对明细: " + getApiErrorMessage(error));
      setReconData(null);
    } finally {
      if (isCurrent()) setReconLoading(false);
    }
  };

  useEffect(() => {
    reconAbortRef.current?.abort();
    reconRequestIdRef.current += 1;
    reconRequestKeyRef.current = "";
    setSelectedStoreForRecon(null);
    setReconData(null);
    setReconLoading(false);
  }, [formattedStartDate, formattedEndDate]);

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
      totalOrders += Number(s.ordersCount || 0);
      totalSales += Number(s.totalSales || 0);
      totalSpend += Number(s.adSpend || 0);
      totalRefunds += Number(s.totalRefunded || 0);
    });

    const averageAOV = totalOrders > 0 ? totalSales / totalOrders : 0;
    const realGlobalROAS = totalSpend > 0 ? totalSales / totalSpend : 0;

    const visibleCoverageStatuses = ["READY", "COVERED", "SUCCESS", "PARTIAL_COVERAGE", "PARTIAL_SUCCESS", "TRUE_EMPTY"];
    const storeMetricsAvailable = visibleCoverageStatuses.includes(String(storeCoverage?.status).toUpperCase());
    const metaMetricsAvailable = visibleCoverageStatuses.includes(String(metaCoverage?.status).toUpperCase());
    return {
      totalStores,
      totalOrders: storeMetricsAvailable ? totalOrders : null,
      totalSales: storeMetricsAvailable ? totalSales : null,
      averageAOV: storeMetricsAvailable ? averageAOV : null,
      totalSpend: metaMetricsAvailable ? totalSpend : null,
      realGlobalROAS: storeMetricsAvailable && metaMetricsAvailable && totalSpend > 0 ? realGlobalROAS : null
    };
  }, [stores, storeCoverage, metaCoverage]);

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

  const handleSyncStoreData = async () => {
    setSyncing(true);
    const toastId = toast.loading("正在执行店铺视图同步...");
    const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1);

    setViewSyncStatus({
      status: "running",
      message: "正在执行店铺视图同步...",
      progressPercent: 15,
      currentStep: 1,
      totalSteps: 1,
      stepLabel: "店铺视图同步"
    });

    try {
      const result = await triggerSyncTask({
        taskType: "sync_view_store_data",
        startDate: formattedStartDate,
        endDate: formattedEndDate,
        days,
        limit: 200
      });

      const status = String(result?.status || "").toUpperCase();
      setViewSyncStatus(mapSyncResultToPanel(result));

      if (status === "RUNNING") {
        toast.info("已有店铺同步任务正在运行，请稍后刷新查看。", { id: toastId });
        window.setTimeout(() => fetchStoresData(true), 5000);
        return;
      }

      if (status === "NO_NEW_DATA") {
        toast.info("店铺同步完成，但当前日期范围暂无新的店铺订单数据。", { id: toastId });
      } else if (status === "PARTIAL_SUCCESS") {
        toast.warning("店铺同步部分完成，正在刷新已同步数据。", { id: toastId });
      } else {
        toast.success(result.message || "店铺视图同步完成，正在刷新页面数据。", { id: toastId });
      }
      await fetchStoresData(true);
    } catch (error: any) {
      const panel = mapSyncErrorToPanel(error);
      const data = error.data || error.response?.data || error.response;
      setViewSyncStatus(panel);
      if (panel.status === "running") {
        toast.info("已有店铺同步任务正在运行，请稍后刷新查看。", { id: toastId });
        window.setTimeout(() => fetchStoresData(true), 5000);
        return;
      }
      if (panel.status === "success") {
        toast.info(panel.message || "店铺同步完成，当前日期范围暂无新的店铺订单数据。", { id: toastId });
        await fetchStoresData(true);
        return;
      }
      if (panel.status === "warning") {
        toast.warning(panel.message || "店铺同步部分完成，正在刷新已同步数据。", { id: toastId });
        await fetchStoresData(true);
        return;
      }
      toast.error("同步数据失败: " + (panel.message || data?.message || data?.details || data?.error || error.message), { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  const reconciliationView = buildOrderConsistencyView(reconData);

  return (
    <div className="space-y-6">
      
      {/* 🚀 Top Command Controls Dashboard */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <StoreIcon className="w-5 h-5 text-indigo-500 shrink-0" />
          <h3 className="font-bold text-slate-900 truncate">店铺经营数据一览</h3>
          <span className="text-xs text-slate-500">| 当前统计期间：{appliedStartDate} 至 {appliedEndDate}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
            onClick={() => fetchStoresData()}
            disabled={loading || syncing}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            刷新页面数据
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
            onClick={handleSyncStoreData}
            disabled={loading || syncing}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
            同步数据
          </Button>
        </div>
      </div>

      <SyncStatusPanel status={viewSyncStatus} />


      {/* 📊 KPI summary banner */}
      {viewNotice && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {viewNotice}
        </div>
      )}

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
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">店铺订单数</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                {aggregatedStats.totalOrders === null ? "N/A" : <>{aggregatedStats.totalOrders.toLocaleString()} <span className="text-xs font-normal text-slate-400">单</span></>}
              </h3>
              <ShoppingBag className="w-4 h-4 text-emerald-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">店铺销售额</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-emerald-600 tracking-tight">
                {aggregatedStats.totalSales === null ? "N/A" : formatStoreCurrency(aggregatedStats.totalSales)}
              </h3>
              <Coins className="w-4 h-4 text-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">平均订单金额</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                {aggregatedStats.averageAOV === null ? "N/A" : formatStoreCurrency(aggregatedStats.averageAOV)}
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
                {aggregatedStats.totalSpend === null ? "N/A" : formatStoreCurrency(aggregatedStats.totalSpend)}
              </h3>
              <SpendIcon className="w-4 h-4 text-indigo-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] bg-white rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between min-h-[96px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">店铺 ROAS</span>
            <div className="flex items-center justify-between mt-2">
              <h3 className="text-md font-extrabold text-indigo-600 tracking-tight">
                {aggregatedStats.realGlobalROAS === null ? "N/A" : `${aggregatedStats.realGlobalROAS.toFixed(2)}x`}
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
              {dataHealth.message || "已配置店铺会继续显示在下方列表中；店铺订单数、店铺销售额和 AOV 在事实表为空时按 0 展示。"}
            </p>
            {dataHealth.lastFailedSync?.errorMessage && (
              <p className="text-rose-700 leading-relaxed">
                最近失败原因：{dataHealth.lastFailedSync.errorMessage}
              </p>
            )}
          </div>
        </div>
      )}

      <Card className="border border-slate-200 shadow-sm bg-white rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-slate-50/50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <StoreIcon className="w-4 h-4 text-indigo-500" />
            <span className="font-bold text-[14px] text-slate-900">店铺列表</span>
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
                  <TableHead className="font-semibold text-center py-3 px-5 text-slate-600">订单同步</TableHead>
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
                    const orderSyncTime = store.lastSyncTime || store.latestFetchedAt || null;
                    const normalizedSyncStatus = String(store.syncStatus || "").trim().toUpperCase();
                    const hasSyncTime = !!orderSyncTime;
                    
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
                            {formatStoreOrderText({ ordersCount: store.ordersCount })}
                          </TableCell>

                          {/* 销售额 */}
                          <TableCell className="text-right text-slate-950 font-mono font-extrabold text-[13px]">
                            {formatStoreSalesText({ totalSales: store.totalSales })}
                          </TableCell>

                          {/* AOV */}
                          <TableCell className="text-right text-slate-600 font-mono font-medium">
                            {formatStoreAovText({ avgOrderValue: store.avgOrderValue })}
                          </TableCell>

                          {/* 账户开销 */}
                          <TableCell className="text-right text-slate-700 font-mono font-bold">
                            {store.adSpend === null ? "N/A" : store.adSpend > 0 ? (
                              formatStoreCurrency(store.adSpend)
                            ) : (
                              <span className="text-[11px] text-slate-400 font-normal">—</span>
                            )}
                          </TableCell>

                          {/* ROAS 分别渲染无绑定、无订单、异常和真实ROAS */}
                          <TableCell className="text-right py-3 px-5">
                            {(store.realRoas === null && (store.adSpend === null || store.totalSales === null)) ? (
                              <span className="text-slate-400 text-[11px]">N/A</span>
                            ) : (!store.hasMappedAccounts) ? (
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
                                {hasSyncTime ? format(new Date(orderSyncTime!), "MM-dd HH:mm") : (normalizedSyncStatus === "NONE" || !normalizedSyncStatus ? "未进行同步" : "")}
                              </p>
                              <div className="text-center">
                                <span className={cn(
                                  "inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold",
                                  ["SUCCESS", "SUCCESSFUL", "READY", "COVERED"].includes(normalizedSyncStatus) && "bg-emerald-50 text-emerald-700 border border-emerald-100",
                                  ["FAILED", "ERROR"].includes(normalizedSyncStatus) && "bg-rose-50 text-rose-700 border border-rose-100",
                                  ["RUNNING", "PENDING"].includes(normalizedSyncStatus) && "bg-blue-50 text-blue-700 border border-blue-100 animate-pulse",
                                  ["NONE", ""].includes(normalizedSyncStatus) && "bg-slate-100 text-slate-500",
                                  ["PARTIAL_SUCCESS", "PARTIAL_COVERAGE"].includes(normalizedSyncStatus) && "bg-amber-50 text-amber-700 border border-amber-100"
                                )}>
                                  {getStoreSyncStatusLabel(store.syncStatus)}
                                </span>
                              </div>
                              {getStoreTimezoneNotice(store) && (
                                <p className="max-w-[160px] text-[10px] leading-snug text-slate-500 text-center">
                                  {getStoreTimezoneNotice(store)}
                                </p>
                              )}
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

  {/* Row 5: operational order consistency check */}
  <Card className="border border-slate-200 shadow-sm bg-white rounded-xl overflow-hidden">
    <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <StoreIcon className="w-4.5 h-4.5 text-slate-600" />
        <h4 className="font-bold text-slate-900 text-[13.5px]">订单数据一致性检查</h4>
      </div>
          {selectedStoreForRecon ? (
            <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
              当前店铺：{selectedStoreForRecon.name}
            </span>
          ) : (
            <span className="text-xs text-slate-500">选择店铺后查看订单校验结果</span>
          )}
        </div>

        <div className="p-5">
          {!selectedStoreForRecon ? (
            <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
              <span className="p-3 bg-white text-slate-400 rounded-full shadow-sm mb-3">
                <StoreIcon className="w-6 h-6" />
              </span>
              <p className="text-xs font-bold text-slate-700">尚未选择店铺</p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm leading-normal">
                请在上方店铺列表中选择需要查看的店铺，系统会展示该日期范围内的订单数量、销售金额和异常订单。
              </p>
            </div>
          ) : reconLoading ? (
            <div className="flex flex-col items-center justify-center p-12 space-y-3">
              <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-500 font-bold">订单数据校验中，请稍候...</p>
            </div>
          ) : reconData ? (
            <div className="space-y-5">
              
              {/* Comparitive metrics view */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-slate-500 font-bold block">订单数量</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-indigo-900 font-mono">
                      {reconciliationView.orderCountText}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-slate-500 font-bold block">销售金额</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-indigo-950 font-mono">
                      {reconciliationView.salesAmountText}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-slate-500 font-bold block">数据状态</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-slate-700 font-mono">
                      {reconciliationView.statusLabel}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-[10px] text-slate-500 font-bold block">最后校验时间</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-slate-700 font-mono">
                      {reconciliationView.lastCheckedText}
                    </span>
                  </div>
                </div>

              </div>

              <div className={cn(
                "p-3 rounded-lg border text-xs font-bold flex items-center gap-2",
                reconciliationView.statusTone === "success"
                  ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                  : "bg-amber-50 border-amber-100 text-amber-700"
              )}>
                {reconciliationView.statusTone === "warning" && <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span>{reconciliationView.resultMessage}</span>
              </div>

              <div className="space-y-3 pt-2">
                <h5 className="font-bold text-slate-900 text-xs">校验结果</h5>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <span className="text-[10px] text-slate-500 font-bold block">账目汇总订单数</span>
                    <div className="mt-1 text-lg font-extrabold text-slate-900 font-mono">
                      {reconciliationView.ledgerOrderCountText}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <span className="text-[10px] text-slate-500 font-bold block">有效订单明细数</span>
                    <div className="mt-1 text-lg font-extrabold text-slate-900 font-mono">
                      {reconciliationView.orderFactCountText}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <span className="text-[10px] text-slate-500 font-bold block">订单数差异</span>
                    <div className="mt-1 text-lg font-extrabold text-slate-900 font-mono">
                      {reconciliationView.orderCountDifferenceText}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <span className="text-[10px] text-slate-500 font-bold block">销售额差异</span>
                    <div className="mt-1 text-lg font-extrabold text-slate-900 font-mono">
                      {reconciliationView.grossSalesDifferenceText}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <span className="text-[10px] text-slate-500 font-bold block">异常订单数量</span>
                    <div className={cn(
                      "mt-1 text-lg font-extrabold font-mono",
                      reconciliationView.anomalies.length === 0 ? "text-emerald-700" : "text-amber-700"
                    )}>
                      {reconciliationView.anomalyOrderCountText}
                    </div>
                  </div>
                </div>
              </div>

              {/* Business anomaly orders */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <span>异常订单</span>
                </h5>

                {reconciliationView.anomalies.length === 0 ? (
                  <div className="p-5 rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700 text-xs font-bold text-center">
                    ✓ 未发现异常订单
                  </div>
                ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <div className="max-h-[300px] overflow-y-auto text-xs">
                    <table className="w-full text-left border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-semibold text-[10px] tracking-wider">
                          <th className="p-2.5 pl-3">订单编号</th>
                          <th className="p-2.5">异常类型</th>
                          <th className="p-2.5">说明</th>
                          <th className="p-2.5 pr-3">处理建议</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {reconciliationView.anomalies.map((item, index) => (
                          <tr key={`${item.orderNumber}-${item.anomalyType}-${index}`} className="hover:bg-amber-50/30 transition-colors">
                            <td className="p-2.5 pl-3 font-mono text-slate-800 text-[11px] font-bold">{item.orderNumber}</td>
                            <td className="p-2.5 text-amber-700 font-bold">{item.anomalyType}</td>
                            <td className="p-2.5 text-slate-600">{item.description}</td>
                            <td className="p-2.5 pr-3 text-slate-600">{item.suggestion}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                )}
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
