import React from "react";
import { 
  History, 
  TrendingUp, 
  Activity, 
  HelpCircle, 
  CheckCircle2, 
  DollarSign, 
  ChevronRight, 
  ArrowUpRight 
} from "lucide-react";

export function PrescriptionReviewPage() {
  const backtestHistory = [
    {
      id: "BCK-201",
      prescriptionName: "禁用转化率低于 0.5% 的冷启动国家定向 GB",
      executionDate: "2026-06-08",
      controlPeriod: "2026-06-01 至 2026-06-07",
      testPeriod: "2026-06-08 至 2026-06-14",
      spendSaved: "$345.00",
      changeInRoas: "+14.5% (1.52 → 1.74)",
      resultStatus: "提效显著",
      eval: "裁撤非主力不饱和定向后，广告算法预算自然向北美、西欧等优质订单腹地收敛，溢出效益明显。"
    },
    {
      id: "BCK-202",
      prescriptionName: "满 $39.99 免邮主站 Banner 置顶与详情页加载流速精进",
      executionDate: "2026-05-28",
      controlPeriod: "2026-05-21 至 2026-05-27",
      testPeriod: "2026-05-28 至 2026-06-03",
      spendSaved: "--",
      changeInRoas: "+22.8% (1.35 → 1.66)",
      resultStatus: "转化突破",
      eval: "通过满额免邮打消末端运费跳出心智卡点。测试期加购到结账率止跌上涨了 8.2 个百分点，全站 Store ROAS 顺其拉高。"
    }
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto font-sans">
      {/* Disclaimer Banner */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-sm">
        <div className="flex">
          <div className="flex-shrink-0">
            <span className="text-amber-500 font-bold">⚠️</span>
          </div>
          <div className="ml-3">
            <p className="text-xs text-amber-800 font-bold">
              当前回测及执行分析面板为示例展示。后续将伴随处方状态流转机制，在 STEP 13-D-Lite 关联真实已被采纳执行的动作与成效率对账。
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">执行回测 (Prescription Backtesting)</h1>
        <p className="text-sm text-slate-500 mt-1">
          将已被采纳并执行的建议处方的动作，与执行前的基线数据进行对比对账，校验动作真实收益率。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[10px] text-slate-400 font-bold block uppercase mb-1">累计验证采纳建议</span>
          <div className="text-2xl font-black text-slate-900">8 条</div>
          <p className="text-[10px] text-slate-400 mt-2">已被对账校验引擎打标完成</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[10px] text-slate-400 font-bold block uppercase mb-1">因避错而挽回消耗</span>
          <div className="text-2xl font-black text-emerald-600">+$678.90</div>
          <p className="text-[10px] text-slate-400 mt-2">削减亏损低效冷定向国家溢出</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[10px] text-slate-400 font-bold block uppercase mb-1">全站综合增效 ROI</span>
          <div className="text-2xl font-black text-blue-600">+18.4%</div>
          <p className="text-[10px] text-slate-400 mt-2">对照组 VS 实验组平均 Store ROAS 差异数</p>
        </div>
      </div>

      <div className="space-y-6">
        <h3 className="font-bold text-slate-900 text-sm">已归档的历史动作回测记录</h3>
        <div className="space-y-4">
          {backtestHistory.map((item, idx) => (
            <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded">
                      ID: {item.id}
                    </span>
                    <span className="text-slate-400 text-xs">实施日期: {item.executionDate}</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm mt-1">{item.prescriptionName}</h4>
                </div>
                <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-full">
                  {item.resultStatus}
                </span>
              </div>

              {/* Multi data contrast */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">对照组区间 (基线期)</span>
                  <span className="font-medium text-slate-700">{item.controlPeriod}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">实验组区间 (验证期)</span>
                  <span className="font-medium text-slate-700">{item.testPeriod}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">挽回低效消耗</span>
                  <span className="font-bold text-slate-900">{item.spendSaved}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">综合店面 ROAS 对比</span>
                  <strong className="text-slate-900 text-sm flex items-center gap-1">
                    {item.changeInRoas} <ArrowUpRight className="w-3 h-3 text-emerald-500 inline" />
                  </strong>
                </div>
              </div>

              <div className="text-xs text-slate-650 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="font-bold text-slate-800 block mb-1">对账回溯解析:</span>
                {item.eval}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
