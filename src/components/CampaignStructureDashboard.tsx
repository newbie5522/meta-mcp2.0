import React, { useState, useEffect } from "react";
import axios from "axios";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { 
  Loader2, 
  RefreshCcw, 
  AlertTriangle, 
  Search, 
  Check, 
  ChevronRight, 
  Copy, 
  SlidersHorizontal,
  Building2,
  FolderGit2,
  Compass,
  Sparkles,
  ArrowLeft,
  CheckCircle,
  HelpCircle
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MetaAccountDisplay, metaAccountSearchText } from "./common/MetaAccountDisplay";
import { SyncStatusPanel, type SyncPanelStatus } from "./common/SyncStatusPanel";
import { DataViewTraceBar } from "./common/DataViewTraceBar";
import { mapSyncErrorToPanel, mapSyncResultToPanel, triggerSyncTask } from "@/lib/sync-trigger";
import {
  buildDataViewRequestKey,
  CURRENT_RANGE_NOT_READY_MESSAGE,
  DATE_RANGE_MISMATCH_MESSAGE,
  getSafeLastGoodData,
  isDateRangeMismatch,
  makeLastGoodData,
  shouldPreserveLastGoodData
} from "@/lib/data-view-state";

function getHierarchyEmptyMessage(dataHealth: any, includeZeroSpend: boolean) {
  if (dataHealth?.status === "EMPTY_STRUCTURE" || dataHealth?.reason === "NO_STRUCTURE_ROWS") {
    return "当前账户没有广告结构数据，请先同步广告结构。";
  }

  if (dataHealth?.status === "STRUCTURE_WITHOUT_FACTS" || dataHealth?.reason === "NO_FACT_LEVEL_ROWS") {
    return "结构已同步，成效未同步。当前日期范围没有广告成效事实数据。";
  }

  if (dataHealth?.reason === "FILTER_ZERO_SPEND_HIDDEN" && !includeZeroSpend) {
    return "当前筛选为“有消耗对象”，部分零消耗结构节点被隐藏。请切换到“全部对象”查看完整结构。";
  }

  return "未检索到符合条件的层级节点。请检查日期范围、账户筛选或同步状态。";
}

