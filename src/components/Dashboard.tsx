import React, { useState, useEffect } from 'react';
import { DateFilter } from './DateFilter';
import { DateRangeType } from '../types';
import { Download, RefreshCw, Filter, Search } from 'lucide-react';
import axios from 'axios';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns';
import { toast } from 'sonner';

import { OverviewDashboard } from './OverviewDashboard';
import { DataDetailsDashboard } from './DataDetailsDashboard';
import { StoreDataDashboard } from './StoreDataDashboard';
import { CreativeIntelligenceDashboard } from './CreativeIntelligenceDashboard';
import { CampaignStructureDashboard } from './CampaignStructureDashboard';
import { AudienceAnalysisDashboard } from './AudienceAnalysisDashboard';
import { MonitoringDashboard } from './MonitoringDashboard';
import { SuggestionsDashboard } from './SuggestionsDashboard';
import { ProductIntelligenceDashboard } from './ProductIntelligenceDashboard';
import { CountryAnalyticsDashboard } from './CountryAnalyticsDashboard';
import { AIAnalysisCenter } from './AIAnalysisCenter';

import { DiagnosisOverviewPage } from './diagnosis/DiagnosisOverviewPage';
import { AdPerformanceDiagnosisPage } from './diagnosis/AdPerformanceDiagnosisPage';
import { FunnelDiagnosisPage } from './diagnosis/FunnelDiagnosisPage';
import { StoreDiagnosisPage } from './diagnosis/StoreDiagnosisPage';
import { CreativeFatigueDiagnosisPage } from './diagnosis/CreativeFatigueDiagnosisPage';
import { ProductDiagnosisPage } from './diagnosis/ProductDiagnosisPage';
import { DataHealthDiagnosisPage } from './diagnosis/DataHealthDiagnosisPage';
import { PrescriptionCenterPage } from './prescription/PrescriptionCenterPage';
import { PrescriptionReviewPage } from './prescription/PrescriptionReviewPage';

export function StandardPageHeader({ 
  title, 
  description, 
  showDateFilter = false,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onSync
}: { 
  title: string, 
  description?: string, 
  showDateFilter?: boolean,
  startDate?: Date,
  endDate?: Date,
  onStartDateChange?: (date: Date) => void,
  onEndDateChange?: (date: Date) => void,
  onSync?: () => void
}) {
  return (
    <div className="space-y-6 mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
          {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onSync} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
            <RefreshCw className="w-4 h-4" />
            同步数据
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
             <Download className="w-4 h-4" />
             导出
          </button>
        </div>
      </div>
      
      {showDateFilter && startDate && endDate && onStartDateChange && onEndDateChange && (
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <DateFilter 
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={onStartDateChange}
            onEndDateChange={onEndDateChange}
          />
        </div>
      )}
    </div>
  );
}

function getDateRange(rangeId: DateRangeType): { startDate: Date, endDate: Date } {
  const today = new Date();
  switch (rangeId) {
    case 'today': return { startDate: today, endDate: today };
    case 'yesterday': return { startDate: subDays(today, 1), endDate: subDays(today, 1) };
    case 'past_7': return { startDate: subDays(today, 6), endDate: today };
    case 'past_14': return { startDate: subDays(today, 13), endDate: today };
    case 'past_30': return { startDate: subDays(today, 29), endDate: today };
    case 'this_week': return { startDate: startOfWeek(today, { weekStartsOn: 1 }), endDate: endOfWeek(today, { weekStartsOn: 1 }) };
    case 'last_week': {
      const lastWeek = subWeeks(today, 1);
      return { startDate: startOfWeek(lastWeek, { weekStartsOn: 1 }), endDate: endOfWeek(lastWeek, { weekStartsOn: 1 }) };
    }
    case 'this_month': return { startDate: startOfMonth(today), endDate: endOfMonth(today) };
    case 'last_month': {
      const lastMonth = subMonths(today, 1);
      return { startDate: startOfMonth(lastMonth), endDate: endOfMonth(lastMonth) };
    }
    default: return { startDate: subDays(today, 6), endDate: today };
  }
}

