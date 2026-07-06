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
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");
      const structureParams: any = {
        selectedAccount: selectedAccount || undefined,
        startDate: startStr,
        endDate: endStr
      };

      if (viewLevel === "accounts") {
        const [accountsRes, structureRes] = await Promise.all([
          axios.get("/api/data-center/ad-hierarchy/accounts", {
            params: {
              startDate: startStr,
              endDate: endStr,
              includeZeroSpend: includeZeroSpend ? "true" : "false"
            }
          }),
          axios.get("/api/data-center/structure", { params: structureParams })
        ]);

        setStructureSummary(structureRes.data || null);
        setDataHealth(structureRes.data?.health || accountsRes.data?.dataHealth || null);
        setData(accountsRes.data?.success ? (accountsRes.data.data || []) : []);
        return;
      }

      const res = await axios.get("/api/data-center/structure", { params: structureParams });
      const payload = res.data || {};
      const campaignNameById = new Map((payload.campaigns || []).map((campaign: any) => [campaign.id, campaign.name]));
      const adsetNameById = new Map((payload.adsets || []).map((adset: any) => [adset.id, adset.name]));
      let nextData: any[] = [];

      if (viewLevel === "campaigns") {
        nextData = payload.campaigns || [];
      } else if (viewLevel === "adsets") {
        nextData = (payload.adsets || [])
          .filter((row: any) => !selectedCampaignId || row.campaignId === selectedCampaignId)
          .map((row: any) => ({
            ...row,
            campaignName: campaignNameById.get(row.campaignId) || row.campaignId
          }));
      } else if (viewLevel === "ads") {
        nextData = (payload.ads || [])
          .filter((row: any) => !selectedAdSetId || row.adsetId === selectedAdSetId)
          .map((row: any) => ({
            ...row,
            adsetName: adsetNameById.get(row.adsetId) || row.adsetId,
            campaignName: campaignNameById.get(row.campaignId) || row.campaignId
          }));
      }

      if (!includeZeroSpend) {
        nextData = nextData.filter((row: any) => Number(row.spend || 0) > 0);
      }

      setStructureSummary(payload);
      setDataHealth(payload.health || null);
      setData(nextData);
    } catch (e: any) {
      console.error("Failed to fetch ad hierarchy details:", e);
      toast.error("获取层级数据失败: " + (e.response?.data?.error || e.message));
      setData([]);
      setStructureSummary(null);
    } finally {
      setLoading(false);
    }
  };

  // Trigger loading when context filters update
  useEffect(() => {
    fetchData();
  }, [viewLevel, selectedAccount, selectedCampaignId, selectedAdSetId, startDate, endDate, includeZeroSpend]);

  // Reset sorting config when entering a new level to avoid stale keys
  useEffect(() => {
    setSortConfig(null);
  }, [viewLevel]);

  // Search logic
  const filteredData = data.filter((row: any) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();

    if (viewLevel === "accounts") {
      const name = (row.fb_account_name || "").toLowerCase();
      const id = (row.fb_account_id || "").toLowerCase();
      const store = (row.storeName || "").toLowerCase();
      return name.includes(query) || id.includes(query) || store.includes(query);
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

    navigator.clipboard.writeText(promptText);
    toast.success("💡 智能复制了此层级优化的提示词！可直接在右下角 AI 诊断中粘贴提问。", { duration: 4000 });
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
    const tId = toast.loading("正在触发真实同步任务...");
    try {
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");

      await axios.post("/api/sync/trigger", {
        taskType: "sync_meta_creatives",
        accountId: selectedAccount || undefined,
        startDate: startStr,
        endDate: endStr,
        days: 30
      });

      toast.success("同步数据任务已触发，稍后自动刷新视图。", { id: tId });
      setTimeout(fetchData, 3000);
    } catch (err: any) {
      toast.error("同步数据失败: " + (err.response?.data?.message || err.message), { id: tId });
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
              title={selectedAccountName || selectedAccount}
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
          >
            同步数据
          </Button>
        </div>
      </div>

      {structureSummary && (
        <div className={cn(
          "rounded-xl border p-4 text-xs shadow-sm",
          dataHealth?.status === "STRUCTURE_WITHOUT_FACTS"
            ? "bg-amber-50 border-amber-200 text-amber-900"
            : dataHealth?.status === "EMPTY_STRUCTURE"
              ? "bg-slate-50 border-slate-200 text-slate-700"
              : "bg-white border-slate-200 text-slate-700"
        )}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>结构行数：<b className="font-mono">{structureSummary.structureRowsCount ?? 0}</b></span>
            <span>成效事实行数：<b className="font-mono">{structureSummary.factRowsCount ?? 0}</b></span>
            <span>状态：<b className="font-mono">{dataHealth?.status || "UNKNOWN"}</b></span>
            <span>当前统计期间：<b className="font-mono">{structureSummary.appliedFilters?.startDate || format(startDate, "yyyy-MM-dd")}</b> 至 <b className="font-mono">{structureSummary.appliedFilters?.endDate || format(endDate, "yyyy-MM-dd")}</b></span>
          </div>
          {dataHealth?.status === "STRUCTURE_WITHOUT_FACTS" && (
            <p className="mt-2 font-semibold">
              结构已同步，成效未同步。当前日期范围内没有 FactMetaPerformance 成效数据，请同步广告成效数据或扩大日期范围。
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
                        <TableHead className="font-bold text-slate-700 cursor-pointer hover:bg-slate-100" onClick={() => requestSort("fb_account_name")}>每个广告账户</TableHead>
                        <TableHead className="font-bold text-slate-700">账户 ID</TableHead>
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
                          <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
                          <h4 className="text-sm font-bold text-slate-800">未检索到符合条件的层级节点</h4>
                          
                          {dataHealth?.reason && (
                            <div className="my-3 px-4 py-2.5 bg-red-50/60 border border-red-200/60 text-red-700 rounded-lg text-xs font-medium text-left w-full space-y-1">
                              <p className="font-mono text-[10px] text-red-500 uppercase tracking-wider font-semibold">Diagnostic Code: {dataHealth.reason}</p>
                              <p className="leading-relaxed text-[11px]">
                                {dataHealth.reason === "NO_FACT_LEVEL_ROWS" && "【当前层级无记账事实行】：数据库中该时段无广告消耗及行为记账，但可能存在结构拓扑。"}
                                {dataHealth.reason === "NO_STRUCTURE_ROWS" && "【当前层级无结构拓扑】：此账户在系统中无对应的广告层级结构数据，需要同步或结构不存在。"}
                                {dataHealth.reason === "ACCOUNT_ID_FORMAT_MISMATCH" && "【广告账户ID格式不匹配】：广告账户ID空缺或格式不规范。"}
                                {dataHealth.reason === "CAMPAIGN_ID_MISMATCH" && "【广告系列ID不存在】：当前广告系列在结构中未检索到。"}
                                {dataHealth.reason === "ADSET_ID_MISMATCH" && "【广告组ID不存在】：当前广告组在结构中未检索到。"}
                                {dataHealth.reason === "DATE_RANGE_EMPTY" && "【时间区间无数据】：选择的起始或结束日期无效或越界。"}
                                {dataHealth.reason === "FILTER_ZERO_SPEND_HIDDEN" && "【零消耗已被隐藏】：当前节点有对应结构，但选择的时间范围内花费为0，且当前筛选开启了【仅看有消耗】。请切换至上方【全部对象】查看。"}
                                {!["NO_FACT_LEVEL_ROWS", "NO_STRUCTURE_ROWS", "ACCOUNT_ID_FORMAT_MISMATCH", "CAMPAIGN_ID_MISMATCH", "ADSET_ID_MISMATCH", "DATE_RANGE_EMPTY", "FILTER_ZERO_SPEND_HIDDEN"].includes(dataHealth.reason) && `【未知原因】：${dataHealth.reason}`}
                              </p>
                              <div className="pt-1.5 border-t border-red-100 mt-1.5 flex gap-4 text-[10px] text-red-400 font-mono">
                                <span>Fact Rows: {dataHealth.factRows}</span>
                                <span>Structure Rows: {dataHealth.structureRows}</span>
                                <span>Level: {dataHealth.level}</span>
                              </div>
                            </div>
                          )}

                          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed text-left w-full">
                            提示诊断排查：<br />
                            1. <b>【时间范围无成效】</b>：在该历史区间内可能未跑量发出消耗。<br />
                            2. <b>【有消耗隐藏】</b>：当前处于“有消耗对象”筛选，可切换到<b>“全部对象”</b>查看未发生花费的结构拓扑，或点击<b>“同步数据”</b>触发真实同步任务。<br />
                            3. <b>【账户未同步】</b>：请确保该账户已通过本底同步成功重写关联。
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedData.map((row) => (
                      <TableRow key={row.id} className="hover:bg-slate-50/80 transition-colors border-b select-none">
                        
                        {/* VIEW LEVEL ACCOUNTS */}
                        {viewLevel === "accounts" && (
                          <>
                            <TableCell className="font-semibold text-blue-600 hover:underline cursor-pointer max-w-[200px] truncate" onClick={() => {
                              setSelectedAccount(row.fb_account_id);
                              setSelectedAccountName(row.fb_account_name);
                              setViewLevel("campaigns");
                            }} title={row.fb_account_name}>
                              {row.fb_account_name}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-500">{row.fb_account_id}</TableCell>
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
