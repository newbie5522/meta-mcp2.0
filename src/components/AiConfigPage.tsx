import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Loader2, Save, Bot } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AiConfigPage() {
  const [provider, setProvider] = useState<string>('gemini');
  const [model, setModel] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [models, setModels] = useState<{id: string, name: string}[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    // Fetch global config on mount
    axios.get('/api/settings').then(res => {
      if (res.data) {
        if (res.data.ai_provider) setProvider(res.data.ai_provider);
        if (res.data.ai_model) setModel(res.data.ai_model);
        if (res.data.ai_api_key) setApiKey(res.data.ai_api_key);
      }
    }).catch(err => console.error("Failed to fetch settings", err));
  }, []);

  useEffect(() => {
    if (provider) {
      setLoadingModels(true);
      axios.get(`/api/settings/ai-models?provider=${provider}`)
        .then(res => {
          setModels(res.data.models || []);
          if (!model || !res.data.models.find((m: any) => m.id === model)) {
            setModel(res.data.models?.[0]?.id || '');
          }
        })
        .catch(err => {
          toast.error("获取模型版本失败");
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
      toast.success("AI 模型配置已保存");
    } catch (error) {
      toast.error("保存配置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col gap-1 text-left">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">AI 模型设置</h2>
        <p className="text-sm text-slate-500">配置您所需要使用的 AI 模型（支持 Gemini, ChatGPT 等）及相关参数。</p>
      </div>
      
      <Card className="border-slate-200 shadow-sm text-left">
        <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="w-5 h-5 text-meta-blue" />
            AI 提供商配置
          </CardTitle>
          <CardDescription>
            选择提供商并获取最新的可支持模型版本。
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 block">活跃的 AI 提供商</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full h-10 px-3 pl-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-meta-blue focus:border-meta-blue transition-colors appearance-none bg-white"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23131313%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.4-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7rem top 50%', backgroundSize: '.65rem auto' }}
            >
              <option value="gemini">Google Gemini</option>
              <option value="chatgpt">OpenAI ChatGPT</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 block">模型版本获取器</label>
            <div className="relative">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={loadingModels || models.length === 0}
                className="w-full h-10 px-3 pl-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-meta-blue focus:border-meta-blue transition-colors appearance-none bg-white disabled:bg-slate-50 disabled:text-slate-500"
                style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23131313%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.4-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7rem top 50%', backgroundSize: '.65rem auto' }}
              >
                {loadingModels ? (
                  <option value="">正在获取最新版本...</option>
                ) : (
                  models.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
                  ))
                )}
              </select>
              {loadingModels && (
                <div className="absolute right-8 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-meta-blue animate-spin" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 block">API Key 配置 <span className="text-red-500">*</span></label>
            <Input
              type="password"
              placeholder={`输入您的 ${provider === 'gemini' ? 'Gemini API Key' : 'OpenAI API Key'}`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-10 text-sm border-slate-200 focus:border-meta-blue focus:ring-meta-blue rounded-lg"
            />
            <p className="text-xs text-slate-500 mt-1">此密钥将安全加密存储于您的本地实例中，不会发送至外部网络。</p>
          </div>
          
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="px-6 h-10 bg-meta-blue hover:bg-meta-blue/90 text-white font-medium"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  保存配置
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
