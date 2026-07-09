import React, { useState, useEffect } from 'react';
import { DateFilter } from './DateFilter';
import { DateRangeType } from '../types';
import { Filter, Search } from 'lucide-react';
import axios from 'axios';
import dayjs from 'dayjs';
import {
  getBusinessDateRange,
  businessDateStringToSafeDate
} from "../shared/business-time";

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
  onEndDateChange
}: { 
  title: string, 
  description?: string, 
  showDateFilter?: boolean,
  startDate?: Date,
  endDate?: Date,
  onStartDateChange?: (date: Date) => void,
  onEndDateChange?: (date: Date) => void
}) {
  return (
    <div className="space-y-6 mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
          {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
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

export function DashboardContainer({ title, tabId }: { title: string, tabId: string }) {
  // Set standard default ranges, then auto-heal on load matching the database active dates
  const defaultRange = getBusinessDateRange("past_30");
  const [startDate, setStartDate] = useState<Date>(businessDateStringToSafeDate(defaultRange.startDateStr));
  const [endDate, setEndDate] = useState<Date>(businessDateStringToSafeDate(defaultRange.endDateStr));
  const [data, setData] = useState<any[]>([]);
  const [mappings, setMappings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  // 默认日期只由 getBusinessDateRange("past_30") 决定。
  // /api/data-center/max-date 只能用于数据健康提示，不允许自动覆盖用户筛选日期。

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
      // Unused legacy API calls are decommissioned for LOCKDOWN
      setData((current) => current);
    } catch (error: any) {
      console.error("fetchData error:", error);
    } finally {
      setLoading(false);
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
        return <DiagnosisOverviewPage startDate={startDate} endDate={endDate} />;
      case 'diag-ad':
        return <AdPerformanceDiagnosisPage startDate={startDate} endDate={endDate} />;
      case 'diag-funnel':
        return <FunnelDiagnosisPage startDate={startDate} endDate={endDate} />;
      case 'diag-store':
        return <StoreDiagnosisPage startDate={startDate} endDate={endDate} />;
      case 'diag-creative':
        return <CreativeFatigueDiagnosisPage startDate={startDate} endDate={endDate} />;
      case 'diag-product':
        return <ProductDiagnosisPage startDate={startDate} endDate={endDate} />;
      case 'diag-health':
        return <DataHealthDiagnosisPage startDate={startDate} endDate={endDate} />;
      case 'rx-pending':
        return <PrescriptionCenterPage currentSubTab="rx-pending" startDate={startDate} endDate={endDate} />;
      case 'rx-health':
        return <PrescriptionCenterPage currentSubTab="rx-health" startDate={startDate} endDate={endDate} />;
      case 'rx-accepted':
        return <PrescriptionCenterPage currentSubTab="rx-accepted" startDate={startDate} endDate={endDate} />;
      case 'rx-debug':
        return <PrescriptionCenterPage currentSubTab="rx-pending" startDate={startDate} endDate={endDate} />;
      case 'rx-review':
        return <PrescriptionReviewPage startDate={startDate} endDate={endDate} />;
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