export function DashboardContainer({ title, tabId }: { title: string, tabId: string }) {
  // Set standard default ranges, then auto-heal on load matching the SQLite database active dates
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 29));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [data, setData] = useState<any[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<Record<string, any>>({});
  const [mappings, setMappings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    axios.get("/api/data-center/max-date")
      .then(res => {
        if (res.data && res.data.maxDate) {
          const maxDateObj = new Date(res.data.maxDate);
          if (!isNaN(maxDateObj.getTime())) {
            setEndDate(maxDateObj);
            setStartDate(subDays(maxDateObj, 29)); // Default to past 30 days of active data
          }
        }
      })
      .catch(err => console.warn("Failed to fetch database max date:", err));
  }, []);

  const fetchMappings = async () => {
    try {
      const response = await axios.get("/api/mappings");
      if (Array.isArray(response.data)) {
        const mappingMap: Record<string, any> = {};
        response.data.forEach((m: any) => {
          mappingMap[m.accountId] = m;
        });
        setMappings(mappingMap);
      }
    } catch (error) {
      console.error("Failed to fetch mappings:", error);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const dateParams = {
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
      };

      const [response, summariesRes] = await Promise.all([
        axios.get("/api/insights", { params: dateParams }),
        axios.get("/api/stores/all-dashboard-summary", { params: dateParams }).catch(err => {
          console.error("Failed to fetch store summaries", err);
          return { data: {} };
        })
      ]);

      if (Array.isArray(response.data)) {
        setData(response.data);
      } else {
        setData([]);
      }
      setStoreSummaries(summariesRes.data || {});
    } catch (error: any) {
      console.error("fetchData error:", error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    const syncToast = toast.loading("正在同步 Meta 数据...");
    try {
      const activeAccountIds = Array.isArray(data) 
        ? [...new Set(data.map(d => d.accountId).filter(Boolean))]
        : [];

      const response = await axios.post("/api/sync", {
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
        syncProduct: false,
        syncCreative: false,
        accounts: activeAccountIds
      });
      toast.success(`同步成功: ${response.data.count} 条记录`, { id: syncToast });
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "同步失败", { id: syncToast });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchMappings();
  }, [startDate, endDate]);

  const renderContent = () => {
    switch (tabId) {
      case 'data-details':
        return <DataDetailsDashboard startDate={startDate} endDate={endDate} />;
      case 'overview':
        return <OverviewDashboard startDate={startDate} endDate={endDate} />;
      case 'data-store':
        return <StoreDataDashboard startDate={startDate} endDate={endDate} />;
      case 'data-creatives':
        return <CreativeIntelligenceDashboard data={data} startDate={startDate} endDate={endDate} onStartDateChange={() => {}} onEndDateChange={() => {}} />;
      case 'data-campaigns':
        return <CampaignStructureDashboard startDate={startDate} endDate={endDate} />;
      case 'data-audiences':
        return <AudienceAnalysisDashboard startDate={startDate} endDate={endDate} />;
      case 'data-products':
        return <ProductIntelligenceDashboard startDate={startDate} endDate={endDate} />;
      case 'diag-overview':
        return <DiagnosisOverviewPage />;
      case 'diag-ad':
        return <AdPerformanceDiagnosisPage />;
      case 'diag-funnel':
        return <FunnelDiagnosisPage />;
      case 'diag-store':
        return <StoreDiagnosisPage />;
      case 'diag-creative':
        return <CreativeFatigueDiagnosisPage />;
      case 'diag-product':
        return <ProductDiagnosisPage />;
      case 'diag-health':
        return <DataHealthDiagnosisPage />;
      case 'rx-pending':
        return <PrescriptionCenterPage currentSubTab="rx-pending" />;
      case 'rx-health':
        return <PrescriptionCenterPage currentSubTab="rx-health" />;
      case 'rx-accepted':
        return <PrescriptionCenterPage currentSubTab="rx-accepted" />;
      case 'rx-debug':
        return <PrescriptionCenterPage currentSubTab="rx-debug" />;
      case 'rx-review':
        return <PrescriptionReviewPage />;
      case 'monitoring':
        return <MonitoringDashboard />;
      case 'sugg-cards':
        return <SuggestionsDashboard />;
      case 'ai-center':
        return <AIAnalysisCenter startDate={startDate} endDate={endDate} defaultType="data_health_summary" />;
      case 'ai-account':
        return <AIAnalysisCenter startDate={startDate} endDate={endDate} defaultType="account_analysis" />;
      case 'ai-store':
        return <AIAnalysisCenter startDate={startDate} endDate={endDate} defaultType="store_analysis" />;
      case 'ai-product':
        return <AIAnalysisCenter startDate={startDate} endDate={endDate} defaultType="product_analysis" />;
      case 'ai-country':
        return <AIAnalysisCenter startDate={startDate} endDate={endDate} defaultType="country_analysis" />;
      default:
        return (
          <div className="p-8 border border-slate-200 rounded-2xl bg-white/50 backdrop-blur-sm border-dashed min-h-[400px] flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-slate-400">
               <Filter className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{title} 开发中</h3>
            <p className="text-slate-500 mt-2 max-w-sm">该模块尚未接入真实数据引擎，UI 与后台集成将在后续步骤中完成部署。</p>
          </div>
        );
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <StandardPageHeader 
        title={title} 
        showDateFilter={tabId !== 'settings' && tabId !== 'monitoring'} 
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onSync={handleSync}
      />
      {loading ? (
        <div className="flex items-center justify-center h-[500px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        renderContent()
      )}
    </div>
  );
}
