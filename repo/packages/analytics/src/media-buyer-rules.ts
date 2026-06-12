export interface MediaBuyingMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  ctr?: number | null;
  cpm?: number | null;
  cpc?: number | null;
  roas?: number | null;
  frequency?: number | null;
}

export interface MediaBuyingSignal {
  code: string;
  severity: "info" | "warning" | "critical";
  priority: 1 | 2 | 3 | 4 | 5;
  conclusion: string;
  suggestedAction: string;
  observationWindow: string;
}

export function evaluateMediaBuyingSignals(metrics: MediaBuyingMetrics): MediaBuyingSignal[] {
  const signals: MediaBuyingSignal[] = [];
  const roas = metrics.roas ?? (metrics.spend > 0 ? metrics.purchaseValue / metrics.spend : null);
  const ctr = metrics.ctr ?? (metrics.impressions > 0 ? (metrics.clicks * 100) / metrics.impressions : null);

  if (metrics.spend >= 50 && metrics.purchases === 0) {
    signals.push({
      code: "spend_no_purchase",
      severity: "critical",
      priority: 1,
      conclusion: "有消耗但没有购买，转化链路或受众匹配存在明显风险。",
      suggestedAction: "建议降预算或暂停观察，由运营人工确认后执行。",
      observationWindow: "24-48 小时",
    });
  }

  if (roas !== null && roas >= 3 && metrics.purchases >= 3) {
    signals.push({
      code: "scale_candidate",
      severity: "info",
      priority: 2,
      conclusion: "ROAS 与订单量同时较好，具备小幅扩量条件。",
      suggestedAction: "建议小幅加预算，并同步生成相似素材与国家本地化版本。",
      observationWindow: "3 天",
    });
  }

  if (ctr !== null && ctr < 0.8 && metrics.spend >= 20) {
    signals.push({
      code: "low_ctr_creative",
      severity: "warning",
      priority: 2,
      conclusion: "CTR 偏低，素材吸引力不足或 Hook 不匹配。",
      suggestedAction: "建议替换前 3 秒 Hook、首图、标题或开头文案。",
      observationWindow: "1-2 天",
    });
  }

  if ((metrics.frequency ?? 0) >= 3 && (ctr ?? 0) < 1) {
    signals.push({
      code: "creative_fatigue",
      severity: "warning",
      priority: 2,
      conclusion: "频次偏高且点击偏弱，存在素材疲劳。",
      suggestedAction: "建议补充新素材，并降低疲劳素材预算占比。",
      observationWindow: "3 天",
    });
  }

  if (signals.length === 0) {
    signals.push({
      code: "observe",
      severity: "info",
      priority: 5,
      conclusion: "暂无强异常信号。",
      suggestedAction: "建议继续观察，并等待更多订单样本。",
      observationWindow: "3-7 天",
    });
  }

  return signals;
}
