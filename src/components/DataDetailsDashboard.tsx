// @ts-nocheck
import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { format, isValid } from "date-fns";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { 
  Database, 
  RefreshCcw, 
  Search, 
  TrendingUp, 
  Sparkles,
  AlertTriangle,
  Info
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  triggerSyncTask,
  formatSyncReceipt,
  getSyncErrorMessage,
  mapSyncErrorToPanel,
  mapSyncResultToPanel
} from "@/lib/sync-trigger";
import { MetaAccountDisplay, metaAccountSearchText } from "./common/MetaAccountDisplay";
import { SyncStatusPanel, type SyncPanelStatus } from "./common/SyncStatusPanel";
import { DataViewTraceBar } from "./common/DataViewTraceBar";

import { useNavigate } from "react-router-dom";

interface DataDetailsDashboardProps {
  startDate: Date;
  endDate: Date;
}

function getApiErrorMessage(error: any): string {
  const data = error?.response?.data;
  const code = data?.error || data?.code;
  if (code === "MANUAL_SYNC_DISABLED") {
    return "该同步任务被安全开关拦截。普通账户表现同步请使用页面上的受限同步按钮。";
  }
  if (!error?.response) {
    return `后端服务未连接或请求失败：${error?.message || "network error"}`;
  }
  return data?.message || data?.details || data?.error || error?.message || "请求失败";
}

