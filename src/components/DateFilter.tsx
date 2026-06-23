import React, { useState, useEffect } from 'react';
import { Calendar, Clock } from 'lucide-react';
import {
  getBusinessDateRange,
  businessDateStringToSafeDate,
  safeDateToDateString,
  getBusinessTimezone
} from "../shared/business-time";

export function DateFilter({ 
  startDate, 
  endDate, 
  onStartDateChange, 
  onEndDateChange 
}: { 
  startDate: Date, 
  endDate: Date, 
  onStartDateChange: (d: Date) => void, 
  onEndDateChange: (d: Date) => void 
}) {
  const [activeShortcut, setActiveShortcut] = useState<string>('');

  const options: { id: string, label: string }[] = [
    { id: 'today', label: '今天' },
    { id: 'yesterday', label: '昨天' },
    { id: 'past_7', label: '过去 7 天' },
    { id: 'past_14', label: '过去 14 天' },
    { id: 'past_30', label: '过去 30 天' },
    { id: 'this_week', label: '本周' },
    { id: 'last_week', label: '上周' },
    { id: 'this_month', label: '本月' },
    { id: 'last_month', label: '上月' },
    { id: 'custom', label: '自定义' },
  ];

  const toInputDateValue = (date: Date) => safeDateToDateString(date);

  // Determine active shortcut whenever dates change
  useEffect(() => {
    const startStr = safeDateToDateString(startDate);
    const endStr = safeDateToDateString(endDate);

    const checkMatch = (id: string) => {
      const r = getBusinessDateRange(id);
      return startStr === r.startDateStr && endStr === r.endDateStr;
    };

    if (checkMatch('today')) {
      setActiveShortcut('today');
    } else if (checkMatch('yesterday')) {
      setActiveShortcut('yesterday');
    } else if (checkMatch('past_7')) {
      setActiveShortcut('past_7');
    } else if (checkMatch('past_14')) {
      setActiveShortcut('past_14');
    } else if (checkMatch('past_30')) {
      setActiveShortcut('past_30');
    } else if (checkMatch('this_week')) {
      setActiveShortcut('this_week');
    } else if (checkMatch('last_week')) {
      setActiveShortcut('last_week');
    } else if (checkMatch('this_month')) {
      setActiveShortcut('this_month');
    } else if (checkMatch('last_month')) {
      setActiveShortcut('last_month');
    } else {
      setActiveShortcut('custom');
    }
  }, [startDate, endDate]);

  const handleShortcut = (id: string) => {
    if (id === 'custom') {
      setActiveShortcut('custom');
      return;
    }

    const range = getBusinessDateRange(id);
    onStartDateChange(businessDateStringToSafeDate(range.startDateStr));
    onEndDateChange(businessDateStringToSafeDate(range.endDateStr));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-slate-500 mr-1">
          <Calendar className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-700">筛选周期:</span>
        </div>
        {options.map(opt => (
          <button
            key={opt.id}
            onClick={() => handleShortcut(opt.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors border cursor-pointer ${
              activeShortcut === opt.id 
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm font-semibold' 
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      
      {activeShortcut === 'custom' && (
        <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100 mt-1 max-w-fit animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">起始日期</span>
            <input 
              type="date" 
              value={toInputDateValue(startDate)}
              onChange={(e) => onStartDateChange(businessDateStringToSafeDate(e.target.value))}
              className="px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-meta-blue"
            />
          </div>
          <span className="text-slate-300">-</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">截止日期</span>
            <input 
              type="date" 
              value={toInputDateValue(endDate)}
              onChange={(e) => onEndDateChange(businessDateStringToSafeDate(e.target.value))}
              className="px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-meta-blue"
            />
          </div>
        </div>
      )}
    </div>
  );
}
