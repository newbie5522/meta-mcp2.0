import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Settings,
  Store,
  Key,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STORE_PLATFORM_OPTIONS = [
  {
    id: "shopline",
    label: "SHOPLINE",
    domainPlaceholder: "xxxx.myshopline.com",
    tokenPlaceholder: "输入 SHOPLINE Access Token"
  },
  {
    id: "shoplazza",
    label: "SHOPLAZZA",
    domainPlaceholder: "xxxx.myshoplaza.com",
    tokenPlaceholder: "输入 SHOPLAZZA Access Token"
  },
  {
    id: "shopify",
    label: "Shopify",
    domainPlaceholder: "xxxx.myshopify.com",
    tokenPlaceholder: "输入 Shopify Access Token"
  }
] as const;

type StorePlatformId = typeof STORE_PLATFORM_OPTIONS[number]["id"];

const getCurrentPlatformOption = (platform?: string) =>
  STORE_PLATFORM_OPTIONS.find(p => p.id === platform) || STORE_PLATFORM_OPTIONS[0];

function getAccountId(acc: unknown): string {
  if (!acc || typeof acc !== "object") return "";
  const a = acc as Record<string, unknown>;
  return String(a.id ?? a.account_id ?? a.accountId ?? "").trim();
}

function getAccountName(acc: unknown): string {
  if (!acc || typeof acc !== "object") return "";
  const a = acc as Record<string, unknown>;
  const accountId = getAccountId(acc);
  return String(a.name ?? a.accountName ?? a.fb_account_name ?? accountId ?? "Unknown").trim();
}

interface StoreSaveResponse {
  success: boolean;
  mode?: "created" | "updated_by_id" | "updated_existing_by_name";
  id?: number;
  store?: {
    id?: number;
    name?: string;
    platform?: string;
    domain?: string | null;
  };
  message?: string;
  error?: string;
  details?: string;
  warnings?: string[];
}

