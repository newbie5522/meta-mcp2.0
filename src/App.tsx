import React, { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Sidebar, menuGroups } from './components/Sidebar';
import { DashboardContainer } from './components/Dashboard';
import { SettingsPage } from './components/SettingsPage';
import { StoresDashboard } from './components/StoresDashboard';
import { StoreDetailsPage } from './components/StoreDetailsPage';
import { AccountDetailsPage } from './components/AccountDetailsPage';
import { AICopilotWindow } from './components/AICopilotWindow';
import { MetaConfigPage } from './components/MetaConfigPage';
import { AiConfigPage } from './components/AiConfigPage';
import { TeamConfigPage } from './components/TeamConfigPage';
import { SyncCenterPage } from './components/SyncCenterPage';

function LoginScreen({ onLogin }: { onLogin: (u: string, p: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((username === 'newbie' && password === 'hlcm123') || (username === 'admin' && password === 'admin123')) {
      onLogin(username, password);
    } else {
      setError('用户名或密码错误 / Invalid credentials');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white mb-4 shadow-sm">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Meta Insights AI</h1>
          <p className="text-sm text-slate-500">AI Media Buying OS by NewbieMedia</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">账号 / Username</label>
            <input
              type="text"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">密码 / Password</label>
            <input
              type="password"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="text-sm text-red-600 font-medium">{error}</div>}
          <button
            type="submit"
            className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-500/20 active:scale-[0.98] transition-all shadow-sm"
          >
            登录 / Login
          </button>
        </form>
      </div>
    </div>
  );
}

function AdHierarchyBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const accountId = params.get("accountId") || "";
    const startDate = params.get("startDate") || "";
    const endDate = params.get("endDate") || "";
    navigate(`/?tab=data-campaigns&accountId=${accountId}&startDate=${startDate}&endDate=${endDate}`, { replace: true });
  }, [location, navigate]);
  return (
    <div className="flex items-center justify-center h-full p-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState('data-details');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    data: true,
    analysis: true,
    creative: true,
    config: true
  });

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [location.search]);

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  const handleSetActiveTab = (tab: string) => {
    setActiveTab(tab);
    navigate(`/?tab=${tab}`);
  };

  const toggleSection = (id: string, defaultSubTab?: string) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
    if (defaultSubTab && !expandedSections[id]) {
      handleSetActiveTab(defaultSubTab);
    }
  };

  const currentTabTitle = menuGroups.reduce((acc, group) => {
    if (group.id === activeTab) return group.label;
    const sub = group.subs?.find(s => s.id === activeTab);
    if (sub) return sub.label;
    return acc;
  }, 'Dashboard');

  return (
    <div className="min-h-screen bg-[#f8fafc] flex font-sans text-slate-900">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={handleSetActiveTab} 
        expandedSections={expandedSections} 
        toggleSection={toggleSection}
        onLogout={() => setIsAuthenticated(false)}
      />
      
      <main className="flex-1 py-8 px-10 overflow-y-auto custom-scrollbar relative">
        <Routes>
          <Route path="/" element={
            activeTab === 'settings' ? (
              <SettingsPage />
            ) : activeTab === 'stores' ? (
              <StoresDashboard />
            ) : activeTab === 'meta-config' ? (
              <MetaConfigPage />
            ) : activeTab === 'ai-config' ? (
              <AiConfigPage />
            ) : activeTab === 'team-config' ? (
              <TeamConfigPage />
            ) : activeTab === 'sync-center' ? (
              <SyncCenterPage />
            ) : (
               <DashboardContainer title={currentTabTitle} tabId={activeTab} />
            )
          } />
          <Route path="/data-center/ad-hierarchy" element={<AdHierarchyBridge />} />
          <Route path="/store/new" element={<StoreDetailsPage isNew={true} />} />
          <Route path="/store/:storeId" element={<StoreDetailsPage />} />
          <Route path="/account/:accountId" element={<AccountDetailsPage onLogout={() => setIsAuthenticated(false)} />} />
        </Routes>
      </main>
      
      {/* Global AI Copilot Component */}
      <AICopilotWindow />
    </div>
  );
}
