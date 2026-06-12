// @ts-nocheck
export interface AiAdvice {
  currentConclusion: string;
  mainIssues: string[];
  dataBasis: string[];
  suggestedActions: string[];
  riskWarnings: string[];
  operatorChecklist: string[];
}

export interface AdviceInput {
  orderCount: number;
  sales: number;
  spend: number;
  realRoas: number | null;
  metaRoas: number | null;
  metaPurchases: number;
  orderGap: number;
}

export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

export function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function classifyCountryRecommendation(input: {
  orders: number;
  sales: number;
  spend: number;
  realRoas: number | null;
  metaRoas: number | null;
}): "加预算" | "保持" | "降预算" | "排除" | "单独开系列" {
  const realRoas = input.realRoas ?? 0;
  if (input.spend >= 50 && input.orders === 0) return "排除";
  if (input.orders >= 8 && realRoas >= 2.5) return "单独开系列";
  if (input.orders >= 3 && realRoas >= 2) return "加预算";
  if (input.spend >= 30 && realRoas < 1) return "降预算";
  return "保持";
}

export function judgeCreativePerformance(input: {
  spend: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  purchases: number;
  roas: number | null;
  frequency: number | null;
}): string {
  const ctr = input.ctr ?? 0;
  const roas = input.roas ?? 0;
  const frequency = input.frequency ?? 0;
  if (input.purchases >= 3 && roas >= 2) return "可扩量";
  if (ctr >= 1.5 && roas < 1) return "高点击低转化";
  if (ctr < 1 && input.purchases > 0 && roas >= 1.5) return "低点击高转化";
  if (frequency >= 3 && ctr < 1) return "疲劳";
  if (ctr < 0.8 && input.spend >= 20) return "需替换 Hook";
  return "观察";
}

export function buildAiAdvice(input: AdviceInput): AiAdvice {
  const hasSpend = input.spend > 0;
  const realRoas = input.realRoas ?? 0;
  const metaRoas = input.metaRoas ?? 0;
  const attributionGapRate = input.orderCount > 0 ? Math.abs(input.orderGap) / input.orderCount : 0;
  const suggestedActions: string[] = [];
  const mainIssues: string[] = [];
  const riskWarnings: string[] = [
    "这些结论只基于已同步到本地数据库的数据，不会自动修改广告账户。",
  ];

  if (!hasSpend) {
    mainIssues.push("当前时间段没有匹配到广告花费，无法判断投放效率。");
    suggestedActions.push("建议先同步 Meta Insights，并确认店铺已经绑定正确广告账户。");
  } else if (realRoas >= 2.5) {
    suggestedActions.push("建议加预算，但保持小幅递增并继续观察真实 ROAS。");
  } else if (realRoas >= 1.5) {
    suggestedActions.push("建议保留当前结构，观察国家、产品和素材拆分后的表现。");
  } else if (realRoas > 0) {
    suggestedActions.push("建议降预算或缩小投放范围，优先排查低 ROAS 国家和素材。");
  } else {
    suggestedActions.push("建议暂停扩量节奏，先检查落地页、支付链路和素材转化承接。");
  }

  if (attributionGapRate >= 0.3) {
    mainIssues.push(input.orderGap >= 0
      ? "真实订单明显高于 Meta 归因订单，可能存在漏归因。"
      : "Meta 归因订单明显高于真实订单，可能存在虚高归因或映射范围不准确。");
    suggestedActions.push("建议核对 UTM、Pixel/CAPI、店铺映射和国家维度差异。");
  }

  if (metaRoas > 0 && hasSpend && Math.abs(metaRoas - realRoas) >= 1) {
    mainIssues.push("Meta ROAS 与真实 ROAS 差距较大，不能只按平台归因判断预算。");
  }

  if (mainIssues.length === 0) {
    mainIssues.push("暂未发现严重异常，建议继续按国家、产品和素材维度拆解。");
  }

  if (!suggestedActions.some((action) => action.includes("观察"))) {
    suggestedActions.push("建议观察最近 3 天和 7 天趋势，避免单日波动误判。");
  }

  return {
    currentConclusion: hasSpend
      ? `当前真实 ROAS 为 ${round(input.realRoas, 2) ?? "N/A"}，Meta ROAS 为 ${round(input.metaRoas, 2) ?? "N/A"}。`
      : "当前缺少广告花费数据，分析结论可信度有限。",
    mainIssues,
    dataBasis: [
      `店铺订单数：${input.orderCount}`,
      `店铺销售额：${round(input.sales, 2) ?? 0}`,
      `广告花费：${round(input.spend, 2) ?? 0}`,
      `Meta 归因订单：${input.metaPurchases}`,
      `真实订单与 Meta 订单差异：${input.orderGap}`,
    ],
    suggestedActions,
    riskWarnings,
    operatorChecklist: [
      "确认店铺与广告账户映射是否正确。",
      "同步最新订单与 Meta Insights 后再做预算动作。",
      "优先查看国家、产品、素材三个报告定位问题来源。",
      "所有动作由运营人工执行，系统不会自动创建、暂停或修改广告。",
    ],
  };
}
