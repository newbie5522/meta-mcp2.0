import {
  CURRENT_RANGE_NOT_READY_MESSAGE,
  DATE_RANGE_MISMATCH_MESSAGE,
  isDateRangeMismatch
} from "@/lib/data-view-state";

export function buildAccountDetailsServerRequestKey(input: {
  accountId?: string;
  level: string;
  startDate: string;
  endDate: string;
}) {
  return [
    `accountId=${input.accountId || "unknown"}`,
    `level=${input.level}`,
    `startDate=${input.startDate}`,
    `endDate=${input.endDate}`
  ].join("|");
}

export function shouldApplyAccountDetailsResult(input: {
  requestId: number;
  currentRequestId: number;
  sourceRequestKey: string;
  currentRequestKey: string;
}) {
  return (
    input.requestId === input.currentRequestId &&
    input.sourceRequestKey === input.currentRequestKey
  );
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getInsight(item: any) {
  return item?.insights?.data?.[0] || null;
}

function findActionValue(actions: any[] | undefined, types: string[]) {
  const action = actions?.find((candidate: any) => types.includes(candidate.action_type));
  return action ? toNumberOrNull(action.value) : null;
}

export function getAccountDetailsMetric(item: any, key: string) {
  if (item?.hasPerformanceFacts === false) return null;
  const insight = getInsight(item);
  if (!insight) return null;

  if (key === "spend") return toNumberOrNull(insight.spend);
  if (key === "impressions") return toNumberOrNull(insight.impressions);
  if (key === "clicks") return toNumberOrNull(insight.clicks);
  if (key === "cpm") return toNumberOrNull(insight.cpm);
  if (key === "ctr") return toNumberOrNull(insight.ctr);
  if (key === "cpc") return toNumberOrNull(insight.cpc);
  if (key === "reach") return insight.reachAvailable === false ? null : toNumberOrNull(insight.reach);
  if (key === "frequency") return insight.frequencyAvailable === false ? null : toNumberOrNull(insight.frequency);
  if (key === "link_clicks") return insight.inlineLinkClicksAvailable === false ? null : toNumberOrNull(insight.inline_link_clicks);
  if (key === "link_ctr") return insight.inlineLinkClicksAvailable === false ? null : toNumberOrNull(insight.inline_link_click_ctr);
  if (key === "link_cpc") return insight.inlineLinkClicksAvailable === false ? null : toNumberOrNull(insight.cost_per_inline_link_click);
  if (key === "add_to_cart") {
    if (insight.addToCartAvailable === false) return null;
    return insight.addToCart !== null && insight.addToCart !== undefined
      ? toNumberOrNull(insight.addToCart)
      : findActionValue(insight.actions, ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]);
  }
  if (key === "results") {
    return insight.purchases !== null && insight.purchases !== undefined
      ? toNumberOrNull(insight.purchases)
      : findActionValue(insight.actions, ["purchase"]);
  }
  if (key === "cpr") return toNumberOrNull(insight.cpa);
  if (key === "purchase_value") {
    if (insight.purchaseValue !== null && insight.purchaseValue !== undefined) return toNumberOrNull(insight.purchaseValue);
    if (insight.purchase_value !== null && insight.purchase_value !== undefined) return toNumberOrNull(insight.purchase_value);
    return findActionValue(insight.action_values, ["purchase"]);
  }
  if (key === "roas") return toNumberOrNull(insight.roas);
  return null;
}

export function buildAccountDetailsPerformanceTotals(items: any[]) {
  const factRows = items.filter((item) => item?.hasPerformanceFacts !== false && getInsight(item));
  if (factRows.length === 0) {
    return {
      factRows,
      spend: null,
      impressions: null,
      reach: null,
      clicks: null,
      purchases: null,
      purchaseValue: null,
      addToCart: null,
      linkClicks: null,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      roas: null,
      frequency: null,
      linkCtr: null,
      linkCpc: null
    };
  }
  const sum = (key: string) => factRows.reduce((total, item) => total + (getAccountDetailsMetric(item, key) ?? 0), 0);
  const sumIfAny = (key: string) => factRows.some((item) => getAccountDetailsMetric(item, key) !== null) ? sum(key) : null;
  const spend = sum("spend");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const purchases = sum("results");
  const purchaseValue = sum("purchase_value");
  const reach = sumIfAny("reach");
  const linkClicks = sumIfAny("link_clicks");
  const addToCart = sumIfAny("add_to_cart");
  return {
    factRows,
    spend,
    impressions,
    reach,
    clicks,
    purchases,
    purchaseValue,
    addToCart,
    linkClicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    roas: spend > 0 ? purchaseValue / spend : 0,
    frequency: reach !== null && reach > 0 ? impressions / reach : null,
    linkCtr: linkClicks !== null && impressions > 0 ? (linkClicks / impressions) * 100 : null,
    linkCpc: linkClicks !== null && linkClicks > 0 ? spend / linkClicks : null
  };
}

