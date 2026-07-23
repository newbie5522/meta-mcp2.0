import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Plus, Store, Link as LinkIcon, Trash2, RefreshCw, ChevronDown, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function getTimezoneSourceLabel(source: string | null | undefined): string {
  const labels: Record<string, string> = {
    platform_shop_api: "平台 API 已验证",
    persisted_verified: "历史验证记录",
    manual_verified: "管理员人工确认",
    temporary_default_la: "临时按美西时区",
    unverified: "尚未验证"
  };
  return labels[source || "unverified"] || labels.unverified;
}

export function getTimestampEncodingLabel(diagnostics: any): string {
  const timestampDiagnostics = diagnostics?.timestampDiagnostics;
  if (!timestampDiagnostics) return "订单时间编码：UNKNOWN";
  const offsets = Array.isArray(timestampDiagnostics.observedOffsets) && timestampDiagnostics.observedOffsets.length > 0
    ? `（${timestampDiagnostics.observedOffsets.join(" / ")}）`
    : "";
  return `订单时间编码：${timestampDiagnostics.encoding}${offsets}`;
}

export function getTimestampConversionLabel(diagnostics: any): string {
  const normalizedToTimezone = diagnostics?.timestampDiagnostics?.normalizedToTimezone || diagnostics?.normalizedTimezone || "-";
  const localDateField = diagnostics?.timestampDiagnostics?.localDateField || "Order.store_local_date";
  return `日期换算：已按 ${normalizedToTimezone} 换算为 ${localDateField}`;
}

export function getWarningsBadgeLabel(warnings: unknown): string {
  return Array.isArray(warnings) && warnings.length > 0 ? "需关注" : "";
}

