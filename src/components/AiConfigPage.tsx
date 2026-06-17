import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Loader2, Save, ShieldCheck, Check, Cpu, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AIProviderConfig, AIProviderId } from '../shared/ai-provider.types';
import { DEFAULT_AI_PROVIDERS } from '../shared/ai-provider-config';

export function AiConfigPage() {
  const [provider, setProvider] = useState<AIProviderId>('gemini');
  const [model, setModel] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [models, setModels] = useState<{id: string, name: string}[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [providers, setProviders] = useState<AIProviderConfig[]>(DEFAULT_AI_PROVIDERS);
  const [loadingProviders, setLoadingProviders] = useState<boolean>(false);

  useEffect(() => {
    // Fetch global config on mount
    axios.get('/api/settings').then(res => {
      if (res.data) {
        if (res.data.ai_provider) setProvider(res.data.ai_provider as AIProviderId);
        if (res.data.ai_model) setModel(res.data.ai_model);
        if (res.data.ai_api_key) setApiKey(res.data.ai_api_key);
      }
    }).catch(err => console.error("Failed to fetch settings", err));

    // Fetch providers config from server
    setLoadingProviders(true);
    axios.get('/api/ai/providers')
      .then(res => {
        if (res.data && res.data.providers) {
          setProviders(res.data.providers);
        }
      })
      .catch(err => console.error("Failed to fetch providers", err))
      .finally(() => setLoadingProviders(false));
  }, []);

  useEffect(() => {
    if (provider) {
      setLoadingModels(true);
      axios.get(`/api/settings/ai-models?provider=${provider === 'openai' ? 'chatgpt' : provider}`)
        .then(res => {
          setModels(res.data.models || []);
          if (!model || !res.data.models.find((m: any) => m.id === model)) {
            setModel(res.data.models?.[0]?.id || '');
          }
        })
        .catch(err => {
          console.error("Failed to fetch models", err);
        })
        .finally(() => {
          setLoadingModels(false);
        });
    }
  }, [provider]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        axios.post('/api/settings', { key: 'ai_provider', value: provider }),
        axios.post('/api/settings', { key: 'ai_model', value: model }),
        axios.post('/api/settings', { key: 'ai_api_key', value: apiKey })
      ]);
      toast.success("AI 模型基础配置已保存");
    } catch (error) {
      toast.error("保存配置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl text-left">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">AI 辅助服务设置</h2>
        <p className="text-sm text-slate-500">配置底层 AI 提供商环境储备，并管理分析模块的对齐策略。</p>
      </div>

      {/* Safety Warning Banner */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-amber-900">AI 安全辅助机制提示与边界声明</h4>
          <p className="text-xs text-amber-700 leading-relaxed">
            当前诊断模型辅助处于安全脱机隔离状态。所有诊断解读、数据归因和对账对齐模板仅作为本地只读分析策略。
            本系统<strong>坚守人工确认屏障</strong>，不提供自动投放、自动调整广告预算、或自动关闭广告等非经人工授权的模型接口，任何修改操作必须由运营专员核实后手工在 Meta 商业大盘执行。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Setup form */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100">
              <CardTitle className="text-base flex items-center gap-2 text-slate-800">
                <Cpu className="w-4 h-4 text-blue-600" />
                模型策略定义
              </CardTitle>
              <CardDescription className="text-xs">
                选择可用提供商作为逻辑接入储备。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">活跃提供商通道</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as AIProviderId)}
                  className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white hover:border-slate-300"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI ChatGPT</option>
                  <option value="claude">Anthropic Claude</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="qwen">阿里云通义千问 (Qwen)</option>
                  <option value="local">本地小模型 (Local)</option>
                  <option value="auto">算力自动调度 (Auto)</option>
                </select>
              </div>

              <div className="space-y-1.5 font-sans">
                <label className="text-xs font-semibold text-slate-700 block">建议模型版本</label>
                <div className="relative">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={loadingModels || models.length === 0}
                    className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white disabled:bg-slate-50 hover:border-slate-300"
                  >
                    {loadingModels ? (
                      <option value="">正在获取可用版本...</option>
                    ) : models.length === 0 ? (
                      <option value="">(根据提供商自动关联)</option>
                    ) : (
                      models.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))
                    )}
                  </select>
                  {loadingModels && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">
                  API 密钥通道
                </label>
                <Input
                  type="password"
                  placeholder="请输入提供商鉴权秘钥 (未启用)"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="h-9 text-xs border-slate-200 focus:border-blue-500 focus:ring-blue-500 rounded-lg"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  秘钥仅作本地实例验证储存，当前未启动外部联网鉴权。
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full h-9 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 mr-2" />
                      保存配置
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Providers List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-slate-500" />
              提供商策略配置图谱
            </h3>
            <span className="text-[10px] text-slate-400">所有连接通道均未激活外部网络</span>
          </div>

          {loadingProviders ? (
            <div className="flex flex-col items-center justify-center p-12 bg-white border border-slate-150 rounded-xl space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              <p className="text-xs text-slate-500">正在获取提供商架构配置...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map((p) => (
                <div
                  key={p.provider}
                  className={`p-4 bg-white border rounded-xl transition-all shadow-sm flex flex-col md:flex-row md:items-start gap-4 ${
                    provider === p.provider
                      ? 'border-blue-200 bg-blue-50/10'
                      : 'border-slate-150'
                  }`}
                >
                  {/* Left Side: Avatar & Status Badge */}
                  <div className="flex md:flex-col items-center md:items-start justify-between md:justify-start gap-2 shrink-0 md:w-36">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${provider === p.provider ? 'bg-indigo-400 animate-pulse' : 'bg-slate-300'}`} />
                      <span className="text-xs font-bold text-slate-800">{p.displayName}</span>
                    </div>

                    <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full font-bold">
                      未启用配置
                    </span>
                  </div>

                  {/* Right Side: Details & Capability matrix */}
                  <div className="flex-1 space-y-2.5 text-left">
                    <div className="space-y-1 text-xs">
                      <p className="text-slate-600 leading-relaxed">{p.description}</p>
                      <p className="text-[10px] text-amber-700 bg-amber-50/50 p-2 rounded border border-amber-100/50 leading-relaxed font-sans mt-1.5">
                        <strong className="text-amber-800 block mb-0.5">安全准入规则：</strong>
                        {p.safetyNotice}
                      </p>
                    </div>

                    {/* Features checklist */}
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-slate-500">
                      <div className="flex items-center gap-1">
                        <Check className={`w-3 h-3 ${p.supportsIssueExplanation ? 'text-emerald-500' : 'text-slate-300'}`} />
                        <span>单项诊断解读</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Check className={`w-3 h-3 ${p.supportsDashboardSummary ? 'text-emerald-500' : 'text-slate-300'}`} />
                        <span>大盘数据摘要</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Check className={`w-3 h-3 ${p.supportsReviewTemplate ? 'text-emerald-500' : 'text-slate-300'}`} />
                        <span>实操复盘模板</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