export function DataDetailsDashboard({ startDate, endDate }: DataDetailsDashboardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({
    metaInsights: [],
    accounts: [],
    filters: { stores: [], adAccounts: [], mappings: [] },
    health: { status: "EMPTY", missingReason: "", lastSyncTime: null, lastSyncTimeStr: "无记录", isSyncActive: false }
  });

  // Local filter states
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  
  // Status Filter state: "spend" | "active" | "all" | "unmapped"
  const [statusFilter, setStatusFilter] = useState<"spend" | "active" | "all" | "unmapped">("all");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncPanelStatus>({ status: "idle" });
  const [lastGoodData, setLastGoodData] = useState<any>(null);
  const [autoRefreshPolling, setAutoRefreshPolling] = useState(false);
  const [showHistoricalAccounts, setShowHistoricalAccounts] = useState(false);

  // Sorting configurations
  const [sortField, setSortField] = useState<string>("spend");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const loadData = async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true;

    if (!silent) {
      setLoading(true);
    }

    try {
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");

      const response = await axios.get("/api/data-center/accounts-performance", {
        params: {
          startDate: startStr,
          endDate: endStr,
          storeId: storeFilter,
          includeHistoricalAccounts: showHistoricalAccounts ? "true" : "false"
        }
      });

      setData(response.data);
      setLastGoodData(response.data);
    } catch (error: any) {
      console.error("Load Accounts Performance error:", error);

      if (lastGoodData) {
        setData(lastGoodData);
      }

      if (!silent) {
        toast.error("加载账户数据明细失败: " + getApiErrorMessage(error));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate, storeFilter, showHistoricalAccounts]);

  const shouldPollAutoRefresh = Boolean(
    data?.freshness?.refreshing ||
    data?.freshness?.latestAutoRefreshStatus === "running" ||
    data?.health?.isSyncActive
  );

  useEffect(() => {
    if (!shouldPollAutoRefresh) {
      setAutoRefreshPolling(false);
      return;
    }

    setAutoRefreshPolling(true);

    const timer = window.setInterval(() => {
      loadData({ silent: true });
    }, 8000);

    return () => {
      window.clearInterval(timer);
    };
  }, [shouldPollAutoRefresh, startDate, endDate, storeFilter, showHistoricalAccounts]);
  
  // Client filtering + sorting based on requirements
  const filteredAccounts = useMemo(() => {
    let list = [...(data.accounts || [])];

    const isActiveAccount = (item: any) => (item.spend || 0) > 0;

    // 1. Apply Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter((item) => 
        metaAccountSearchText(item.fb_account_name, item.fb_account_id).includes(term) ||
        (item.storeName || "").toLowerCase().includes(term)
      );
    }

    // 2. Apply Custom Account Status Filters
    if (statusFilter === "spend") {
      // 有消耗账户: spend > 0
      list = list.filter(item => (item.spend || 0) > 0);
    } else if (statusFilter === "active") {
      // 活跃账户: spend > 0
      list = list.filter(item => isActiveAccount(item));
    } else if (statusFilter === "unmapped") {
      // 未绑定店铺账户: isBound is false
      list = list.filter(item => !item.isBound);
    }
    // "all" doesn't filter out anything

    // 3. Sort List
    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === undefined) return 1;
      if (valB === undefined) return -1;

      if (typeof valA === "string") {
        return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortOrder === "asc" ? valA - valB : valB - valA;
    });

    return list;
  }, [data.accounts, searchTerm, statusFilter, sortField, sortOrder]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleSyncAccounts = async () => {
    setSyncing(true);
    const startStr = format(startDate, "yyyy-MM-dd");
    const endStr = format(endDate, "yyyy-MM-dd");
    const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1);

    const toastId = toast.loading(
      "开始同步 Meta 账户与当前日期范围表现..."
    );

    setSyncStatus({
      status: "running",
      message: "正在同步 Meta 账户列表..."
    });

    try {
      const accountsResult = await triggerSyncTask({
        taskType: "sync_meta_accounts"
      });

      setSyncStatus({
        status: "running",
        message: "账户列表已同步，正在拉取当前日期范围广告表现...",
        chainId: accountsResult.chainId || null,
        taskIds: accountsResult.taskIds || null,
        recordsFetched: accountsResult.recordsFetched ?? null,
        recordsSaved: accountsResult.recordsSaved ?? null,
        recordsUpdated: accountsResult.recordsUpdated ?? null,
        targetAccountsCount: accountsResult.targetAccountsCount ?? null,
        failedAccounts: accountsResult.failedAccounts || null
      });

      const insightsResult = await triggerSyncTask({
        taskType: "sync_meta_insights",
        startDate: startStr,
        endDate: endStr,
        days,
        limit: 200
      });

      setSyncStatus({
        status: "running",
        message: "Meta 广告表现已同步，正在刷新 DataCenter 账本...",
        chainId: insightsResult.chainId || null,
        taskIds: insightsResult.taskIds || null,
        recordsFetched: insightsResult.recordsFetched ?? null,
        recordsSaved: insightsResult.recordsSaved ?? null,
        recordsUpdated: insightsResult.recordsUpdated ?? null,
        targetAccountsCount: insightsResult.targetAccountsCount ?? null,
        failedAccounts: insightsResult.failedAccounts || null
      });

      const ledgerResult = await triggerSyncTask({
        taskType: "refresh_meta_datacenter_ledger",
        startDate: startStr,
        endDate: endStr,
        storeId: storeFilter === "all" ? null : Number(storeFilter),
        includeUnmapped: true
      });

      const panelResult = mapSyncResultToPanel({
        ...ledgerResult,
        chainId: ledgerResult.chainId || insightsResult.chainId || accountsResult.chainId,
        taskIds: [
          ...(accountsResult.taskIds || []),
          ...(insightsResult.taskIds || []),
          ...(ledgerResult.taskIds || [])
        ],
        recordsFetched: ledgerResult.recordsFetched ?? insightsResult.recordsFetched,
        recordsSaved: ledgerResult.recordsSaved ?? insightsResult.recordsSaved,
        recordsUpdated: ledgerResult.recordsUpdated ?? insightsResult.recordsUpdated,
        targetAccountsCount: insightsResult.targetAccountsCount ?? accountsResult.targetAccountsCount,
        failedAccounts: insightsResult.failedAccounts || ledgerResult.failedAccounts || null
      });
      setSyncStatus(panelResult);

      toast.success(formatSyncReceipt({
        ...ledgerResult,
        recordsFetched: panelResult.recordsFetched ?? undefined,
        recordsSaved: panelResult.recordsSaved ?? undefined,
        recordsUpdated: panelResult.recordsUpdated ?? undefined,
        targetAccountsCount: panelResult.targetAccountsCount ?? undefined
      }), {
        id: toastId,
        duration: 7000
      });

      await loadData();
    } catch (error: any) {
      setSyncStatus(mapSyncErrorToPanel(error));
      toast.error(`Meta 同步失败: ${getSyncErrorMessage(error)}`, {
        id: toastId,
        duration: 8000
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleAskAI = (row: any) => {
    const prompt = `分析广告账户：${row.fb_account_name} (${row.fb_account_id})\n关联店铺：${row.storeName}\n花费 $${row.spend.toFixed(2)}，曝光 ${row.impressions}，点击数 ${row.clicks}，点击率 ${row.ctr.toFixed(2)}%，购买数 ${row.purchases}，CPC $${row.cpc.toFixed(2)}，CPA $${(row.cpa || 0).toFixed(2)}，Meta ROAS ${row.roas.toFixed(2)}。如何优化投放预算？`;
    navigator.clipboard.writeText(prompt);
    toast.success("💡 已自动复制账户多维诊断提示词！请点击右侧 AI Copilot 悬浮窗粘贴提问。");
  };

  const handleViewHierarchy = (accountId: string) => {
    const startStr = format(startDate, "yyyy-MM-dd");
    const endStr = format(endDate, "yyyy-MM-dd");
    navigate(`/?tab=data-campaigns&accountId=${accountId}&startDate=${startStr}&endDate=${endStr}`);
  };

  const allAccountsCount = data.accountsInventoryCount ?? data.summary?.totalAccounts ?? data.accounts?.length ?? 0;
  const totalAdAccountsInventoryCount = data.totalAdAccountsInventoryCount ?? allAccountsCount;
  const hiddenHistoricalAccountsCount = data.hiddenHistoricalAccountsCount ?? 0;
  const accountDisplayScope = data.accountDisplayScope || data.dataSourceExplain?.accountDisplayScope || "active_only";
  const accountsWithFactsCount = data.accountsWithFactsCount ?? data.accounts?.filter(a => a.lastSyncedAt || (a.impressions || 0) > 0 || (a.clicks || 0) > 0).length ?? 0;
  const withSpendCount = data.accountsWithSpendCount ?? data.summary?.spendAccounts ?? data.accounts?.filter(a => (a.spend || 0) > 0).length ?? 0;
  const unboundWithSpendCount = data.accounts?.filter(a => !a.isBound && (a.spend || 0) > 0).length || 0;
  const factRowsCount = data.metaReconciliation?.canonicalFactRows ?? data.metaFactsCount ?? 0;
  const hasAccountInventoryWithoutFacts = allAccountsCount > 0 && factRowsCount === 0;
  const appliedStartDate = data.appliedFilters?.startDate || format(startDate, "yyyy-MM-dd");
  const appliedEndDate = data.appliedFilters?.endDate || format(endDate, "yyyy-MM-dd");
  const displayScopeText = accountDisplayScope === "historical_all" ? "全部历史账户" : "当前日期范围内活跃账户";

  // Formatting date safely
  const formatTimeStr = (rawVal: any) => {
    if (!rawVal) return "无记录";
    try {
      const d = new Date(rawVal);
      if (isValid(d)) {
        return format(d, "yyyy-MM-dd HH:mm:ss");
      }
    } catch (_) {}
    return "无记录";
  };

  const lastSyncTimeVal = formatTimeStr(data.health?.lastSyncTime);

  return (
    <div className="flex flex-col gap-6" id="data-details-viewer">
      
      {/* Sleek Mini Footprint Status Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 font-medium">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 font-medium">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full animate-pulse",
              (data.metaFreshness?.secondsSinceLatestSync !== null && data.metaFreshness?.secondsSinceLatestSync > 1800)
                ? "bg-orange-500"
                : "bg-blue-500"
            )}></span>
            <span>
              最近同步时间: <strong className="text-slate-800 font-mono">{lastSyncTimeVal}</strong>
              {autoRefreshPolling && (
                <span className="ml-2 text-blue-600 font-semibold">
                  后台刷新中，页面将自动更新
                </span>
              )}
            </span>
          </div>
          <div>
            <span>
              当前显示账户数: <strong className="text-slate-800 font-mono">{allAccountsCount}</strong>
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span>
              有消耗账户数量: <strong className="text-blue-600 font-mono">{withSpendCount}</strong>
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span>
              展示范围:
              <strong className={cn(
                "ml-1 font-mono",
                accountDisplayScope === "historical_all" ? "text-purple-700" : "text-emerald-700"
              )}>
                {displayScopeText}
              </strong>
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span>
              当前统计期间: <strong className="text-slate-800 font-mono">{appliedStartDate}</strong> 至 <strong className="text-slate-800 font-mono">{appliedEndDate}</strong>
            </span>
          </div>
          {data.metaFreshness?.latestFactDate && (
            <div>
              <span className="text-slate-300">|</span>
              <span className="ml-2">最新事实日期: <strong className="text-emerald-700 font-mono">{data.metaFreshness.latestFactDate}</strong></span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2.5 font-medium border-slate-200 bg-white hover:bg-slate-50 transition shadow-sm"
            onClick={loadData}
            disabled={loading || syncing}
          >
            <RefreshCcw className={cn("w-3 h-3 text-slate-500", loading && "animate-spin")} />
            刷新页面数据
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2.5 font-medium border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition shadow-sm"
            onClick={handleSyncAccounts}
            disabled={loading || syncing}
          >
            <RefreshCcw className={cn("w-3 h-3", syncing && "animate-spin")} />
            同步数据
          </Button>
        </div>
      </div>

      <SyncStatusPanel status={syncStatus} />

      <DataViewTraceBar
        currentStartDate={format(startDate, "yyyy-MM-dd")}
        currentEndDate={format(endDate, "yyyy-MM-dd")}
        responseStartDate={data.dateRange?.startDate || data.appliedFilters?.startDate}
        responseEndDate={data.dateRange?.endDate || data.appliedFilters?.endDate}
        timezone={data.dateRange?.timezone || data.appliedFilters?.timezone || "America/Los_Angeles"}
        rowCount={data.accounts?.length || 0}
        factRows={factRowsCount}
        status={data.health?.status || "UNKNOWN"}
        level="account"
        source="广告成效数据 + 广告账户"
      />

      {/* Meta Freshness Warning Alert Box */}
      {data.metaFreshness && (data.metaFreshness.warning || (data.metaFreshness.secondsSinceLatestSync !== null && data.metaFreshness.secondsSinceLatestSync > 1800)) && (
        <div className="flex items-start gap-3 p-4 bg-orange-50/60 border border-orange-200 rounded-xl text-slate-850 text-xs shadow-sm">
          <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5 animate-pulse" />
          <div className="space-y-1 text-left flex-1">
            <h5 className="font-bold text-orange-950">Meta 消耗数据过期提醒</h5>
            <p className="text-orange-900 font-medium leading-relaxed">
              {data.metaFreshness.warning || "Meta 消耗数据已过期，建议立即触发实时刷新。"}
            </p>
            <p className="text-slate-500 leading-relaxed text-[11.5px]">
              说明：由于 Meta API 有频控，本功能将直接对 Meta 广告账户并发请求 account level 增量成效数据，直接使用 Meta 提供的 API 起始日 date_start 覆写 SOT。为了安全与性能，建议高频更新时限定为单店铺或限定账户。
              {(data.metaFreshness.secondsSinceLatestSync !== null) && ` (当前已延迟 ${Math.floor(data.metaFreshness.secondsSinceLatestSync / 60)} 分钟)`}
            </p>
          </div>
        </div>
      )}

      {/* Dynamic Critical warning panel of mSpend unmapped accounts */}
      {unboundWithSpendCount > 0 && (
        <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-slate-800 text-xs shadow-sm">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="space-y-1 text-left">
            <h5 className="font-bold text-rose-900">数据健康提醒：存在未绑定且有消耗账户</h5>
            <p className="text-rose-700 leading-relaxed">
              当前有 <strong className="font-mono text-red-700">{unboundWithSpendCount}</strong> 个未绑定店铺但有消耗的账户。该问题只影响店铺级 ROAS 归因，不影响账户级 Meta 表现查看。请在数据健康检测中处理映射关系。
            </p>
          </div>
        </div>
      )}

      {/* Warning banner of missing/empty metrics if no accounts have spend */}
      {withSpendCount === 0 && !loading && (
        <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs shadow-sm">
          <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div>
            <h5 className="font-bold text-slate-900 mb-0.5">
              {hasAccountInventoryWithoutFacts ? "账户已存在，但当前日期范围暂无广告表现事实数据" : "当前日期范围内没有有消耗账户"}
            </h5>
            <p className="text-slate-600 leading-relaxed">
              {hasAccountInventoryWithoutFacts ? (
                <>
                  配置中心已保存 <strong className="font-mono">{allAccountsCount}</strong> 个 Meta 广告账户，但所选日期范围
                  (<strong>{appliedStartDate}</strong> 至 <strong>{appliedEndDate}</strong>)
                  暂无广告成效事实记录。下方仍展示账户库存，花费、展示、点击、购买和 ROAS 按 0 展示。
                </>
              ) : (
                <>
                  系统在选定的日期范围内 (<strong>{appliedStartDate}</strong> 至 <strong>{appliedEndDate}</strong>)
                  未发现具有广告花费的活跃账户。请前往“<strong>数据同步中心</strong>”手动对 Meta 资产成效数据执行一次强制提取与加载。
                </>
              )}
            </p>
            {data.health?.lastFailedSync?.errorMessage && (
              <p className="mt-2 text-rose-700 leading-relaxed">
                最近同步失败原因：{data.health.lastFailedSync.errorMessage}
              </p>
            )}
          </div>
        </div>
      )}

      {data.health?.status === "SYNC_FAILED" && withSpendCount > 0 && !loading && (
        <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs shadow-sm">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <h5 className="font-bold text-rose-900 mb-0.5">最近一次 Meta 同步失败</h5>
            <p className="text-rose-700 leading-relaxed">
              {data.health?.lastFailedSync?.errorMessage || data.health?.missingReason || "后端同步失败，但未返回具体错误。"}
            </p>
          </div>
        </div>
      )}

      {/* Primary Filtering controls */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        
        {/* Left Side: Status buttons filter */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg shrink-0">
          <button
            onClick={() => setStatusFilter("spend")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all text-slate-600",
              statusFilter === "spend" ? "bg-white text-slate-900 shadow-sm font-bold" : "hover:text-slate-900"
            )}
          >
            有消耗账户 ({withSpendCount})
          </button>
          <button
            onClick={() => setStatusFilter("active")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all text-slate-600",
              statusFilter === "active" ? "bg-white text-slate-900 shadow-sm font-bold" : "hover:text-slate-900"
            )}
          >
            活跃账户 ({data.summary?.activeAccounts ?? withSpendCount})
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all text-slate-600",
              statusFilter === "all" ? "bg-white text-slate-900 shadow-sm font-bold" : "hover:text-slate-900"
            )}
          >
            全部账户 ({allAccountsCount})
          </button>
          <button
            onClick={() => setStatusFilter("unmapped")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all text-slate-600",
              statusFilter === "unmapped" ? "bg-white text-slate-900 shadow-sm font-bold" : "hover:text-slate-900"
            )}
          >
            未绑定店铺 ({data.accounts?.filter(a => !a.isBound).length || 0})
          </button>
        </div>

        {/* Right Side: inputs and dropdown selection */}
        <div className="flex items-center gap-2 flex-wrap md:flex-nowrap w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="搜索账户名称或 ID..."
              className="pl-8 h-8 w-full rounded-lg border border-slate-200 bg-white font-medium text-slate-850 outline-none placeholder:text-slate-400 focus:border-blue-550 focus:ring-1 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="h-8 px-2 border border-slate-200 bg-white rounded-lg text-slate-600 font-semibold outline-none cursor-pointer hover:bg-slate-50 transition shadow-sm"
          >
            <option value="all">选择店铺筛选</option>
            {data.filters?.stores?.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 text-[11px] px-3 font-semibold transition shadow-sm",
              showHistoricalAccounts
                ? "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            )}
            onClick={() => setShowHistoricalAccounts(prev => !prev)}
            disabled={loading || syncing}
          >
            {showHistoricalAccounts ? "切回活跃账户" : "查看全部历史账户"}
          </Button>
        </div>
      </div>

      <div className={cn(
        "flex items-start gap-3 p-3 rounded-xl border text-xs shadow-sm",
        showHistoricalAccounts
          ? "bg-purple-50 border-purple-200 text-purple-900"
          : "bg-emerald-50 border-emerald-200 text-emerald-900"
      )}>
        <Info className={cn(
          "w-4 h-4 shrink-0 mt-0.5",
          showHistoricalAccounts ? "text-purple-600" : "text-emerald-600"
        )} />
        <div className="leading-relaxed">
          {showHistoricalAccounts ? (
            <>
        当前正在展示全部历史账户库存，仅用于排查绑定、命名和历史资料。系统不会因为打开此视图而同步全部账户，也不会把无消耗历史账户纳入 Data Center 默认计算。
           </>
          ) : (
            <>
              当前默认只展示近 90 天活跃账户，隐藏了
              <strong className="mx-1 font-mono">{hiddenHistoricalAccountsCount}</strong>
              个历史无活跃账户，以降低页面负担和 Meta API 同步压力。需要排查历史账户时，可点击“查看全部历史账户”。
            </>
          )}
        </div>
      </div>

      {loading ? (
            
        <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white rounded-2xl border border-slate-200 min-h-[300px] shadow-sm">
          <RefreshCcw className="w-8 h-8 animate-spin text-blue-500 mb-3" />
          <p className="text-xs font-semibold">正在调阅数据库核心账户指标表...</p>
        </div>
      ) : (
        /* Real Account Table view */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              Meta 广告账户级周期表现 (Meta Ad Accounts Multi-day Performance Insights)
            </h4>
            <span className="text-[11px] font-mono text-slate-500 font-semibold bg-slate-100 px-3 py-0.5 rounded-full border">
              满足筛选: {filteredAccounts.length} / {allAccountsCount} 个 · 有事实账户 {accountsWithFactsCount} 个
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table className="text-[12px] table-fixed w-full min-w-[1250px]">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[110px]" />
                <col className="w-[110px]" />
                <col className="w-[70px]" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
                <col className="w-[90px]" />
                <col className="w-[75px]" />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[90px]" />
                <col className="w-[100px]" />
                <col className="w-[130px]" />
              </colgroup>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="font-semibold text-slate-700 h-10">广告账户</TableHead>
                  <TableHead className="font-semibold text-slate-700">绑定店铺</TableHead>
                  <TableHead className="font-semibold text-slate-700">币种/时区</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-center">状态</TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("spend")}>
                    广告花费 {sortField === "spend" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("impressions")}>
                    展现量 {sortField === "impressions" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("clicks")}>
                    点击数 {sortField === "clicks" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("ctr")}>
                    点击率 {sortField === "ctr" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("cpc")}>
                    CPC {sortField === "cpc" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("cpm")}>
                    CPM {sortField === "cpm" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("purchases")}>
                    购买数 {sortField === "purchases" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 cursor-pointer text-right" onClick={() => toggleSort("cpa")}>
                    CPA {sortField === "cpa" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-blue-600 text-right cursor-pointer" onClick={() => toggleSort("roas")}>
                    Meta ROAS {sortField === "roas" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                  </TableHead>
                  <TableHead className="font-semibold text-slate-700 text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center p-12 text-slate-400 font-medium">
                      <Database className="w-8 h-8 mx-auto opacity-30 mb-2 text-slate-500" />
                      {allAccountsCount > 0
                        ? "当前筛选条件下暂无账户。请切换到“全部账户”查看已保存的 Meta 账户库存。"
                        : "暂无 Meta 广告账户库存。请先在配置中心保存 token 并拉取账户。"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAccounts.map((row, index) => {
                    const hasSpend = (row.spend || 0) > 0;
                    const isUnboundWithSpend = !row.isBound && hasSpend;
                    return (
                      <TableRow 
                        key={row.fb_account_id || index} 
                        className={cn(
                          "hover:bg-slate-50 border-b group transition-colors",
                          isUnboundWithSpend && "bg-rose-50/50 hover:bg-rose-100/60 border-l-2 border-l-rose-500"
                        )}
                      >
                        <TableCell className="font-medium text-slate-900 overflow-hidden text-ellipsis">
                          <button
                            type="button"
                            className="block w-full text-left cursor-pointer"
                            onClick={() => handleViewHierarchy(row.fb_account_id)}
                          >
                            <MetaAccountDisplay
                              name={row.fb_account_name}
                              accountId={row.fb_account_id}
                              nameClassName="font-bold text-blue-600 hover:underline text-[13px] truncate"
                              idClassName="text-[10px] text-slate-400 font-mono truncate"
                            />
                          </button>
                        </TableCell>
                        <TableCell className="text-slate-600">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[11px] font-semibold block text-center truncate",
                            row.isBound 
                              ? "bg-blue-50 text-blue-700 border border-blue-100" 
                              : "bg-slate-100 text-slate-400"
                          )}>
                            {row.isBound ? row.storeName : "未绑定店铺"}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          <div>{row.currency || "USD"}</div>
                          <div className="text-[10px] text-slate-400 truncate" title={row.timezone}>{row.timezone || "America/Los_Angeles"}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          {(row.spend || 0) > 0 || row.activityStatus === 1 ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-100">
                              活跃
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-55 text-slate-400 text-[10px] font-medium border border-slate-100">
                              静默
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={cn("text-right font-bold font-mono", hasSpend ? "text-slate-900" : "text-slate-400")}>
                          ${(row.spend || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">{(row.impressions || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">{(row.clicks || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-slate-650 font-mono">{(row.ctr || 0).toFixed(2)}%</TableCell>
                        <TableCell className="text-right text-slate-650 font-mono">${(row.cpc || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-slate-650 font-mono">${(row.cpm || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-slate-950 font-mono font-bold">{(row.purchases || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-slate-650 font-mono">${(row.cpa || 0).toFixed(2)}</TableCell>
                        <TableCell className={cn("text-right font-mono font-bold", (row.roas || 0) > 0 ? "text-rose-600" : "text-slate-400")}>
                          {(row.roas || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleViewHierarchy(row.fb_account_id)}
                              className="px-2 py-1 text-slate-600 bg-slate-105 rounded hover:bg-blue-600 hover:text-white transition-all text-[11px] font-medium border border-slate-200"
                            >
                              广告层级
                            </button>
                            <button
                              onClick={() => handleAskAI(row)}
                              className="px-2 py-1 text-white bg-blue-650 bg-blue-600 rounded hover:bg-blue-700 transition-all text-[11px] font-semibold shadow-sm"
                            >
                              问 AI
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
