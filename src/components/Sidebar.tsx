import React from 'react';
import {
  BarChart3,
  Database,
  Brain,
  TrendingUp,
  Wand2,
  Settings,
  ChevronDown,
  ChevronRight,
  Activity,
  LogOut,
  MessageSquareWarning,
  Sparkles
} from 'lucide-react';
import { MenuItem } from '../types';

export const menuGroups: MenuItem[] = [
  { id: 'overview', label: '数据总览', icon: BarChart3 },
  { 
    id: 'data', 
    label: '数据中心', 
    icon: Database,
    subs: [
      { id: 'data-details', label: '账户表现' },
      { id: 'data-store', label: '店铺订单' },
      { id: 'data-campaigns', label: '广告层级' },
      { id: 'data-audiences', label: '受众洞察' },
      { id: 'data-creatives', label: '素材洞察' },
    ]
  },
  { 
    id: 'analysis', 
    label: 'AI 分析', 
    icon: Brain,
    subs: [
      { id: 'ai-account', label: '账户分析' },
      { id: 'ai-store', label: '店铺分析' },
      { id: 'ai-country', label: '国家分析' },
      { id: 'ai-product', label: '产品分析' },
    ]
  },
  { 
    id: 'suggestions', 
    label: '建议中心', 
    icon: MessageSquareWarning,
    subs: [
      { id: 'sugg-cards', label: 'AI 建议卡片' },
    ]
  },
  { 
    id: 'creative', 
    label: '创意中心', 
    icon: Sparkles,
    subs: [
      { id: 'creative-copilot', label: 'Creative Copilot' },
    ]
  },
  { 
    id: 'config', 
    label: '配置中心', 
    icon: Settings,
    subs: [
      { id: 'stores', label: '店铺配置' },
      { id: 'meta-config', label: 'Meta 账户配置' },
      { id: 'sync-center', label: '数据同步中心' },
      { id: 'ai-config', label: 'AI 模型设置' },
      { id: 'team-config', label: '人员团队配置' },
    ]
  },
];

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  expandedSections: Record<string, boolean>;
  toggleSection: (id: string, defaultSubTab?: string) => void;
  onLogout: () => void;
}

export function Sidebar({ activeTab, setActiveTab, expandedSections, toggleSection, onLogout }: SidebarProps) {
  return (
    <aside className="w-[280px] bg-slate-900 border-r border-slate-800 text-slate-300 flex flex-col flex-shrink-0 h-screen sticky top-0 shadow-2xl z-20">
      <div className="h-20 flex items-center px-6 gap-4 shrink-0 border-b border-slate-800 bg-slate-900/50">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-inner flex items-center justify-center">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-[16px] font-bold tracking-wide text-white leading-tight">Meta Insights AI</h1>
          <p className="text-[11px] text-blue-400 font-medium uppercase tracking-wider mt-0.5">By Newbie Media</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-1 custom-scrollbar">
        {menuGroups.map((group) => {
          const Icon = group.icon;
          const isGroupActive = activeTab === group.id || activeTab.startsWith(group.id + '-');
          const isExpanded = expandedSections[group.id];

          return (
            <div key={group.id} className="space-y-1">
              <button
                onClick={() => {
                  if (group.subs) {
                    toggleSection(group.id, group.subs[0].id);
                  } else {
                    setActiveTab(group.id);
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm transition-all duration-200 ${
                  isGroupActive && !group.subs
                    ? 'bg-blue-600 text-white shadow-md'
                    : isExpanded
                    ? 'bg-slate-800/80 text-blue-400 font-semibold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  {Icon && <Icon className="w-5 h-5" />}
                  {group.label}
                </div>
                {group.subs && (
                  isExpanded ? <ChevronDown className="w-4 h-4 opacity-70" /> : <ChevronRight className="w-4 h-4 opacity-70" />
                )}
              </button>

              {group.subs && isExpanded && (
                <div className="pl-[42px] pr-2 py-1 space-y-1 relative">
                  <div className="absolute left-[21px] top-0 bottom-0 w-px bg-slate-800"></div>
                  {group.subs.map((sub) => {
                    const isSubActive = activeTab === sub.id;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => setActiveTab(sub.id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] transition-all relative ${
                          isSubActive
                            ? 'text-blue-400 font-bold bg-blue-500/10'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                        }`}
                      >
                         <div className="flex items-center gap-2">
                           {isSubActive && <div className="absolute -left-[24px] top-1/2 -translate-y-1/2 w-[3px] h-4 bg-blue-500 rounded-r-full" />}
                           {sub.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0">
        <button 
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 py-2.5 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="font-medium">退出登录</span>
        </button>
      </div>
    </aside>
  );
}
