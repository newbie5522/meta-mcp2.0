import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { format } from "date-fns";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Loader2, Users, MapPin, MonitorPlay, AlertTriangle, ShieldCheck, 
  Sparkles, SlidersHorizontal, ArrowUpDown, RefreshCw, Layers 
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { metaAccountOptionLabel } from "./common/MetaAccountDisplay";
import { SyncStatusPanel, type SyncPanelStatus } from "./common/SyncStatusPanel";
import { mapSyncErrorToPanel, mapSyncResultToPanel, triggerSyncTask } from "@/lib/sync-trigger";
import {
  CURRENT_RANGE_NOT_READY_MESSAGE,
  DATE_RANGE_MISMATCH_MESSAGE,
  responseDateRangeMatches,
  shouldPreserveLastGoodData
} from "@/lib/data-view-state";

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export function AudienceAnalysisDashboard({ startDate, endDate }: { startDate: Date; endDate: Date }) {
  const [stores, setStores] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  
  // High granularity filters
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [minSpend, setMinSpend] = useState<string>("");
  const [includeZeroSpend, setIncludeZeroSpend] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>("country");
  
  // Data State
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [dataHealth, setDataHealth] = useState<any | null>(null);
  const [lastGoodData, setLastGoodData] = useState<any | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncPanelStatus>({ status: "idle" });
  const [viewNotice, setViewNotice] = useState<string | null>(null);

  // Order Country Rows
  const [orderCountryRows, setOrderCountryRows] = useState<any[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [countriesHealth, setCountriesHealth] = useState<any | null>(null);

  // Local/Backend Sorting
  const [sortBy, setSortBy] = useState<string>("spend");

  // Fetch Filters (Stores and Accounts) from central endpoint
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const startStr = format(startDate, "yyyy-MM-dd");
        const endStr = format(endDate, "yyyy-MM-dd");
        
        const res = await axios.get("/api/data-center/detail", {
          params: { startDate: startStr, endDate: endStr }
        });
        
        if (res.data?.filters) {
          setStores(res.data.filters.stores || []);
          setAccounts(res.data.filters.adAccounts || []);
        }
      } catch (err) {
        console.error("Failed to load global filters for Audience", err);
      }
    };
    fetchFilters();
  }, [startDate, endDate]);

  // Load audience insights from server matching the exact requirements
  const fetchAudienceInsights = async () => {
    setLoading(true);
    try {
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");
      
      const res = await axios.get("/api/data-center/audience", {
        params: {
          storeId: selectedStore,
          accountId: selectedAccount,
          dimensionType: activeTab,
          minSpend: minSpend || undefined,
          includeZeroSpend: includeZeroSpend ? "true" : "false",
          sortBy: sortBy,
          startDate: startStr,
          endDate: endStr
        }
      });
      
      if (res.data) {
        const rows = res.data.rows || [];
        if (!responseDateRangeMatches(res.data, startStr, endStr) && lastGoodData) {
          setData(lastGoodData.rows || []);
          setSummary(lastGoodData.summary || null);
          setDataHealth(lastGoodData.dataHealth || null);
          setViewNotice(DATE_RANGE_MISMATCH_MESSAGE);
          return;
        }
        if (shouldPreserveLastGoodData(res.data, rows, lastGoodData)) {
          setData(lastGoodData.rows || []);
          setSummary(lastGoodData.summary || null);
          setDataHealth(lastGoodData.dataHealth || null);
          setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
          return;
        }
        setData(rows);
        setSummary(res.data.summary || null);
        setDataHealth(res.data.dataHealth || null);
        setLastGoodData({
          rows,
          summary: res.data.summary || null,
          dataHealth: res.data.dataHealth || null
        });
        setViewNotice(null);
      } else {
        setData(lastGoodData?.rows || []);
        setSummary(lastGoodData?.summary || null);
        setDataHealth(lastGoodData?.dataHealth || null);
        setViewNotice(lastGoodData ? CURRENT_RANGE_NOT_READY_MESSAGE : null);
      }

      // If active tab is country, load order countries list from database
      if (activeTab === "country") {
        setCountriesLoading(true);
        try {
          const countriesRes = await axios.get("/api/data-center/countries", {
            params: {
              startDate: startStr,
              endDate: endStr,
              storeId: selectedStore,
              minSpend: minSpend || undefined,
              includeUnmappedSpend: "true"
            }
          });
          if (countriesRes.data) {
            setOrderCountryRows(countriesRes.data.rows || []);
            setCountriesHealth(countriesRes.data.dataHealth || null);
          } else {
            setOrderCountryRows([]);
            setCountriesHealth(null);
          }
        } catch (countriesErr) {
          console.error("Failed to fetch order country statistics", countriesErr);
          setOrderCountryRows([]);
          setCountriesHealth(null);
        } finally {
          setCountriesLoading(false);
        }
      } else {
        setOrderCountryRows([]);
        setCountriesHealth(null);
      }

    } catch (err: any) {
      console.error("Failed to fetch audience insights", err);
      if (lastGoodData) {
        setData(lastGoodData.rows || []);
        setSummary(lastGoodData.summary || null);
        setDataHealth(lastGoodData.dataHealth || null);
        setViewNotice(CURRENT_RANGE_NOT_READY_MESSAGE);
      }
      toast.error("加载受众成效分析发生错误");
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAudience = async () => {
    setSyncing(true);
    const startStr = format(startDate, "yyyy-MM-dd");
    const endStr = format(endDate, "yyyy-MM-dd");

    setSyncStatus({
      status: "running",
      message: "正在同步 Meta 受众 breakdown 数据..."
    });

    try {
      const result = await triggerSyncTask({
        taskType: "sync_meta_audience",
        startDate: startStr,
        endDate: endStr,
        days: Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1),
        limit: 200
      });

      setSyncStatus(mapSyncResultToPanel(result));
      await fetchAudienceInsights();
    } catch (error: any) {
      setSyncStatus(mapSyncErrorToPanel(error));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchAudienceInsights();
  }, [startDate, endDate, selectedStore, selectedAccount, minSpend, includeZeroSpend, activeTab, sortBy]);

  // Dynamically Filter accounts by currently selected store for best in-app UX
  const filteredAccounts = useMemo(() => {
    if (selectedStore === "all") return accounts;
    return accounts.filter(acc => acc.storeId === Number(selectedStore));
  }, [accounts, selectedStore]);

  // Reset selected account if filtered accounts doesn't contain it
  useEffect(() => {
    if (selectedStore !== "all" && selectedAccount !== "all") {
      const exists = filteredAccounts.some(acc => acc.fb_account_id === selectedAccount);
      if (!exists) {
        setSelectedAccount("all");
      }
    }
  }, [selectedStore, filteredAccounts, selectedAccount]);

  // Column header toggle sort helper
  const handleSortToggle = (field: string) => {
    if (sortBy === field) {
      // Toggle to default or keep it simple as our API sorts DESC for high value metrics.
      // If they click again, we keep it as DESC.
    } else {
      setSortBy(field);
    }
  };

  // Rule-based deterministic, transparent suggestion actions
  const getSuggestionAction = (row: any) => {
    if (row.spend === 0) return "观察积累";
    if (row.purchases > 0) {
      if (row.roas >= 1.8) return "首选优选";
      if (row.roas >= 1.0) return "保持投放";
      return "降预算";
    } else {
      if (row.spend >= 50) return "关停建议";
      if (row.clicks >= 10) return "扩充受众";
      return "观察积累";
    }
  };

  // AI Prompt Diagnosis Copy trigger
  const handleAskAICopilot = (row: any) => {
    const formattedCtr = (row.ctr * 100).toFixed(4);
    const suggestion = getSuggestionAction(row);
    const totalSpend = summary?.totalSpend ?? 1;
    const totalPurchases = summary?.totalPurchases ?? 1;
    const spendRatio = totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0;
    const purchaseRatio = totalPurchases > 0 ? (row.purchases / totalPurchases) * 100 : 0;
    
    const promptText = `你是一位顶尖的跨境电商 Meta Ads 广告出海流量分析专家。
我正在使用专业的 Meta 流量分析数据中心，针对我在 【${format(startDate, "yyyy-MM-dd")}】至【${format(endDate, "yyyy-MM-dd")}】 周期内投放的受众细分数据进行细分特征诊断。

📋 **基础投放维度信息**：
- 细分维度 (Dimension Type): ${activeTab}
- 维度具体值 (Dimension Value): ${row.dimensionValue}

📊 **11 维核心成效物理指标**：
- 广告花费 (Spend): $${row.spend.toFixed(2)}
- 展现曝光 (Impressions): ${row.impressions.toLocaleString()}
- 关联点击 (Clicks): ${row.clicks.toLocaleString()}
- 点击率 (CTR): ${formattedCtr}%
- 单次点击成本 (CPC): $${row.cpc.toFixed(2)}
- 千次展示成本 (CPM): $${row.cpm.toFixed(2)}
- 带来的转化购买数 (Purchases): ${row.purchases}
- 获客单价 (CPA/CAC): $${row.cpa.toFixed(2)}
- 广告购买价值 (Purchase Value): $${row.purchaseValue.toFixed(2)}
- 广告投资回报率 (ROAS): ${row.roas.toFixed(2)}
- 触点关联广告账户数: ${row.accountsCount} 个

📈 **大盘整体贡献度**：
- 花费金额占比: ${spendRatio.toFixed(2)}%
- 转化贡献量占比: ${purchaseRatio.toFixed(2)}%

🧠 **系统操作评级**：
- 当前运行状态：【${suggestion}】

🎯 **核心诊断分析诉求**：
请根据上面真实拉取并且无泄露、无加工的物理底层受众指标，帮我分析：
1. 为什么该细分群组会呈现这样的漏斗转化效率（CTR、CPC、CPA、ROAS）？
2. 在创意素材、着陆页体验、特定国家/设备的投流优化方面，有哪些切实的改善方案？
3. 如果这是我的高价值群组或低效群组，我的下一阶段扩量、关停、或者是受众重定向(Retargeting)的具体方向应该是什么？

请保持高度专业，并给出条理清晰的跨境运营优化动作建议。`;

    navigator.clipboard.writeText(promptText);
    toast.success(`💡 已自动为您复制针对【${row.dimensionValue}】维度的 11 维深度智能诊断提示词！请点击右侧 AI Copilot，直接粘贴发送即可获得优化对策。`);
  };

  // Safe Getters for Core Summary Cards (direct consumption from API)
  const totalSpend = summary?.totalSpend ?? 0;
  const totalImpressions = summary?.totalImpressions ?? 0;
  const totalClicks = summary?.totalClicks ?? 0;
  const totalPurchases = summary?.totalPurchases ?? 0;
  const totalPurchaseValue = summary?.totalPurchaseValue ?? 0;
  const ctrVal = (summary?.ctr ?? 0) * 100;
  const cpcVal = summary?.cpc ?? 0;
  const cpmVal = summary?.cpm ?? 0;
  const cpaVal = summary?.cpa ?? 0;
  const roasVal = summary?.roas ?? 0;

  // Unified data source for both charts and table (limited to Top 10 for country to prevent label skipping/overlap)
  const tableRows = data;

  const chartRows = useMemo(() => {
    if (activeTab === "country") {
      return data.slice(0, 10);
    }
    return data;
  }, [data, activeTab]);

  const chartKey = `${activeTab}-${format(startDate, "yyyyMMdd")}-${format(endDate, "yyyyMMdd")}-${selectedStore}-${selectedAccount}-${sortBy}-${chartRows.length}`;
  const isMetaBreakdownMissing = dataHealth?.status === "MISSING_META_BREAKDOWN" || dataHealth?.reason === "META_AUDIENCE_BREAKDOWN_MISSING";
  const shouldShowAudienceNotice =
    !loading &&
    data.length === 0 &&
    dataHealth?.status &&
    !["READY", "OK"].includes(String(dataHealth.status).toUpperCase());
  const audienceNoticeMessage =
    syncStatus.status === "no_new_data"
      ? syncStatus.message || "Meta API 当前日期范围未返回受众 breakdown 数据。请扩大日期范围或检查 Meta 账户是否有足够投放数据。"
      : dataHealth?.message || "当前日期范围暂无 Meta 受众 breakdown 数据。";

  // Chart Rendering Logic according to instructions
  const renderChart = () => {
    if (loading) {
      return (
        <div className="h-64 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-xs">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mb-2" />
          <span>正在加载物理投流细分指标图表...</span>
        </div>
      );
    }

    if (isMetaBreakdownMissing || chartRows.length === 0) {
      return (
        <div className="h-64 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-xs p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-slate-400 mb-2" />
          <span className="font-bold text-slate-700 text-sm mb-1">受众细分数据未同步</span>
          <p className="text-[11px] text-slate-500 max-w-sm">
            当前日期范围没有 Meta 受众拆分数据，请先同步受众 breakdown。
          </p>
        </div>
      );
    }

    switch (activeTab) {
      case "country":
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart key={chartKey} data={chartRows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="dimensionValue" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} interval={0} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#10b981' }} axisLine={false} />
              <RechartsTooltip formatter={(value, name) => [typeof value === 'number' ? value.toFixed(2) : value, name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="spend" name="花费 ($)" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={25} />
              <Bar yAxisId="right" dataKey="purchases" name="购买 (单)" fill="#10b981" radius={[4, 4, 0, 0]} barSize={25} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "age":
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart key={chartKey} data={chartRows} layout="vertical" margin={{ top: 10, right: 10, left: 30, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
              <YAxis type="category" dataKey="dimensionValue" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} interval={0} />
              <RechartsTooltip formatter={(value, name) => [typeof value === 'number' ? value.toFixed(2) : value, name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="spend" name="花费 ($)" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={15} />
              <Bar dataKey="purchases" name="购买 (单)" fill="#10b981" radius={[0, 4, 4, 0]} barSize={15} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "gender":
        return (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart key={chartKey}>
              <Pie
                data={chartRows}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={85}
                paddingAngle={4}
                dataKey="spend"
                nameKey="dimensionValue"
              >
                {chartRows.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip formatter={(value) => [`$${Number(value).toFixed(2)}`, '花费金额']} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        );
      case "publisher_platform":
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart key={chartKey} data={chartRows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="dimensionValue" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} interval={0} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#10b981' }} axisLine={false} />
              <RechartsTooltip formatter={(value, name) => [typeof value === 'number' ? value.toFixed(2) : value, name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="spend" name="花费 ($)" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={25} />
              <Bar yAxisId="right" dataKey="purchases" name="购买 (单)" fill="#10b981" radius={[4, 4, 0, 0]} barSize={25} />
            </BarChart>
          </ResponsiveContainer>
        );
     
            default:
              return (
                <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
                  当前维度暂无可视化配置
                </div>
              );
           }
         };

         return (
    <div className="flex flex-col gap-6 font-sans">
      
      {/* ⚠️ Data Health Warning Banner (warnings & missing from API) */}
      {data.length > 0 && dataHealth && (dataHealth.warnings?.length > 0 || dataHealth.missing?.length > 0) && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-1.5 text-xs text-slate-700 shadow-sm">
          <div className="flex items-center gap-2 font-bold mb-1">
            <AlertTriangle className="w-4 h-4 text-slate-500 animate-pulse" />
            <span>数据源健康状态提醒 ({dataHealth.status}):</span>
          </div>
          {dataHealth.warnings?.map((warn: string, i: number) => (
            <p key={`warn-${i}`} className="pl-6 font-medium">⚠️ {warn}</p>
          ))}
          {dataHealth.missing?.map((miss: string, i: number) => (
            <p key={`miss-${i}`} className="pl-6 text-slate-600 font-medium">📌 信息缺少: {miss}</p>
          ))}
        </div>
      )}

      {viewNotice && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {viewNotice}
        </div>
      )}

      {shouldShowAudienceNotice && !viewNotice && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {audienceNoticeMessage}
        </div>
      )}

      {/* Primary Filter Dashboard Controls */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
            
            {/* 1. Store Selecting Option */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">选择店铺 (Store)</label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="h-10 w-full px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 outline-none hover:bg-slate-50 cursor-pointer transition-all duration-150"
              >
                <option value="all">所有店铺</option>
                {stores.map(st => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </div>

            {/* 2. Ad Account Selecting Option */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">广告账户 (Ad Account)</label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="h-10 w-full px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 outline-none hover:bg-slate-50 cursor-pointer transition-all duration-150"
              >
                <option value="all">所有广告账户</option>
                {filteredAccounts.map(acc => (
                  <option key={acc.fb_account_id} value={acc.fb_account_id}>
                    {metaAccountOptionLabel(acc.fb_account_name, acc.fb_account_id)}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Dimension Selection Option */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">细分物理维度 (Dimension)</label>
              <select
                value={activeTab}
                onChange={(e) => {
                  setActiveTab(e.target.value);
                  setSortBy("spend"); // Reset sort key
                }}
                className="h-10 w-full px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 outline-none hover:bg-slate-50 cursor-pointer transition-all duration-150"
              >
                <option value="country">国家 (country)</option>
                <option value="age">年龄段 (age)</option>
                <option value="gender">性别 (gender)</option>
                <option value="publisher_platform">版位 (publisher_platform)</option>
              </select>
            </div>

            {/* 4. Min Spend Input Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">起投最小消耗 (minSpend $)</label>
              <input
                type="number"
                placeholder="0.00"
                value={minSpend}
                onChange={(e) => setMinSpend(e.target.value)}
                className="h-10 w-full px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-500 transition-all duration-150"
              />
            </div>

            {/* 5. Include Zero Spend Checkbox switch */}
            <div className="flex items-center gap-2 h-10 px-1 select-none">
              <Checkbox 
                id="includeZeroSpend" 
                checked={includeZeroSpend} 
                onCheckedChange={(checked) => setIncludeZeroSpend(!!checked)}
              />
              <label htmlFor="includeZeroSpend" className="text-xs font-semibold text-slate-600 cursor-pointer">
                包含零花费受众
              </label>
            </div>

            {/* 6. Dynamic Re-fetch manual button */}
            <div>
              <button
                onClick={fetchAudienceInsights}
                disabled={loading || syncing}
                className="w-full h-10 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-indigo-600 active:scale-[0.98] transition-all duration-150 shadow-sm"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                刷新页面数据
              </button>
            </div>

          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <button
          onClick={handleSyncAudience}
          disabled={loading || syncing}
          className="h-9 px-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 disabled:opacity-60"
        >
          {syncing ? "同步中..." : "同步数据"}
        </button>
      </div>

      <SyncStatusPanel status={syncStatus} />

      {/* 📊 Core Indicators Summary Board (Direct Consumption from API) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        
        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">总花费 (Spend)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">总展示 (Impressions)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">{totalImpressions.toLocaleString()}</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">总点击 (Clicks)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">{totalClicks.toLocaleString()}</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">总购买 (Purchases)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">{totalPurchases} 单</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">总购买价值 (Value)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">${totalPurchaseValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">平均点击率 (CTR)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">{ctrVal.toFixed(3)}%</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">单次点击成本 (CPC)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">${cpcVal.toFixed(2)}</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">千次展示成本 (CPM)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">${cpmVal.toFixed(2)}</h3>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">平均购买成本 (CPA)</p>
            <h3 className="text-lg font-black text-slate-800 font-mono mt-1">${cpaVal.toFixed(2)}</h3>
          </CardContent>
        </Card>

        <Card className="border-indigo-200 bg-indigo-50/10 shadow-xs hover:border-indigo-300 transition-all">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">大盘综合 ROAS</p>
            <h3 className="text-lg font-black text-indigo-600 font-mono mt-1">{roasVal.toFixed(3)}</h3>
          </CardContent>
        </Card>

      </div>

      {/* Visual Analytics Space */}
      <div className="grid grid-cols-1 gap-6">
        
        {/* Comparative Purchases vs Budget Column Chart */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="p-5 border-b pb-4">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                <MonitorPlay className="w-4 h-4 text-indigo-500" />
                受众花费与转化购买分布交叉比对图 (Purchases vs Ad Spend)
              </CardTitle>
              {activeTab === "country" && (
                <p className="text-[10px] text-slate-500 font-semibold mt-1">
                  * 提示：图表展示 Spend Top 10 细分，下方表格展示当前全部 {tableRows.length} 项受众细分数据。
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-5">
            <div className="h-[280px] w-full">
              {renderChart()}
            </div>
          </CardContent>
        </Card>

      </div>

      {/* 15 维受众表现智能交叉比对表 */}
      <Card className="border-slate-200 shadow-sm mt-6">
        <CardHeader className="p-5 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-slate-50/30">
          <div>
            <CardTitle className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
              {activeTab === "country" 
                ? "Meta 受众国家：来自 FactAudienceBreakdown"
                : "11 维受众分析智能交叉决策底表 (Deterministic Demographic Attributes)"}
            </CardTitle>
            <p className="text-[11px] text-slate-400 mt-1">
              表格默认按 Spend DESC 排序。点击字段表头可切换为 Purchases、ROAS、CPA、CTR 高效排序。
            </p>
          </div>
          <span className="text-[11px] text-slate-500 font-semibold bg-slate-100 px-3 py-1 rounded-full font-mono">
            分析范围组: {tableRows.length} 项
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-20 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
              <p className="text-xs font-semibold">分析引擎智能计算中...</p>
            </div>
          ) : (isMetaBreakdownMissing || tableRows.length === 0) ? (
            <div className="p-16 text-center text-slate-500 bg-slate-50/20 rounded-xl my-4 flex flex-col items-center justify-center max-w-lg mx-auto">
              <AlertTriangle className="w-8 h-8 text-slate-400 mb-2" />
              <p className="text-xs font-bold text-slate-700">受众细分数据未同步</p>
              <p className="text-[11px] text-slate-400 mt-1">
                当前日期范围没有 Meta 受众拆分数据，请先同步受众 breakdown。
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-[11px]">
                <TableHeader className="bg-slate-50/40">
                  <TableRow>
                     <TableHead className="py-3 h-11 text-slate-700 font-semibold text-left whitespace-nowrap">
                       {activeTab === "country" ? "Meta 交付国家/地区" : "维度值名称"}
                     </TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right cursor-pointer hover:bg-slate-100/50" onClick={() => handleSortToggle("spend")}>
                      <div className="flex items-center justify-end gap-1 select-none">
                        广告花费 {sortBy === "spend" && <span className="text-indigo-600 font-extrabold font-mono">↓</span>}
                      </div>
                    </TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right">展示量</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right">点击数</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right cursor-pointer hover:bg-slate-100/50" onClick={() => handleSortToggle("ctr")}>
                      <div className="flex items-center justify-end gap-1 select-none">
                        点击率 CTR {sortBy === "ctr" && <span className="text-indigo-600 font-extrabold font-mono">↓</span>}
                      </div>
                    </TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right">单次点击 CPC</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right">千次 CPM</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right cursor-pointer hover:bg-slate-100/50" onClick={() => handleSortToggle("purchases")}>
                      <div className="flex items-center justify-end gap-1 select-none">
                        购买单数 {sortBy === "purchases" && <span className="text-indigo-600 font-extrabold font-mono">↓</span>}
                      </div>
                    </TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right cursor-pointer hover:bg-slate-100/50" onClick={() => handleSortToggle("cpa")}>
                      <div className="flex items-center justify-end gap-1 select-none">
                        获客 CPA/CAC {sortBy === "cpa" && <span className="text-indigo-600 font-extrabold font-mono">↓</span>}
                      </div>
                    </TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right">购买价值</TableHead>
                    <TableHead className="text-slate-700 font-bold text-indigo-500 text-right cursor-pointer hover:bg-indigo-50/50" onClick={() => handleSortToggle("roas")}>
                      <div className="flex items-center justify-end gap-1 select-none font-mono">
                        ROAS {sortBy === "roas" && <span className="text-indigo-600 font-extrabold font-mono">↓</span>}
                      </div>
                    </TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right whitespace-nowrap">消耗占比 %</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right whitespace-nowrap">转化贡献 %</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-right">关联账户数</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-center">最后物理同步时间</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-center">AI 分析</TableHead>
                    <TableHead className="text-slate-700 font-semibold text-center">AI 联动决策</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((row) => {
                    const rowSpendRatio = totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0;
                    const rowPurchaseRatio = totalPurchases > 0 ? (row.purchases / totalPurchases) * 100 : 0;
                    const suggestion = getSuggestionAction(row);
                    const rowKey = `${row.dimensionType || activeTab}-${row.dimensionValue || "unspecified"}-${row.lastSyncedAt || ""}`;
                    
                    return (
                      <TableRow key={rowKey} className="hover:bg-slate-50/80 border-b">
                        <TableCell className="font-extrabold text-slate-800 whitespace-nowrap pr-4">
                          {row.dimensionValue || "unspecified"}
                        </TableCell>
                        <TableCell className="text-right font-bold text-slate-900 font-mono">
                          ${row.spend.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-slate-400 font-mono">
                          {row.impressions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-slate-400 font-mono">
                          {row.clicks.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">
                          {(row.ctr * 100).toFixed(3)}%
                        </TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">
                          ${row.cpc.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">
                          ${row.cpm.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-black text-slate-900 font-mono">
                          {row.purchases}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 font-mono">
                          ${row.cpa.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">
                          ${row.purchaseValue.toFixed(2)}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-black font-mono",
                          row.roas >= 1.5 ? "text-emerald-600" : "text-indigo-600"
                        )}>
                          {row.roas.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-slate-400 font-mono font-semibold">
                          {rowSpendRatio.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right text-slate-400 font-mono font-semibold">
                          {rowPurchaseRatio.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">
                          {row.accountsCount}
                        </TableCell>
                        <TableCell className="text-center text-slate-400 font-mono text-[10px]">
                          {row.lastSyncedAt ? format(new Date(row.lastSyncedAt), "yyyy-MM-dd HH:mm") : "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider",
                            suggestion === "首选优选" && "bg-emerald-100 text-emerald-800",
                            suggestion === "保持投放" && "bg-blue-100 text-blue-800",
                            suggestion === "观察积累" && "bg-slate-100 text-slate-800",
                            suggestion === "降预算" && "bg-slate-100 text-slate-700",
                            suggestion === "扩充受众" && "bg-indigo-100 text-indigo-800",
                            suggestion === "关停建议" && "bg-rose-100 text-rose-800"
                          )}>
                            {suggestion}
                          </span>
                        </TableCell>
                        <TableCell className="text-center py-2">
                          <button
                            onClick={() => handleAskAICopilot(row)}
                            className="px-2.5 py-1.5 bg-indigo-600 hover:bg-slate-900 text-white rounded-md text-[10px] font-bold active:scale-95 transition-all shadow-xs flex items-center gap-1 mx-auto"
                          >
                            <Sparkles className="w-2.5 h-2.5" />
                            问 AI
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Store Real Order Destination Country Table */}
      {activeTab === "country" && (
        <Card className="border-slate-200 shadow-sm mt-6">
          <CardHeader className="p-5 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-emerald-50/10">
            <div>
              <CardTitle className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-emerald-600" />
                订单收货国家：来自 Order shipping/billing country
              </CardTitle>
              <p className="text-[11px] text-slate-400 mt-1">
                该区域只展示主站订单收货/账单国家，不代表 Meta 受众国家；Meta 受众国家来自上方 FactAudienceBreakdown。
              </p>
            </div>
            <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-3 py-1 rounded-full font-mono">
              对应订单收货国家: {orderCountryRows.length} 个
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {countriesLoading ? (
              <div className="p-16 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500 mb-2" />
                <p className="text-xs font-semibold">主站订单国家数据分析中...</p>
              </div>
            ) : (countriesHealth?.status === "ORDER_COUNTRY_BACKFILL_REQUIRED" || orderCountryRows.length === 0) ? (
              <div className="p-12 text-center text-slate-500 bg-slate-50/20 rounded-xl my-4 flex flex-col items-center justify-center max-w-lg mx-auto border border-dashed border-slate-200">
                <AlertTriangle className="w-8 h-8 text-slate-400 mb-2" />
                <p className="text-xs font-bold text-slate-700">订单国家/地区属性需要回填/校验</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  主站交易订单存在收货/账单国家解析为空的情况，需要运行账目刷新回填与别名映射校验，请先在「数据中心」或「同步中心」执行相关操作。
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="text-[11px]">
                  <TableHeader className="bg-slate-50/40">
                    <TableRow>
                      <TableHead className="py-3 h-11 text-slate-700 font-semibold text-left whitespace-nowrap">收货国家 (Country)</TableHead>
                      <TableHead className="text-slate-700 font-semibold text-right">已付款订单量 (Unique Orders)</TableHead>
                      <TableHead className="text-slate-700 font-semibold text-right font-bold text-emerald-600">净销售总额 (Order Revenue)</TableHead>
                      <TableHead className="text-slate-700 font-semibold text-right">平均客单价 (AOV)</TableHead>
                      <TableHead className="text-slate-700 font-semibold text-right">关联 Meta 广告花费</TableHead>
                      <TableHead className="text-slate-700 font-semibold text-right">首单物理时间</TableHead>
                      <TableHead className="text-slate-700 font-semibold text-right">末单物理时间</TableHead>
                      <TableHead className="text-slate-700 font-semibold text-center">数据源解析说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderCountryRows.map((row) => {
                      const formattedFirst = row.orderFirstAt ? format(new Date(row.orderFirstAt), "yyyy-MM-dd HH:mm") : "-";
                      const formattedLast = row.orderLastAt ? format(new Date(row.orderLastAt), "yyyy-MM-dd HH:mm") : "-";
                      return (
                        <TableRow key={`order-country-${row.countryCode}`} className="hover:bg-slate-50/80 border-b">
                          <TableCell className="font-extrabold text-slate-800 whitespace-nowrap pr-4 flex items-center gap-1.5">
                            <span className="w-4 h-4 bg-slate-100 rounded text-[9px] flex items-center justify-center font-mono font-bold text-slate-600">
                              {row.countryCode}
                            </span>
                            {row.countryName || row.countryCode}
                          </TableCell>
                          <TableCell className="text-right font-bold text-slate-900 font-mono">
                            {row.orderCount || 0} 单
                          </TableCell>
                          <TableCell className="text-right font-black text-emerald-600 font-mono">
                            ${(row.orderRevenue || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right text-slate-600 font-mono">
                            ${(row.averageOrderValue || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right text-slate-500 font-mono font-bold">
                            ${(row.metaSpend || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right text-slate-400 font-mono text-[10px]">
                            {formattedFirst}
                          </TableCell>
                          <TableCell className="text-right text-slate-400 font-mono text-[10px]">
                            {formattedLast}
                          </TableCell>
                          <TableCell className="text-center text-slate-400 font-mono text-[10px] max-w-[200px] truncate" title={row.dataSourceExplain}>
                            {row.dataSourceExplain || "系统自动流映射"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
