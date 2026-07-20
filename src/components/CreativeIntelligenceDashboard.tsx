import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { 
  ArrowUpDown, 
  Download, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  Activity,
  Image as ImageIcon,
  Video,
  Layers,
  Sparkles,
  BarChart2,
  Calendar,
  Search,
  Check,
  ChevronRight,
  RefreshCcw,
  RefreshCw,
  Clock,
  Zap,
  Maximize2,
  XCircle,
  TrendingUp as TrendUpIcon,
  Award,
  DollarSign,
  ExternalLink,
  Percent,
  Info,
  ChevronLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { toast } from "sonner";
import axios from "axios";
import { MetaAccountDisplay, cleanAccountId, metaAccountOptionLabel } from "./common/MetaAccountDisplay";
import { SyncStatusPanel, type SyncPanelStatus } from "./common/SyncStatusPanel";
import { DataViewTraceBar } from "./common/DataViewTraceBar";
import { DataCoverageBanner } from "./common/DataCoverageBanner";
import { mapSyncErrorToPanel, mapSyncResultToPanel, triggerSyncTask, type SyncTaskPayload } from "@/lib/sync-trigger";
import {
  isCanceledRequest,
  shouldApplyLatestRequest
} from "@/lib/data-view-state";
import { cn } from "@/lib/utils";
import type { CreativeIntelligenceRow } from "../shared/creative-intelligence-contract";
import {
  buildCreativeAiPrompt,
  buildCreativeAiRequestKey,
  buildCreativeAnalysisRequest,
  buildCreativeDashboardRequestKey,
  buildCreativeSelectionScopeKey,
  compareNullable,
  formatCreativeAnalysisDataBasis,
  isCreativeAiAllowed,
  resolveCreativeFilterCascade,
  resolveCreativeAnalysisResponse,
  resolveCreativeDashboardResponse
} from "./creative-dashboard-orchestrator";
type CreativeData = CreativeIntelligenceRow & {
  storeId: number | null;
  creativeName: string | null;
  revenue: number;
  purchase_value?: number;
  fb_account_name?: string;
  adName?: string;
  frequencyAvailable?: boolean;
  reachAvailable?: boolean;
  addToCartAvailable?: boolean;
  productLinkAvailable?: boolean;
  hookRateAvailable?: boolean;
  aiRiskStatus?: string;
  trendStatus?: string;
  aiSuggestion?: string;
  syncedAt?: string | null;
};

interface FatigueDetails {
  creativeId: string;
  creativeName: string;
  type: string;
  fatigueScore: number | null;
  riskLevel: string;
  riskColor: string;
  riskBg: string;
  rulesTriggered: string[];
  recommendations: string[];
}

export interface CreativePageState {
  performanceRows: CreativeData[];
  structureOnlyRows: any[];
  summary: any | null;
  structureSummary: any | null;
  bucketSummary: Record<string, number>;
  coverage: any | null;
  pagination: any | null;
}

export function resolveCreativePageState(payload: any): CreativePageState {
  const coverage = payload?.coverage || null;
  const status = String(coverage?.status || "NOT_SYNCED").toUpperCase();
  const performanceRows = (payload?.performanceRows || payload?.data || []).map((item: any) => ({
    ...item,
    type: item.type || "IMAGE"
  }));

  if (status === "ERROR") {
    return {
      performanceRows: [],
      structureOnlyRows: [],
      summary: null,
      structureSummary: null,
      bucketSummary: {},
      coverage,
      pagination: null
    };
  }

  return {
    performanceRows,
    structureOnlyRows: payload?.structureOnlyRows || [],
    summary: payload?.summary || null,
    structureSummary: payload?.structureSummary || null,
    bucketSummary: payload?.bucketSummary || {},
    coverage,
    pagination: payload?.pagination ? {
      ...payload.pagination,
      pageRowCount: payload?.pageRowCount,
      filteredTotalCount: payload?.filteredTotalCount
    } : null
  };
}

function formatNullableMetric(value: number | null | undefined, digits: number, suffix = "", prefix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${prefix}${value.toFixed(digits)}${suffix}`
    : "N/A";
}

function formatCreativeRiskScore(value: number | null | undefined) {
  return value === null || value === undefined ? "N/A" : `${value} / 100 分`;
}

export function formatCreativeAiConfidence(confidence: string | null | undefined) {
  if (confidence === "partial") return "\u90e8\u5206\u8986\u76d6";
  if (confidence === "full") return "\u5b8c\u6574\u8986\u76d6";
  return "\u672a\u77e5";
}

export function normalizeAiReportList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split("\n").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function getCreativePreviewSources(row: Pick<CreativeData, "imageUrl" | "previewUrl">) {
  return Array.from(new Set([row.imageUrl, row.previewUrl].filter(Boolean))) as string[];
}

export function CreativePreviewMedia({
  row,
  compact = false
}: {
  row: Pick<CreativeData, "creativeId" | "creativeName" | "type" | "imageUrl" | "previewUrl">;
  compact?: boolean;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const sources = useMemo(() => getCreativePreviewSources(row), [row.imageUrl, row.previewUrl]);

  useEffect(() => {
    setSourceIndex(0);
  }, [row.creativeId, row.imageUrl, row.previewUrl]);

  const source = sources[sourceIndex] || null;
  const isDirectVideo = Boolean(source) && /\.(mp4|webm|ogg)(\?|#|$)/i.test(String(source));

  if (row.type === "VIDEO" && source && isDirectVideo) {
    return (
      <video
        data-testid="creative-video-preview"
        src={source}
        controls={!compact}
        preload="metadata"
        className="h-full w-full object-cover"
        onError={() => setSourceIndex((current) => current + 1)}
      />
    );
  }

  if (source) {
    return (
      <img
        data-testid="creative-image-preview"
        src={source}
        alt={row.creativeName || "creative preview"}
        className="h-full w-full object-cover"
        referrerPolicy="no-referrer"
        onError={() => setSourceIndex((current) => current + 1)}
      />
    );
  }

  return (
    <div
      data-testid="creative-preview-unavailable"
      className="flex h-full min-h-24 w-full items-center justify-center rounded bg-slate-50 text-xs text-slate-500"
    >
      Creative preview unavailable
    </div>
  );
}

export function CreativeAiReportPanel({ aiReport }: { aiReport: any }) {
  const facts = normalizeAiReportList(aiReport?.facts);
  const riskPoints = normalizeAiReportList(aiReport?.riskPoints);
  const recommendedActions = normalizeAiReportList(aiReport?.recommendedActions);
  const warnings = normalizeAiReportList(aiReport?.warnings);
  const basis = aiReport ? formatCreativeAnalysisDataBasis(aiReport) : [];

  return (
    <div className="space-y-4 text-xs">
      <section data-testid="creative-ai-conclusion" className="space-y-1 bg-white p-3 rounded-lg border border-indigo-50 leading-relaxed text-slate-700">
        <p className="text-[10px] font-bold text-indigo-600">Conclusion</p>
        <p className="text-xs text-slate-800">{aiReport.conclusion}</p>
      </section>

      <section data-testid="creative-ai-facts" className="space-y-1 bg-white p-3 rounded-lg border border-slate-100 leading-relaxed text-slate-600">
        <p className="text-[10px] font-bold text-slate-600">Facts</p>
        {facts.length === 0 ? (
          <p className="text-xs text-slate-500">No fact items are available for this report.</p>
        ) : (
          <ul className="list-disc pl-4 text-xs text-slate-600">
            {facts.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1 bg-white p-3 rounded-lg border border-slate-100 leading-relaxed text-slate-600">
        <p className="text-[10px] font-bold text-slate-600">Data basis</p>
        <ul className="list-disc pl-4 text-xs text-slate-600">
          {basis.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-1.5 bg-red-50/50 p-3 rounded-lg border border-red-100/50 leading-relaxed text-slate-700">
        <p className="text-[10px] font-bold text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          Risk points
        </p>
        {riskPoints.length === 0 ? (
          <p className="text-xs text-slate-500">No clear high-risk item was detected by the current rules.</p>
        ) : (
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
            {riskPoints.map((item) => (
              <li key={item} className="font-medium">{item}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1.5 bg-emerald-50/50 p-3 rounded-lg border border-emerald-100/50 leading-relaxed text-slate-700">
        <p className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
          <Zap className="w-3.5 h-3.5" />
          Recommended actions
        </p>
        {recommendedActions.length === 0 ? (
          <p className="text-xs text-slate-500">No additional recommended action is available.</p>
        ) : (
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
            {recommendedActions.map((item) => (
              <li key={item} className="font-medium">{item}</li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="creative-ai-coverage" className="space-y-2 bg-white p-3 rounded-lg border border-slate-100 leading-relaxed text-slate-600">
        <div className="flex gap-2 flex-wrap">
          <span>Coverage: {aiReport.coverageStatus || "UNKNOWN"}</span>
          <span>Confidence: {formatCreativeAiConfidence(aiReport.confidence)}</span>
        </div>
        {warnings.length > 0 && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            {warnings.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function CreativeIntelligenceDashboard({ 
  data, 
  startDate, 
  endDate,
  onStartDateChange,
  onEndDateChange,
  storeFilter = "all",
  projectFilter = "all",
  ownerFilter = "all"
}: { 
  data: any[], 
  startDate?: Date, 
  endDate?: Date,
  onStartDateChange?: (date: Date) => void,
  onEndDateChange?: (date: Date) => void,
  storeFilter?: string,
  projectFilter?: string,
  ownerFilter?: string
}) {
  const navigate = useNavigate();
  const [activeSubTab, setActiveSubTab] = useState<"preview" | "metrics" | "trends">("preview");
  const [searchTerm, setSearchTerm] = useState("");
  const [performanceRows, setPerformanceRows] = useState<CreativeData[]>([]);
  const [structureOnlyRows, setStructureOnlyRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [structureSummary, setStructureSummary] = useState<any>(null);
  const [bucketSummary, setBucketSummary] = useState<Record<string, number>>({});
  const [coverage, setCoverage] = useState<any>(null);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const creatives = performanceRows;
  const [selectedAccountFilter, setSelectedAccountFilter] = useState("all");
  const [selectedCampaignFilter, setSelectedCampaignFilter] = useState("all");
  const [selectedAdsetFilter, setSelectedAdsetFilter] = useState("all");
  const [storesList, setStoresList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncPanelStatus>({ status: "idle" });
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [responseDateRange, setResponseDateRange] = useState<{ startDate: string; endDate: string; timezone?: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [creativeDataHealth, setCreativeDataHealth] = useState<any>(null);
  const [filterOptions, setFilterOptions] = useState<any>({
    storeOptions: [],
    accountOptions: [],
    campaignOptions: [],
    adsetOptions: [],
    creativeTypeOptions: []
  });

  function resolveSelectedStoreId() {
    if (localStoreFilter === "all") return "all";
    return /^\d+$/.test(localStoreFilter) ? Number(localStoreFilter) : null;
  }

  const handleSyncCreatives = async () => {
    setSyncing(true);
    const syncToast = toast.loading("正在同步数据...");
    setSyncStatus({
      status: "running",
      message: "正在同步 Meta 素材结构与素材表现数据...",
      progressPercent: 15,
      currentStep: 1,
      totalSteps: 3,
      stepLabel: "素材结构同步：1 / 3",
      processedAccounts: 0,
      totalAccounts: selectedAccountFilter !== "all" ? 1 : null
    });

    try {
      const startStr = startDate ? format(startDate, "yyyy-MM-dd") : format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd");
      const endStr = endDate ? format(endDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
      const selectedStoreId = resolveSelectedStoreId();
      if (localStoreFilter !== "all" && selectedStoreId === null) {
        toast.warning("店铺筛选尚未解析，未启动素材同步。", { id: syncToast });
        setSyncStatus({ status: "warning", message: "STORE_FILTER_UNRESOLVED" });
        return;
      }

      const payload: SyncTaskPayload = {
        taskType: "sync_view_creatives",
        startDate: startStr,
        endDate: endStr,
        days: Math.max(1, Math.ceil((new Date(endStr).getTime() - new Date(startStr).getTime()) / 86400000) + 1),
        limit: 200
      };
      if (selectedAccountFilter !== "all") {
        payload.accountId = selectedAccountFilter;
      }
      if (selectedStoreId !== "all" && selectedStoreId !== null) {
        payload.storeId = selectedStoreId;
      }

      const result = await triggerSyncTask(payload);
      const status = String(result?.status || "").toUpperCase();
      setSyncStatus(mapSyncResultToPanel(result));

      if (status === "RUNNING") {
        toast.info("已有素材同步任务正在运行，请稍后刷新查看。", { id: syncToast });
        window.setTimeout(() => fetchCreatives(), 5000);
        return;
      }

      if (status === "NO_NEW_DATA") {
        toast.info("素材同步完成，但当前日期范围暂无新的素材成效数据。", { id: syncToast });
      } else if (status === "PARTIAL_SUCCESS") {
        toast.warning("素材同步部分完成，正在刷新已同步数据。", { id: syncToast });
      } else {
        toast.success("素材视图同步完成，正在刷新数据。", { id: syncToast });
      }
      await fetchCreatives();
    } catch (err: any) {
      const panel = mapSyncErrorToPanel(err);
      setSyncStatus(panel);
      if (panel.status === "running") {
        toast.info("已有素材同步任务正在运行，请稍后刷新查看。", { id: syncToast });
        window.setTimeout(() => fetchCreatives(), 5000);
        return;
      }
      if (panel.status === "success") {
        toast.info(panel.message || "素材同步完成，当前日期范围暂无新的素材成效数据。", { id: syncToast });
        await fetchCreatives();
        return;
      }
      if (panel.status === "warning") {
        toast.warning(panel.message || "素材同步部分完成，正在刷新已同步数据。", { id: syncToast });
        await fetchCreatives();
        return;
      }
      toast.error("素材同步失败：" + (panel.message || err?.data?.message || err?.response?.data?.message || err.message), { id: syncToast });
    } finally {
      setSyncing(false);
    }
  };
  
  // Local store filter state
  const [localStoreFilter, setLocalStoreFilter] = useState("all");

  useEffect(() => {
    if (storeFilter) {
      setLocalStoreFilter(storeFilter);
    }
  }, [storeFilter]);

  // Format Filter
  const [selectedType, setSelectedType] = useState<string>("ALL");

  // Preview Modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [selectedPreviewCreative, setSelectedPreviewCreative] = useState<CreativeData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<any>(null);

  // Sorting state for (1)素材预览设置
  const [previewSortField, setPreviewSortField] = useState<string>("opsScore");
  const [previewSortOrder, setPreviewSortOrder] = useState<"asc" | "desc">("desc");

  // Sorting state for (2)素材表现指标
  const [metricsSortField, setMetricsSortField] = useState<string>("spend");
  const [metricsSortOrder, setMetricsSortOrder] = useState<"asc" | "desc">("desc");
  const creativeBuckets = [
    { id: "all", label: "全部素材" },
    { id: "scale_candidate", label: "扩量候选" },
    { id: "high_ctr_test", label: "高点击测试" },
    { id: "watching", label: "观察中" },
    { id: "fatigue_warning", label: "低回报风险" },
    { id: "inefficient_stop", label: "低效止损" }
  ] as const;
  const [activeOpsBucket, setActiveOpsBucket] = useState<string>("all");
  const startStrKey = startDate ? format(startDate, "yyyy-MM-dd") : "";
  const endStrKey = endDate ? format(endDate, "yyyy-MM-dd") : "";
  const serverRequestKey = buildCreativeDashboardRequestKey({
    startDate: startStrKey,
    endDate: endStrKey,
    storeId: localStoreFilter,
    accountId: selectedAccountFilter,
    campaignId: selectedCampaignFilter,
    adsetId: selectedAdsetFilter,
    type: selectedType,
    bucket: activeOpsBucket,
    search: searchTerm,
    page,
    pageSize,
    sortBy: `${metricsSortField} ${metricsSortOrder.toUpperCase()}`,
    includeZeroSpend: true
  });
  const creativeRequestIdRef = useRef(0);
  const creativeRequestKeyRef = useRef(serverRequestKey);
  const creativeAbortRef = useRef<AbortController | null>(null);
  creativeRequestKeyRef.current = serverRequestKey;
  const aiRequestIdRef = useRef(0);
  const aiRequestKeyRef = useRef("");
  const aiAbortRef = useRef<AbortController | null>(null);
  const creativeSelectionScopeKey = useMemo(
    () =>
      buildCreativeSelectionScopeKey({
        startDate: startStrKey,
        endDate: endStrKey,
        storeId: localStoreFilter,
        accountId: selectedAccountFilter,
        campaignId: selectedCampaignFilter,
        adsetId: selectedAdsetFilter,
        type: selectedType,
        bucket: activeOpsBucket,
        search: searchTerm
      }),
    [
      startStrKey,
      endStrKey,
      localStoreFilter,
      selectedAccountFilter,
      selectedCampaignFilter,
      selectedAdsetFilter,
      selectedType,
      activeOpsBucket,
      searchTerm
    ]
  );
  const creativeAiRequestKey = useMemo(() => buildCreativeAiRequestKey(selectedPreviewCreative, {
    startDate: startStrKey,
    endDate: endStrKey,
    coverageStatus: String(coverage?.status || "")
  }), [selectedPreviewCreative, startStrKey, endStrKey, coverage?.status]);

  useEffect(() => {
    aiAbortRef.current?.abort();
    aiRequestIdRef.current += 1;
    aiRequestKeyRef.current = "";
    setAiReport(null);
    setAiLoading(false);
    setPreviewModalOpen(false);
    setSelectedPreviewCreative(null);
  }, [creativeSelectionScopeKey]);

  // Scroll Synchronization Refs & State
  const previewContainerRef = React.useRef<HTMLDivElement>(null);
  const metricsContainerRef = React.useRef<HTMLDivElement>(null);
  const previewScrollBarRef = React.useRef<HTMLDivElement>(null);
  const metricsScrollBarRef = React.useRef<HTMLDivElement>(null);

  const [previewScrollWidth, setPreviewScrollWidth] = React.useState(0);
  const [metricsScrollWidth, setMetricsScrollWidth] = React.useState(0);

  React.useEffect(() => {
    const updateWidths = () => {
      if (previewContainerRef.current) {
        setPreviewScrollWidth(previewContainerRef.current.scrollWidth);
      }
      if (metricsContainerRef.current) {
        setMetricsScrollWidth(metricsContainerRef.current.scrollWidth);
      }
    };
    
    const timer = setTimeout(updateWidths, 150);

    const observers: ResizeObserver[] = [];
    if (previewContainerRef.current) {
      const obs = new ResizeObserver(updateWidths);
      obs.observe(previewContainerRef.current);
      if (previewContainerRef.current.firstElementChild) {
        obs.observe(previewContainerRef.current.firstElementChild);
      }
      observers.push(obs);
    }
    if (metricsContainerRef.current) {
      const obs = new ResizeObserver(updateWidths);
      obs.observe(metricsContainerRef.current);
      if (metricsContainerRef.current.firstElementChild) {
        obs.observe(metricsContainerRef.current.firstElementChild);
      }
      observers.push(obs);
    }

    return () => {
      clearTimeout(timer);
      observers.forEach(obs => obs.disconnect());
    };
  }, [activeSubTab, creatives, searchTerm]);

  const handleContainerScroll = (tab: "preview" | "metrics") => {
    const container = tab === "preview" ? previewContainerRef.current : metricsContainerRef.current;
    const scrollBar = tab === "preview" ? previewScrollBarRef.current : metricsScrollBarRef.current;
    if (container && scrollBar) {
      scrollBar.scrollLeft = container.scrollLeft;
    }
  };

  const handleScrollBarScroll = (tab: "preview" | "metrics", e: React.UIEvent<HTMLDivElement>) => {
    const container = tab === "preview" ? previewContainerRef.current : metricsContainerRef.current;
    if (container) {
      container.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const handlePreviewSort = (field: string) => {
    if (previewSortField === field) {
      setPreviewSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setPreviewSortField(field);
      setPreviewSortOrder("desc");
    }
  };

  const handleMetricsSort = (field: string) => {
    if (metricsSortField === field) {
      setMetricsSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setMetricsSortField(field);
      setMetricsSortOrder("desc");
    }
  };

  const renderSortIcon = (field: string, currentField: string, currentOrder: "asc" | "desc") => {
    if (currentField !== field) {
      return <span className="inline-block ml-1 text-slate-300">↕</span>;
    }
    return currentOrder === "asc" 
      ? <span className="inline-block ml-1 text-slate-800 font-extrabold text-[11px]">↑</span> 
      : <span className="inline-block ml-1 text-slate-800 font-extrabold text-[11px]">↓</span>;
  };

  const fetchCreatives = async () => {
    creativeAbortRef.current?.abort();
    const controller = new AbortController();
    creativeAbortRef.current = controller;
    const requestId = ++creativeRequestIdRef.current;
    const sourceRequestKey = serverRequestKey;
    const isCurrent = () => shouldApplyLatestRequest({
      requestId,
      latestRequestId: creativeRequestIdRef.current,
      sourceRequestKey,
      latestRequestKey: creativeRequestKeyRef.current
    });
    try {
      setLoading(true);
      setPerformanceRows([]);
      setStructureOnlyRows([]);
      setSummary(null);
      setStructureSummary(null);
      setBucketSummary({});
      setCoverage(null);
      setPagination(null);
      setDiagnostics(null);
      setFilterOptions({ storeOptions: [], accountOptions: [], campaignOptions: [], adsetOptions: [], creativeTypeOptions: [] });
      setResponseDateRange(null);
      setViewNotice(null);
      const startStr = startStrKey;
      const endStr = endStrKey;
      const selectedStoreId = localStoreFilter === "all"
        ? "all"
        : localStoreFilter;

      const [resGrouped, resStores] = await Promise.all([
        axios.get("/api/data-center/creative-insights", {
          signal: controller.signal,
          params: {
            startDate: startStr,
            endDate: endStr,
            accountId: selectedAccountFilter,
            storeId: selectedStoreId,
            campaignId: selectedCampaignFilter,
            adsetId: selectedAdsetFilter,
            creativeType: selectedType,
            opsBucket: activeOpsBucket,
            search: searchTerm,
            page,
            pageSize,
            sortBy: `${metricsSortField} ${metricsSortOrder.toUpperCase()}`,
            includeZeroSpend: true
          }
        }),
        axios.get("/api/stores", { signal: controller.signal }).catch((storeError) => {
          if (isCanceledRequest(storeError)) throw storeError;
          return { data: [] };
        })
      ]);
      if (!isCurrent()) return;

      const nextPageState = resolveCreativeDashboardResponse(resGrouped.data, startStr, endStr);
      const formattedGrouped = nextPageState.performanceRows as CreativeData[];
      const storesPayload = resStores.data?.stores || resStores.data?.data || resStores.data || [];
      setStoresList(Array.isArray(storesPayload) ? storesPayload : []);
      setResponseDateRange(nextPageState.dateRange);

      /*
      if (String(resGrouped.data?.coverage?.status || "").toUpperCase() === "ERROR") {
        setPerformanceRows([]);
        setStructureOnlyRows([]);
        setSummary(null);
        setStructureSummary(null);
        setBucketSummary({});
        setCoverage(resGrouped.data?.coverage || null);
        setPagination(null);
        setDiagnostics(resGrouped.data?.diagnostics || null);
        setCreativeDataHealth(resGrouped.data?.dataHealth || { status: "ERROR" });
        setViewNotice("当前素材筛选周期查询失败，未展示旧数据。");
        return;
      }

      */
      setPerformanceRows(formattedGrouped);
      setStructureOnlyRows(nextPageState.structureOnlyRows);
      setSummary(nextPageState.summary);
      setStructureSummary(nextPageState.structureSummary);
      setBucketSummary(nextPageState.bucketSummary);
      setCoverage(nextPageState.coverage);
      setPagination(nextPageState.pagination);
      setFilterOptions(nextPageState.filterOptions);
      setDiagnostics(nextPageState.diagnostics);
      setCreativeDataHealth(resGrouped.data?.dataHealth || null);
      setViewNotice(nextPageState.notice);

    } catch (err: any) {
      if (!isCurrent() || isCanceledRequest(err)) return;
      toast.error("加载素材分析数据失败");
      setPerformanceRows([]);
      setStructureOnlyRows([]);
      setSummary(null);
      setStructureSummary(null);
      setBucketSummary({});
      setCoverage({ status: "ERROR" });
      setPagination(null);
      setDiagnostics(null);
      setFilterOptions({ storeOptions: [], accountOptions: [], campaignOptions: [], adsetOptions: [], creativeTypeOptions: [] });
      setCreativeDataHealth({
        status: "ERROR",
        reason: "FETCH_FAILED_FOR_CURRENT_REQUEST",
        message: "当前素材筛选周期请求失败，未使用旧素材数据。",
        dateRange: { startDate: startStrKey, endDate: endStrKey, timezone: "America/Los_Angeles" }
      });
      setViewNotice("当前素材筛选周期请求失败，未展示旧数据。");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    setViewNotice(null);
    setResponseDateRange(null);
    setSyncStatus({ status: "idle" });
  }, [serverRequestKey]);

  useEffect(() => {
    setPage(1);
  }, [startStrKey, endStrKey, localStoreFilter, selectedAccountFilter, selectedCampaignFilter, selectedAdsetFilter, selectedType, activeOpsBucket, searchTerm]);

  useEffect(() => {
    fetchCreatives();
  }, [startStrKey, endStrKey, localStoreFilter, selectedAccountFilter, selectedCampaignFilter, selectedAdsetFilter, selectedType, activeOpsBucket, searchTerm, page, pageSize, metricsSortField, metricsSortOrder]);

  useEffect(() => () => creativeAbortRef.current?.abort(), []);

  const handleTriggerAiAnalysisForRow = async (creative: CreativeData, onlyCached = false) => {
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const requestId = ++aiRequestIdRef.current;
    const requestPayload = buildCreativeAnalysisRequest(creative, {
      startDate: startStrKey,
      endDate: endStrKey,
      onlyCached,
      forceRefresh: !onlyCached
    });
    const aiKey = buildCreativeAiRequestKey(creative, {
      startDate: startStrKey,
      endDate: endStrKey,
      coverageStatus: String(coverage?.status || "")
    });
    aiRequestKeyRef.current = aiKey;
    const isCurrentAi = () => requestId === aiRequestIdRef.current && aiRequestKeyRef.current === aiKey;
    setAiLoading(!onlyCached);
    try {
      const res = await axios.post(`/api/data-center/creatives/${creative.creativeId}/analyze`, requestPayload, {
        signal: controller.signal
      });
      if (!isCurrentAi()) return;
      const resolved = resolveCreativeAnalysisResponse(res.data);
      if (resolved.report) {
        setAiReport(resolved.report);
        if (!onlyCached) toast.success("规则诊断已生成");
      } else if (!onlyCached) {
        setAiReport(null);
      }
    } catch (err: any) {
      if (!isCurrentAi() || isCanceledRequest(err)) return;
      console.error("Failed to run scoped creative rule diagnosis", err);
      if (!onlyCached) toast.error("规则诊断暂时无法生成，请稍后重试。");
    } finally {
      if (isCurrentAi()) setAiLoading(false);
    }
  };

  const getCreativeAccountName = (creative: CreativeData | null | undefined) => {
    if (!creative) return "";
    return creative.accountName || creative.fb_account_name || (creative.accountId ? "账户名称未同步" : "");
  };

  const handleAskCreativeAI = (creative: CreativeData) => {
    const aiAvailability = isCreativeAiAllowed(creative, coverage);
    if (!aiAvailability.allowed) {
      toast.info("当前素材没有可用于 AI 的事实或 Coverage 不可用。");
      return;
    }
    const scopedPrompt = buildCreativeAiPrompt(creative, {
      coverage,
      confidence: aiAvailability.confidence || "full",
      startDate: startStrKey,
      endDate: endStrKey
    });
    window.dispatchEvent(new CustomEvent("open-ai-context", {
      detail: {
        source: "creative_intelligence",
        title: `分析素材：${creative.creativeName || creative.analysisEntityId || creative.id}`,
        prompt: scopedPrompt,
        context: buildCreativeAnalysisRequest(creative, {
          startDate: startStrKey,
          endDate: endStrKey
        })
      }
    }));
    toast.success(aiAvailability.warning || "已打开 AI 上下文。");
  };

  const copyCreativeAiPrompt = async (creative: CreativeData) => {
    const aiAvailability = isCreativeAiAllowed(creative, coverage);
    if (!aiAvailability.allowed) {
      toast.info("当前素材没有可复制的 AI 分析数据。");
      return;
    }
    const prompt = buildCreativeAiPrompt(creative, {
      coverage,
      confidence: aiAvailability.confidence || "full",
      startDate: startStrKey,
      endDate: endStrKey
    });
    await navigator.clipboard.writeText(prompt);
    toast.success("分析数据已复制。");
  };

  useEffect(() => {
    aiAbortRef.current?.abort();
    aiRequestIdRef.current += 1;
    aiRequestKeyRef.current = creativeAiRequestKey;
    setAiReport(null);
    setAiLoading(false);
    if (selectedPreviewCreative && creativeAiRequestKey) {
      void handleTriggerAiAnalysisForRow(selectedPreviewCreative, true);
    }
  }, [creativeAiRequestKey]);


  const availableStores = React.useMemo(() => {
    return filterOptions.storeOptions || [];
  }, [filterOptions]);

  const availableAccounts = React.useMemo(() => {
    return filterOptions.accountOptions || [];
  }, [filterOptions]);

  const availableCampaigns = React.useMemo(() => {
    return filterOptions.campaignOptions || [];
  }, [filterOptions]);

  const availableAdsets = React.useMemo(() => {
    return filterOptions.adsetOptions || [];
  }, [filterOptions]);

  const handleStoreFilterChange = (nextStoreId: string) => {
    const next = resolveCreativeFilterCascade({ changed: "store", nextValue: nextStoreId });
    setLocalStoreFilter(next.storeId);
    setSelectedAccountFilter(next.accountId);
    setSelectedCampaignFilter(next.campaignId);
    setSelectedAdsetFilter(next.adsetId);
    setPage(next.page);
  };

  const handleAccountFilterChange = (nextAccountId: string) => {
    const next = resolveCreativeFilterCascade({ changed: "account", nextValue: nextAccountId });
    setSelectedAccountFilter(next.accountId);
    setSelectedCampaignFilter(next.campaignId);
    setSelectedAdsetFilter(next.adsetId);
    setPage(next.page);
  };

  const handleCampaignFilterChange = (nextCampaignId: string) => {
    const next = resolveCreativeFilterCascade({ changed: "campaign", nextValue: nextCampaignId });
    setSelectedCampaignFilter(next.campaignId);
    setSelectedAdsetFilter(next.adsetId);
    setPage(next.page);
  };

  // Server applies every business filter before summary, buckets and pagination.
  const filteredCreatives = React.useMemo(() => {
    return [...creatives];
  }, [creatives]);

  // Daily records matching current selection

  // Fatigue fields are displayed only when the backend has source-backed values.
  const fatigueMap = React.useMemo(() => {
    const map: Record<string, FatigueDetails> = {};
    for (const c of creatives) {
      const riskLevel = c.riskLevel || "数据不足";
      map[c.id] = {
        creativeId: c.id,
        creativeName: c.creativeName,
        type: c.type,
        fatigueScore: c.fatigueScore ?? null,
        riskLevel,
        riskColor: riskLevel === "数据不足" ? "text-slate-500" : "text-orange-600",
        riskBg: riskLevel === "数据不足" ? "bg-slate-50 border-slate-200 text-slate-600" : "bg-orange-50 border-orange-200 text-orange-700",
        rulesTriggered: [c.diagnosisReason || "当前筛选周期无素材成效事实"],
        recommendations: c.recommendedAction ? [c.recommendedAction] : []
      };
    }
    return map;
  }, [creatives]);

  const evaluateSingleFatigue = (creativeId: string, creativeName: string, type: string): FatigueDetails => {
    if (fatigueMap[creativeId]) {
      return fatigueMap[creativeId];
    }
    return {
      creativeId,
      creativeName,
      type,
      fatigueScore: null,
      riskLevel: "数据不足",
      riskColor: "text-slate-500",
      riskBg: "bg-slate-50 border-slate-200 text-slate-600",
      rulesTriggered: ["当前筛选周期无素材成效事实"],
      recommendations: []
    };
  };

  // Sorted creatives for Preview tab
  const sortedPreviewCreatives = React.useMemo(() => {
    const list = [...filteredCreatives];
    list.sort((a, b) => {
      let valA: any = "";
      let valB: any = "";

      if (previewSortField === "opsScore") {
        valA = a.opsScore;
        valB = b.opsScore;
      } else if (previewSortField === "spend") {
        valA = a.spend;
        valB = b.spend;
      } else if (previewSortField === "purchases") {
        valA = a.purchases;
        valB = b.purchases;
      } else if (previewSortField === "revenue") {
        valA = a.revenue;
        valB = b.revenue;
      } else if (previewSortField === "name") {
        valA = a.creativeName || "";
        valB = b.creativeName || "";
      } else if (previewSortField === "type") {
        valA = a.type || "";
        valB = b.type || "";
      } else if (previewSortField === "fatigue") {
        valA = evaluateSingleFatigue(a.id, a.creativeName, a.type).fatigueScore;
        valB = evaluateSingleFatigue(b.id, b.creativeName, b.type).fatigueScore;
      } else {
        valA = a.spend;
        valB = b.spend;
      }

      return compareNullable(valA, valB, previewSortOrder);
    });
    return list;
  }, [filteredCreatives, previewSortField, previewSortOrder, fatigueMap]);

  // Sorted creatives for Metrics tab
  const sortedMetricsCreatives = React.useMemo(() => {
    const list = [...filteredCreatives];
    list.sort((a, b) => {
      let valA: any = "";
      let valB: any = "";

      if (metricsSortField === "spend") {
        valA = a.spend;
        valB = b.spend;
      } else if (metricsSortField === "purchases") {
        valA = a.purchases;
        valB = b.purchases;
      } else if (metricsSortField === "revenue") {
        valA = a.revenue;
        valB = b.revenue;
      } else if (metricsSortField === "cpc") {
        valA = a.cpc;
        valB = b.cpc;
      } else if (metricsSortField === "impressions") {
        valA = a.impressions;
        valB = b.impressions;
      } else if (metricsSortField === "reach") {
        valA = a.reachAvailable ? a.reach : null;
        valB = b.reachAvailable ? b.reach : null;
      } else if (metricsSortField === "ctr") {
        valA = a.ctr;
        valB = b.ctr;
      } else if (metricsSortField === "addToCart") {
        valA = a.addToCartAvailable ? a.addToCart : null;
        valB = b.addToCartAvailable ? b.addToCart : null;
      } else if (metricsSortField === "accountId") {
        valA = a.accountId || "";
        valB = b.accountId || "";
      } else if (metricsSortField === "adsetId") {
        valA = a.adsetId || "";
        valB = b.adsetId || "";
      } else if (metricsSortField === "adId") {
        valA = a.adId || "";
        valB = b.adId || "";
      } else if (metricsSortField === "id") {
        valA = a.id || "";
        valB = b.id || "";
      } else if (metricsSortField === "type") {
        valA = a.type || "";
        valB = b.type || "";
      } else {
        valA = a.spend;
        valB = b.spend;
      }

      return compareNullable(valA, valB, metricsSortOrder);
    });
    return list;
  }, [filteredCreatives, metricsSortField, metricsSortOrder]);

  // KPI values come from the complete server-filtered dataset, never the visible page.
  const metricsAvailable = summary && summary.spend !== null && summary.spend !== undefined;
  const totalSpend: number | null = metricsAvailable ? Number(summary.spend) : null;
  const totalImpressions: number | null = metricsAvailable ? Number(summary.impressions) : null;
  const totalClicks: number | null = metricsAvailable ? Number(summary.clicks) : null;
  const totalRevenue: number | null = metricsAvailable ? Number(summary.purchaseValue) : null;
  const totalPurchases: number | null = metricsAvailable ? Number(summary.purchases) : null;
  const avgROAS: number | null = metricsAvailable ? Number(summary.roas) : null;
  const avgCTR: number | null = metricsAvailable ? Number(summary.ctr) : null;
  const avgCPM: number | null = metricsAvailable ? Number(summary.cpm) : null;
  const creativeHealthStatus = coverage?.status || creativeDataHealth?.status || "NOT_SYNCED";
  const creativeHealthMessage = creativeDataHealth?.message || (
    creativeHealthStatus === "NOT_SYNCED"
      ? `当前周期素材成效尚未同步，数据最新至 ${coverage?.latestAvailableDate || "未知"}`
      : creativeHealthStatus === "PARTIAL_COVERAGE"
        ? `请求截止 ${endStrKey}，当前事实只覆盖至 ${coverage?.latestAvailableDate || "未知"}`
        : creativeHealthStatus === "TRUE_EMPTY" ? "当前周期已完整同步，素材成效为空。" : "素材成效覆盖状态已更新。"
  );
  const shouldShowCreativeNotice =
    !loading &&
    creatives.length === 0 &&
    creativeHealthStatus &&
    !["READY", "OK"].includes(String(creativeHealthStatus).toUpperCase());

  const handleExport = async () => {
    try {
      const selectedStoreId = resolveSelectedStoreId();
      if (localStoreFilter !== "all" && selectedStoreId === null) {
        toast.warning("店铺筛选尚未解析，未导出全部店铺素材数据。");
        return;
      }
      const response = await axios.get("/api/data-center/creative-insights", {
        params: {
          startDate: startStrKey,
          endDate: endStrKey,
          accountId: selectedAccountFilter,
          storeId: selectedStoreId,
          campaignId: selectedCampaignFilter,
          adsetId: selectedAdsetFilter,
          creativeType: selectedType,
          opsBucket: activeOpsBucket,
          search: searchTerm,
          includeZeroSpend: true,
          sortBy: `${metricsSortField} ${metricsSortOrder.toUpperCase()}`,
          export: true
        }
      });
      const exportRows: CreativeData[] = response.data?.performanceRows || response.data?.data || [];
      const exportData = exportRows.map(row => ({
        "素材名称": row.creativeName || "名称未同步",
        "素材类型": row.type,
        "店铺": row.storeName || "未绑定店铺",
        "广告账户": row.accountName || "账户名称未同步",
        "广告系列数": row.campaignCount,
        "广告组数": row.adsetCount,
        "广告数": row.adCount,
        "Meta花费": row.spend,
        "展示": row.impressions,
        "点击": row.clicks,
        "CTR": row.ctr ?? "N/A",
        "CPC": row.cpc ?? "N/A",
        "CPM": row.cpm ?? "N/A",
        "Meta购买": row.purchases,
        "CPA": row.cpa ?? "N/A",
        "Meta转化价值": row.purchaseValue,
        "MetaROAS": row.roas ?? "N/A",
        "加购": row.availability?.addToCart ? row.addToCart : "N/A",
        "Reach": row.availability?.reach ? row.reach : "N/A",
        "运营分组": row.opsBucketLabel,
        "规则风险": row.riskLevel,
        "建议动作": row.recommendedAction || "N/A",
        "数据日期": row.latestPerformanceDate || "N/A",
        "同步时间": row.performanceSyncedAt || "N/A",
        "analysisEntityId": row.analysisEntityId,
        "creativeIds": row.creativeIds.join(","),
        "adIds": row.adIds.join(","),
        "campaignIds": row.campaignIds.join(","),
        "adsetIds": row.adsetIds.join(","),
        "accountId": row.accountId,
        "storeId": row.storeId ?? "N/A"
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "素材诊断数据报表");
      const safeStore = localStoreFilter === "all" ? "all-stores" : `store-${localStoreFilter}`;
      const safeAccount = selectedAccountFilter === "all" ? "all-accounts" : selectedAccountFilter.replace(/[^a-zA-Z0-9_-]/g, "_");
      XLSX.writeFile(wb, `Creative_Intelligence_${startStrKey}_${endStrKey}_${safeStore}_${safeAccount}.xlsx`);
      if (response.data?.export?.truncated) {
        toast.warning(response.data.export.message || `共匹配 ${response.data.export.totalMatched} 条，本次导出前 ${response.data.export.limit} 条。`);
      }
      else toast.success("素材诊断数据报表导出成功！");
    } catch {
      toast.error("导出素材报表失败");
    }
  };

  // Render icons helper
  const getTypeBadge = (type: string) => {
    switch(type) {
      case "VIDEO": 
        return (
          <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
            <Video className="w-3.5 h-3.5 text-blue-500 shrink-0" /> 视频素材
          </span>
        );
      case "IMAGE": 
        return (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <ImageIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> 单图素材
          </span>
        );
      case "CAROUSEL": 
        return (
          <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
            <Layers className="w-3.5 h-3.5 text-purple-500 shrink-0" /> 轮播素材
          </span>
        );
      default: 
        return (
          <span className="inline-flex items-center gap-1 rounded bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-700 border border-gray-200">
            <ImageIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" /> 其它格式
          </span>
        );
    }
  };

  const CreativeMetaLinkPanel = ({
    creativeId,
    type
  }: {
    creativeId: string;
    type: string;
  }) => {
    const directUrl = `https://business.facebook.com/adsmanager/manage/ads?act=all&selected_creative_ids=${creativeId}`;
    return (
      <div className="w-full rounded-lg bg-slate-50 border border-slate-200 p-4 transition-all hover:border-meta-blue hover:bg-slate-100 flex flex-col justify-between gap-3 text-slate-800 shadow-sm relative group cursor-pointer">
        <div className="flex justify-between items-start gap-2 border-b border-slate-200 pb-2">
          <span className="inline-flex items-center gap-1 rounded bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold text-slate-700 tracking-wider">
            {type === "VIDEO" ? <Video className="w-3.5 h-3.5 text-blue-500 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" />} {type} 格式
          </span>
          <span className="text-slate-400 group-hover:text-meta-blue transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />
          </span>
        </div>
        
        <div className="space-y-1">
          <p className="text-[10px] text-slate-500 leading-tight font-medium">在 Meta 广告管理工具中查看素材</p>
          <a
            href={directUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="text-[11px] font-mono text-meta-blue underline hover:text-blue-700 font-bold break-all block"
          >
            {directUrl}
          </a>
        </div>
        
      </div>
    );
  };

  const normalizeAiReportList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split("\n").map((item) => item.trim()).filter(Boolean);
    }
    return [];
  };

  // Curated leaderboards from current coupled dataset
  const getLeaderboards = () => {
    const sortedByROAS = [...filteredCreatives].sort((left, right) => compareNullable(left.roas, right.roas, "desc"));
    const sortedByCTR = [...filteredCreatives].sort((left, right) => compareNullable(left.ctr, right.ctr, "desc"));
    
    // Inefficient: Spend > $100 and ROAS < 1.1 (money wasted)
    const sortedByWaste = [...filteredCreatives]
      .filter(creative => creative.spend > 100 && creative.roas !== null && creative.roas < 1.1)
      .sort((left, right) => compareNullable(left.spend, right.spend, "desc"));

    // Dynamic Video Hook Rate Ranking 
    const sortedByHook = [...filteredCreatives]
      .filter(c => c.type === "VIDEO" && c.hookRateAvailable && c.hookRate !== null)
      .sort((a, b) => Number(b.hookRate) - Number(a.hookRate));

    return {
      topRoas: sortedByROAS.slice(0, 5),
      topCtr: sortedByCTR.slice(0, 5),
      topWaste: sortedByWaste.slice(0, 5),
      topHook: sortedByHook.slice(0, 5)
    };
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {viewNotice && (
        <div className="bg-slate-50 border border-slate-200 text-slate-700 rounded-xl p-4 text-sm">
          {viewNotice}
        </div>
      )}

      {shouldShowCreativeNotice && !viewNotice && (
        <div className="bg-slate-50 border border-slate-200 text-slate-700 rounded-xl p-4 space-y-2 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-2 font-bold text-slate-800 text-xs">
            <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0" />
            <span>{creativeHealthStatus === "STRUCTURE_WITHOUT_FACTS" ? "素材结构已同步，成效未同步" : "当前日期范围暂无素材表现数据"}</span>
          </div>
          <p className="text-xs text-slate-600 font-medium leading-relaxed">
            {creativeHealthMessage}
          </p>
        </div>
      )}

      {/* Dynamic coupled BI Header */}
      <div className="bg-white px-6 py-4 rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-400">素材 Meta 成效口径，按 Ad / Creative 聚合</span>
        
        {/* Date Selector Indicator, Store selection dropdown, & Export block */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 h-9">
            <span className="text-xs text-slate-500 font-bold">选择店铺:</span>
            <select
              className="h-7 text-xs bg-transparent border-none outline-none font-extrabold text-slate-800 pr-2 cursor-pointer"
              value={localStoreFilter}
              onChange={(e) => handleStoreFilterChange(e.target.value)}
            >
              <option value="all">全部店铺</option>
              {availableStores.map((option: any) => (
                <option key={option.storeId} value={String(option.storeId)}>{option.storeName}</option>
              ))}
            </select>
          </div>

          {onStartDateChange && onEndDateChange ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 z-10" />
                <Popover>
                  <PopoverTrigger className="pl-8 pr-2.5 h-9 border border-gray-200 rounded-lg text-xs w-[120px] text-left bg-white flex items-center text-gray-750 font-semibold cursor-pointer">
                    {startDate ? format(startDate, "yyyy-MM-dd") : "开始"}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={(day) => day && onStartDateChange(day)}
                      autoFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <span className="text-gray-400 text-xs font-medium">至</span>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 z-10" />
                <Popover>
                  <PopoverTrigger className="pl-8 pr-2.5 h-9 border border-gray-200 rounded-lg text-xs w-[120px] text-left bg-white flex items-center text-gray-750 font-semibold cursor-pointer">
                    {endDate ? format(endDate, "yyyy-MM-dd") : "结束"}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
                    <CalendarComponent
                      mode="single"
                      selected={endDate}
                      onSelect={(day) => day && onEndDateChange(day)}
                      autoFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          ) : (
            <div className="flex items-center h-9 bg-gray-50 border border-gray-200 text-gray-700 px-3 rounded-lg text-xs gap-2">
              <Calendar className="w-3.5 h-3.5 text-gray-400 mr-0.5" />
              <span>
                {startDate ? format(startDate, "yyyy-MM-dd") : "过去30天"} ~ {endDate ? format(endDate, "yyyy-MM-dd") : "当天"}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            className="h-9 px-3.5 text-xs font-semibold border-gray-200 text-slate-700 hover:bg-gray-50 flex items-center gap-1.5"
            onClick={handleSyncCreatives}
            disabled={syncing}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            同步数据
          </Button>
          <Button
            onClick={fetchCreatives}
            variant="outline"
            className="h-9 px-3.5 text-xs font-semibold border-gray-200 text-gray-600 hover:text-gray-900 shrink-0"
            title="刷新页面数据"
            disabled={loading || syncing}
          >
            <RefreshCcw className="w-3.5 h-3.5 mr-1.5" />
            刷新页面数据
          </Button>
          <Button
            variant="outline"
            className="h-9 px-3.5 text-xs font-semibold border-gray-200 text-[#374151] hover:bg-gray-50"
            onClick={handleExport}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            导出报表
          </Button>
        </div>
      </div>

      <SyncStatusPanel status={syncStatus} />

      <DataCoverageBanner coverage={coverage} />

      <DataViewTraceBar
        compactScopeLabel="素材 Meta 成效口径"
        currentStartDate={startStrKey || "--"}
        currentEndDate={endStrKey || "--"}
        responseStartDate={responseDateRange?.startDate}
        responseEndDate={responseDateRange?.endDate}
        latestAvailableDate={coverage?.latestAvailableDate}
        timezone={responseDateRange?.timezone || "America/Los_Angeles"}
        rowCount={pagination?.total ?? creatives.length}
        factRows={creativeDataHealth?.factRows}
        structureRows={creativeDataHealth?.structureRows}
        status={creativeDataHealth?.status || "UNKNOWN"}
        level={activeSubTab}
        source="Meta 素材成效"
        scope={selectedAccountFilter !== "all" ? "current_account" : "all_accounts"}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <span>
          当前页 {pagination?.pageRowCount ?? creatives.length} 条 / 符合条件 {pagination?.total ?? pagination?.filteredTotalCount ?? creatives.length} 条
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading || page <= 1} onClick={() => setPage(prev => Math.max(1, prev - 1))}>
            上一页
          </Button>
          <span className="font-mono">{page} / {Math.max(1, pagination?.totalPages || 1)}</span>
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading || page >= Math.max(1, pagination?.totalPages || 1)} onClick={() => setPage(prev => prev + 1)}>
            下一页
          </Button>
          <select
            className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[25, 50, 100, 250].map(size => <option key={size} value={size}>{size}/页</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
        {creativeBuckets.map(bucket => {
          const count = bucket.id === "all"
            ? (summary?.performanceCount ?? 0)
            : (bucketSummary[bucket.id] || 0);
          const active = activeOpsBucket === bucket.id;
          return (
            <button
              key={bucket.id}
              type="button"
              onClick={() => setActiveOpsBucket(bucket.id)}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-bold transition-all",
                active
                  ? "bg-slate-900 text-white"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100"
              )}
            >
              {bucket.label} <span className="font-mono opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="text-xs text-slate-600 flex flex-wrap gap-4">
        <span>当前周期有成效素材：<b>{summary?.performanceCount ?? 0}</b></span>
        <span>结构已同步但当前周期无成效：<b>{structureSummary?.structureOnlyCount ?? structureOnlyRows.length}</b></span>
      </div>

      {/* Aggregate KPI Panels connected with parent filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-white border border-slate-100 shadow-sm rounded-xl">
          <div className="flex justify-between items-center text-slate-400 mb-1">
            <span className="text-[11px] font-bold tracking-wider uppercase">素材消耗</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-lg font-extrabold text-slate-900 font-mono">{totalSpend === null ? "N/A" : `$${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded">实时计算</span>
            <span className="text-[9px] text-slate-400">当前筛选周期合计</span>
          </div>
        </Card>

        <Card className="p-4 bg-white border border-slate-100 shadow-sm rounded-xl">
          <div className="flex justify-between items-center text-slate-400 mb-1">
            <span className="text-[11px] font-bold tracking-wider uppercase">Meta转化价值</span>
            <TrendUpIcon className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-lg font-extrabold text-slate-900 font-mono">{totalRevenue === null ? "N/A" : `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[9px] bg-blue-50 text-blue-700 font-bold px-1.5 py-0.5 rounded">Meta购买数</span>
            <span className="text-[9px] text-slate-500 font-semibold font-mono">{totalPurchases ?? "N/A"}</span>
          </div>
        </Card>

        <Card className="p-4 bg-white border border-slate-100 shadow-sm rounded-xl">
          <div className="flex justify-between items-center text-slate-400 mb-1">
            <span className="text-[11px] font-bold tracking-wider uppercase">素材ROAS</span>
            <Award className="w-4 h-4 text-indigo-505" />
          </div>
          <p className={`text-lg font-extrabold font-mono ${Number(avgROAS) >= 2.0 ? 'text-blue-600' : Number(avgROAS) >= 1.2 ? 'text-slate-800' : 'text-slate-500'}`}>{avgROAS === null ? "N/A" : `${avgROAS.toFixed(2)}x`}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${avgROAS !== null && avgROAS >= 1.2 ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50 text-slate-600'}`}>
              {avgROAS === null ? '当前周期未同步' : avgROAS >= 1.2 ? '转化效率优良' : '低于观察线'}
            </span>
          </div>
        </Card>

        <Card className="p-4 bg-white border border-slate-100 shadow-sm rounded-xl">
          <div className="flex justify-between items-center text-slate-400 mb-1">
            <span className="text-[11px] font-bold tracking-wider uppercase">平均展现点击率 CTR</span>
            <Percent className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-lg font-extrabold text-slate-900 font-mono">{avgCTR === null ? "N/A" : `${avgCTR.toFixed(2)}%`}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[9px] bg-purple-50 text-purple-700 font-semibold px-1.5 py-0.5 rounded">平均 CPM</span>
            <span className="text-[9px] text-slate-400 font-mono">{avgCPM === null ? "N/A" : `$${avgCPM.toFixed(2)}`}</span>
          </div>
        </Card>
      </div>

            {/* SECONDARY NAVIGATION TABS */}
      <div className="flex border border-slate-150 bg-white p-1 rounded-xl shadow-sm gap-1">
        <button
          type="button"
          onClick={() => setActiveSubTab("preview")}
          className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${activeSubTab === "preview" ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 bg-transparent"}`}
        >
          <Maximize2 className="w-4 h-4" /> (1) 素材预览设置 (Creative Setup & Preview)
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("metrics")}
          className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${activeSubTab === "metrics" ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 bg-transparent"}`}
        >
          <BarChart2 className="w-4 h-4" /> (2) 素材表现指标 (Performance Metrics)
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("trends")}
          className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${activeSubTab === "trends" ? "bg-slate-900 text-white shadow" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 bg-transparent"}`}
        >
          <Activity className="w-4 h-4" /> (3) 素材对比走势 (Trend Charts)
        </button>
      </div>

      {/* SUBTAB CONTENT */}
      <div className="space-y-4">
        {/* TAB 1: 素材预览设置 (Creative Preview & Settings) */}
        {activeSubTab === "preview" && (
          <div className="space-y-4">
            {/* Inline layout controller */}
            <div className="bg-white p-4 border border-slate-100 rounded-xl shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <Input 
                  type="text"
                  placeholder="智能搜索素材名 / ID..."
                  className="pl-9 h-9 text-xs border-slate-200"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-bold shrink-0">素材类型:</span>
                  <select
                    className="h-9 text-xs bg-white border border-slate-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-slate-900 font-medium cursor-pointer text-slate-700"
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                  >
                    <option value="ALL">全部格式</option>
                    <option value="IMAGE">单图</option>
                    <option value="VIDEO">视频</option>
                    <option value="CAROUSEL">轮播</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-bold shrink-0">广告账商:</span>
                  <select
                    className="h-9 text-xs bg-white border border-slate-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-slate-900 font-medium cursor-pointer text-slate-700 max-w-[125px]"
                    value={selectedAccountFilter}
                    onChange={(e) => handleAccountFilterChange(e.target.value)}
                  >
                    <option value="all">所有账户</option>
                    {availableAccounts.map((option: any) => (
                      <option key={option.accountId} value={option.accountId}>{option.accountName || metaAccountOptionLabel(null, option.accountId)}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-bold shrink-0">关联系列:</span>
                  <select
                    className="h-9 text-xs bg-white border border-slate-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-slate-900 font-medium cursor-pointer text-slate-700 max-w-[125px]"
                    value={selectedCampaignFilter}
                    onChange={(e) => handleCampaignFilterChange(e.target.value)}
                  >
                    <option value="all">所有系列</option>
                    {availableCampaigns.map((option: any) => (
                      <option key={option.campaignId} value={option.campaignId}>{option.campaignName || "广告系列名称未同步"}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-bold shrink-0">广告组:</span>
                  <select
                    className="h-9 text-xs bg-white border border-slate-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-slate-900 font-medium cursor-pointer text-slate-700 max-w-[125px]"
                    value={selectedAdsetFilter}
                    onChange={(e) => { setSelectedAdsetFilter(e.target.value); setPage(1); }}
                  >
                    <option value="all">所有广告组</option>
                    {availableAdsets.map((option: any) => (
                      <option key={option.adsetId} value={option.adsetId}>{option.adsetName || "广告组名称未同步"}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="text-xs text-slate-450 font-medium">
                符合筛选条件素材: <b className="text-slate-800 font-extrabold">{filteredCreatives.length} / {creatives.length}</b> 个
              </div>
            </div>

            {filteredCreatives.length === 0 ? (
              <Card className="py-20 text-center text-slate-400 text-xs font-mono border-slate-100 bg-white">
                未匹配到符合条件的素材或当前该账户名下暂无同步的数据
              </Card>
            ) : (
              <Card className="border border-slate-100 rounded-xl overflow-hidden shadow-sm bg-white">
                <div 
                  className="overflow-x-auto" 
                  ref={previewContainerRef} 
                  onScroll={() => handleContainerScroll("preview")}
                >
                  <Table>
                    <TableHeader className="bg-slate-50 border-b border-slate-100">
                      <TableRow>
                        <TableHead className="text-xs font-bold text-slate-700 h-11 w-[90px] text-center">素材预览</TableHead>
                        <TableHead 
                          onClick={() => handlePreviewSort("name")}
                          className="text-xs font-bold text-slate-700 h-11 cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          素材名称 / ID {renderSortIcon("name", previewSortField, previewSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handlePreviewSort("type")}
                          className="text-xs font-bold text-slate-700 h-11 w-[130px] cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          素材类型 {renderSortIcon("type", previewSortField, previewSortOrder)}
                        </TableHead>
                        <TableHead className="text-xs font-bold text-slate-700 h-11">关联广告标识</TableHead>
                        <TableHead 
                          onClick={() => handlePreviewSort("fatigue")}
                          className="text-xs font-bold text-slate-700 h-11 w-[140px] cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          风险评分 {renderSortIcon("fatigue", previewSortField, previewSortOrder)}
                        </TableHead>
                        <TableHead className="text-xs font-bold text-slate-700 h-11">商品落地页链接</TableHead>
                        <TableHead className="text-xs font-bold text-slate-700 h-11 w-[120px] text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedPreviewCreatives.flatMap((c, idx) => {
                        const fatigue = evaluateSingleFatigue(c.id, c.creativeName, c.type);
                        const row = (
                          <TableRow key={c.id} className="hover:bg-slate-50/50 align-middle">
                            <TableCell className="py-3 text-center">
                              <div 
                                className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center cursor-pointer hover:border-meta-blue transition-colors mx-auto relative group"
                                onClick={() => {
                                  setSelectedPreviewCreative(c);
                                  setPreviewModalOpen(true);
                                }}
                                title="点击查看详细诊断"
                              >
                                <CreativePreviewMedia row={c} compact />
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="space-y-0.5 max-w-[200px]">
                                <div 
                                  className="font-bold text-slate-800 hover:text-meta-blue cursor-pointer truncate text-[13px]"
                                  onClick={() => {
                                    setSelectedPreviewCreative(c);
                                    setPreviewModalOpen(true);
                                  }}
                                >
                                  {c.creativeName}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-3">{getTypeBadge(c.type)}</TableCell>
                            <TableCell className="py-3">
                              <div className="space-y-1 font-mono text-[10px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1 py-0.2 text-[8px] font-extrabold bg-slate-100 text-slate-500 rounded border border-slate-200">账户</span>
                                  <MetaAccountDisplay
                                    name={getCreativeAccountName(c)}
                                    accountId={c.accountId}
                                    nameClassName="text-slate-600 font-medium truncate"
                                    idClassName="text-[10px] text-slate-500 font-mono truncate"
                                  />
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1 py-0.2 text-[8px] font-extrabold bg-blue-50 text-blue-600 rounded border border-blue-100">组ID</span>
                                  <span className="text-slate-600 font-medium">{c.adsetId || "N/A"}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1 py-0.2 text-[8px] font-extrabold bg-indigo-50 text-indigo-600 rounded border border-indigo-100">广告</span>
                                  <span className="text-slate-600 font-medium">{c.adId || "N/A"}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1 py-0.2 text-[8px] font-extrabold bg-emerald-50 text-emerald-600 rounded border border-emerald-100">素材</span>
                                  <span className="text-slate-600 font-medium">{c.id}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-mono font-bold text-slate-800">{fatigue.fatigueScore === null ? "N/A" : `${fatigue.fatigueScore} 分`}</span>
                                  <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border ${fatigue.riskBg}`}>
                                    {fatigue.riskLevel}
                                  </span>
                                </div>
                                {fatigue.fatigueScore !== null && <div className="w-20 bg-slate-100 rounded-full h-1 overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full ${
                                      fatigue.fatigueScore >= 70 ? 'bg-red-500' : 
                                      fatigue.fatigueScore >= 40 ? 'bg-orange-500' : 
                                      fatigue.fatigueScore >= 20 ? 'bg-slate-500' : 'bg-green-500'
                                    }`}
                                    style={{ width: `${fatigue.fatigueScore}%` }}
                                  ></div>
                                </div>}
                                <div className="text-[10px] text-slate-600">
                                  <span className="font-bold text-slate-800">{c.opsBucketLabel || "数据不足"}</span>
                                  {c.opsScore !== undefined && c.opsScore !== null && <span className="font-mono ml-1">({c.opsScore})</span>}
                                </div>
                                {c.recommendedAction && (
                                  <div className="text-[10px] text-slate-500 max-w-[160px] truncate" title={c.recommendedAction}>
                                    {c.recommendedAction}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="max-w-[220px] flex items-center gap-1.5 bg-slate-50/50 hover:bg-slate-100/50 transition-colors border border-slate-100 rounded-lg px-2.5 py-1.5 text-slate-800">
                                <span className="overflow-hidden flex-1 shrink-0">
                                  {c.productLink ? <a
                                    href={c.productLink}
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-[11px] font-mono text-meta-blue font-bold truncate block underline hover:text-blue-700"
                                    onClick={(e) => e.stopPropagation()}
                                    title={c.productLink}
                                  >
                                    {c.productLink}
                                  </a> : <span className="text-[11px] text-slate-500">落地页链接未同步</span>}
                                </span>
                                {c.productLink && <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                              </div>
                            </TableCell>
                            <TableCell className="py-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs font-bold border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                                onClick={() => handleAskCreativeAI(c)}
                                disabled={c.hasPerformanceFacts !== true}
                              >
                                问 AI 分析该素材
                              </Button>
                            </TableCell>
                          </TableRow>
                        );

                        if (idx === 9 && sortedPreviewCreatives.length > 10) {
                          const scrollRow = (
                            <TableRow key="floating-preview-scrollbar-row" className="bg-slate-50/50 border-y border-slate-200">
                              <TableCell colSpan={7} className="p-0 h-6">
                                <div 
                                  className="overflow-x-auto w-full flex items-center h-6 bg-slate-100 border-b border-slate-200 scrollbar-thin scrollbar-thumb-slate-300"
                                  onScroll={(e) => handleScrollBarScroll("preview", e)}
                                  ref={previewScrollBarRef}
                                >
                                  <div style={{ width: `${previewScrollWidth}px`, height: '1px' }} />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                          return [row, scrollRow];
                        }

                        return [row];
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* TAB 2: 素材表现指标 (Performance Metrics) */}
        {activeSubTab === "metrics" && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between gap-4 flex-wrap text-slate-800 shadow-sm">
              <div className="flex items-center gap-3 text-xs leading-relaxed">
                <Info className="w-4 h-4 text-meta-blue shrink-0 animate-pulse" />
                <p className="text-slate-600">
                  此报表展示当前筛选范围内的素材成效、转化与可用诊断字段。全表支持横向滑动。
                </p>
              </div>
              <div className="text-xs font-semibold text-slate-500">
                当前统计素材量: <span className="text-slate-900 font-bold">{filteredCreatives.length}</span> 个
              </div>
            </div>

            {filteredCreatives.length === 0 ? (
              <Card className="py-20 text-center text-slate-455 text-xs font-mono border-slate-100 bg-white">
                当前无符合筛选条件的素材表现指标数据
              </Card>
            ) : (
              <Card className="border border-slate-100 rounded-xl overflow-hidden shadow-sm bg-white">
                <div 
                  className="overflow-x-auto"
                  ref={metricsContainerRef}
                  onScroll={() => handleContainerScroll("metrics")}
                >
                  <Table>
                    <TableHeader className="bg-slate-50/75 border-b border-slate-100 [&_tr]:border-b-0">
                      <TableRow>
                        <TableHead 
                          onClick={() => handleMetricsSort("accountId")}
                          className="text-xs font-bold text-slate-700 h-11 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          广告账户 {renderSortIcon("accountId", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("adsetId")}
                          className="text-xs font-bold text-slate-700 h-11 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          广告组 ID (Ad Group ID) {renderSortIcon("adsetId", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("adId")}
                          className="text-xs font-bold text-slate-700 h-11 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          广告 ID (Ad ID) {renderSortIcon("adId", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("id")}
                          className="text-xs font-bold text-slate-700 h-11 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          素材 ID (Material ID) {renderSortIcon("id", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("type")}
                          className="text-xs font-bold text-slate-700 h-11 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          素材类型 {renderSortIcon("type", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("spend")}
                          className="text-xs font-bold text-slate-700 h-11 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          花费金额 {renderSortIcon("spend", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("purchases")}
                          className="text-xs font-bold text-slate-700 h-11 text-center whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          购物次数 {renderSortIcon("purchases", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("cpc")}
                          className="text-xs font-bold text-slate-700 h-11 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          单次购物费用 {renderSortIcon("cpc", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("impressions")}
                          className="text-xs font-bold text-slate-700 h-11 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          展示次数 {renderSortIcon("impressions", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("reach")}
                          className="text-xs font-bold text-slate-700 h-11 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          覆盖人数 {renderSortIcon("reach", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("ctr")}
                          className="text-xs font-bold text-slate-700 h-11 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          点击率 {renderSortIcon("ctr", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead 
                          onClick={() => handleMetricsSort("addToCart")}
                          className="text-xs font-bold text-slate-700 h-11 text-center whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-all"
                        >
                          加入购物车 {renderSortIcon("addToCart", metricsSortField, metricsSortOrder)}
                        </TableHead>
                        <TableHead className="text-xs font-bold text-slate-700 h-11 whitespace-nowrap">商品链接/落地页链接</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedMetricsCreatives.flatMap((c, idx) => {
                        const singlePurchaseCost = c.purchases > 0 ? (c.spend / c.purchases) : 0;
                        const row = (
                          <TableRow key={c.id} className="hover:bg-slate-50/50 align-middle">
                            {/* 1. 广告账户 */}
                            <TableCell className="py-3 whitespace-nowrap">
                              <MetaAccountDisplay
                                name={getCreativeAccountName(c)}
                                accountId={c.accountId}
                                nameClassName="text-[11px] font-semibold text-slate-700 truncate"
                                idClassName="text-[10px] text-slate-500 font-mono truncate"
                              />
                            </TableCell>
                            {/* 2. 广告组 ID */}
                            <TableCell className="py-3 font-mono text-[11px] text-slate-600 font-medium whitespace-nowrap">
                              {c.adsetId || "N/A"}
                            </TableCell>
                            {/* 3. 广告 ID */}
                            <TableCell className="py-3 font-mono text-[11px] text-slate-600 font-medium whitespace-nowrap">
                              {c.adId || "N/A"}
                            </TableCell>
                            {/* 4. 素材 ID */}
                            <TableCell className="py-3 font-mono text-[11px] text-slate-800 font-bold whitespace-nowrap">
                              {c.id}
                            </TableCell>
                            {/* 5. 素材类型 */}
                            <TableCell className="py-3 whitespace-nowrap">
                              {getTypeBadge(c.type)}
                            </TableCell>
                            {/* 4. 花费金额 */}
                            <TableCell className="py-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                              ${c.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            {/* 5. 购物次数 */}
                            <TableCell className="py-3 text-center font-mono font-bold text-blue-650 whitespace-nowrap">
                              {c.purchases}
                            </TableCell>
                            {/* 6. 单次购物费用 */}
                            <TableCell className="py-3 text-right font-mono whitespace-nowrap">
                              {singlePurchaseCost > 0 ? (
                                <span className="font-semibold text-slate-800">${singlePurchaseCost.toFixed(2)}</span>
                              ) : (
                                <span className="text-slate-400 font-medium">-</span>
                              )}
                            </TableCell>
                            {/* 7. 展示次数 */}
                            <TableCell className="py-3 text-right font-mono text-slate-500 whitespace-nowrap">
                              {c.impressions.toLocaleString()}
                            </TableCell>
                            {/* 8. 覆盖人数 */}
                            <TableCell className="py-3 text-right font-mono text-slate-500 whitespace-nowrap">
                              {c.reachAvailable && c.reach !== null && c.reach !== undefined ? c.reach.toLocaleString() : "N/A"}
                            </TableCell>
                            {/* 9. 点击率 */}
                            <TableCell className="py-3 text-right font-mono font-bold text-emerald-650 whitespace-nowrap">
                              {formatNullableMetric(c.ctr, 2, "%")}
                            </TableCell>
                            {/* 10. 加入购物车 */}
                            <TableCell className="py-3 text-center font-mono font-bold text-purple-650 whitespace-nowrap">
                              {c.addToCartAvailable && c.addToCart !== null && c.addToCart !== undefined ? c.addToCart : "N/A"}
                            </TableCell>
                            {/* 11. 商品链接/落地页链接 */}
                            <TableCell className="py-3">
                              <div className="max-w-[240px] min-w-[180px] flex items-center justify-between gap-1 bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100 rounded px-2.5 py-1 text-slate-800">
                                {c.productLink ? <a
                                  href={c.productLink}
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-mono text-meta-blue font-bold truncate block underline hover:text-blue-700"
                                  onClick={(e) => e.stopPropagation()}
                                  title={c.productLink}
                                >
                                  {c.productLink}
                                </a> : <span className="text-[11px] text-slate-500">落地页链接未同步</span>}
                                {c.productLink && <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                              </div>
                            </TableCell>
                          </TableRow>
                        );

                        if (idx === 9 && sortedMetricsCreatives.length > 10) {
                          const scrollRow = (
                            <TableRow key="floating-metrics-scrollbar-row" className="bg-slate-50/50 border-y border-slate-200">
                              <TableCell colSpan={13} className="p-0 h-6">
                                <div 
                                  className="overflow-x-auto w-full flex items-center h-6 bg-slate-100 border-b border-slate-200 scrollbar-thin scrollbar-thumb-slate-300"
                                  onScroll={(e) => handleScrollBarScroll("metrics", e)}
                                  ref={metricsScrollBarRef}
                                >
                                  <div style={{ width: `${metricsScrollWidth}px`, height: '1px' }} />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                          return [row, scrollRow];
                        }

                        return [row];
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* TAB 3: 素材趋势 */}
        {activeSubTab === "trends" && (
          <Card className="border border-slate-100 rounded-xl bg-white p-8">
            <div
              data-testid="creative-trend-unavailable"
              className="mx-auto max-w-xl rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center"
            >
              <p className="text-sm font-semibold text-slate-700">
                当前版本尚未建立素材日趋势事实
              </p>
              <p className="mt-2 text-xs text-slate-500">
                本页不展示推算曲线。当前素材判断以所选周期的真实汇总成效为准。
              </p>
            </div>
          </Card>
        )}
      </div>

{/* Slide-in Detailed Profile Drawer (深度诊断档案) */}
      {previewModalOpen && selectedPreviewCreative && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-lg h-full bg-white shadow-2xl flex flex-col justify-between slide-in-from-right duration-300 transform transition-all">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="w-8 h-8 rounded-full"
                  onClick={() => { setPreviewModalOpen(false); setSelectedPreviewCreative(null); }}
                >
                  <ChevronLeft className="w-5 h-5 text-slate-500" />
                </Button>
                <div>
                  <h3 className="text-xs font-extrabold text-slate-950 truncate max-w-[280px]" title={selectedPreviewCreative.creativeName}>
                    {selectedPreviewCreative.creativeName}
                  </h3>
                </div>
              </div>
              
              <Button 
                size="sm" 
                variant="outline" 
                className="h-8 border-[#e5e7eb] px-2.5 text-xs text-[#374151]"
                onClick={() => {
                  setPreviewModalOpen(false);
                  setSelectedPreviewCreative(null);
                }}
              >
                关闭面板
              </Button>
            </div>

            <div className="flex-grow overflow-y-auto p-5 space-y-5">
              
              {/* Media spec Block */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Maximize2 className="w-3.5 h-3.5 text-slate-500" /> 格式直达规格
                </p>
                <div className="h-56 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <CreativePreviewMedia row={selectedPreviewCreative} />
                </div>
                {selectedPreviewCreative.creativeId && (
                  <div className="mt-3">
                    <CreativeMetaLinkPanel
                      creativeId={selectedPreviewCreative.creativeId}
                      type={selectedPreviewCreative.type}
                    />
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-2 text-center text-xs mt-3 bg-slate-50 p-2.5 rounded-lg border border-slate-150 font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 block pb-0.5">建议最佳画幅</span>
                    <span className="font-bold text-slate-800">
                      {selectedPreviewCreative.type === "IMAGE" ? "1080 x 1080 (1:1)" : "1080 x 1920 (9:16)"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block pb-0.5">底层数据关联</span>
                    <span className="font-bold text-meta-blue">生产数据链路</span>
                  </div>
                </div>
              </div>

              {/* Data mapping path block */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 shadow-sm space-y-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">链式归因路径 (ATTRIBUTION PATH)</p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="bg-white px-3 py-2 rounded border border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-slate-400">广告账户:</span>
                    <MetaAccountDisplay
                      name={getCreativeAccountName(selectedPreviewCreative)}
                      accountId={selectedPreviewCreative.accountId}
                      className="text-right min-w-0"
                      nameClassName="font-bold text-slate-850 truncate"
                      idClassName="text-[10px] text-slate-500 font-mono truncate select-all"
                    />
                  </div>
                  <div className="bg-white px-3 py-2 rounded border border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-slate-400">广告组 ID:</span>
                    <span className="font-bold text-slate-850 select-all">{selectedPreviewCreative.adsetId || "N/A"}</span>
                  </div>
                  <div className="bg-white px-3 py-2 rounded border border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-slate-400">广告 ID:</span>
                    <span className="font-bold text-slate-850 select-all">{selectedPreviewCreative.adId || "N/A"}</span>
                  </div>
                  <div className="bg-white px-3 py-2 rounded border border-slate-100 flex items-center justify-between gap-2 bg-indigo-50/10 border-indigo-100/30">
                    <span className="text-[10px] font-semibold text-indigo-500">素材 / 创意 ID:</span>
                    <span className="font-bold text-indigo-700 select-all">{selectedPreviewCreative.creativeId || selectedPreviewCreative.id}</span>
                  </div>
                </div>
              </div>

              {/* Lifetime BI metrics funnel */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">区间全链路指标 (Funnel Data)</p>
                <div className="grid grid-cols-2 gap-3 font-mono">
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <p className="text-[9px] text-slate-400">曝光花费 (Spend)</p>
                    <p className="text-xs font-bold text-slate-900 mt-1">${selectedPreviewCreative.spend.toLocaleString(undefined, { minimumFractionDigits: 1 })}</p>
                  </div>
                  
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <p className="text-[9px] text-slate-400">转化营收 (Revenue)</p>
                    <p className="text-xs font-bold text-slate-900 mt-1">${selectedPreviewCreative.revenue.toLocaleString(undefined, { minimumFractionDigits: 1 })}</p>
                  </div>
                  
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <p className="text-[9px] text-slate-400">产出回报率 ROAS</p>
                    <p className="text-xs font-bold text-slate-900 mt-1">{formatNullableMetric(selectedPreviewCreative.roas, 2, "x")}</p>
                  </div>
                  
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <p className="text-[9px] text-slate-400">购买订单</p>
                    <p className="text-xs font-bold text-slate-900 mt-1">{(selectedPreviewCreative.purchases || 0).toLocaleString()}</p>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <p className="text-[9px] text-slate-400">展现成本 CPM</p>
                    <p className="text-xs font-bold text-slate-900 mt-1">{formatNullableMetric(selectedPreviewCreative.cpm, 2, "", "$")}</p>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <p className="text-[9px] text-slate-400">点击率 CTR</p>
                    <p className="text-xs font-bold text-slate-900 mt-1">{formatNullableMetric(selectedPreviewCreative.ctr, 2, "%")}</p>
                  </div>
                </div>
              </div>

              {/* Offline Rule Deep Intelligence Expert Audit Card */}
              <div className="bg-white border border-slate-200 p-4 rounded-xl space-y-2 shadow-sm">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">运营决策分组</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-900">{selectedPreviewCreative.opsBucketLabel || "数据不足"}</span>
                  <span className="text-xs font-mono text-slate-500">opsScore: {selectedPreviewCreative.opsScore ?? "--"}</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {selectedPreviewCreative.recommendedAction || "继续观察 24-48 小时"}
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {selectedPreviewCreative.diagnosisReason || "当前数据不足以做扩量或止损判断。"}
                </p>
                <Button
                  onClick={() => handleAskCreativeAI(selectedPreviewCreative)}
                  disabled={!isCreativeAiAllowed(selectedPreviewCreative, coverage).allowed}
                  className="w-full h-8 bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold rounded-lg"
                >
                  问 AI 分析该素材
                </Button>
                <Button
                  onClick={() => copyCreativeAiPrompt(selectedPreviewCreative)}
                  disabled={!isCreativeAiAllowed(selectedPreviewCreative, coverage).allowed}
                  variant="outline"
                  className="w-full h-8 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-lg"
                >
                  复制分析数据
                </Button>
              </div>

              {/* Offline Rule Deep Intelligence Expert Audit Card */}
              <div className="bg-slate-50 border border-indigo-150 p-4 rounded-xl space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600 animate-pulse" />
                    素材规则风险复核
                  </span>
                  {aiReport && (
                    <span
                      data-testid="creative-ai-confidence"
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700"
                    >
                      置信度：{formatCreativeAiConfidence(aiReport.confidence)}
                    </span>
                  )}
                </div>

                {aiLoading ? (
                  <div className="py-6 flex flex-col items-center justify-center text-center">
                    <RefreshCw className="w-6 h-6 animate-spin text-indigo-600 mb-2" />
                    <p className="text-xs font-semibold text-slate-600">正在评估底层成效与属性特征，进行离线规则审计...</p>
                    <p className="text-[10px] text-slate-400 mt-1">正在基于当前生产范围与事实覆盖重新计算。</p>
                  </div>
                ) : aiReport ? (
                  <div className="space-y-4 text-xs">
                    <CreativeAiReportPanel aiReport={aiReport} />
                    <Button
                      onClick={() => handleTriggerAiAnalysisForRow(selectedPreviewCreative)}
                      className="w-full h-8 bg-slate-100 text-slate-700 hover:bg-slate-200 text-[10px] font-bold rounded-lg border border-slate-200 transition-all"
                    >
                      🔄 重新评估审计该素材风险
                    </Button>
                  </div>
                ) : (
                  <div className="p-3 bg-white border border-dashed border-slate-200 rounded-lg text-center space-y-2.5">
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      本素材当前尚未生成规则风险复核。需要离线规则辅助时，可运行一次底层转化数据复核。
                    </p>
                    <Button
                      onClick={() => handleTriggerAiAnalysisForRow(selectedPreviewCreative)}
                      className="w-full h-9 bg-indigo-600 text-white hover:bg-slate-900 text-xs font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5"
                    >
                      <Sparkles className="w-4 h-4" />
                      运行规则复核
                    </Button>
                  </div>
                )}
              </div>

              {/* Dynamic local alert engine */}
              {(() => {
                const fatigue = evaluateSingleFatigue(selectedPreviewCreative.creativeId || selectedPreviewCreative.id, selectedPreviewCreative.creativeName, selectedPreviewCreative.type);
                return (
                  <div className="bg-slate-900 text-slate-100 p-5 rounded-xl space-y-3 border border-slate-800">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        低回报风险与性能诊断说明
                      </span>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${fatigue.riskBg}`}>
                        {fatigue.riskLevel}
                      </span>
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-400">风险评分:</span>
                        <span data-testid="creative-risk-score" className="font-bold text-white">
                          {formatCreativeRiskScore(fatigue.fatigueScore)}
                        </span>
                      </div>
                      
                      <div className="space-y-1.5 pt-2 border-t border-slate-800">
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">触发红线诊断因子:</p>
                        {fatigue.rulesTriggered.map((rule, sIdx) => (
                          <div key={sIdx} className="text-xs text-slate-300 leading-tight pl-2 border-l border-red-500 flex items-center gap-1 py-0.5 font-medium">
                            <span className="w-1 h-1 bg-red-500 rounded-full shrink-0"></span>
                            <span>{rule}</span>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-slate-800 leading-relaxed text-xs">
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider flex items-center gap-1">
                          <Zap className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                          深度诊断处方方案:
                        </p>
                        <div className="bg-slate-950 p-3 rounded border border-slate-800 text-slate-300">
                          {fatigue.recommendations.map((rec, recIdx) => (
                            <p key={recIdx} className="mb-1 last:mb-0 font-medium leading-relaxed">{rec}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <Button 
                className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg"
                onClick={() => {
                  setPreviewModalOpen(false);
                  const cleanAccId = selectedPreviewCreative.accountId ? (selectedPreviewCreative.accountId.toLowerCase().startsWith("act_") ? selectedPreviewCreative.accountId : `act_${selectedPreviewCreative.accountId}`) : "";
                  // Navigate using router search params
                  navigate(`/?tab=data-campaigns&accountId=${cleanAccId}&campaignId=${selectedPreviewCreative.campaignId || ""}&adsetId=${selectedPreviewCreative.adsetId || ""}&creativeId=${selectedPreviewCreative.creativeId || ""}`);
                  setSelectedPreviewCreative(null);
                }}
              >
                查看关联 Ad
              </Button>
              <Button 
                variant="outline"
                className="flex-1 h-10 border-slate-200 text-slate-700 bg-white font-semibold text-xs rounded-lg"
                onClick={() => { setPreviewModalOpen(false); setSelectedPreviewCreative(null); }}
              >
                确认关闭
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
