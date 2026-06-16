import React from "react";
import { Users, ShieldAlert, ArrowRight, Sparkles, Database, Lock } from "lucide-react";

export function OperatorTeamPlaceholderPage() {
  return (
    <div className="max-w-4xl mx-auto py-12 font-sans">
      <div className="bg-white p-12 rounded-3xl border border-slate-200 shadow-sm text-center relative overflow-hidden space-y-8">
        {/* Visual backgrounds */}
        <div className="absolute left-1/2 top-0 -translate-x-1/2 w-80 h-80 bg-blue-50 rounded-full filter blur-3xl -z-10" />

        {/* Big styled Icon */}
        <div className="mx-auto w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner relative">
          <Users className="w-8 h-8" />
          <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white rounded-full p-1 border border-white">
            <Lock className="w-3 h-3" />
          </div>
        </div>

        {/* Text Area */}
        <div className="space-y-4 max-w-2xl mx-auto">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">运营团队配置 (Operator Team Config)</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            运营团队配置暂未启用。后续将支持添加运营人员、绑定店铺、绑定广告账户，并在数据总览中展示运营销售额、广告消耗、ROAS 排名。
          </p>
        </div>

        {/* Auxiliary info cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-left">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
            <span className="text-xs font-bold text-slate-800">运营人员管理</span>
            <p className="text-[11px] text-slate-400">支持添加多个运营买手和财务角色，配置多档权限控制</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
            <span className="text-xs font-bold text-slate-800">精细绑定关系</span>
            <p className="text-[11px] text-slate-400">建立‘买手-店铺-广告账户’的多对多关联关系核查</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
            <span className="text-xs font-bold text-slate-800">业绩大盘排行</span>
            <p className="text-[11px] text-slate-400">在数据总览中直观排序买手消耗、成交金额及精准客单率</p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-1.5 text-xs text-slate-400 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          模块将在二级权限系统上线后开放部署，敬请期待
        </div>
      </div>
    </div>
  );
}