export function StoreDetailsPage({
  isNew = false,
}: {
  isNew?: boolean;
}) {
  const navigate = useNavigate();
  const { storeId } = useParams();
  const [storeData, setStoreData] = useState<any>({
    name: "",
    platform: "shopline",
    shopline_token: "",
    shopify_token: "",
    shoplazza_token: "",
    domain: "",
    timezone: "GMT+8",
  });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [savedStoreId, setSavedStoreId] = useState<number | null>(null);

  // Ad Account Mappings States
  const [mappings, setMappings] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);
  const [searchAccountQuery, setSearchAccountQuery] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [loadingAccountsList, setLoadingAccountsList] = useState(false);

  const hasStoreId = !isNew || !!storeId || !!savedStoreId;

  useEffect(() => {
    if (addAccountOpen && availableAccounts.length === 0) {
      setLoadingAccountsList(true);
      axios.get("/api/accounts")
        .then(res => setAvailableAccounts(Array.isArray(res.data) ? res.data : (res.data.data || [])))
        .catch(() => toast.error("拉取账户列表失败"))
        .finally(() => setLoadingAccountsList(false));
    }
  }, [addAccountOpen]);

  const fetchAssociatedAdAccounts = async () => {
    if (!storeData?.name) return;
    setAccountsLoading(true);
    try {
      const mappingsRes = await axios.get("/api/mappings");
      if (Array.isArray(mappingsRes.data)) {
        setMappings(mappingsRes.data.filter((m: any) => m.store && String(m.store).toLowerCase() === String(storeData.name).toLowerCase()));
      }
    } catch (error) {
      console.error("Failed to fetch associated account data:", error);
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    if (hasStoreId && storeData?.name) {
      fetchAssociatedAdAccounts();
    }
  }, [hasStoreId, storeData?.name]);

  const handleAddAccountSubmit = async () => {
    if (selectedAccountIds.length === 0) {
      toast.error("请先选择要绑定的广告账户");
      return;
    }
    setSaving(true);
    try {
      const mappingsPayload = selectedAccountIds.map(id => {
        const acc = availableAccounts.find(a => getAccountId(a) === id);
        return {
          accountId: id,
          accountName: getAccountName(acc),
          store: storeData?.name,
          owner: "未分配",
          project: "未分配",
        };
      });

      const res = await axios.post("/api/mappings/batch", { mappings: mappingsPayload });
      
      if (res.data.success) {
        toast.success(`成功绑定 ${res.data.count || res.data.count === 0 ? res.data.count : selectedAccountIds.length} 个账户`);
        setAddAccountOpen(false);
        setSelectedAccountIds([]);
        fetchAssociatedAdAccounts();
      } else {
        toast.error("批量添加广告账户失败");
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || "添加广告账户出错");
    } finally {
      setSaving(false);
    }
  };

  const handleUnmapAccount = async (accountId: string) => {
    if (!window.confirm("确定要解除该广告账户与当前店铺的关联吗？")) return;
    try {
      const res = await axios.post("/api/mappings/batch", {
        mappings: [{ accountId: accountId, store: "未分配" }]
      });
      if (res.data.success) {
        toast.success("解除关联成功");
        fetchAssociatedAdAccounts();
      } else {
        toast.error("解除关联失败");
      }
    } catch (error) {
      toast.error("解除关联失败");
    }
  };

  useEffect(() => {
    const activeStoreId = storeId || savedStoreId;
    if (!isNew && activeStoreId) {
      fetchStore(Number(activeStoreId));
    }
  }, [isNew, storeId, savedStoreId]);

  const fetchStore = async (targetId: number) => {
    try {
      const res = await axios.get(`/api/stores/${targetId}`);
      setStoreData(res.data);
    } catch (err: any) {
      if (err.response?.status === 404 && targetId && isNaN(Number(targetId))) {
        setStoreData((prev: any) => ({ ...prev, name: String(targetId) }));
      } else {
        toast.error("加载店铺数据失败");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStore = async () => {
    if (!storeData.name) return toast.error("请输入店铺名称");
    setSaving(true);
    try {
      const { mode: _mode, ...storePayload } = storeData;
      const payload = {
        ...storePayload,
        id: storeId || savedStoreId || undefined,
        name: storeData.name?.trim(),
        domain: storeData.domain?.trim()
      };
      
      const res = await axios.post("/api/stores", payload);
      
      if (res.data.success === false) {
        throw new Error(res.data.details || res.data.error || "保存失败");
      }

      const mode = res.data.mode;
      let successMsg = "店铺保存成功";
      if (mode === "created") {
        successMsg = "店铺配置已创建";
      } else if (mode === "updated_by_id") {
        successMsg = "店铺配置已保存";
      } else if (mode === "updated_existing_by_name") {
        successMsg = "已检测到同名店铺，已更新已有配置";
      }
      
      const savedStore = res.data.store || res.data;
      const savedId = res.data.id || savedStore?.id;
      
      if (isNew && !savedId) {
        console.error("Store save complete but return payload had no ID:", res.data);
        toast.error("保存成功，但系统未能匹配返回的店铺ID（响应内容：" + JSON.stringify(res.data) + "）");
        return;
      }

      toast.success(successMsg);
      
      if (savedId) {
        setSavedStoreId(Number(savedId));
      }

      if (isNew && savedId) {
        navigate(`/store/${savedId}`, { replace: true });
      } else {
        if (savedId) {
          fetchStore(Number(savedId));
        } else {
          const activeId = storeId || savedStoreId;
          if (activeId) fetchStore(Number(activeId));
        }
      }
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err)
          ? err.response?.data?.details || err.response?.data?.error || err.message
          : err instanceof Error
            ? err.message
            : "保存失败";

      toast.error(`保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-[400px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-meta-blue animate-spin" />
      </div>
    );
  }

  const accountsFilter = availableAccounts.filter(acc => 
    (acc.name || acc.accountName || "").toLowerCase().includes(searchAccountQuery.toLowerCase()) || 
    String(acc.account_id || acc.accountId).includes(searchAccountQuery)
  );

  return (
    <div className="flex-1 overflow-y-auto space-y-6 pb-12">
      <div className="flex items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <button
          onClick={() => navigate("/?tab=stores")}
          className="text-slate-500 hover:text-slate-900 flex items-center gap-2 cursor-pointer font-medium"
        >
          <ArrowLeft className="h-5 w-5" />
          返回店铺列表
        </button>
        <div className="h-5 w-px bg-slate-200"></div>
        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
          {isNew ? "新建店铺配置" : `店铺: ${storeData.name}`}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* === 店铺基础配置 === */}
        <Card className="shadow-sm border border-slate-200 bg-white">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-4 px-6">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-50 text-meta-blue"><Store className="w-4 h-4" /></span>
              店铺基础配置
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-3 pb-4 border-b border-slate-100">
              <label className="text-sm font-semibold text-slate-700 block">店铺所在独立站平台</label>
              <div className="grid grid-cols-3 gap-3">
                {STORE_PLATFORM_OPTIONS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setStoreData({ ...storeData, platform: p.id })}
                    className={cn(
                      "p-3 rounded-lg border text-sm font-medium transition-colors font-bold cursor-pointer",
                      (storeData.platform || "shopline") === p.id
                        ? "border-meta-blue bg-blue-50 text-meta-blue shadow-sm"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">店铺名称 *</label>
                <Input
                  value={storeData.name || ""}
                  onChange={(e) => setStoreData({ ...storeData, name: e.target.value })}
                  placeholder="如您的域名主体或店铺简写"
                  className="h-10 border-slate-200"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">店铺域名</label>
                <Input
                  value={storeData.domain || ""}
                  onChange={(e) => setStoreData({ ...storeData, domain: e.target.value })}
                  placeholder={
                    STORE_PLATFORM_OPTIONS.find(p => p.id === storeData.platform)?.domainPlaceholder || "xxxx.myshopline.com"
                  }
                  className="h-10 border-slate-200"
                />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">独立站 API 请求令牌</h3>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Access Token</label>
                <Input
                  type="password"
                  value={
                    storeData.platform === "shoplazza" ? storeData.shoplazza_token :
                    storeData.platform === "shopify" ? storeData.shopify_token :
                    storeData.shopline_token || ""
                  }
                  onChange={(e) => {
                    const key = storeData.platform === "shoplazza" ? "shoplazza_token" :
                                storeData.platform === "shopify" ? "shopify_token" :
                                "shopline_token";
                    setStoreData({ ...storeData, [key]: e.target.value });
                  }}
                  placeholder={
                    STORE_PLATFORM_OPTIONS.find(p => p.id === storeData.platform)?.tokenPlaceholder || "输入 Access Token"
                  }
                  className="h-10 border-slate-200"
                />
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <Button
                onClick={handleSaveStore}
                disabled={saving}
                className="bg-meta-blue hover:bg-meta-blue/90 font-semibold cursor-pointer"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? "保存中..." : "保存配置"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* === Meta 账户绑定映射 === */}
        {hasStoreId && (
          <Card className="shadow-sm border border-slate-200 bg-white">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-4 px-6 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><Key className="w-4 h-4" /></span>
                Meta 账户绑定映射
              </CardTitle>
              <Dialog open={addAccountOpen} onOpenChange={setAddAccountOpen}>
                <DialogTrigger render={
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer">
                    <Plus className="w-4 h-4 mr-1" /> 添加映射
                  </Button>
                } />
                <DialogContent className="sm:max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl">
                  <DialogHeader className="border-b pb-4 mb-2">
                    <DialogTitle className="font-bold">添加关联账号绑定</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <Input
                      placeholder="搜索账号名称或 ID"
                      value={searchAccountQuery}
                      onChange={e => setSearchAccountQuery(e.target.value)}
                      className="border-slate-200"
                    />
                    <div className="max-h-[300px] overflow-y-auto border border-slate-100 rounded-lg">
                      <Table>
                        <TableHeader className="bg-slate-50 sticky top-0 shadow-sm border-b">
                           <TableRow>
                            <TableHead className="w-[50px] text-center">
                              <Checkbox 
                                checked={accountsFilter.length > 0 && selectedAccountIds.length === accountsFilter.length}
                                onCheckedChange={(checked) => {
                                  setSelectedAccountIds(checked ? accountsFilter.map(a => getAccountId(a)) : []);
                                }}
                              />
                            </TableHead>
                            <TableHead className="font-bold text-slate-700">账户名称</TableHead>
                            <TableHead className="font-bold text-slate-700">ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loadingAccountsList ? (
                            <TableRow><TableCell colSpan={3} className="text-center h-24 text-slate-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
                          ) : availableAccounts.length === 0 ? (
                            <TableRow><TableCell colSpan={3} className="text-center h-24 text-slate-500 font-medium p-4">暂无可绑定账户，请先到 Meta 账户配置页保存 Token 并拉取账户。</TableCell></TableRow>
                          ) : accountsFilter.length === 0 ? (
                            <TableRow><TableCell colSpan={3} className="text-center h-24 text-slate-400">在活跃账户中未检索到结果</TableCell></TableRow>
                          ) : (
                            accountsFilter.map((acc, index) => {
                              const accId = getAccountId(acc);
                              const accName = getAccountName(acc);
                              return (
                                <TableRow key={accId} className={index % 2===0 ? "bg-white" : "bg-slate-50/50"}>
                                  <TableCell className="text-center py-2 border-r border-[#f3f4f6]">
                                    <div className="flex justify-center">
                                      <Checkbox 
                                        checked={selectedAccountIds.includes(accId)}
                                        onCheckedChange={(c) => {
                                          setSelectedAccountIds(prev => c ? [...prev, accId] : prev.filter(i => i !== accId));
                                        }}
                                      />
                                    </div>
                                  </TableCell>
                                  <TableCell className="font-medium text-slate-800 border-r border-[#f3f4f6]">{accName}</TableCell>
                                  <TableCell className="font-mono text-xs text-slate-500">{accId}</TableCell>
                                </TableRow>
                              )
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-sm font-medium text-slate-600">已勾选 {selectedAccountIds.length} 项</span>
                      <Button onClick={handleAddAccountSubmit} disabled={selectedAccountIds.length === 0 || saving} className="bg-emerald-600 hover:bg-emerald-700 font-semibold cursor-pointer">
                        {saving ? "绑定中..." : "批量绑定至当前店铺"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              {accountsLoading ? (
                <div className="h-32 flex items-center justify-center text-slate-400 text-sm">
                  <Loader2 className="w-5 h-5 text-meta-blue animate-spin mr-2" />
                  正在加载绑定数据...
                </div>
              ) : mappings.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center bg-slate-50/50">
                  <Key className="w-10 h-10 text-slate-300 mb-3" />
                  <p className="text-sm font-semibold text-slate-700">暂无已绑定账户</p>
                  <p className="text-xs text-slate-500 mt-1">右上角点击「添加映射」或「添加账户」即可选择Meta账户</p>
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50/80 border-b">
                    <TableRow>
                      <TableHead className="font-bold text-slate-700">账户名称</TableHead>
                      <TableHead className="font-bold text-slate-700">账户 ID</TableHead>
                      <TableHead className="text-right font-bold text-slate-700">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((m, index) => (
                      <TableRow key={m.accountId} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/30"}>
                        <TableCell className="font-medium text-slate-800">{m.accountName || m.accountId}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">{m.accountId}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => handleUnmapAccount(m.accountId)} className="text-slate-400 hover:text-red-600 hover:bg-red-50 h-8 px-3 cursor-pointer">
                            <Trash2 className="w-4 h-4 mr-1" /> 解绑
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
