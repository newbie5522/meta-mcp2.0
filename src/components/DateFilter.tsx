import React, { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths, isSameDay } from 'date-fns';

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

  // Map startDate and endDate strictly to local timezone date string (YYYY-MM-DD)
  const toLocalISOString = (date: Date) => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  };

  // Determine active shortcut whenever dates change
  useEffect(() => {
    const today = new Date();
    const isToday = isSameDay(startDate, today) && isSameDay(endDate, today);
    const isYesterday = isSameDay(startDate, subDays(today, 1)) && isSameDay(endDate, subDays(today, 1));
    const isPast7 = isSameDay(startDate, subDays(today, 6)) && isSameDay(endDate, today);
    const isPast14 = isSameDay(startDate, subDays(today, 13)) && isSameDay(endDate, today);
    const isPast30 = isSameDay(startDate, subDays(today, 29)) && isSameDay(endDate, today);
    
    if (isToday) setActiveShortcut('today');
    else if (isYesterday) setActiveShortcut('yesterday');
    else if (isPast7) setActiveShortcut('past_7');
    else if (isPast14) setActiveShortcut('past_14');
    else if (isPast30) setActiveShortcut('past_30');
    else if (isSameDay(startDate, startOfWeek(today, { weekStartsOn: 1 })) && isSameDay(endDate, endOfWeek(today, { weekStartsOn: 1 }))) setActiveShortcut('this_week');
    else if (isSameDay(startDate, startOfMonth(today)) && isSameDay(endDate, endOfMonth(today))) setActiveShortcut('this_month');
    else setActiveShortcut('custom');
  }, [startDate, endDate]);

  const handleShortcut = (id: string) => {
    const today = new Date();
    let newStart = new Date();
    let newEnd = new Date();
    
    switch (id) {
      case 'today': newStart = today; newEnd = today; break;
      case 'yesterday': newStart = subDays(today, 1); newEnd = subDays(today, 1); break;
      case 'past_7': newStart = subDays(today, 6); newEnd = today; break;
      case 'past_14': newStart = subDays(today, 13); newEnd = today; break;
      case 'past_30': newStart = subDays(today, 29); newEnd = today; break;
      case 'this_week': newStart = startOfWeek(today, { weekStartsOn: 1 }); newEnd = endOfWeek(today, { weekStartsOn: 1 }); break;
      case 'last_week': {
        const lastWeek = subWeeks(today, 1);
        newStart = startOfWeek(lastWeek, { weekStartsOn: 1 }); newEnd = endOfWeek(lastWeek, { weekStartsOn: 1 }); 
        break;
      }
      case 'this_month': newStart = startOfMonth(today); newEnd = endOfMonth(today); break;
      case 'last_month': {
        const lastMonth = subMonths(today, 1);
        newStart = startOfMonth(lastMonth); newEnd = endOfMonth(lastMonth);
        break;
      }
      case 'custom':
        setActiveShortcut('custom');
        return;
    }
    
    onStartDateChange(newStart);
    onEndDateChange(newEnd);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-slate-500 mr-2">
          <Calendar className="w-4 h-4" />
          <span className="text-sm font-medium">筛选周期:</span>
        </div>
        {options.map(opt => (
          <button
            key={opt.id}
            onClick={() => handleShortcut(opt.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors border ${
              activeShortcut === opt.id 
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm' 
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
              value={toLocalISOString(startDate)}
              onChange={(e) => onStartDateChange(new Date(e.target.value))}
              className="px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-meta-blue"
            />
          </div>
          <span className="text-slate-300">-</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">截止日期</span>
            <input 
              type="date" 
              value={toLocalISOString(endDate)}
              onChange={(e) => onEndDateChange(new Date(e.target.value))}
              className="px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-meta-blue"
            />
          </div>
        </div>
      )}
    </div>
  );
}