export function StoresDashboard({ startDate, endDate }: { startDate?: Date; endDate?: Date }) {
  const navigate = useNavigate();
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filterType, setFilterType] = useState<"connected" | "unconnected" | "all">("connected");
  const [expandedStoreIds, setExpandedStoreIds] = useState<Record<number, boolean>>({});

  const toggleExpand = (id: number) => {
    setExpandedStoreIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const isApiBound = (store: any) => {
    return !!(
      store.hasShoplineToken ||
      store.hasShopifyToken ||
      store.hasShoplazzaToken
    );
  };

  const getApiErrorMessage = (error: any) => {
    const data = error?.response?.data;
    return data?.message || data?.details || data?.error || error?.message || "同步店铺数据失败";
  };

  const allCount = stores.length;
  
  const connectedStores = stores.filter(store => {
    const apiBound = isApiBound(store);
    return apiBound;
  });

  const unconnectedStores = stores.filter(store => {
    const apiBound = isApiBound(store);
    return !apiBound;
  });

  const displayedStores = filterType === "connected"
    ? connectedStores
    : filterType === "unconnected"
    ? unconnectedStores
    : stores;

  // States for store deletion
  const [deletingStoreId, setDeletingStoreId] = useState<number | null>(null);
  const [deleteStoreName, setDeleteStoreName] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleSyncStore = async () => {
    setSyncing(true);
    const syncToast = toast.loading("正在同步店铺与订单数据...");
    try {
      const sDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const eDate = endDate || new Date();
      // Format to local YYYY-MM-DD format safely
      const offset = sDate.getTimezoneOffset();
      const localSDate = new Date(sDate.getTime() - (offset * 60 * 1000));
      const localEDate = new Date(eDate.getTime() - (offset * 60 * 1000));
      const startStr = localSDate.toISOString().split('T')[0];
      const endStr = localEDate.toISOString().split('T')[0];

      const response = await axios.post("/api/sync/trigger", {
        taskType: "sync_store_orders",
        startDate: startStr,
        endDate: endStr,
        days: 90,
        limit: 10
      });
      if (response.data?.status === "NO_NEW_DATA") {
        toast.warning(response.data.message || "同步完成，但当前日期范围暂无新的店铺订单。", { id: syncToast });
      } else {
        toast.success(response.data.message || "店铺和订单数据同步完成", { id: syncToast });
      }
      fetchStores();
    } catch (error: any) {
      toast.error(getApiErrorMessage(error), { id: syncToast });
    } finally {
      setSyncing(false);
    }
  };

  const fetchStores = async () => {
    setLoading(true);
    try {
      const storesRes = await axios.get("/api/stores");
      setStores(Array.isArray(storesRes.data) ? storesRes.data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStores();
  }, []);

  const handleDeleteStore = async (storeId: number) => {
    setDeleteLoading(true);
    try {
      const res = await axios.delete(`/api/stores/${storeId}`);
      toast.success(res.data.message || "店铺删除成功");
      setDeletingStoreId(null);
      setDeleteStoreName("");
      // Refresh list
      fetchStores();
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.error || "删除店铺失败，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto space-y-6 pb-12">
      <div className="flex justify-between items-center bg-white p-6 rounded-[12px] shadow-sm border border-[#e5e7eb]">
        <div>
          <h2 className="text-xl font-bold">店铺管理</h2>
          <p className="text-sm text-gray-500 mt-1">
            管理独立站店铺，并关联对应的 Meta 广告账户
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="flex items-center gap-2 text-gray-700 border-gray-300 hover:bg-gray-50"
            onClick={handleSyncStore}
            disabled={syncing}
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            同步店铺数据
          </Button>
          <Button onClick={() => navigate("/store/new")}>添加店铺</Button>
        </div>
      </div>

      {/* Tab filter control for stores - Single Choice (单选功能) */}
      {!loading && stores.length > 0 && (
        <div className="bg-white p-4 rounded-[12px] shadow-sm border border-[#e5e7eb] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">店铺筛选:</span>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setFilterType("connected")}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer",
                  filterType === "connected"
                    ? "bg-white text-slate-900 shadow-sm border border-slate-100 font-bold"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                已连接店铺 ({connectedStores.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterType("unconnected")}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer",
                  filterType === "unconnected"
                    ? "bg-white text-slate-900 shadow-sm border border-slate-100 font-bold"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                未连接店铺 ({unconnectedStores.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterType("all")}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer",
                  filterType === "all"
                    ? "bg-white text-slate-900 shadow-sm border border-slate-100 font-bold"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                全部店铺 ({stores.length})
              </button>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            {filterType === "connected" && "💡 已绑定 API 或已分配广告账户的店铺（未连接的店铺已自动折叠隐藏）"}
            {filterType === "unconnected" && "💡 发现没有关联广告账户且未绑定 API 的潜在闲置店铺"}
            {filterType === "all" && "💡 显示系统内录入的所有店铺"}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : stores.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-24 text-center">
            <Store className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">暂无已连接店铺</h3>
            <p className="text-sm text-gray-500 mb-4">
              暂无已连接店铺。请添加真实 Shopline / Shoplazza / Shopify API 授权后开始同步。
            </p>
            <Button onClick={() => navigate("/store/new")}>
              <Plus className="h-4 w-4 mr-2" />
              添加第一个店铺
            </Button>
          </CardContent>
        </Card>
      ) : displayedStores.length === 0 ? (
        <Card className="border-dashed border-2 bg-slate-50 border-slate-200">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Store className="h-10 w-10 text-slate-400 mb-3" />
            <h3 className="text-base font-semibold text-slate-700 mb-1">
              {filterType === "connected" ? "没有已连接的店铺" : "没有未连接的店铺"}
            </h3>
            <p className="text-xs text-slate-500">
              {filterType === "connected" 
                ? "所有店铺都处于未连接状态，您可以点击上方【未连接店铺】按钮查看与管理"
                : "恭喜！目前系统内所有的店铺均已正常配置/关联！"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayedStores.map((store) => {
            const apiBound = isApiBound(store);
            return (
              <Card
                key={store.id}
                className="cursor-pointer hover:shadow-md transition-shadow border-gray-200"
                onClick={() => navigate(`/store/${store.id}`)}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-blue-50 text-meta-blue flex items-center justify-center rounded-lg">
                        <Store className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 flex items-center gap-1.5 flex-wrap">
                          {store.name}
                          {store.platform && (
                            <span className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded-full font-semibold tracking-wide uppercase inline-block",
                              store.platform === "shopline" && "bg-blue-50 text-blue-600 border border-blue-200",
                              store.platform === "shoplazza" && "bg-emerald-50 text-emerald-600 border border-emerald-200",
                              store.platform === "shopify" && "bg-green-50 text-green-600 border border-green-200",
                            )}>
                              {store.platform === "shoplazza" ? "SHOPLAZZA" : (store.platform === "shopline" ? "SHOPLINE" : "Shopify")}
                            </span>
                          )}
                          {!apiBound && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-600 border border-amber-200 uppercase inline-block">
                              未连接
                            </span>
                          )}
                          {apiBound && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 uppercase inline-block">
                              API 已装配
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {store.domain || "未配置域名"}
                        </p>
                      </div>
                    </div>
                    
                    {/* Delete Button */}
                    <button
                      type="button"
                      title="删除店铺"
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingStoreId(store.id);
                        setDeleteStoreName(store.name);
                      }}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-600 mt-4 border-t pt-4">
                    <span className={cn(
                      "text-xs px-1.5 py-0.5 rounded font-mono",
                      apiBound ? "text-emerald-700 bg-emerald-50" : "text-slate-400 bg-slate-50"
                    )}>
                      {apiBound ? "API ACTIVE" : "NO API"}
                    </span>
                  </div>

                  {store.timezoneDiagnostics && (
                    <div className="border-t pt-2 mt-3 flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer font-semibold text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(store.id);
                        }}
                      >
                        {expandedStoreIds[store.id] ? "收起时区与同步血缘" : "查看时区与同步血缘"}
                        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform inline-block", expandedStoreIds[store.id] && "rotate-180")} />
                      </button>

                      {store.timezoneDiagnostics.warnings?.length > 0 && (
                        <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-bold">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          <span className="text-[10px]">{getWarningsBadgeLabel(store.timezoneDiagnostics.warnings)}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {expandedStoreIds[store.id] && store.timezoneDiagnostics && (
                    <div 
                      className="mt-3 p-3 bg-slate-50 rounded-lg text-xs space-y-2.5 border border-slate-100 font-sans"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="grid grid-cols-2 gap-2 text-[11px] bg-white p-2.5 rounded border border-gray-100">
                        <div>
                          <span className="text-gray-400 block font-medium">1. timezone 原始配置值:</span>
                          <span className="font-mono text-gray-800 block text-[12px] truncate" title={store.timezoneDiagnostics.configuredTimezone || "null"}>
                            {store.timezoneDiagnostics.configuredTimezone || "未配置"}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400 block font-medium">2. 标准使用值 (normalized):</span>
                          <span className="font-mono text-gray-800 block text-[12px] truncate" title={store.timezoneDiagnostics.normalizedTimezone}>
                            {store.timezoneDiagnostics.normalizedTimezone}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400 block font-medium">3. 时区 Offset / 当前:</span>
                          <span className="font-mono text-gray-800 block text-[12px]">
                            {store.timezoneDiagnostics.currentOffset || "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400 block font-medium">4. timezoneSource 来源:</span>
                          <span className="font-bold text-indigo-600 block text-[11px] truncate">
                            <span className="text-[11px]">{getTimezoneSourceLabel(store.timezoneDiagnostics.timezoneSource)}</span>
                          </span>
                        </div>
                      </div>

                      {store.timezoneDiagnostics.lastSyncWindow ? (
                        <div className="space-y-1.5 text-[11px]">
                          <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-indigo-500" />
                            最近一次订单同步窗口血缘
                          </div>
                          <div className="grid grid-cols-1 gap-2 font-mono text-[10px] text-gray-500 bg-white p-2.5 rounded border border-gray-100">
                            <div>
                              <span className="text-gray-400 block font-sans">5. sync_store_orders 请求窗口:</span>
                              <div className="text-gray-700 break-all font-mono select-all bg-slate-50 p-1 rounded font-medium mt-0.5">
                                {store.timezoneDiagnostics.lastSyncWindow.requestStartAt || "-"} 至 {store.timezoneDiagnostics.lastSyncWindow.requestEndAt || "-"}
                              </div>
                            </div>
                            <div>
                              <span className="text-gray-400 block font-sans">6. 拓展防丢溢出窗口:</span>
                              <div className="text-gray-700 break-all font-mono select-all bg-slate-50 p-1 rounded font-medium mt-0.5">
                                {store.timezoneDiagnostics.lastSyncWindow.expandedStartAt || "-"} 至 {store.timezoneDiagnostics.lastSyncWindow.expandedEndAt || "-"}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                              <div>
                                <span className="text-gray-400 block font-sans">7. 归因时点口径:</span>
                                <span className="text-slate-800 font-sans block font-semibold text-[11px] truncate bg-slate-50 p-1 rounded" title={store.timezoneDiagnostics.lastSyncWindow.attributionField}>
                                  {store.timezoneDiagnostics.lastSyncWindow.attributionField || "-"}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400 block font-sans">8. 收入口径字段:</span>
                                <span className="text-slate-800 font-sans block font-semibold text-[11px] truncate bg-slate-50 p-1 rounded" title={store.timezoneDiagnostics.lastSyncWindow.revenueField}>
                                  {store.timezoneDiagnostics.lastSyncWindow.revenueField || "-"}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400 block font-sans">9. HTTP 请求页数:</span>
                                <span className="text-slate-800 font-sans block font-semibold text-[11px] bg-slate-50 p-1 rounded">
                                  {store.timezoneDiagnostics.lastSyncWindow.pagesFetched ?? "-"} 页
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400 block font-sans">10. 验证同步订单/金额:</span>
                                <span className="text-emerald-700 font-sans block font-bold text-[11px] bg-emerald-50 p-1 rounded">
                                  {store.timezoneDiagnostics.lastSyncWindow.validOrdersCount ?? 0} 单 (US${store.timezoneDiagnostics.lastSyncWindow.validPaidTotal?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"})
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white p-2.5 rounded border border-gray-150 text-[11.5px] text-slate-400 italic font-sans text-center">
                          ⚠️ 暂无该店铺最近一次同步血缘信息
                        </div>
                      )}

                      {store.timezoneDiagnostics.timestampDiagnostics && (
                        <div className="text-[11px] bg-blue-50 p-2.5 rounded border border-blue-100 text-blue-900 space-y-1">
                          <div className="font-semibold">{getTimestampEncodingLabel(store.timezoneDiagnostics)}</div>
                          <div>{getTimestampConversionLabel(store.timezoneDiagnostics)}</div>
                          <div className="text-blue-700">{store.timezoneDiagnostics.timestampDiagnostics.message}</div>
                        </div>
                      )}

                      {store.timezoneDiagnostics.observedOrderOffsets && store.timezoneDiagnostics.observedOrderOffsets.length > 0 && (
                        <div className="text-[11px] bg-white p-2 rounded border border-gray-100">
                          <span className="font-semibold block text-slate-700 font-sans mb-1">订单中观测到的 offsets:</span>
                          <div className="flex flex-wrap gap-1">
                            {store.timezoneDiagnostics.observedOrderOffsets.map((os: string, idx: number) => (
                              <span key={idx} className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono font-medium text-[10px]">
                                {os}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {store.timezoneDiagnostics.warnings?.length > 0 && (
                        <div className="p-2.5 bg-amber-50 rounded border border-amber-200 text-[10.5px] text-amber-800 space-y-1 font-sans">
                          {store.timezoneDiagnostics.warnings.map((warn: string, idx: number) => (
                            <div key={idx} className="flex gap-1.5 align-top">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-600 flex-shrink-0" />
                              <span className="leading-tight font-medium">{warn}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modern Confirmation Overlay Dialog */}
      {deletingStoreId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 transition-opacity duration-300">
          <div className="bg-white p-6 rounded-[12px] max-w-md w-full shadow-xl border border-gray-100 transform scale-100 transition-transform duration-300">
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <div className="h-10 w-10 bg-red-50 rounded-full flex items-center justify-center">
                <Trash2 className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">确认删除店铺</h3>
            </div>
            
            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
              您确定要删除店铺 <span className="font-semibold text-gray-900">"{deleteStoreName}"</span> 吗？
              这将硬删除该店铺关联的所有配置、广告账户关联信息和离线缓存指标，此操作无法撤销。
            </p>

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button 
                variant="outline" 
                onClick={() => { setDeletingStoreId(null); setDeleteStoreName(""); }}
                disabled={deleteLoading}
              >
                取消
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => handleDeleteStore(deletingStoreId)}
                disabled={deleteLoading}
              >
                {deleteLoading ? "正在删除..." : "确认删除"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
