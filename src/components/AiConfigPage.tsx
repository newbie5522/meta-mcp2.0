import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Check, Cpu, Server, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AIProviderConfig, AIProviderId } from '../shared/ai-provider.types';
import { DEFAULT_AI_PROVIDERS } from '../shared/ai-provider-config';

export function AiConfigPage() {
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>('gemini');
  const [providers, setProviders] = useState<AIProviderConfig[]>(DEFAULT_AI_PROVIDERS);
  const [loadingProviders, setLoadingProviders] = useState<boolean>(false);

  useEffect(() => {
    // Only fetch static providers layout config from server
    setLoadingProviders(true);
    axios.get('/api/ai/providers')
      .then(res => {
        if (res.data && res.data.providers) {
          setProviders(res.data.providers);
        }
      })
      .catch(err => console.error("获取策略规划失败", err))
      .finally(() => setLoadingProviders(false));
  }, []);

  const activeProviderDetail = providers.find(p => p.provider === selectedProvider) || DEFAULT_AI_PROVIDERS[1];

  return (
    <div className="space-y-6 max-w-5xl text-left" id="ai-config-page-container">
      {/* Title block */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900" id="ai-config-title">AI 提供商接入规划</h2>
        <p className="text-sm text-slate-500" id="ai-config-subtitle">
          预览系统未来集成的智能化大语言模型生态图谱，以及各提供商的处理能力与安全边界。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="ai-config-layout-grid">
        {/* Left column: Interaction view & Selector (strictly local UI simulation with no save) */}
        <div className="lg:col-span-1 space-y-6" id="ai-config-left-col">
          <Card className="border-slate-200 shadow-sm" id="ai-selector-card">
            <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100">
              <CardTitle className="text-base flex items-center gap-2 text-slate-800">
                <Cpu className="w-4 h-4 text-indigo-600" />
                通道交互仿真
              </CardTitle>
              <CardDescription className="text-xs">
                在前端仿真了解特定提供商的静态接入机制。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-1.5 bg-white">
                <label className="text-xs font-semibold text-slate-700 block">选择提供商</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value as AIProviderId)}
                  className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white hover:border-slate-300"
                  id="ai-provider-select"
                >
                  {providers.map((p) => (
                    <option key={p.provider} value={p.provider}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5" id="ai-static-model-field">
                <label className="text-xs font-semibold text-slate-700 block">标准关联模型</label>
                <div className="h-9 px-3 border border-slate-100 rounded-lg bg-slate-50/50 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-600">{activeProviderDetail.model}</span>
                  <span className="px-1.5 py-0.5 text-[10px] text-slate-400 bg-slate-100 rounded">预设模式</span>
                </div>
              </div>

              {/* Saved actions notice */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 mt-4" id="ai-save-placeholder">
                <div className="flex gap-2 items-start">
                  <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                    本处仅作接入规划模型推演。系统不提供 API 密钥输入框，亦不支持对此配置进行数据库写落库或外部同步操作。
                  </p>
                </div>
                <button
                  disabled
                  className="w-full h-9 bg-slate-100 border border-slate-200 text-slate-400 font-semibold text-xs rounded-lg cursor-not-allowed"
                  id="ai-save-cfg-button"
                >
                  当前仅展示配置壳层，暂不启用保存
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Providers configuration layout cards */}
        <div className="lg:col-span-2 space-y-4" id="ai-config-right-col">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-slate-500" />
              预设提供商对账与诊断策略图谱
            </h3>
            <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
              全部通道未启用 · 无敏感数据传输
            </span>
          </div>

          {loadingProviders ? (
            <div className="flex flex-col items-center justify-center p-12 bg-white border border-slate-150 rounded-xl space-y-2" id="ai-loading-placeholder">
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
              <p className="text-xs text-slate-500">正在拉取策略图谱规划列表...</p>
            </div>
          ) : (
            <div className="space-y-3" id="ai-providers-list-wrapper">
              {providers.map((p) => {
                const isActive = selectedProvider === p.provider;
                return (
                  <div
                    key={p.provider}
                    id={`ai-provider-row-${p.provider}`}
                    className={`p-4 bg-white border rounded-xl transition-all shadow-sm flex flex-col md:flex-row md:items-start gap-4 ${
                      isActive
                        ? 'border-indigo-200 bg-indigo-50/5 ring-1 ring-indigo-100'
                        : 'border-slate-150 hover:border-slate-200'
                    }`}
                  >
                    {/* Brand Identifier */}
                    <div className="flex md:flex-col items-center md:items-start justify-between md:justify-start gap-2 shrink-0 md:w-36">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-indigo-500 animate-pulse' : 'bg-slate-350'}`} />
                        <span className="text-xs font-bold text-slate-800">{p.displayName}</span>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-500 rounded-full font-bold">
                        未开启
                      </span>
                    </div>

                    {/* Meta descriptions */}
                    <div className="flex-1 space-y-2.5 text-left">
                      <div className="space-y-1.5 text-xs">
                        <p className="text-slate-600 leading-relaxed">{p.description}</p>
                        <p className="text-[10px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed font-sans mt-2">
                          <strong className="text-slate-700 block mb-0.5">安全准入规则：</strong>
                          {p.safetyNotice}
                        </p>
                      </div>

                      {/* Capabilities Checklist */}
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-slate-500">
                        <div className="flex items-center gap-1">
                          <Check className={`w-3.5 h-3.5 ${p.supportsIssueExplanation ? 'text-emerald-550 font-bold' : 'text-slate-350'}`} />
                          <span className={p.supportsIssueExplanation ? "text-slate-700" : "text-slate-400"}>
                            单项诊断解读
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Check className={`w-3.5 h-3.5 ${p.supportsDashboardSummary ? 'text-emerald-550 font-bold' : 'text-slate-350'}`} />
                          <span className={p.supportsDashboardSummary ? "text-slate-700" : "text-slate-400"}>
                            大盘指标总结
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Check className={`w-3.5 h-3.5 ${p.supportsReviewTemplate ? 'text-emerald-550 font-bold' : 'text-slate-350'}`} />
                          <span className={p.supportsReviewTemplate ? "text-slate-700" : "text-slate-400"}>
                            运营复盘模板
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
