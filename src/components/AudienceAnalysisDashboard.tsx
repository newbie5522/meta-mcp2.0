// @ts-nocheck
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
        setData(res.data.rows || []);
        setSummary(res.data.summary || null);
        setDataHealth(res.data.dataHealth || null);
      } else {
        setData([]);
        setSummary(null);
        setDataHealth(null);
      }
    } catch (err: any) {
      console.error("Failed to fetch audience insights", err);
      setData([]);
      setSummary(null);
      setDataHealth(null);
      toast.error("加载受众成效分析发生错误");
    } finally {
      setLoading(false);
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

    if (chartRows.length === 0) {
      return (
        <div className="h-64 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-xs">
          <span>当前日期范围内暂无受众数据，无法渲染图表对比</span>
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
      case "impression_device":
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart key={chartKey} data={chartRows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="dimensionValue" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} interval={0} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#10b981' }} axisLine={false} />
              <RechartsTooltip formatter={(value, name) => [typeof value === 'number' ? value.toFixed(2) : value, name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="spend" name="花费 ($)" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={25} />
              <Bar yAxisId="right" dataKey="purchases" name="购买 (单)" fill="#10b981" radius={[4, 4, 0, 0]} barSize={25} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "region":
      default:
        return (
          <div className="h-64 flex flex-col items-center justify-center text-indigo-800 bg-indigo-50/40 rounded-xl border border-dashed border-indigo-200 text-xs px-6 text-center">
            <MapPin className="w-8 h-8 text-indigo-500 mb-2 animate-pulse" />
            <span className="font-semibold text-indigo-900">高基数特定 Region 维度不渲染冗余图形</span>
            <span className="text-slate-500 mt-1 max-w-sm">
              Region 为高基数二级物理地理单元，建议运营直接通过右侧的表现指标表进行花费与 ROI 深度排序分析。
            </span>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6 font-sans">
      
      {/* ⚠️ Data Health Warning Banner (warnings & missing from API) */}
      {dataHealth && (dataHealth.warnings?.length > 0 || dataHealth.missing?.length > 0) && (
        <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-4 flex flex-col gap-1.5 text-xs text-amber-800 shadow-sm">
          <div className="flex items-center gap-2 font-bold mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-600 animate-pulse" />
            <span>数据源健康状态提醒 ({dataHealth.status}):</span>
          </div>
          {dataHealth.warnings?.map((warn: string, i: number) => (
            <p key={`warn-${i}`} className="pl-6 font-medium">⚠️ {warn}</p>
          ))}
          {dataHealth.missing?.map((miss: string, i: number) => (
            <p key={`miss-${i}`} className="pl-6 text-amber-700 font-medium">📌 信息缺少: {miss}</p>
          ))}
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
                    {acc.fb_account_name || acc.fb_account_id}
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
                <option value="impression_device">设备 (impression_device)</option>
                <option value="region">地区 (region)</option>
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
                className="w-full h-10 flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-indigo-600 active:scale-[0.98] transition-all duration-150 shadow-sm"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                同步刷新看板
              </button>
            </div>

          </div>
        </CardContent>
      </Card>

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

      {activeTab === "region" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2.5 text-xs text-amber-900 shadow-sm animate-fade-in">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0 animate-pulse" />
          <div>
            <p className="font-bold text-amber-950 mb-1">Region 维度指标特殊提示 (Region Operational Guidance):</p>
            <p className="font-semibold text-amber-800">
              Region 当前仅展示花费、展示和点击，购买与 ROAS 暂不作为决策指标。
            </p>
            <p className="text-slate-500 mt-1">
              Region 为高基数二级物理地理单元，默认仅展示花费 Top 20。若要过滤非重要小省州投放，可在上方输入最小花费起投门槛。
            </p>
          </div>
        </div>
      )}

      {/* Visual Analytics Space */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Comparative Purchases vs Budget Column Chart */}
        <Card className="lg:col-span-2 border-slate-200 shadow-sm">
          <CardHeader className="p-5 border-b pb-4">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                <MonitorPlay className="w-4 h-4 text-indigo-500" />
                受众花费与转化购买分布交叉比对图 (Purchases vs Ad Spend)
              </CardTitle>
              {activeTab === "country" && (
                <p className="text-[10px] text-amber-600 font-semibold mt-1">
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

        {/* Visual Info Block cards */}
        <Card className="border-slate-200 shadow-sm flex flex-col justify-between">
          <CardHeader className="p-5 border-b pb-4">
            <CardTitle className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              受众决策分析小技巧 (Operational Guidance)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 flex-1 flex flex-col gap-4 text-xs text-slate-600 justify-center">
            <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-lg">
              <strong className="text-indigo-900 font-semibold block mb-1">1. 谁值得扩量？</strong>
              <span>点击「Meta ROAS」表头，筛选出 ROAS 比值大于 1.5 且具有起量空间的受众特征，点击操作中的「问 AI」规划扩量方案。</span>
            </div>
            <div className="p-3 bg-rose-50/50 border border-rose-100 rounded-lg">
              <strong className="text-rose-900 font-semibold block mb-1">2. 谁在浪费预算？</strong>
              <span>点击「花费」表头降序排列，排查高花费但 purchases 为 0 或者是 ROAS 低于 0.5 的特定版位或设备特征，考虑予以独立排除设置。</span>
            </div>
            <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg">
              <strong className="text-emerald-900 font-semibold block mb-1">3. 人群画像精细交叉</strong>
              <span>本受众看板数据直接来自底表 FactAudienceBreakdown。绝对真实可靠，彻底消灭 Female 55% / Male 45% 的随机乱套数据。</span>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* 15 维受众表现智能交叉比对表 */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="p-5 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-slate-50/30">
          <div>
            <CardTitle className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
              11 维受众分析智能交叉决策底表 (Deterministic Demographic Attributes)
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
          ) : tableRows.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-slate-50/20 rounded-xl my-4 flex flex-col items-center justify-center max-w-lg mx-auto">
              <AlertTriangle className="w-8 h-8 text-amber-500 mb-2 animate-pulse" />
              <p className="text-xs font-bold text-slate-700">当前筛选周期或店铺范围内暂无物理受众数据</p>
              <p className="text-[11px] text-slate-400 mt-1">
                请先前往「同步管理中心」启动 Meta 受众指标同步任务。
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-[11px]">
                <TableHeader className="bg-slate-50/40">
                  <TableRow>
                    <TableHead className="py-3 h-11 text-slate-700 font-semibold text-left whitespace-nowrap">维度值名称</TableHead>
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
                    const rowKey = `${row.dimensionType || activeTab}-${row.dimensionValue || "unknown"}-${row.lastSyncedAt || ""}`;
                    
                    return (
                      <TableRow key={rowKey} className="hover:bg-slate-50/80 border-b">
                        <TableCell className="font-extrabold text-slate-800 whitespace-nowrap pr-4">
                          {row.dimensionValue || "unknown"}
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
                        <TableCell className="text-right text-slate-400 font-mono">
                          {rowSpendRatio.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right text-slate-400 font-mono">
                          {rowPurchaseRatio.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right text-slate-500 font-mono">
                          {row.accountsCount}
                        </TableCell>
                        <TableCell className="text-center text-slate-400 font-mono text-[10px]">
                          {format(new Date(row.lastSyncedAt), "yyyy-MM-dd HH:mm")}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider",
                            suggestion === "首选优选" && "bg-emerald-100 text-emerald-800",
                            suggestion === "保持投放" && "bg-blue-100 text-blue-800",
                            suggestion === "观察积累" && "bg-slate-100 text-slate-800",
                            suggestion === "降预算" && "bg-amber-100 text-amber-800",
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
      
    </div>
  );
}
