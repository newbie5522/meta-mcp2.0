import {
  buildDataViewRequestKey,
  DATE_RANGE_MISMATCH_MESSAGE,
  isDateRangeMismatch
} from "@/lib/data-view-state";
import type {
  CreativeAnalysisReport,
  CreativeAnalysisRequest,
  CreativeIntelligenceRow
} from "../shared/creative-intelligence-contract";

const TRUE_EMPTY_SUMMARY = {
  performanceCount: 0,
  spend: 0,
  impressions: 0,
  clicks: 0,
  purchases: 0,
  purchaseValue: 0,
  ctr: null,
  cpc: null,
  cpm: null,
  cpa: null,
  roas: null
};

const EMPTY_SNAPSHOT = {
  performanceRows: [],
  structureOnlyRows: [],
  summary: null,
  structureSummary: null,
  bucketSummary: {},
  filterOptions: {
    storeOptions: [],
    accountOptions: [],
    campaignOptions: [],
    adsetOptions: [],
    creativeTypeOptions: []
  },
  coverage: null,
  pagination: null,
  diagnostics: null,
  dateRange: null,
  notice: null
};

export function buildCreativeDashboardRequestKey(input: {
  startDate: string;
  endDate: string;
  storeId?: string | number | null;
  accountId?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  type?: string | null;
  bucket?: string | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
  sortBy?: string | null;
  includeZeroSpend?: boolean;
}) {
  return buildDataViewRequestKey({
    page: "creative",
    startDate: input.startDate,
    endDate: input.endDate,
    storeId: input.storeId || "all",
    accountId: input.accountId || "all",
    campaignId: input.campaignId || "all",
    adsetId: input.adsetId || "all",
    type: input.type || "ALL",
    opsBucket: input.bucket || "all",
    search: input.search || "",
    pageNumber: input.page || 1,
    pageSize: input.pageSize || 50,
    sortBy: input.sortBy || "spend DESC",
    includeZeroSpend: input.includeZeroSpend === true
  });
}

export function buildCreativeSelectionScopeKey(input: {
  startDate: string;
  endDate: string;
  storeId: string | number | null;
  accountId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  type: string | null;
  bucket: string | null;
  search: string | null;
}) {
  return buildDataViewRequestKey({
    page: "creative-selection-scope",
    startDate: input.startDate,
    endDate: input.endDate,
    storeId: input.storeId || "all",
    accountId: input.accountId || "all",
    campaignId: input.campaignId || "all",
    adsetId: input.adsetId || "all",
    type: input.type || "ALL",
    bucket: input.bucket || "all",
    search: input.search || ""
  });
}

export function resolveCreativeDashboardResponse(payload: any, startDate: string, endDate: string) {
  if (!startDate || !endDate || isDateRangeMismatch(payload, startDate, endDate)) {
    return {
      ...EMPTY_SNAPSHOT,
      notice: DATE_RANGE_MISMATCH_MESSAGE,
      dateRange: null
    };
  }
  const coverage = payload?.coverage || null;
  const status = String(coverage?.status || "NOT_SYNCED").toUpperCase();
  if (status === "ERROR") {
    return {
      ...EMPTY_SNAPSHOT,
      coverage,
      diagnostics: payload?.diagnostics || null,
      notice: "Creative data is unavailable for the current request."
    };
  }
  if (status === "NOT_SYNCED" || status === "SYNC_RUNNING") {
    return {
      ...EMPTY_SNAPSHOT,
      structureOnlyRows: payload?.structureOnlyRows || [],
      structureSummary: payload?.structureSummary || null,
      filterOptions: payload?.filterOptions || EMPTY_SNAPSHOT.filterOptions,
      coverage,
      diagnostics: payload?.diagnostics || null,
      dateRange: payload?.dateRange || payload?.appliedFilters || null,
      notice: status === "SYNC_RUNNING" ? "Creative sync is still running." : "Creative facts are not synced."
    };
  }
  if (status === "TRUE_EMPTY") {
    return {
      ...EMPTY_SNAPSHOT,
      structureOnlyRows: payload?.structureOnlyRows || [],
      summary: TRUE_EMPTY_SUMMARY,
      structureSummary: payload?.structureSummary || null,
      filterOptions: payload?.filterOptions || EMPTY_SNAPSHOT.filterOptions,
      coverage,
      pagination: payload?.pagination || null,
      diagnostics: payload?.diagnostics || null,
      dateRange: payload?.dateRange || payload?.appliedFilters || null,
      notice: "当前周期已完整同步，素材成效为空。"
    };
  }
  return {
    performanceRows: payload?.performanceRows || payload?.data || [],
    structureOnlyRows: payload?.structureOnlyRows || [],
    summary: payload?.summary || null,
    structureSummary: payload?.structureSummary || null,
    bucketSummary: payload?.bucketSummary || {},
    filterOptions: payload?.filterOptions || EMPTY_SNAPSHOT.filterOptions,
    coverage,
    pagination: payload?.pagination || null,
    diagnostics: payload?.diagnostics || null,
    dateRange: payload?.dateRange || payload?.appliedFilters || null,
    notice: status === "PARTIAL_COVERAGE" ? "Partial coverage: AI confidence is downgraded." : null
  };
}