export function compareAccountDetailsSortValues(a: any, b: any, direction: "asc" | "desc") {
  const aMissing = a === null || a === undefined || a === "N/A";
  const bMissing = b === null || b === undefined || b === "N/A";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (a < b) return direction === "asc" ? -1 : 1;
  if (a > b) return direction === "asc" ? 1 : -1;
  return 0;
}

export function getAccountDetailsCoverageMode(coverage: any, dataHealth?: any) {
  const status = String(dataHealth?.status || coverage?.status || "UNKNOWN").toUpperCase();
  if (status === "READY" || status === "OK") return "READY";
  if (status === "PARTIAL_COVERAGE" || status === "PARTIAL") return "PARTIAL_COVERAGE";
  if (status === "NOT_SYNCED") return "NOT_SYNCED";
  if (status === "TRUE_EMPTY" || status === "EMPTY") return "TRUE_EMPTY";
  if (status === "SYNC_RUNNING" || status === "RUNNING") return "SYNC_RUNNING";
  if (status === "ERROR") return "ERROR";
  if (status === "DATE_RANGE_MISMATCH") return "DATE_RANGE_MISMATCH";
  return status;
}

export function resolveAccountDetailsResponseState(input: {
  payload: any;
  rows: any[];
  startStr: string;
  endStr: string;
  sourceRequestKey: string;
  currentRequestKey: string;
}) {
  if (input.sourceRequestKey !== input.currentRequestKey) {
    return {
      ignored: true,
      reason: "STALE_RESPONSE" as const,
      data: [],
      coverage: null,
      dataHealth: null,
      responseDateRange: null,
      viewNotice: null
    };
  }

  const coverage = input.payload?.coverage || input.payload?.sourceCoverage || null;
  const dataHealth = input.payload?.dataHealth || null;
  const responseDateRange = input.payload?.dateRange || input.payload?.appliedFilters || null;
  if (isDateRangeMismatch(input.payload, input.startStr, input.endStr)) {
    return {
      data: [],
      coverage,
      dataHealth: { status: "DATE_RANGE_MISMATCH", message: DATE_RANGE_MISMATCH_MESSAGE },
      responseDateRange,
      viewNotice: DATE_RANGE_MISMATCH_MESSAGE
    };
  }

  const mode = getAccountDetailsCoverageMode(coverage, dataHealth);
  if (mode === "ERROR") {
    return { data: [], coverage, dataHealth, responseDateRange, viewNotice: dataHealth?.message || "当前请求失败，未展示旧数据。" };
  }
  if (mode === "DATE_RANGE_MISMATCH") {
    return { data: [], coverage, dataHealth, responseDateRange, viewNotice: DATE_RANGE_MISMATCH_MESSAGE };
  }
  if (mode === "SYNC_RUNNING") {
    return { data: [], coverage, dataHealth, responseDateRange, viewNotice: CURRENT_RANGE_NOT_READY_MESSAGE };
  }
  if (mode === "TRUE_EMPTY") {
    return { data: input.rows, coverage, dataHealth, responseDateRange, viewNotice: "当前周期已完整同步且无成效事实。" };
  }
  if (mode === "NOT_SYNCED") {
    return { data: input.rows, coverage, dataHealth, responseDateRange, viewNotice: "当前周期尚未同步成效事实，成效指标显示为 N/A。" };
  }
  if (mode === "PARTIAL_COVERAGE") {
    return { data: input.rows, coverage, dataHealth, responseDateRange, viewNotice: "当前周期数据覆盖不完整，汇总仅统计已有成效事实。" };
  }
  return { data: input.rows, coverage, dataHealth, responseDateRange, viewNotice: null };
}

export function shouldApplyAccountHierarchyResult(input: {
  requestId: number;
  currentRequestId: number;
  accountId?: string;
  currentAccountId?: string;
}) {
  return input.requestId === input.currentRequestId && input.accountId === input.currentAccountId;
}
