// @ts-nocheck
import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { format } from "date-fns";
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
  SlidersHorizontal 
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DataDetailsDashboardProps {
  startDate: Date;
  endDate: Date;
}

export function DataDetailsDashboard({ startDate, endDate }: DataDetailsDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({
    metaInsights: [],
    accounts: [],
    orders: [],
    filters: { stores: [], adAccounts: [], mappings: [] },
    health: { status: "EMPTY", missingReason: "", lastSyncTime: null, lastSyncStatus: "none", isSyncActive: false }
  });

  // Local filter states
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  
  // Status Filter state: "spend" | "active" | "all" | "unmapped"
  const [statusFilter, setStatusFilter] = useState<"spend" | "active" | "all" | "unmapped">("spend");

  // Sorting configurations
  const [sortField, setSortField] = useState<string>("spend");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const loadData = async () => {
    setLoading(true);
    try {
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");

      const response = await axios.get("/api/data-center/detail", {
        params: {
          startDate: startStr,
          endDate: endStr,
          storeId: storeFilter
        }
      });
      setData(response.data);
    } catch (error: any) {
      console.error("Load Data Detail error:", error);
      toast.error("加载账户数据明细失败，请检查数据库服务连接");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate, storeFilter]);

  // Client filtering + sorting based on requirements
  const filteredAccounts = useMemo(() => {
    let list = [...(data.accounts || [])];

    // 1. Apply Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter((item) => 
        (item.fb_account_name || "").toLowerCase().includes(term) ||
        String(item.fb_account_id).toLowerCase().includes(term) ||
        (item.storeName || "").toLowerCase().includes(term)
      );
    }

    // 2. Apply Custom Account Status Filters
    if (statusFilter === "spend") {
      // 有消耗账户: spend > 0
      list = list.filter(item => (item.spend || 0) > 0);
    } else if (statusFilter === "active") {
      // 活跃账户: recentActivity90d equals true
      list = list.filter(item => item.recentActivity90d === true || item.recentActivity90d === 1);
    } else if (statusFilter === "unmapped") {
      // 未绑定店铺账户: storeName empty or default warnings
      list = list.filter(item => !item.storeName || item.storeName.includes("未绑定") || item.storeName.includes("未关联"));
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

  const handleAskAI = (row: any) => {
    const prompt = `分析广告账户：${row.fb_account_name} (${row.fb_account_id})\n关联店铺：${row.storeName}\n花费 $${row.spend.toFixed(2)}，曝光 ${row.impressions}，点击数 ${row.clicks}，点击率 ${row.ctr.toFixed(2)}%，加购数 ${row.addToCart}，购买数 ${row.purchases}，CPC $${row.cpc.toFixed(2)}，CPA $${(row.cpa || 0).toFixed(2)}，Meta ROAS ${row.roas.toFixed(2)}。如何优化投放预算？`;
    navigator.clipboard.writeText(prompt);
    toast.success("💡 已自动复制账户多维诊断提示词！请点击右侧 AI Copilot 悬浮窗粘贴提问。");
  };

  const handleViewHierarchy = (accountId: string) => {
    const cleanId = String(accountId).replace("act_", "").trim();
    window.location.href = `/?tab=data-campaigns&accountId=${cleanId}`;
  };

  // Compute status summary count
  const allAccountsCount = data.accounts?.length || 0;
  const withSpendCount = data.accounts?.filter(a => (a.spend || 0) > 0).length || 0;

  // Render a compact small footprint status indicator
  const sysStatus = data.health?.status || "EMPTY";
  const sysStatusBadge = 
    sysStatus === "EXCELLENT" || sysStatus === "READY" ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
    sysStatus === "WARNING" || sysStatus === "PARTIAL" ? "bg-amber-50 text-amber-600 border-amber-200" :
    "bg-red-50 text-red-600 border-red-200";

  return (
    <div className="flex flex-col gap-6" id="data-details-viewer">
      
      {/* Sleek Mini Footprint Status Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 font-medium">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
            <span>最近同步时间: <strong className="text-slate-800 font-mono">{data.health?.lastSyncTime ? format(new Date(data.health.lastSyncTime), "yyyy-MM-dd HH:mm:ss") : "无记录"}</strong></span>
          </div>
          <div>
            <span>Insights 同步属性: <strong className={cn("px-2 py-0.5 border rounded-full text-[11px]", sysStatusBadge)}>{sysStatus}</strong></span>
          </div>
          <div>
            <span>总账户数: <strong className="text-slate-800 font-mono">{allAccountsCount}</strong></span>
            <span className="mx-2 text-slate-300">|</span>
            <span>有消耗账户（本日历范围）: <strong className="text-blue-600 font-mono">{withSpendCount}</strong></span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2.5 font-medium border-slate-200 bg-white hover:bg-slate-50 transition"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCcw className={cn("w-3 h-3 text-slate-500", loading && "animate-spin")} />
            刷新底表
          </Button>
        </div>
      </div>

      {/* Primary Filtering controls */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        
        {/* Left Side: Status buttons filter */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg shrink-0">
          <button
            onClick={() => setStatusFilter("spend")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all",
              statusFilter === "spend" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            )}
          >
            有消耗账户 ({withSpendCount})
          </button>
          <button
            onClick={() => setStatusFilter("active")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all",
              statusFilter === "active" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            )}
          >
            活跃账户 ({data.accounts?.filter(a => a.recentActivity90d === true || a.recentActivity90d === 1).length || 0})
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all",
              statusFilter === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            )}
          >
            全部账户 ({allAccountsCount})
          </button>
          <button
            onClick={() => setStatusFilter("unmapped")}
            className={cn(
              "px-3 py-1.5 rounded-md font-semibold transition-all",
              statusFilter === "unmapped" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            )}
          >
            未绑定店铺
          </button>
        </div>

        {/* Right Side: inputs and dropdown selection */}
        <div className="flex items-center gap-2 flex-wrap md:flex-nowrap w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="搜索账户名称或 ID..."
              className="pl-8 h-8 w-full rounded-lg border border-slate-200 bg-white font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="h-8 px-2 border border-slate-200 bg-white rounded-lg text-slate-600 font-semibold outline-none cursor-pointer hover:bg-slate-50"
          >
            <option value="all">选择店铺筛选</option>
            {data.filters?.stores?.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white rounded-2xl border border-slate-300 min-h-[300px]">
          <RefreshCcw className="w-8 h-8 animate-spin text-blue-500 mb-3" />
          <p className="text-xs font-semibold">正在调阅数据库核心账户指标表...</p>
        </div>
      ) : (
        /* Real Account Table view */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              Meta 广告多日指标明细 (Spend & Multi-day Self-Attributed Insights)
            </h4>
            <span className="text-[11px] font-mono text-slate-500 font-semibold bg-slate-100 px-2 py-0.5 rounded">
              满足筛选: {filteredAccounts.length} / {allAccountsCount} 个
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table className="text-[12px]">
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="font-semibold text-slate-700 py-3 h-10">账户 ID & 名称</TableHead>
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
                  <TableHead className="font-semibold text-slate-700 text-right">加购量</TableHead>
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
                    <TableCell colSpan={15} className="text-center p-12 text-slate-400 font-medium">
                      <Database className="w-8 h-8 mx-auto opacity-30 mb-2 text-slate-500" />
                      当前筛选条件下暂无账户数据 (均无广告花费且无消耗)。
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAccounts.map((row, index) => {
                    return (
                      <TableRow key={row.fb_account_id || index} className="hover:bg-slate-50 border-b group">
                        <TableCell className="font-medium text-slate-900 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span 
                              className="font-bold text-blue-600 hover:underline cursor-pointer flex items-center gap-1 text-[13px]"
                              onClick={() => handleViewHierarchy(row.fb_account_id)}
                            >
                              {row.fb_account_name || "未命名 Meta 账号"}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">{row.fb_account_id}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[11px] font-semibold",
                            row.storeName && !row.storeName.includes("未绑定") && !row.storeName.includes("未关联") 
                              ? "bg-blue-50 text-blue-700 border border-blue-100" 
                              : "bg-slate-100 text-slate-400"
                          )}>
                            {row.storeName && !row.storeName.includes("未绑定") && !row.storeName.includes("未关联") ? row.storeName : "未映射店铺"}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-500 font-mono text-[11px]">
                          <div>{row.currency || "USD"}</div>
                          <div className="text-[10px] text-slate-400">{row.timezone || "America/Los_Angeles"}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          {row.recentActivity90d ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-100">
                              活跃 (Active)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 text-[10px] font-medium">
                              静默
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-slate-900 font-mono">${(row.spend || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">{(row.impressions || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">{(row.clicks || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">{(row.ctr || 0).toFixed(2)}%</TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">${(row.cpc || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">${(row.cpm || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">{(row.addToCart || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-bold text-slate-950 font-mono">{(row.purchases || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">${(row.cpa || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-black text-rose-600 font-mono">{(row.roas || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-center space-x-1 whitespace-nowrap">
                          <button
                            onClick={() => handleViewHierarchy(row.fb_account_id)}
                            className="px-2 py-1 text-slate-600 bg-slate-100 rounded hover:bg-blue-600 hover:text-white transition-all text-[11px] font-medium"
                          >
                            广告层级
                          </button>
                          <button
                            onClick={() => handleAskAI(row)}
                            className="px-2 py-1 text-white bg-blue-600 rounded hover:bg-blue-700 transition-all text-[11px] font-semibold"
                          >
                            问 AI
                          </button>
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
