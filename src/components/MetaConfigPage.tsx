import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, RefreshCcw, Activity, AlertTriangle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

export function MetaConfigPage() {
  const [token, setToken] = useState<string>('');
  const [maskedToken, setMaskedToken] = useState<string>('');
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [isEditingToken, setIsEditingToken] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Diagnostics and testing state
  const [testResult, setTestResult] = useState<any>(null);
  const [testingToken, setTestingToken] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<any>(null);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'inactive'>('all');

  const fetchAccountsFromDb = async () => {
    setLoadingAccounts(true);
    try {
      const res = await axios.get('/api/accounts/db-list');
      setAccounts(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to load accounts from database:", err);
      toast.error("从本地数据库加载已保存的广告账户失败");
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchToken = async () => {
    try {
      const res = await axios.get('/api/settings');
      let fbToken = '';
      if (res.data && res.data.meta_token) {
        fbToken = res.data.meta_token;
      } else if (res.data && res.data.META_ACCESS_TOKEN) {
        fbToken = res.data.META_ACCESS_TOKEN;
      }
      if (fbToken) {
        setMaskedToken(fbToken);
        setHasSavedToken(true);
        setToken('');
        setIsEditingToken(false);
      } else {
        setMaskedToken('');
        setHasSavedToken(false);
        setIsEditingToken(true);
      }
    } catch (err) {
      console.error("Failed to fetch meta token", err);
    }
  };

  const testMetaToken = async () => {
    setTestingToken(true);
    setApiError(null);
    try {
      const res = await axios.get('/api/accounts/test-token');
      setTestResult(res.data);
      setLastSyncError(null);
      return res.data;
    } catch (err: any) {
      console.error("Failed token diagnostic test:", err);
      const detailError = err.response?.data?.details?.error?.error || err.response?.data?.details?.error || null;
      setApiError(detailError);
      setTestResult(null);
      setLastSyncError(err.response?.data?.error || err.message);
      throw err;
    } finally {
      setTestingToken(false);
    }
  };

  const fetchAccountsAndTest = async () => {

    setLoadingAccounts(true);
    setApiError(null);
    setLastSyncError(null);

    try {
      // Step 1: Run diagnostics first (triggers identity /me endpoint verification)
      const diagnostics = await testMetaToken().catch((e) => {
        // Continue but keep diagnostic error stored
        return null;
      });


      // Step 2: Grab the accounts list
      const res = await axios.get('/api/accounts/active-list');
      const accountsList = Array.isArray(res.data) ? res.data : [];
      setAccounts(accountsList);

      const isFallback = accountsList.some((acc: any) => acc.isFallbackDbCopy);

      if (isFallback) {
        setLastSyncError("当前展示的是本地缓存账户，不是本次 Meta API 同步结果。");
        toast.warning("当前展示的是本地缓存账户，不是本次 Meta API 同步结果。");
      } else {
        if (diagnostics) {
          if (diagnostics.apiAccessStatus !== "usable") {
            setLastSyncError("Token identity check completed, but ad account API was limited. Account list follows /api/accounts/active-list.");
            toast.warning("Token identity check completed, but account sync used active-list as the source.");
          }
          if (accountsList.length === 0) {
            toast.warning("Token 验证成功，但在该 Meta 商务资产下未能拉取到可访问的广告账户，可能是权限限制或账户分配不足！");
          } else {
            toast.success(`成功拉取并注册了 ${accountsList.length} 个广告账户基础结构！`);
          }
        }
      }
    } catch (err: any) {
      console.error("Failed to sync accounts list:", err);
      let errorMsg = "拉取账户列表失败，请验证 API Token 有效性。";
      const fbErr = err.response?.data?.details?.error?.error || err.response?.data?.details?.error;
      if (fbErr?.message) {
        errorMsg = `Token无效: ${fbErr.message}`;
        setApiError(fbErr);
      } else if (err.response?.data?.error) {
        errorMsg = err.response.data.error;
      }
      if (typeof errorMsg === "string" && /Meta Token|未配置|not configured/i.test(errorMsg)) {
        errorMsg = "请先保存 Meta Token";
        setHasSavedToken(false);
        setMaskedToken('');
        setIsEditingToken(true);
      }
      setLastSyncError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    fetchToken();
    fetchAccountsFromDb();
  }, []);

  const handleSaveToken = async () => {
    const tokenToSave = token.trim();
    if (!tokenToSave) {
      toast.error("请输入有效的 Meta Token。");
      return;
    }
    if (tokenToSave.includes("...")) {
      toast.error("请粘贴完整 Meta Token，不能保存已脱敏的 token。");
      return;
    }
    setSaving(true);
    try {
      await axios.post("/api/settings", { key: "meta_token", value: tokenToSave });
      await axios.post("/api/settings", { key: "META_ACCESS_TOKEN", value: tokenToSave });
      await axios.post("/api/settings", { key: "META_TOKEN_UPDATED_AT", value: new Date().toISOString() });
      toast.success("Meta API Token 保存成功，可以直接拉取和更新广告账户列表。");
      setToken("");
      setMaskedToken(`${tokenToSave.slice(0, 4)}...${tokenToSave.slice(-4)}`);
      setHasSavedToken(true);
      setIsEditingToken(false);
    } catch (err: any) {
      const errMsg = err.response?.data?.details || err.response?.data?.error || err.message || "Save failed";
      toast.error(`Save failed: ${errMsg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleManualFetch = () => {
    fetchAccountsAndTest();
  };

  const handleEditToken = () => {
    setToken("");
    setIsEditingToken(true);
  };

  const displayToken = isEditingToken ? token : (hasSavedToken ? `已配置：${maskedToken || "********"}` : "");
  const filteredAccounts = accounts.filter(acc => {
    if (filterTab === 'all') return true;
    if (filterTab === 'active') return acc.status === 'active';
    if (filterTab === 'inactive') return acc.status === 'inactive';
    return true;
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto pt-6 pb-20">
      <div className="flex flex-col gap-1 text-left">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">Meta 账户配置及监控</h2>
        <p className="text-sm text-slate-500">配置并即时验证 Meta 长期访问令牌，支持多属性隔离和消耗实时诊断。</p>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="bg-slate-50 pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
              <Key className="w-5 h-5 text-meta-blue" />
              Meta Token 配置
            </CardTitle>
            <CardDescription className="mt-1">
              配置拥有安全 ads_read 和 read_insights 访问权限的 Graph API Token。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-3 text-left">
            <label className="text-sm font-bold text-slate-700 block text-left">
              System Meta Access Token <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-3 items-center">
              <Input
                type="text"
                placeholder="输入以 EA... 开头的 Meta 永久 Token"
                value={displayToken}
                onChange={(e) => setToken(e.target.value)}
                readOnly={!isEditingToken}
                className={`h-10 text-sm border-slate-200 focus:border-meta-blue focus:ring-meta-blue rounded-lg flex-1 ${!isEditingToken ? 'bg-amber-50/50 text-slate-400 select-none' : 'bg-white'}`}
              />
              {isEditingToken ? (
                <Button
                  onClick={handleSaveToken}
                  disabled={saving || !token}
                  className="px-6 h-10 bg-meta-blue hover:bg-meta-blue/90 text-white font-medium shadow-sm transition-all text-sm rounded-lg"
                >
                  {saving ? "保存中..." : "保存绑定"}
                </Button>
              ) : (
                <Button
                  onClick={handleEditToken}
                  variant="outline"
                  className="px-6 h-10 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium shadow-sm transition-all text-sm rounded-lg"
                >
                  修改
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              ⚠️ 请确保提供的 Token 已分配对应的广告账户权限。如果是 Business BM 账号，需进入用户分配面板给该 System User 分配广告账号资源。
            </p>
          </div>

          {/* Token Diagnostics Panel */}
          <div className="mt-4 space-y-3">
            {testingToken && (
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-500 animate-pulse text-left flex items-center gap-2">
                <RefreshCcw className="w-4 h-4 animate-spin text-meta-blue" />
                <span>正在向 Meta API 诊断与测试访问令牌有效性...</span>
              </div>
            )}

            {!testingToken && testResult && (
              <div className="p-4 bg-emerald-50/40 border border-emerald-100 rounded-lg text-sm text-slate-700 text-left space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5 text-emerald-800 font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                    Meta Access Token 验证成功 (身份确立)
                  </div>
                  <span className="text-xs text-slate-400 font-mono">UID: {testResult.id}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mt-1">
                  <div>
                    <span className="text-slate-400 block mb-0.5">令牌授权人 (Authorized Account):</span>
                    <span className="font-semibold text-slate-800">{testResult.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">授权资产数 (Granted Ad Accounts):</span>
                    <span className="font-semibold text-slate-800">{testResult.accountsCount} 个</span>
                  </div>
                </div>
                <div className="text-xs">
                  <span className="text-slate-400 block mb-1">已授予的权限列表:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {testResult.permissions && testResult.permissions.length > 0 ? (
                      testResult.permissions.map((p: string) => (
                        <span key={p} className="px-2 py-0.5 rounded bg-emerald-100/70 text-emerald-800 text-[10px] font-mono">
                          {p}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-500 font-mono">暂无任何已被授予的权限。</span>
                    )}
                  </div>
                </div>

                {testResult.apiAccessStatus !== 'usable' && testResult.apiError && (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-800 text-left space-y-2 mt-3">
                    <div className="flex items-center gap-1.5 font-bold text-rose-900 leading-snug">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      Token identity validation successful, but ad account API is currently restricted and cannot sync account data.
                    </div>
                    <div className="mt-3 bg-white p-2.5 rounded border border-rose-100 font-mono text-[11px] text-rose-800 space-y-1 block">
                      <div className="font-bold border-b border-rose-50 pb-1 mb-1 text-rose-900">Original Meta API Error Details：</div>
                      <div><span className="text-slate-400 font-sans">错误代码 (Code):</span> {testResult.apiError.code}</div>
                      {testResult.apiError.error_subcode && <div><span className="text-slate-400 font-sans">错误子码 (Subcode):</span> {testResult.apiError.error_subcode}</div>}
                      {testResult.apiError.type && <div><span className="text-slate-400 font-sans">错误类型 (Type):</span> {testResult.apiError.type}</div>}
                      <div><span className="text-slate-400 font-sans">错误原因 (Message):</span> {testResult.apiError.message}</div>
                      {testResult.apiError.fbtrace_id && <div><span className="text-slate-400 font-sans">追踪 ID (fbtrace_id):</span> {testResult.apiError.fbtrace_id}</div>}
                    </div>
                  </div>
                )}
                
                {testResult.apiAccessStatus === 'usable' && (!testResult.hasAdsRead || !testResult.hasBusinessManagement) && (
                  <div className="p-3 bg-amber-50 rounded border border-amber-200 text-[11px] text-amber-800 mt-2 space-y-1.5 leading-relaxed">
                    <p className="font-bold flex items-center gap-1 text-amber-900">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      部分核心权限未全选
                    </p>
                    <p>
                      在 Meta 商务设置中需确保勾选了 <code className="font-mono bg-amber-100 px-1 rounded text-red-700">ads_read</code> (当前：{testResult.hasAdsRead ? '✅ 已授予' : '❌ 未授予'}) 以读取广告数据。 如果您通过 BM 读取，可能还需要 <code className="font-mono bg-amber-100 px-1 rounded text-red-700">business_management</code> (当前：{testResult.hasBusinessManagement ? '✅ 已授' : '⚠️ 建议授予'}) 权限。
                    </p>
                  </div>
                )}
              </div>
            )}

            {!testingToken && lastSyncError && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-800 text-left space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-rose-900">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  令牌校验失败 (API Access Blocked)
                </div>
                <p className="text-xs text-rose-700 leading-snug">{lastSyncError}</p>
                {apiError && (
                  <div className="mt-3 bg-white p-2.5 rounded border border-rose-100 font-mono text-[11px] text-rose-800 space-y-1 block">
                    <div className="font-bold border-b border-rose-50 pb-1 mb-1 text-rose-900">Meta API 返回错误细节：</div>
                    <div><span className="text-slate-400">错误代码 (Code):</span> {apiError.code}</div>
                    <div><span className="text-slate-400">错误子码 (Subcode):</span> {apiError.error_subcode || '无'}</div>
                    <div><span className="text-slate-400">错误类型 (Type):</span> {apiError.type}</div>
                    <div><span className="text-slate-400">错误原因 (Message):</span> {apiError.message}</div>
                    {apiError.fbtrace_id && <div><span className="text-slate-400">追踪 ID (fbtrace_id):</span> {apiError.fbtrace_id}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Account Verification Details Notice if Empty Accounts */}
      {testResult && accounts.length === 0 && !loadingAccounts && (
        <div className="p-5 bg-amber-50 rounded-lg border border-amber-200 text-sm text-slate-700 flex items-start gap-3.5 text-left">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="space-y-1.5">
            <h4 className="font-bold text-amber-900">提示：Token 校验通过，但没有发现可拉取的广告账户</h4>
            <p className="text-xs text-amber-800">
              我们成功登录了您的 Meta 账号（<strong>{testResult.name}</strong>），但没有通过接口拉取到任何与之关联的广告账号资源。这通常代表以下其中一种问题：
            </p>
            <ol className="list-decimal pl-5 text-xs text-amber-800 space-y-1.5 mt-2">
              <li>
                <strong>未分配账户资产</strong>：这是 System User 令牌最常见的情况。请进入您的 Business Manager（Meta 商务管理平台）设置，点击资产管理中的 "System Users"，选中这个系统用户，并将其添加到您需要同步的各个广告账户资产的“拥有者/协作者”中，分配<strong>“读取/广告数据分析” (View performance)</strong> 权限。
              </li>
              <li>
                <strong>缺少 ads_read 核心权限</strong>：当前该 Token 所授权的权限未包含权限 <code className="bg-amber-100 px-1 py-0.5 text-red-700 font-mono text-[11px] rounded">ads_read</code>（参见上方已授权权限列表）。请在 Graph Explorer 工具中申请并添加核心权限后，重新获取长效 token 并配置。
              </li>
            </ol>
          </div>
        </div>
      )}

      <Card className="border-slate-200">
        <CardHeader className="bg-slate-50 pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2 text-slate-800 font-sans">
              <Activity className="w-5 h-5 text-emerald-500" />
              Meta 广告账户列表
            </CardTitle>
            <CardDescription className="mt-1">
              展示已经过验证并同步的 Meta 拥有该 Token 权限的所有广告账号，包含历史与近期活跃实体。
            </CardDescription>
          </div>
          <Button 
            onClick={handleManualFetch} 
            disabled={loadingAccounts}
            variant="outline"
            className="h-9 px-3 text-xs disabled:pointer-events-none disabled:opacity-50"
          >
            <RefreshCcw className={`w-3.5 h-3.5 mr-1 ${loadingAccounts ? 'animate-spin' : ''}`} />
            拉取和更新
          </Button>
        </CardHeader>

        {((testResult && testResult.apiAccessStatus !== 'usable') || accounts.some((a: any) => a.isFallbackDbCopy)) && (
          <div className="mx-6 mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-medium">当前展示的是本地缓存账户，不是本次 Meta API 同步结果。</span>
          </div>
        )}
        
        {accounts.length > 0 && (
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex gap-1.5">
              <Button
                variant={filterTab === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTab('all')}
                className={`h-8 text-xs font-medium px-3.5 rounded-lg ${filterTab === 'all' ? 'bg-meta-blue text-white hover:bg-meta-blue/90' : 'border-slate-200 text-slate-600'}`}
              >
                全部账户
              </Button>
              <Button
                variant={filterTab === 'active' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTab('active')}
                className={`h-8 text-xs font-medium px-3.5 rounded-lg ${filterTab === 'active' ? 'bg-[#059669] text-white hover:bg-[#05966 emerald-700]' : 'border-slate-200 text-slate-600'}`}
              >
                近90天活跃
              </Button>
              <Button
                variant={filterTab === 'inactive' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterTab('inactive')}
                className={`h-8 text-xs font-medium px-3.5 rounded-lg ${filterTab === 'inactive' ? 'bg-slate-700 text-white hover:bg-slate-600' : 'border-slate-200 text-slate-500'}`}
              >
                非活跃/无消耗
              </Button>
            </div>
            
            <div className="text-xs text-slate-500">
              当前展示账户列表状态
            </div>
          </div>
        )}

        <CardContent className="pt-0 px-0">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="px-6 py-3 font-semibold text-slate-700">账户ID</TableHead>
                <TableHead className="px-6 py-3 font-semibold text-slate-700">账户名称</TableHead>
                <TableHead className="px-6 py-3 font-semibold text-slate-700">本币与时区</TableHead>
                <TableHead className="px-6 py-3 font-semibold text-slate-700">近90天消耗状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingAccounts ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-slate-500">
                    <RefreshCcw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
                    正在同步 Meta 广告云端资产，请耐心等候...
                  </TableCell>
                </TableRow>
              ) : accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-slate-500">
                    <Activity className="w-8 h-8 mx-auto mb-2.5 text-slate-300" />
                    暂无已连接 Meta 广告账户。请完成 Meta Business 授权或手动绑定广告账户。
                  </TableCell>
                </TableRow>
              ) : filteredAccounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-slate-400">
                    <Activity className="w-8 h-8 mx-auto mb-2.5 text-slate-300" />
                    没有符合筛选条件的 Meta 广告账户
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccounts.map(acc => {
                  const accId = getAccountId(acc);
                  const accName = getAccountName(acc);
                  return (
                    <TableRow key={accId} className="hover:bg-slate-50 transition-colors">
                      <TableCell className="px-6 py-4 font-mono text-xs text-slate-600 font-medium">{accId}</TableCell>
                      <TableCell className="px-6 py-4 font-semibold text-slate-800 text-left">{accName}</TableCell>
                      <TableCell className="px-6 py-4 text-xs text-slate-500 text-left font-mono">
                        {acc.currency || 'USD'} / {acc.timezone || 'UTC'}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {acc.status === 'active' ? (
                          <span className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-semibold">
                            活跃 (近90天有消耗)
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-500 text-xs font-medium">
                            非活跃 (近期无消耗)
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
