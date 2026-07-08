export const problemStageLabels: Record<string, string> = {
  data_health: "数据健康",
  outcome: "成交结果",
  product_page_intent: "商品页兴趣",
  checkout_payment: "结账与支付",
  ad_delivery: "广告投放",
  creative_attraction: "素材吸引力",
  creative_fatigue: "素材疲劳",
  store_operations: "店铺经营",
  landing_page_arrival: "落地页到达",
  cart_to_checkout: "加购到结账"
};

export const optimizationAreaLabels: Record<string, string> = {
  mapping: "账户绑定",
  budget: "预算控制",
  product_page: "商品页承接",
  creative: "素材创意",
  audience: "受众优化",
  delivery: "投放效率",
  pricing: "价格与优惠",
  trust: "信任建设",
  tracking: "追踪质量",
  data_sync: "数据同步"
};

export const funnelStageLabels: Record<string, string> = {
  not_applicable: "不适用",
  impression_to_click: "曝光到点击",
  landing_page_to_add_to_cart: "落地页到加购",
  landing_page_arrival: "落地页到达",
  product_page_intent: "商品页兴趣",
  cart_to_checkout: "加购到结账",
  checkout_to_purchase: "结账到购买",
  checkout_payment: "结账与支付",
  meta_to_store_reconciliation: "Meta 与店铺对账"
};

export const severityLabels: Record<string, string> = {
  critical: "严重",
  warning: "需要关注",
  info: "提醒",
  healthy: "正常"
};

export const entityTypeLabels: Record<string, string> = {
  account: "广告账户",
  ad_account: "广告账户",
  store: "店铺",
  campaign: "广告系列",
  adset: "广告组",
  ad: "广告",
  creative: "素材",
  product: "商品"
};

export function toBusinessLabel(value: string | null | undefined, map: Record<string, string>) {
  if (!value) return "未分类";
  return map[value] || String(value).replace(/_/g, " ");
}
