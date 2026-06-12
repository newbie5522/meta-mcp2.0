import React, { useState } from 'react';
import { Bot, X, Maximize2, Send, Wand2, Sparkles } from 'lucide-react';

export function AICopilotWindow() {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all z-50 group"
      >
        <Sparkles className="w-6 h-6 animate-pulse group-hover:animate-none" />
      </button>
    );
  }


  return (
    <div className="fixed bottom-6 right-6 w-[400px] h-[600px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Wand2 className="w-5 h-5" />
          <span className="font-semibold tracking-wide">AI Copilot</span>
        </div>
        <div className="flex items-center gap-2">
           <button className="p-1 hover:bg-white/20 rounded-md transition-colors">
              <Maximize2 className="w-4 h-4" />
           </button>
           <button 
             onClick={() => setIsOpen(false)}
             className="p-1 hover:bg-white/20 rounded-md transition-colors"
           >
              <X className="w-4 h-4" />
           </button>
        </div>
      </div>
      
      <div className="flex-1 bg-slate-50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <div className="flex gap-3">
             <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
               <Bot className="w-5 h-5" />
             </div>
             <div className="bg-white p-3 rounded-2xl rounded-tl-sm shadow-sm border border-slate-100 text-sm text-slate-700">
               你好！我是你的 AI 优化师。你可以随时问我关于 Meta 广告投放、店铺数据表现、ROAS 提升等问题。<br/><br/>或者你可以点击页面上广告层级的 "问 AI" 按钮，我会基于那些精准的数据为你出具分析报告和操作建议。
             </div>
          </div>
        </div>
      </div>
      
      <div className="p-4 bg-white border-t border-slate-200 shrink-0">
        <div className="relative">
          <input 
            type="text" 
            placeholder="询问数据表现，或者获取优化建议..."
            autoComplete="off"
            className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-inner"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SparklesIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.8 11.3 2 22l10.7-3.79" />
      <path d="M4 3h.01" />
      <path d="M22 8h.01" />
      <path d="M15 2h.01" />
      <path d="M22 20h.01" />
      <path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.31 1.7-1.06 2.16l-5.61 3.4a2.9 2.9 0 0 0-1.22 3.51l.86 2.37" />
      <path d="m9.37 13.43 2.37-.86" />
    </svg>
  );
}