export function buildCreativeAiRequestKey(row: CreativeIntelligenceRow | null, input: {
  startDate: string;
  endDate: string;
  coverageStatus: string;
}) {
  if (!row) return "";
  return buildDataViewRequestKey({
    analysisEntityId: row.analysisEntityId,
    startDate: input.startDate,
    endDate: input.endDate,
    coverageStatus: input.coverageStatus,
    storeId: row.storeId ?? "all",
    accountId: row.accountId,
    creativeIds: [...(row.creativeIds || [])].sort(),
    adIds: [...(row.adIds || [])].sort(),
    campaignIds: [...(row.campaignIds || [])].sort(),
    adsetIds: [...(row.adsetIds || [])].sort()
  });
}

export function resolveCreativeFilterCascade(input: {
  changed: "store" | "account" | "campaign";
  nextValue: string;
}) {
  if (input.changed === "store") {
    return { storeId: input.nextValue, accountId: "all", campaignId: "all", adsetId: "all", page: 1 };
  }
  if (input.changed === "account") {
    return { accountId: input.nextValue, campaignId: "all", adsetId: "all", page: 1 };
  }
  return { campaignId: input.nextValue, adsetId: "all", page: 1 };
}

export function compareNullable(
  left: number | string | null | undefined,
  right: number | string | null | undefined,
  direction: "asc" | "desc"
) {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (typeof left === "string" && typeof right === "string") {
    return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return direction === "asc" ? leftNumber - rightNumber : rightNumber - leftNumber;
}

export function formatCreativeAnalysisDataBasis(report: CreativeAnalysisReport) {
  return [
    `来源：${report.dataBasis.source}`,
    `事实层级：${report.dataBasis.factLevel}`,
    `事实行数：${report.dataBasis.factRows}`,
    `账户：${report.dataBasis.accountId}`,
    `店铺：${report.dataBasis.storeId ?? "未绑定"}`,
    `素材版本：${report.dataBasis.creativeIds.length}`,
    `关联广告：${report.dataBasis.adIds.length}`,
    `广告系列：${report.dataBasis.campaignIds.length}`,
    `广告组：${report.dataBasis.adsetIds.length}`,
    `最新成效日期：${report.dataBasis.latestPerformanceDate || "N/A"}`,
    `最新同步时间：${report.dataBasis.latestSyncedAt || "N/A"}`
  ];
}

export function isCreativeAiAllowed(row: Partial<CreativeIntelligenceRow> | null | undefined, coverage: any, dateRangeMismatch = false) {
  if (!row || row.hasPerformanceFacts !== true || dateRangeMismatch) {
    return { allowed: false, confidence: null as null, warning: null as string | null };
  }
  const status = String(coverage?.status || "").toUpperCase();
  if (status === "READY") return { allowed: true, confidence: "full" as const, warning: null };
  if (status === "PARTIAL_COVERAGE") return { allowed: true, confidence: "partial" as const, warning: "部分覆盖，AI 降级判断。" };
  return { allowed: false, confidence: null as null, warning: null };
}

export function buildCreativeAnalysisRequest(row: CreativeIntelligenceRow, input: {
  startDate: string;
  endDate: string;
  onlyCached?: boolean;
  forceRefresh?: boolean;
}): CreativeAnalysisRequest {
  return {
    analysisEntityId: row.analysisEntityId || row.id,
    creativeId: row.creativeId,
    creativeIds: row.creativeIds || [row.creativeId],
    adIds: row.adIds || [],
    campaignIds: row.campaignIds || [],
    adsetIds: row.adsetIds || [],
    accountId: row.accountId,
    storeId: row.storeId ?? null,
    startDate: input.startDate,
    endDate: input.endDate,
    onlyCached: input.onlyCached,
    forceRefresh: input.forceRefresh
  };
}

function metric(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "N/A" : `${value}${suffix}`;
}

export function buildCreativeAiPrompt(row: CreativeIntelligenceRow, input: {
  coverage: any;
  confidence: "full" | "partial";
  startDate: string;
  endDate: string;
}) {
  return [
    `日期: ${input.startDate} ~ ${input.endDate}`,
    `Coverage: ${input.coverage?.status || "UNKNOWN"} / confidence=${input.confidence}`,
    `Store: ${row.storeName || "N/A"} (${row.storeId ?? "N/A"})`,
    `Account: ${row.accountName || "账户名称未同步"} (${row.accountId})`,
    `Creative: ${row.creativeName || "N/A"} / ${row.type}`,
    `关联数量: creative=${row.creativeCount}, campaign=${row.campaignCount}, adset=${row.adsetCount}, ad=${row.adCount}`,
    `Spend=${metric(row.spend)}, Impressions=${metric(row.impressions)}, Clicks=${metric(row.clicks)}, CTR=${metric(row.ctr, "%")}, CPC=${metric(row.cpc)}, CPM=${metric(row.cpm)}, Purchases=${metric(row.purchases)}, CPA=${metric(row.cpa)}, PurchaseValue=${metric(row.purchaseValue)}, ROAS=${metric(row.roas)}`,
    `Reach=${row.availability?.reach ? metric(row.reach) : "N/A"}, AddToCart=${row.availability?.addToCart ? metric(row.addToCart) : "N/A"}`,
    `规则分类: ${row.opsBucketLabel || "N/A"}; 依据: ${row.diagnosisReason || "N/A"}; 建议: ${row.recommendedAction || "N/A"}`
  ].join("\n");
}

export function resolveCreativeAnalysisResponse(payload: any) {
  if (!payload || payload.success !== true) return { report: null, cached: false };
  return {
    report: payload.report === null ? null : payload,
    cached: payload.cached === true
  };
}