export function CampaignStructureDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  // Navigation level
  const [viewLevel, setViewLevel] = useState<"accounts" | "campaigns" | "adsets" | "ads">("accounts");

  // Selected entities and their readable names (saved for breadcrumb displays)
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [selectedAccountName, setSelectedAccountName] = useState<string>("");
  
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>("");
  
  const [selectedAdSetId, setSelectedAdSetId] = useState<string>("");
  const [selectedAdSetName, setSelectedAdSetName] = useState<string>("");

  // Filters & UI Config
  const [includeZeroSpend, setIncludeZeroSpend] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const [data, setData] = useState<any[]>([]);
  const [dataHealth, setDataHealth] = useState<any>(null);
  const [structureSummary, setStructureSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<SyncPanelStatus>({ status: "idle" });
  const [lastGoodData, setLastGoodData] = useState<any | null>(null);
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [responseDateRange, setResponseDateRange] = useState<{ startDate: string; endDate: string; timezone?: string } | null>(null);
  const startStrKey = format(startDate, "yyyy-MM-dd");
  const endStrKey = format(endDate, "yyyy-MM-dd");
  const currentRequestKey = buildDataViewRequestKey({
    page: "ad-hierarchy",
    startDate: startStrKey,
    endDate: endStrKey,
    level: viewLevel,
    accountId: selectedAccount || "all",
    campaignId: selectedCampaignId || "all",
    adsetId: selectedAdSetId || "all",
    includeZeroSpend,
    search: searchQuery,
    sort: sortConfig ? `${sortConfig.key}:${sortConfig.direction}` : "none"
  });

  useEffect(() => {
    setViewNotice(null);
    setResponseDateRange(null);
    setSyncStatus({ status: "idle" });
  }, [currentRequestKey]);

  // Manage initial load with URL parameters (deep linkage from Account Performance page or Creative Insights tab)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlAccId = params.get("accountId");
    const urlCampId = params.get("campaignId");
    const urlAdsetId = params.get("adsetId");
    const urlCreativeId = params.get("creativeId");

    if (urlAccId) {
      const cleanId = urlAccId.toLowerCase().startsWith("act_") ? urlAccId : `act_${urlAccId}`;
      setSelectedAccount(cleanId);
      setSelectedAccountName(cleanId);
      
      if (urlCampId && urlAdsetId && urlCreativeId) {
        setSelectedCampaignId(urlCampId);
        setSelectedCampaignName(`系列 ${urlCampId}`);
        setSelectedAdSetId(urlAdsetId);
        setSelectedAdSetName(`组 ${urlAdsetId}`);
        setSearchQuery(urlCreativeId);
        setViewLevel("ads");
      } else {
        setViewLevel("campaigns");
      }
    }
  }, []);

  // Fetch performance and structures depending on current view Level
  const fetchData = async () => {
    setLoading(true);
    try {
      const startStr = startStrKey;
      const endStr = endStrKey;
      const requestKey = currentRequestKey;
      const structureParams: any = {
        selectedAccount: selectedAccount || undefined,
        startDate: startStr,
        endDate: endStr,
        _requestKey: requestKey
      };

      if (viewLevel === "accounts") {
        const [accountsRes, structureRes] = await Promise.all([
          axios.get("/api/data-center/ad-hierarchy/accounts", {
            params: {
              startDate: startStr,
              endDate: endStr,
              includeZeroSpend: includeZeroSpend ? "true" : "false",
              _requestKey: requestKey
            }
          }),
          axios.get("/api/data-center/structure", { params: structureParams })
        ]);

        const rows = accountsRes.data?.success ? (accountsRes.data.data || []) : [];
        const nextHealth = accountsRes.data?.dataHealth || structureRes.data?.health || null;
        const statePayload = {
          ...(accountsRes.data || {}),
          health: nextHealth,
          appliedFilters: accountsRes.data?.appliedFilters || structureRes.data?.appliedFilters,
          dateRange: accountsRes.data?.dateRange || structureRes.data?.dateRange
        };
        setResponseDateRange(statePayload.dateRange || null);
        if (isDateRangeMismatch(statePayload, startStr, endStr)) {
          const safeLastGoodData = getSafeLastGoodData(lastGoodData, requestKey);
          if (!safeLastGoodData) {
            setData([]);
            setStructureSummary(null);
            setDataHealth(nextHealth);
            setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
            return;
          }
          setData(safeLastGoodData.data || []);
          setStructureSummary(safeLastGoodData.structureSummary || null);
          setDataHealth(safeLastGoodData.dataHealth || null);
          setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
          return;
        }
        if (shouldPreserveLastGoodData(statePayload, rows, lastGoodData, requestKey)) {
          const safeLastGoodData = getSafeLastGoodData(lastGoodData, requestKey);
          if (safeLastGoodData) {
            setData(safeLastGoodData.data || []);
            setStructureSummary(safeLastGoodData.structureSummary || null);
            setDataHealth(safeLastGoodData.dataHealth || null);
            setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
            return;
          }
        }
        setStructureSummary(structureRes.data || null);
        setDataHealth(nextHealth);
        setData(rows);
        setLastGoodData(makeLastGoodData(requestKey, rows, { structureSummary: structureRes.data || null, dataHealth: nextHealth }));
        setViewNotice(null);
        return;
      }

      const hierarchyEndpoint =
        viewLevel === "campaigns"
          ? "/api/data-center/ad-hierarchy/campaigns"
          : viewLevel === "adsets"
            ? "/api/data-center/ad-hierarchy/adsets"
            : "/api/data-center/ad-hierarchy/ads";
      const hierarchyParams: any = {
        startDate: startStr,
        endDate: endStr,
        includeZeroSpend: includeZeroSpend ? "true" : "false",
        accountId: selectedAccount || undefined,
        campaignId: selectedCampaignId || undefined,
        adsetId: selectedAdSetId || undefined,
        _requestKey: requestKey
      };
      const res = await axios.get(hierarchyEndpoint, { params: hierarchyParams });
      const hierarchyPayload = res.data || {};
      let nextData: any[] = hierarchyPayload.data || [];
      setResponseDateRange(hierarchyPayload.dateRange || hierarchyPayload.appliedFilters || null);

      if (isDateRangeMismatch(hierarchyPayload, startStr, endStr)) {
        const safeLastGoodData = getSafeLastGoodData(lastGoodData, requestKey);
        if (!safeLastGoodData) {
          setData([]);
          setStructureSummary(hierarchyPayload);
          setDataHealth(hierarchyPayload.dataHealth || hierarchyPayload.health || null);
          setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
          return;
        }
        setData(safeLastGoodData.data || []);
        setStructureSummary(safeLastGoodData.structureSummary || null);
        setDataHealth(safeLastGoodData.dataHealth || null);
        setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
        return;
      }
      if (shouldPreserveLastGoodData(hierarchyPayload, nextData, lastGoodData, requestKey)) {
        const safeLastGoodData = getSafeLastGoodData(lastGoodData, requestKey);
        if (safeLastGoodData) {
          setData(safeLastGoodData.data || []);
          setStructureSummary(safeLastGoodData.structureSummary || null);
          setDataHealth(safeLastGoodData.dataHealth || null);
          setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
          return;
        }
      }
      setStructureSummary(hierarchyPayload);
      setDataHealth(hierarchyPayload.dataHealth || hierarchyPayload.health || null);
      setData(nextData);
      setLastGoodData(makeLastGoodData(requestKey, nextData, { structureSummary: hierarchyPayload, dataHealth: hierarchyPayload.dataHealth || hierarchyPayload.health || null }));
      setViewNotice(null);
    } catch (e: any) {
      console.error("Failed to fetch ad hierarchy details:", e);
      toast.error("获取层级数据失败: " + (e.response?.data?.error || e.message));
      const safeLastGoodData = getSafeLastGoodData(lastGoodData, currentRequestKey);
      if (safeLastGoodData) {
        setData(safeLastGoodData.data || []);
        setStructureSummary(safeLastGoodData.structureSummary || null);
        setDataHealth(safeLastGoodData.dataHealth || null);
        setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
      } else {
        setData([]);
        setStructureSummary(null);
        setDataHealth({
          status: "REQUEST_FAILED",
          reason: "FETCH_FAILED_FOR_CURRENT_REQUEST",
          message: "当前筛选周期请求失败，未使用其他日期周期的旧数据。",
          dateRange: {
            startDate: startStrKey,
            endDate: endStrKey,
            timezone: "America/Los_Angeles"
          }
        });
        setViewNotice("当前筛选周期请求失败，未展示其他日期周期的旧数据。");
      }
    } finally {
      setLoading(false);
    }
  };

  // Trigger loading when context filters update
  useEffect(() => {
    fetchData();
  }, [viewLevel, selectedAccount, selectedCampaignId, selectedAdSetId, startStrKey, endStrKey, includeZeroSpend]);

  // Reset sorting config when entering a new level to avoid stale keys
  useEffect(() => {
    setSortConfig(null);
  }, [viewLevel]);

  // Search logic
  const filteredData = data.filter((row: any) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();

    if (viewLevel === "accounts") {
      const accountSearchText = metaAccountSearchText(row.fb_account_name, row.fb_account_id);
      const store = (row.storeName || "").toLowerCase();
      return accountSearchText.includes(query) || store.includes(query);
    }
    if (viewLevel === "campaigns") {
      const name = (row.name || "").toLowerCase();
      const id = (row.id || "").toLowerCase();
      const obj = (row.objective || "").toLowerCase();
      return name.includes(query) || id.includes(query) || obj.includes(query);
    }
    if (viewLevel === "adsets") {
      const name = (row.name || "").toLowerCase();
      const id = (row.id || "").toLowerCase();
      const parentCamp = (row.campaignName || "").toLowerCase();
      return name.includes(query) || id.includes(query) || parentCamp.includes(query);
    }
    if (viewLevel === "ads") {
      const name = (row.name || "").toLowerCase();
      const id = (row.id || "").toLowerCase();
      const parentAdset = (row.adsetName || "").toLowerCase();
      const parentCamp = (row.campaignName || "").toLowerCase();
      const creative = (row.creativeId || "").toLowerCase();
      return name.includes(query) || id.includes(query) || parentAdset.includes(query) || parentCamp.includes(query) || creative.includes(query);
    }
    return true;
  });

  // Sorting logic
  const requestSort = (key: string) => {
    let direction: "asc" | "desc" = "desc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    }
    setSortConfig({ key, direction });
  };

  const sortedData = [...filteredData].sort((a, b) => {
    if (!sortConfig) return 0;
    const aVal = a[sortConfig.key];
    const bVal = b[sortConfig.key];
    
    if (aVal === undefined || bVal === undefined) return 0;
    
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    }
    
    const strA = String(aVal).toLowerCase();
    const strB = String(bVal).toLowerCase();
    if (strA < strB) return sortConfig.direction === "asc" ? -1 : 1;
    if (strA > strB) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });
  const shouldShowStructureNotice = Boolean(
    structureSummary &&
    !loading &&
    sortedData.length === 0 &&
    dataHealth?.status &&
    !["READY", "OK"].includes(String(dataHealth.status).toUpperCase())
  );

  // Copy helper for Creative ID
  const handleCopyText = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    toast.success(`复制成功: ${text}`);
  };

  // AI prompt builder customized for current active level
  const handleAskAI = (row: any, e: React.MouseEvent) => {
    e.stopPropagation();
    let promptText = "";
    if (viewLevel === "accounts") {
      promptText = `分析 Meta 广告账户表现 [${row.fb_account_name}] (ID: ${row.fb_account_id})：
- 日期范围: ${format(startDate, "yyyy-MM-dd")} ~ ${format(endDate, "yyyy-MM-dd")}
- 绑定店铺: ${row.storeName}
- 花费金额: $${row.spend.toFixed(2)}
- 展现次数: ${row.impressions.toLocaleString()}
- 点击数量: ${row.clicks}
- 平均点击率 (CTR): ${row.ctr.toFixed(2)}%
- 单次点击费用 (CPC): $${row.cpc.toFixed(2)}
- 千次展示成本 (CPM): $${row.cpm.toFixed(2)}
- 购买成效: ${row.purchases}
- 单次获客成本 (CPA/CPP): $${row.cpa.toFixed(2)}
- Meta 报告 ROAS: ${row.roas.toFixed(2)}

作为资深海外广告投放专家，请为此账户的整体花费效率、CTR 瓶颈以及获客成本提供全面的诊断分析和预算倾斜建议。`;
    } else if (viewLevel === "campaigns") {
      promptText = `分析 Meta 广告系列 [${row.name}] (ID: ${row.id})：
- 状态: ${row.status}
- 营销目标: ${row.objective}
- 花费金额: $${row.spend.toFixed(2)}
- 展现次数: ${row.impressions.toLocaleString()}
- 点击量: ${row.clicks}
- 点击率 (CTR): ${row.ctr.toFixed(2)}%
- 单次点击费用 (CPC): $${row.cpc.toFixed(2)}
- 转化购买量: ${row.purchases}
- 获客成本 (CPA): $${row.cpa.toFixed(2)}
- ROAS: ${row.roas.toFixed(2)}

作为优化师，请在该 Campaign 的状态与表现反馈下给出竞价决策，应当扩增预算、进行成本优化还是关停，并补充可能的优化策略。`;
    } else if (viewLevel === "adsets") {
      promptText = `分析 Meta 广告组 [${row.name}] (ID: ${row.id})：
- 所属广告系列: ${row.campaignName}
- 花费金额: $${row.spend.toFixed(2)}
- 展现次数: ${row.impressions.toLocaleString()}
- 点击数量: ${row.clicks}
- 点击率 (CTR): ${row.ctr.toFixed(2)}%
- 千次展示成本 (CPM): $${row.cpm.toFixed(2)}
- 购买获客量: ${row.purchases}
- 单次获客成本 (CPA): $${row.cpa.toFixed(2)}
- 转化率 ROAS: ${row.roas.toFixed(2)}

请根据该 Ad Set 层级的效果反馈提供受众定位和扩增/紧缩竞价调优战术。`;
    } else if (viewLevel === "ads") {
      promptText = `分析 Meta 广告创意 [${row.name}] (ID: ${row.id})：
- 创意 ID (Creative ID): ${row.creativeId}
- 所属广告组: ${row.adsetName}
- 所属广告系列: ${row.campaignName}
- 花费金额: $${row.spend.toFixed(2)}
- 展现量: ${row.impressions.toLocaleString()}
- 点击量: ${row.clicks}
- 点击率 (CTR): ${row.ctr.toFixed(2)}%
- 千次显示费用 (CPM): $${row.cpm.toFixed(2)}
- 购买成效: ${row.purchases}
- 获客成本 (CPA): $${row.cpa.toFixed(2)}
- 转化 ROAS: ${row.roas.toFixed(2)}

请评估该 Creative ID 素材方案的转化成效，并针对后续的素材测试与创意设计迭代方向提供可行思路。`;
    }

    const context = {
      level: viewLevel,
      accountId: selectedAccount || row.fb_account_id || row.accountId || "",
      accountName: selectedAccountName || row.fb_account_name || row.accountName || "",
      campaignId: row.campaignId || (viewLevel === "campaigns" ? row.id : selectedCampaignId) || "",
      adsetId: row.adsetId || (viewLevel === "adsets" ? row.id : selectedAdSetId) || "",
      adId: viewLevel === "ads" ? row.id : "",
      name: row.name || row.fb_account_name || row.id,
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      purchases: Number(row.purchases || 0),
      cpa: Number(row.cpa || 0),
      roas: Number(row.roas || 0),
      dateRange: {
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd")
      }
    };

    window.dispatchEvent(new CustomEvent("open-ai-context", {
      detail: {
        source: "campaign_structure",
        title: `分析${viewLevel}: ${context.name || context.adId || context.campaignId || context.accountId}`,
        prompt: promptText,
        context
      }
    }));

    navigator.clipboard.writeText(promptText).catch(() => undefined);
    toast.success("已打开 AI 上下文，并已复制该层级分析提示词。", { duration: 4000 });
  };

  // Level-Up Navigation back-links
  const navigateBackTo = (target: "accounts" | "campaigns" | "adsets") => {
    if (target === "accounts") {
      setSelectedAccount("");
      setSelectedAccountName("");
      setSelectedCampaignId("");
      setSelectedCampaignName("");
      setSelectedAdSetId("");
      setSelectedAdSetName("");
      setViewLevel("accounts");
    } else if (target === "campaigns") {
      setSelectedCampaignId("");
      setSelectedCampaignName("");
      setSelectedAdSetId("");
      setSelectedAdSetName("");
      setViewLevel("campaigns");
    } else if (target === "adsets") {
      setSelectedAdSetId("");
      setSelectedAdSetName("");
      setViewLevel("adsets");
    }
  };

  // Sync utilities trigger
  const handleSyncAdHierarchy = async () => {
    setSyncing(true);
    const tId = toast.loading("正在触发真实同步任务...");
    const startStr = format(startDate, "yyyy-MM-dd");
    const endStr = format(endDate, "yyyy-MM-dd");
    const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1);

    setSyncStatus({
      status: "running",
      message: "正在执行广告层级视图同步...",
      progressPercent: 10,
      currentStep: 1,
      totalSteps: 1,
      stepLabel: "广告层级视图同步",
      processedAccounts: 0,
      totalAccounts: selectedAccount ? 1 : null
    });

    try {
      const result = await triggerSyncTask({
        taskType: "sync_view_ad_hierarchy",
        accountId: selectedAccount || undefined,
        startDate: startStr,
        endDate: endStr,
        days,
        limit: selectedAccount ? undefined : 200
      });

      setSyncStatus(mapSyncResultToPanel(result));

      if (String(result?.status || "").toUpperCase() === "RUNNING") {
        toast.info("广告层级同步任务正在运行，请稍后查看进度。", { id: tId });
      } else {
        toast.success("广告层级视图同步完成，正在刷新页面数据。", { id: tId });
      }
      await fetchData();
    } catch (err: any) {
      const data = err.data || err.response?.data || err.response;
      const panel = mapSyncErrorToPanel(err);
      setSyncStatus(panel);
      if (panel.status === "running") {
        toast.info("已有同步任务正在运行，请稍后查看进度", { id: tId });
      } else {
        toast.error("同步数据失败: " + (data?.message || data?.details || data?.error || err.message), { id: tId });
      }
    } finally {
      setSyncing(false);
    }
  };

  // Footer totals
  const totalSpend = filteredData.reduce((sum, item) => sum + (item.spend || 0), 0);
  const totalImpressions = filteredData.reduce((sum, item) => sum + (item.impressions || 0), 0);
  const totalClicks = filteredData.reduce((sum, item) => sum + (item.clicks || 0), 0);
  const totalPurchases = filteredData.reduce((sum, item) => sum + (item.purchases || 0), 0);
  const totalPurchaseValue = filteredData.reduce((sum, item) => sum + (item.purchaseValue || item.purchase_value || 0), 0);

  const totalCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const totalCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const totalCPM = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
  const totalCPA = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
  const totalROAS = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

  return (
    <div id="ad-hierarchy-dashboard-container" className="flex flex-col h-full bg-[#f9fafb] p-6 space-y-6">
      
      {/* 4-Tier Interactive Navigation Breadcrumbs */}
      <div id="breadcrumb-navigation-bar" className="flex items-center gap-2 text-sm text-slate-500 bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
        <span 
          id="crumb-level-accounts"
          className={cn(
            "cursor-pointer hover:text-blue-600 transition-colors font-medium flex items-center gap-1.5",
            viewLevel === "accounts" ? "text-slate-900 font-bold" : "text-slate-400"
          )}
          onClick={() => navigateBackTo("accounts")}
        >
          <Building2 className="w-4 h-4" />
          广告账户
        </span>
        
        {selectedAccount && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span 
              id="crumb-level-campaigns"
              className={cn(
                "cursor-pointer hover:text-blue-600 transition-colors font-medium flex items-center gap-1.5 max-w-[180px] truncate",
                viewLevel === "campaigns" ? "text-slate-900 font-bold" : "text-slate-400"
              )}
              onClick={() => navigateBackTo("campaigns")}
              title={`${selectedAccountName || "账户名称未同步"} / ${selectedAccount}`}
            >
              <FolderGit2 className="w-4 h-4" />
              {selectedAccountName || selectedAccount}
            </span>
          </>
        )}

        {selectedCampaignId && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span 
              id="crumb-level-adsets"
              className={cn(
                "cursor-pointer hover:text-blue-600 transition-colors font-medium flex items-center gap-1.5 max-w-[180px] truncate",
                viewLevel === "adsets" ? "text-slate-900 font-bold" : "text-slate-400"
              )}
              onClick={() => navigateBackTo("adsets")}
              title={selectedCampaignName || selectedCampaignId}
            >
              <Compass className="w-4 h-4" />
              {selectedCampaignName || selectedCampaignId}
            </span>
          </>
        )}

        {selectedAdSetId && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span 
              id="crumb-level-ads"
              className="font-bold text-slate-900 flex items-center gap-1.5 max-w-[180px] truncate"
              title={selectedAdSetName || selectedAdSetId}
            >
              <Sparkles className="w-4 h-4 text-indigo-500" />
              {selectedAdSetName || selectedAdSetId}
            </span>
          </>
        )}
      </div>

      {/* Top Functional Filters & Sync Buttons */}
      <div id="ad-hierarchy-actions-hub" className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Level back navigation support button */}
          {viewLevel !== "accounts" && (
            <Button
              id="nav-back-button"
              variant="outline"
              size="sm"
              className="h-9 px-3 text-slate-600 border-slate-200 hover:bg-slate-50 transition-all font-medium"
              onClick={() => {
                if (viewLevel === "campaigns") navigateBackTo("accounts");
                if (viewLevel === "adsets") navigateBackTo("campaigns");
                if (viewLevel === "ads") navigateBackTo("adsets");
              }}
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              返回上一级
            </Button>
          )}

          {/* Real-time search query box */}
          <div className="relative w-[240px] md:w-[280px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="search-input-field"
              type="text"
              placeholder={
                viewLevel === "accounts" ? "搜索账户名称/ID..." :
                viewLevel === "campaigns" ? "搜索 Campaign 名称/ID..." :
                viewLevel === "adsets" ? "搜索 Ad Set 名称/ID..." : "搜索广告/创意/Campaign..."
              }
              className="w-full pl-9 pr-3 h-9 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50 transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Range visibility segment select */}
          <div id="visibility-range-switcher" className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 h-9 items-center">
            <button
              id="switcher-btn-comsumed"
              onClick={() => setIncludeZeroSpend(false)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all h-8",
                !includeZeroSpend 
                  ? "bg-white text-slate-800 shadow-sm" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              有消耗对象
            </button>
            <button
              id="switcher-btn-all"
              onClick={() => setIncludeZeroSpend(true)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all h-8",
                includeZeroSpend 
                  ? "bg-white text-slate-800 shadow-sm" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              全部对象
            </button>
          </div>
        </div>

        {/* Sync Controls Side */}
        <div id="sync-buttons-group" className="flex items-center gap-2">
          <Button
            id="reload-view-btn"
            variant="outline"
            size="sm"
            className="h-9 px-3 border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCcw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            刷新页面数据
          </Button>

          <Button
            id="sync-ad-hierarchy-btn"
            variant="outline"
            size="sm"
            className="h-9 px-3 border-blue-200 text-blue-700 bg-blue-50/10 hover:bg-blue-50"
            onClick={handleSyncAdHierarchy}
            disabled={loading || syncing}
          >
            同步数据
          </Button>
        </div>
      </div>

      <SyncStatusPanel status={syncStatus} />

      <DataViewTraceBar
        currentStartDate={startStrKey}
        currentEndDate={endStrKey}
        responseStartDate={responseDateRange?.startDate}
        responseEndDate={responseDateRange?.endDate}
        timezone={responseDateRange?.timezone || "America/Los_Angeles"}
        rowCount={data.length}
        factRows={dataHealth?.factRows}
        structureRows={dataHealth?.structureRows}
        status={dataHealth?.status || structureSummary?.health?.status || "UNKNOWN"}
        level={viewLevel}
        queryDebug={dataHealth?.queryDebug || structureSummary?.dataHealth?.queryDebug || structureSummary?.health?.queryDebug}
        extra={
          <>
            <span>花费：${totalSpend.toFixed(2)}</span>
            <span>展示：{totalImpressions.toLocaleString()}</span>
            <span>点击：{totalClicks.toLocaleString()}</span>
            <span>购买：{totalPurchases.toLocaleString()}</span>
            <span>说明：同一层级行数可能不变，请以指标和事实行数判断日期差异。</span>
          </>
        }
        source="广告层级结构 + 广告成效数据"
      />

      {viewNotice && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {viewNotice}
        </div>
      )}

      {shouldShowStructureNotice && !viewNotice && (
        <div className={cn(
          "rounded-xl border p-4 text-xs shadow-sm",
          dataHealth?.status === "STRUCTURE_WITHOUT_FACTS"
            ? "bg-slate-50 border-slate-200 text-slate-700"
            : dataHealth?.status === "EMPTY_STRUCTURE"
              ? "bg-slate-50 border-slate-200 text-slate-700"
              : "bg-white border-slate-200 text-slate-700"
        )}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>结构行数：<b className="font-mono">{structureSummary.structureRowsCount ?? dataHealth?.structureRows ?? 0}</b></span>
            <span>成效事实行数：<b className="font-mono">{structureSummary.factRowsCount ?? dataHealth?.factRows ?? 0}</b></span>
            <span>状态：<b className="font-mono">{dataHealth?.status || "UNKNOWN"}</b></span>
            <span>当前统计期间：<b className="font-mono">{structureSummary.appliedFilters?.startDate || format(startDate, "yyyy-MM-dd")}</b> 至 <b className="font-mono">{structureSummary.appliedFilters?.endDate || format(endDate, "yyyy-MM-dd")}</b></span>
          </div>
          {dataHealth?.status === "STRUCTURE_WITHOUT_FACTS" && (
            <p className="mt-2 font-semibold">
              结构已同步，成效未同步。当前日期范围内没有广告成效事实数据，请同步广告成效数据或扩大日期范围。
            </p>
          )}
          {dataHealth?.missingReason && dataHealth?.status !== "STRUCTURE_WITHOUT_FACTS" && (
            <p className="mt-2">{dataHealth.missingReason}</p>
          )}
        </div>
      )}

      {/* Main Data View Table */}
      <div id="ad-hierarchy-table-wrapper" className="w-full">
        <Card className="border border-slate-200 shadow-sm overflow-hidden bg-white rounded-2xl">
          <div className="overflow-x-auto w-full">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                <span className="text-sm font-medium text-slate-500">正在重组并聚合 Level 排布数据...</span>
              </div>
            ) : (
              <Table id="hierarchy-detailed-table" className="w-full">
                <TableHeader id="hierarchy-table-header" className="bg-slate-50 border-b border-slate-100">
                  <TableRow>
                    
                    {/* View Specific Header Definitions */}
                    {viewLevel === "accounts" && (
                      <>
                        <TableHead className="font-bold text-slate-700 cursor-pointer hover:bg-slate-100" onClick={() => requestSort("fb_account_name")}>广告账户</TableHead>
                        <TableHead className="font-bold text-slate-700 cursor-pointer hover:bg-slate-100" onClick={() => requestSort("storeName")}>绑定店铺</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center">币种</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("spend")}>花费金额</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("impressions")}>展示</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("clicks")}>点击</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("ctr")}>点击率 (CTR)</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpc")}>单次点击 (CPC)</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpm")}>千展成本 (CPM)</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("purchases")}>购买成效</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpa")}>客单单价 (CPA)</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("roas")}>ROAS</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center">结构数 (C/S/A)</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center text-indigo-600">快捷操作</TableHead>
                      </>
                    )}

                    {viewLevel === "campaigns" && (
                      <>
                        <TableHead className="font-bold text-slate-700 cursor-pointer hover:bg-slate-100" onClick={() => requestSort("name")}>广告系列 (Campaign)</TableHead>
                        <TableHead className="font-bold text-slate-700">Campaign ID</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center">状态</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center">目标 Objective</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("spend")}>花费金额</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("impressions")}>展示</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("clicks")}>点击</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("ctr")}>CTR</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpc")}>CPC</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpm")}>CPM</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("purchases")}>购买量</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpa")}>CPA</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("roas")}>ROAS</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center text-indigo-600">快捷操作</TableHead>
                      </>
                    )}

                    {viewLevel === "adsets" && (
                      <>
                        <TableHead className="font-bold text-slate-700 cursor-pointer hover:bg-slate-100" onClick={() => requestSort("name")}>广告组 (Ad Set)</TableHead>
                        <TableHead className="font-bold text-slate-700">Ad Set ID</TableHead>
                        <TableHead className="font-bold text-slate-700">所属 Campaign</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center">状态</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("spend")}>花费金额</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("impressions")}>展示</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("clicks")}>点击</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("ctr")}>CTR</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpc")}>CPC</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpm")}>CPM</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("purchases")}>购买量</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpa")}>CPA</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("roas")}>ROAS</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center text-indigo-600">快捷操作</TableHead>
                      </>
                    )}

                    {viewLevel === "ads" && (
                      <>
                        <TableHead className="font-bold text-slate-700 cursor-pointer hover:bg-slate-100" onClick={() => requestSort("name")}>广告名称 (Ad Name)</TableHead>
                        <TableHead className="font-bold text-slate-700">Ad ID</TableHead>
                        <TableHead className="font-bold text-slate-700">Creative ID</TableHead>
                        <TableHead className="font-bold text-slate-700">所属 Ad Set</TableHead>
                        <TableHead className="font-bold text-slate-700">所属 Campaign</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("spend")}>花费金额</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("impressions")}>展示</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("clicks")}>点击</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("ctr")}>CTR</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpc")}>CPC</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpm")}>CPM</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("purchases")}>购买量</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("cpa")}>CPA</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right cursor-pointer hover:bg-slate-100" onClick={() => requestSort("roas")}>ROAS</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center text-indigo-600">问 AI</TableHead>
                      </>
                    )}

                  </TableRow>
                </TableHeader>
                
                <TableBody id="hierarchy-table-rows">
                  {sortedData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={viewLevel === "ads" ? 15 : 14} className="text-center py-20 text-gray-500">
                        <div className="flex flex-col items-center justify-center max-w-xl mx-auto bg-slate-50 p-6 rounded-2xl border border-slate-200">
                          <AlertTriangle className="w-10 h-10 text-slate-400 mb-3" />
                          <p className="text-sm font-semibold text-slate-700">
                            {getHierarchyEmptyMessage(dataHealth, includeZeroSpend)}
                          </p>
                          {dataHealth?.reason && (
                            <p className="mt-3 text-[11px] text-slate-400 font-mono">
                              状态原因：{dataHealth.reason}
                            </p>
                          )}
                          {(dataHealth?.factRows !== undefined || dataHealth?.structureRows !== undefined || dataHealth?.level) && (
                            <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-slate-400 font-mono">
                              {dataHealth?.factRows !== undefined && <span>事实行数：{dataHealth.factRows}</span>}
                              {dataHealth?.structureRows !== undefined && <span>结构行数：{dataHealth.structureRows}</span>}
                              {dataHealth?.level && <span>层级：{dataHealth.level}</span>}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedData.map((row) => (
                      <TableRow key={row.id} className="hover:bg-slate-50/80 transition-colors border-b select-none">
                        
                        {/* VIEW LEVEL ACCOUNTS */}
                        {viewLevel === "accounts" && (
                          <>
                            <TableCell className="max-w-[220px]">
                              <button
                                type="button"
                                className="block w-full text-left cursor-pointer"
                                onClick={() => {
                                  setSelectedAccount(row.fb_account_id);
                                  setSelectedAccountName(row.fb_account_name);
                                  setViewLevel("campaigns");
                                }}
                              >
                                <MetaAccountDisplay
                                  name={row.fb_account_name}
                                  accountId={row.fb_account_id}
                                  nameClassName="font-semibold text-blue-600 hover:underline truncate"
                                  idClassName="font-mono text-xs text-slate-500 truncate"
                                />
                              </button>
                            </TableCell>
                            <TableCell>
                              {row.isBound ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-semibold">
                                  <CheckCircle className="w-3 h-3 text-emerald-600" />
                                  {row.storeName}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-400 text-xs">
                                  未关联店铺
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-center font-bold text-xs text-slate-500 uppercase">{row.currency}</TableCell>
                            <TableCell className="text-right font-semibold">${row.spend.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-slate-600">{row.impressions.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-slate-600">{row.clicks.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">{row.ctr.toFixed(2)}%</TableCell>
                            <TableCell className="text-right font-medium">${row.cpc.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium text-slate-500">${row.cpm.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">{row.purchases}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">${row.cpa.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-black text-blue-600 bg-blue-50/20">{row.roas.toFixed(2)}</TableCell>
                            <TableCell className="text-center">
                              <span className="inline-flex gap-1 text-[11px] font-mono text-slate-400">
                                <span>{row.campaignCount}C</span>/
                                <span>{row.adsetCount}S</span>/
                                <span>{row.adCount}A</span>
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 py-1"
                                  onClick={() => {
                                    setSelectedAccount(row.fb_account_id);
                                    setSelectedAccountName(row.fb_account_name);
                                    setViewLevel("campaigns");
                                  }}
                                >
                                  查看系列
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 hover:bg-slate-100 text-indigo-500 hover:text-indigo-600"
                                  onClick={(e) => handleAskAI(row, e)}
                                  title="向 AI 发问诊断"
                                >
                                  💬
                                </Button>
                              </div>
                            </TableCell>
                          </>
                        )}

                        {/* VIEW LEVEL CAMPAIGNS */}
                        {viewLevel === "campaigns" && (
                          <>
                            <TableCell className="font-semibold text-blue-600 hover:underline cursor-pointer max-w-[200px] truncate" onClick={() => {
                              setSelectedCampaignId(row.id);
                              setSelectedCampaignName(row.name);
                              setViewLevel("adsets");
                            }} title={row.name}>
                              {row.name}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-400">{row.id}</TableCell>
                            <TableCell className="text-center">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                                row.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                              )}>
                                {row.status}
                              </span>
                            </TableCell>
                            <TableCell className="text-center text-xs text-slate-500 font-medium">{row.objective}</TableCell>
                            <TableCell className="text-right font-semibold">${row.spend.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-slate-500">{row.impressions.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-slate-500">{row.clicks.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">{row.ctr.toFixed(2)}%</TableCell>
                            <TableCell className="text-right font-medium">${row.cpc.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium text-slate-400">${row.cpm.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">{row.purchases}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">${row.cpa.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-black text-blue-600">{row.roas.toFixed(2)}</TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[11px] font-bold text-blue-600 py-1"
                                  onClick={() => {
                                    setSelectedCampaignId(row.id);
                                    setSelectedCampaignName(row.name);
                                    setViewLevel("adsets");
                                  }}
                                >
                                  查看广告组
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-indigo-500"
                                  onClick={(e) => handleAskAI(row, e)}
                                >
                                  💬
                                </Button>
                              </div>
                            </TableCell>
                          </>
                        )}

                        {/* VIEW LEVEL ADSETS */}
                        {viewLevel === "adsets" && (
                          <>
                            <TableCell className="font-semibold text-blue-600 hover:underline cursor-pointer max-w-[200px] truncate" onClick={() => {
                              setSelectedAdSetId(row.id);
                              setSelectedAdSetName(row.name);
                              setViewLevel("ads");
                            }} title={row.name}>
                              {row.name}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-400">{row.id}</TableCell>
                            <TableCell className="max-w-[150px] truncate text-slate-500 text-xs" title={row.campaignName}>{row.campaignName}</TableCell>
                            <TableCell className="text-center">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                                {row.status}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-semibold">${row.spend.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-slate-500">{row.impressions.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-slate-500">{row.clicks.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">{row.ctr.toFixed(2)}%</TableCell>
                            <TableCell className="text-right font-medium">${row.cpc.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium text-slate-400">${row.cpm.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">{row.purchases}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">${row.cpa.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-black text-blue-600">{row.roas.toFixed(2)}</TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[11px] font-bold text-blue-600 py-1"
                                  onClick={() => {
                                    setSelectedAdSetId(row.id);
                                    setSelectedAdSetName(row.name);
                                    setViewLevel("ads");
                                  }}
                                >
                                  查看广告
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-indigo-500"
                                  onClick={(e) => handleAskAI(row, e)}
                                >
                                  💬
                                </Button>
                              </div>
                            </TableCell>
                          </>
                        )}

                        {/* VIEW LEVEL ADS */}
                        {viewLevel === "ads" && (
                          <>
                            <TableCell className="font-semibold text-slate-800 max-w-[200px] truncate" title={row.name}>
                              {row.name}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-400">{row.id}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {row.creativeId && row.creativeId !== "N/A" ? (
                                <span 
                                  className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded cursor-pointer font-bold select-all transition-colors border border-slate-200" 
                                  onClick={(e) => handleCopyText(row.creativeId, e)}
                                  title="点击一键复制 Creative ID"
                                >
                                  <Copy className="w-3 h-3 text-slate-400" />
                                  {row.creativeId}
                                </span>
                              ) : (
                                <span className="text-slate-300 italic">空创意绑定</span>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[150px] truncate text-slate-500 text-xs" title={row.adsetName}>{row.adsetName}</TableCell>
                            <TableCell className="max-w-[150px] truncate text-slate-500 text-xs" title={row.campaignName}>{row.campaignName}</TableCell>
                            <TableCell className="text-right font-semibold">${row.spend.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-slate-500">{row.impressions.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-slate-500">{row.clicks.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">{row.ctr.toFixed(2)}%</TableCell>
                            <TableCell className="text-right font-medium">${row.cpc.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium text-slate-400">${row.cpm.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">{row.purchases}</TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">${row.cpa.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-black text-blue-600">{row.roas.toFixed(2)}</TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-indigo-500"
                                onClick={(e) => handleAskAI(row, e)}
                              >
                                💬
                              </Button>
                            </TableCell>
                          </>
                        )}

                      </TableRow>
                    ))
                  )}
                </TableBody>
                
                {filteredData.length > 0 && (
                  <TableFooter className="bg-slate-50 font-bold border-t sticky bottom-0 border-slate-200 shadow-inner">
                    <TableRow>
                      
                      {/* Sum columns match column headers dynamically */}
                      {viewLevel === "accounts" && (
                        <>
                          <TableCell className="font-bold">成效汇总 ({filteredData.length} 账号)</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalSpend.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalImpressions.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalClicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-900">{totalCTR.toFixed(2)}%</TableCell>
                          <TableCell className="text-right text-slate-900">${totalCPC.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-500">${totalCPM.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">{totalPurchases}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalCPA.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-black text-blue-600 bg-blue-100/20">{totalROAS.toFixed(2)}</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                        </>
                      )}

                      {viewLevel === "campaigns" && (
                        <>
                          <TableCell className="font-bold">成效汇总 ({filteredData.length} 系列)</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalSpend.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalImpressions.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalClicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-900">{totalCTR.toFixed(2)}%</TableCell>
                          <TableCell className="text-right text-slate-900">${totalCPC.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-500">${totalCPM.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">{totalPurchases}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalCPA.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-black text-blue-600">{totalROAS.toFixed(2)}</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                        </>
                      )}

                      {viewLevel === "adsets" && (
                        <>
                          <TableCell className="font-bold">成效汇总 ({filteredData.length} 广告组)</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalSpend.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalImpressions.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalClicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-900">{totalCTR.toFixed(2)}%</TableCell>
                          <TableCell className="text-right text-slate-900">${totalCPC.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-500">${totalCPM.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">{totalPurchases}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalCPA.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-black text-blue-600">{totalROAS.toFixed(2)}</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                        </>
                      )}

                      {viewLevel === "ads" && (
                        <>
                          <TableCell className="font-bold">成效汇总 ({filteredData.length} 创意广告)</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalSpend.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalImpressions.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-700">{totalClicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-slate-900">{totalCTR.toFixed(2)}%</TableCell>
                          <TableCell className="text-right text-slate-900">${totalCPC.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-slate-500">${totalCPM.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">{totalPurchases}</TableCell>
                          <TableCell className="text-right font-bold text-slate-900">${totalCPA.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-black text-blue-600">{totalROAS.toFixed(2)}</TableCell>
                          <TableCell className="text-slate-400">—</TableCell>
                        </>
                      )}

                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
