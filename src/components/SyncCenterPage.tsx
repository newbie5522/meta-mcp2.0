import React, { useState, useEffect } from "react";
import dayjs from "dayjs";
import {
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Database,
  Search,
  ShieldAlert,
  Sliders,
  Sparkles,
  Layers,
  FileSpreadsheet,
  Calendar
} from "lucide-react";
import {
  triggerSyncTask,
  formatSyncReceipt,
  getSyncErrorMessage
} from "@/lib/sync-trigger";

interface SyncStatus {
  healthStatus: string;
  detailMessage: string;
  metaConfigured: boolean;
  storesCount: number;
  mappingsCount: number;
  totalInsightsCount: number;
  activeSyncCount: number;
  runningTasksList: Array<{ id: string; type: string; taskType: string; taskChainId: string }>;
}

interface ChainTask {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  recordsFetched: number;
  recordsSaved: number;
  errorMessage?: string;
}

interface GroupedChain {
  chainId: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  tasks: ChainTask[];
}

interface StoreItem {
  id: number;
  name: string;
  platform: string;
}

export function SyncCenterPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [chains, setChains] = useState<GroupedChain[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [stores, setStores] = useState<StoreItem[]>([]);
  
  // Controls
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"chains" | "logs">("chains");
  const [isTriggering, setIsTriggering] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Ledger Rebuild states
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [rebuildStartDate, setRebuildStartDate] = useState(dayjs().subtract(7, "day").format("YYYY-MM-DD"));
  const [rebuildEndDate, setRebuildEndDate] = useState(dayjs().format("YYYY-MM-DD"));

  // Load Status and Logs
  const fetchStatusAndData = async () => {
    try {
      const statusRes = await fetch("/api/sync/status");
      const statusData = await statusRes.json();
      setStatus(statusData);

      const chainsRes = await fetch("/api/sync/chains");
      const chainsData = await chainsRes.json();
      setChains(chainsData);

      const logsRes = await fetch("/api/sync/logs?limit=80");
      const logsData = await logsRes.json();
      setLogs(logsData);

      const storesRes = await fetch("/api/stores");
      const storesData = await storesRes.json();
      setStores(storesData);
      if (storesData.length > 0 && !selectedStoreId) {
        setSelectedStoreId(String(storesData[0].id));
      }

      // Load available Facebook/Meta Accounts
      const accountsRes = await fetch("/api/accounts");
      const accountsData = await accountsRes.json();
      if (Array.isArray(accountsData)) {
        setAccounts(accountsData);
        if (accountsData.length > 0 && !selectedAccountId) {
          setSelectedAccountId(accountsData[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load Sync Center indices:", err);
    }
  };

  const handleRebuildStoreLedger = async () => {
    if (!selectedStoreId) return;

    setIsTriggering("refresh_store_datacenter_ledger");
    setInfoMessage(null);

    try {
      const data = await triggerSyncTask({
        taskType: "refresh_store_datacenter_ledger",
        storeId: selectedStoreId,
        startDate: rebuildStartDate,
        endDate: rebuildEndDate
      });

      setInfoMessage({
        text: formatSyncReceipt(data),
        type: "success"
      });

      await fetchStatusAndData();
    } catch (err: any) {
      setInfoMessage({
        text: getSyncErrorMessage(err),
        type: "error"
      });
    } finally {
      setIsTriggering(null);
    }
  };

  const handleRebuildMetaLedger = async () => {
    if (!selectedAccountId) return;

    setIsTriggering("refresh_meta_datacenter_ledger");
    setInfoMessage(null);
  
    try {
      const data = await triggerSyncTask({
        taskType: "refresh_meta_datacenter_ledger",
        accountId: selectedAccountId,
        startDate: rebuildStartDate,
        endDate: rebuildEndDate,
        includeUnmapped: false
      });

      setInfoMessage({
        text: formatSyncReceipt(data),
        type: "success"
      });

      await fetchStatusAndData();
    } catch (err: any) {
      setInfoMessage({
        text: getSyncErrorMessage(err),
        type: "error"
      });
    } finally {
      setIsTriggering(null);
    }
  };

  useEffect(() => {
    fetchStatusAndData();
    // Poll sync status every 6 seconds if tasks are running
    const timer = setInterval(() => {
      fetchStatusAndData();
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const handleTriggerTask = async (
    taskType: string,
    options: {
      storeId?: string | number | null;
      accountId?: string | null;
      startDate?: string;
      endDate?: string;
      days?: number;
      limit?: number;
      includeUnmapped?: boolean;
    } = {}
  ) => {
    setIsTriggering(taskType);
    setInfoMessage(null);

    try {
      const data = await triggerSyncTask({
        taskType,
        ...options
      });

      setInfoMessage({
        text: formatSyncReceipt(data),
        type: "success"
      });

      await fetchStatusAndData();
    } catch (err: any) {
      setInfoMessage({
        text: getSyncErrorMessage(err),
        type: "error"
      });
    } finally {
      setIsTriggering(null);
    }
  };

  const getHealthBadge = (health: string) => {
    switch (health) {
      case "ready":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> 诊断就绪 / Ready
          </span>
        );
      case "syncing":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20 animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 后台同步中 / Syncing
          </span>
        );
      case "partial_data":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> 链路受限 / Partial
          </span>
        );
      case "missing_meta_token":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-500 border border-red-500/20">
            <ShieldAlert className="w-3.5 h-3.5" /> 丢失令牌 / Missing Secret
          </span>
        );
      case "sync_failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" /> 同步报错 / Error
          </span>
        );
      case "stale_data":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
            <Clock className="w-3.5 h-3.5" /> 数据滞后 / Stale
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400">
            未知 / Unknown
          </span>
        );
    }
  };

  const getTaskBadge = (statusStr: string) => {
    switch (statusStr) {
      case "success":
        return <span className="text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs rounded font-medium">成功</span>;
      case "failed":
        return <span className="text-rose-500 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 text-xs rounded font-medium">失败</span>;
      case "running":
        return (
          <span className="text-blue-500 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" /> 执行中
          </span>
        );
      default:
        return <span className="text-slate-400 bg-slate-800 px-2.5 py-1 text-xs rounded font-medium">等待</span>;
    }
  };

  const translateTaskType = (t: string) => {
    const dict: Record<string, string> = {
      sync_store_profile: "店铺基本资料",
      sync_store_orders: "订单财务流水",
      sync_meta_accounts: "广告主体检测",
      sync_meta_activity: "90天活跃检测",
      sync_meta_structure: "广告结构同步",
      sync_meta_insights: "广告消耗事实同步",
      refresh_store_datacenter_ledger: "店铺账本刷新",
      refresh_meta_datacenter_ledger: "Meta 账户账本刷新",
      sync_meta_audience: "受众拆分同步",
    };
    return dict[t] || t;
  };

  // Filter logs locally
  const filteredLogs = logs.filter((log) => {
    if (!logSearchQuery) return true;
    const q = logSearchQuery.toLowerCase();
    return (
      (log.taskType && log.taskType.toLowerCase().includes(q)) ||
      (log.id && log.id.toLowerCase().includes(q)) ||
      (log.taskChainId && log.taskChainId.toLowerCase().includes(q)) ||
      (log.error && log.error.toLowerCase().includes(q)) ||
      (log.errorMessage && log.errorMessage.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sync Center / 数据同步中心</h1>
          <p className="text-slate-500 text-sm mt-1">
            统一监控、审计并人工调节系统所有关于店铺订单、Meta成效抓取、映射关联计算、AI风控推荐等任务队列。
          </p>
        </div>
        <button
          onClick={fetchStatusAndData}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 shadow-sm text-sm font-medium transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${isTriggering === "refresh" ? "animate-spin" : ""}`} />
          刷新状态
        </button>
      </div>

      {/* Info notification */}
      {infoMessage && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium flex items-start gap-3 transition-all ${
            infoMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : infoMessage.type === "error"
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-blue-50 border-blue-200 text-blue-800"
          }`}
        >
          <div className="flex-1">
            <span className="font-bold">排程回执：</span>
            {infoMessage.text}
          </div>
          <button onClick={() => setInfoMessage(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-2">
            ×
          </button>
        </div>
      )}

      {/* Grid: Health Diagnosis Status Card & Trigger Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Diagnosis Status Indicator */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <span className="text-[15px] font-bold text-slate-900">数据链路健康指标</span>
            {status && getHealthBadge(status.healthStatus)}
          </div>

          {status ? (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600 leading-relaxed">
                {status.detailMessage}
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">绑定店铺数</div>
                  <div className="text-xl font-bold text-slate-800 mt-1">{status.storesCount}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">映射配置链</div>
                  <div className="text-xl font-bold text-slate-800 mt-1">{status.mappingsCount}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 col-span-2">
                  <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">已缓存Meta日度数据明细</div>
                  <div className="text-xl font-bold text-slate-800 mt-1">{status.totalInsightsCount} 行</div>
                </div>
              </div>

              {status.runningTasksList.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
                    后台进行中任务 (Running Tasks):
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1.5 custom-scrollbar bg-blue-50/20 p-2 rounded border border-blue-100/40 font-mono text-[11px]">
                    {status.runningTasksList.map((t) => (
                      <div key={t.id} className="text-blue-700 flex justify-between">
                        <span>▶ {t.taskType}</span>
                        <span className="opacity-70">{t.taskChainId.substring(0,8)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}
        </div>

        {/* Task Executor Panel */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2 flex flex-col justify-between space-y-4">
          <div>
            <div className="border-b border-slate-100 pb-3 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-500" />
              <span className="text-[15px] font-bold text-slate-900">同步任务执行台 / Sync Task Trigger Console</span>
            </div>
            <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">
              支持对单一渠道模块发起手动重补和同步触发。各模块的流向下游都会触达汇总计算机制。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-100 space-y-3">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span className="w-1.5 h-3 bg-blue-600 rounded"></span>
                Meta 数据同步
              </div>

              <p className="text-[11px] text-slate-500 leading-normal">
                统一同步广告账户、广告结构、素材与广告成效数据。店铺订单同步请在店铺管理页面执行。
              </p>

              <button
                onClick={() => handleTriggerTask("sync_meta_creatives", { days: 30 })}
                disabled={!!isTriggering}
                className="w-full flex items-center justify-between text-left p-3 bg-white hover:bg-slate-100 border border-slate-200/80 rounded-lg text-xs font-semibold text-slate-700 transition disabled:opacity-50"
              >
                <span>同步 Meta 数据</span>
                <Play className="w-3.5 h-3.5 text-blue-500 fill-blue-500" />
              </button>
            </div>
          </div>

            {/* Store & Summary Control Blocks */}

            {/* Ledger Rebuild Control Blocks */}
            <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-100 flex flex-col justify-between h-full space-y-4 col-span-1">
              <div>
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-2">
                  <span className="w-1.5 h-3 bg-rose-600 rounded"></span>
                  对账清洗与账目重构 / Ledgers
                </div>
                <p className="text-[11px] text-slate-500 leading-normal mb-3">
                  抹除历史错误事实并重新拉取 API 对账入账。
                </p>

                {/* Range Filters */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">开始日期</label>
                    <input
                      type="date"
                      value={rebuildStartDate}
                      onChange={(e) => setRebuildStartDate(e.target.value)}
                      className="w-full text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">结束日期</label>
                    <input
                      type="date"
                      value={rebuildEndDate}
                      onChange={(e) => setRebuildEndDate(e.target.value)}
                      className="w-full text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200/60 pt-3 space-y-3">
                {/* Store Rebuild Action */}
                <div className="space-y-1">
                  <span className="block text-[10px] text-slate-400 font-semibold">1. 店铺级额度重组</span>
                  <div className="flex gap-1.5">
                    <select
                      value={selectedStoreId}
                      onChange={(e) => setSelectedStoreId(e.target.value)}
                      className="flex-1 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none max-w-[110px]"
                    >
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      {stores.length === 0 && <option value="">暂无店铺</option>}
                    </select>
                    <button
                      onClick={handleRebuildStoreLedger}
                      disabled={!!isTriggering || !selectedStoreId}
                      className="flex-1 truncate flex items-center justify-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isTriggering === "rebuild_store_ledger" ? "animate-spin" : ""}`} />
                      重构店铺
                    </button>
                  </div>
                </div>

                {/* Meta Rebuild Action */}
                <div className="space-y-1">
                  <span className="block text-[10px] text-slate-400 font-semibold">2. Meta 消耗重组</span>
                  <div className="flex gap-1.5">
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="flex-1 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none max-w-[110px]"
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name || acc.id}
                        </option>
                      ))}
                      {accounts.length === 0 && <option value="">暂无账户</option>}
                    </select>
                    <button
                      onClick={handleRebuildMetaLedger}
                      disabled={!!isTriggering || !selectedAccountId}
                      className="flex-1 truncate flex items-center justify-center gap-1 px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isTriggering === "rebuild_meta_ledger" ? "animate-spin" : ""}`} />
                      重构广告
                    </button>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>

      </div>

      {/* Main Tabs Area: Chain Task Tracking vs Linear Log Audit */}
      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        
        {/* Navigation Tabs Header */}
        <div className="bg-slate-50 border-b border-slate-200/60 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("chains")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition ${
                activeTab === "chains"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Layers className="w-4 h-4" />
              链式级联跟踪 / Cascading Chains
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition ${
                activeTab === "logs"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              事务底层日志 / Audit Logs
            </button>
          </div>

          {activeTab === "logs" && (
            <div className="relative w-full md:w-72">
              <input
                type="text"
                placeholder="搜索运行状态、错误日志或任务ID..."
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                className="w-full text-xs font-medium pl-8 pr-4 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          )}
        </div>

        {/* Tab Panel A: Grouped Chains with Status Flow */}
        {activeTab === "chains" && (
          <div className="p-6 space-y-6">
            {chains.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Clock className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-medium">系统尚无已执行的任务链条。请通过上方动作控制台发起同步。</p>
              </div>
            ) : (
              <div className="space-y-4">
                {chains.map((chain) => (
                  <div key={chain.chainId} className="border border-slate-200/80 rounded-xl overflow-hidden shadow-sm">
                    {/* Chain Title Block */}
                    <div className="bg-slate-50/50 p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded font-semibold">
                          CHAIN: {chain.chainId.substring(0, 16)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {dayjs(chain.startedAt).format("MM-DD HH:mm:ss")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">串行状态:</span>
                        {getTaskBadge(chain.status)}
                      </div>
                    </div>

                    {/* Chain Inner Block - Cascading Task Staged List */}
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 bg-white">
                      {chain.tasks.map((task, index) => (
                        <div key={task.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200/60 flex flex-col justify-between space-y-2">
                          <div className="flex justify-between items-start gap-1">
                            <div className="space-y-0.5">
                              <span className="text-xs text-slate-400 font-mono font-medium">#{index + 1} Step</span>
                              <div className="text-xs font-bold text-slate-700">{translateTaskType(task.type)}</div>
                            </div>
                            {getTaskBadge(task.status)}
                          </div>

                          <div className="text-[11px] font-mono text-slate-500 space-y-1">
                            {task.finishedAt ? (
                              <div className="flex justify-between">
                                <span>耗时 / Time:</span>
                                <span>{dayjs(task.finishedAt).diff(dayjs(task.startedAt), "second")}s</span>
                              </div>
                            ) : (
                              <div className="flex justify-between">
                                <span>启动 / Start:</span>
                                <span>{dayjs(task.startedAt).format("HH:mm:ss")}</span>
                              </div>
                            )}

                            {(task.recordsFetched > 0 || task.recordsSaved > 0) && (
                              <div className="flex justify-between text-slate-600 font-medium">
                                <span>写入记录比 / Saved:</span>
                                <span>{task.recordsSaved} / {task.recordsFetched}</span>
                              </div>
                            )}
                          </div>

                          {task.errorMessage && (
                            <div className="text-[10px] text-rose-600 bg-rose-50 border border-rose-100 p-1.5 rounded leading-relaxed break-all">
                              错误: {task.errorMessage}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Panel B: Linear Execution Log Table */}
        {activeTab === "logs" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200/50">
                  <th className="px-6 py-3">任务 UUID / Task ID</th>
                  <th className="px-6 py-3">任务分类 / Task Type</th>
                  <th className="px-6 py-3">串列链ID / Chain ID</th>
                  <th className="px-6 py-3">成效指标比</th>
                  <th className="px-6 py-3">状态 / Status</th>
                  <th className="px-6 py-3">起止时间 / Started At</th>
                  <th className="px-6 py-3">诊断详情 / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-6 py-4 font-mono text-[11px] text-slate-500">{log.id}</td>
                    <td className="px-6 py-4 font-bold text-slate-700">{translateTaskType(log.taskType || log.type)}</td>
                    <td className="px-6 py-4 font-mono text-[11px] text-slate-400">
                      {log.taskChainId ? log.taskChainId.substring(0, 12) : "-"}
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-slate-600">
                      {log.recordsSaved != null ? `${log.recordsSaved} saves` : "0"}
                    </td>
                    <td className="px-6 py-4">{getTaskBadge(log.status)}</td>
                    <td className="px-6 py-4 text-slate-400">
                      {dayjs(log.startedAt).format("YYYY-MM-DD HH:mm:ss")}
                    </td>
                    <td className="px-6 py-4 max-w-xs truncate text-slate-500">
                      {log.errorMessage || log.error || "成功运行：正常解压归档并写入SQLite"}
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-20 text-slate-400">
                      无对应的任务或者检索到审计记录。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Extreme Historical Data Complete Rebuild Console Area (Danger Zone) */}
      <div className="bg-white border border-red-200/80 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5 text-rose-600">
          <ShieldAlert className="w-5 h-5" />
          <h2 className="text-[15px] font-bold tracking-tight">高级维护控制台 / Danger Zone</h2>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
          用于数据失真修复：点击下面的控制按键将清空本地数据库中 
          <code className="bg-red-50 text-red-600 border border-red-100/60 px-1 py-0.5 rounded mx-1 font-mono text-[11px]">dailySummary</code> 核心多维汇总表，
          并根据现有的关联映射参数、店铺交易数据和广告抓取结果，全面重构过去 90 天所有汇总指标链条和 ROAS 参数。此操作不可逆，运行可能耗费15-30秒！
        </p>
        
        {showConfirmRebuild ? (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 space-y-3 max-w-xl transition-all">
            <p className="text-xs text-red-800 font-bold">
              你确定要清空并拉起全量 90 天多维数据重建吗？如果后台其他同步任务正在执行，可能会发生线程锁死！
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleFullRebuild}
                disabled={!!isTriggering}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
              >
                确定全面重建
              </button>
              <button
                onClick={() => setShowConfirmRebuild(false)}
                className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-100 transition"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirmRebuild(true)}
            className="px-4 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 font-bold rounded-xl text-xs shadow-sm active:scale-95 transition"
          >
            全面重建历史数据 / Reconstruct Historical Summaries
          </button>
        )}
      </div>

    </div>
  );
}
