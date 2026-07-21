import {
  CURRENT_RANGE_NOT_READY_MESSAGE,
  DATE_RANGE_MISMATCH_MESSAGE,
  getSafeLastGoodData,
  isDateRangeMismatch,
  makeLastGoodData,
  shouldPreserveLastGoodData
} from "@/lib/data-view-state";

export type AudienceRequestContext = {
  requestKey: string;
  startStr: string;
  endStr: string;
  selectedStore: string;
  selectedAccount: string;
  activeTab: string;
  minSpend: string;
  includeZeroSpend: boolean;
  sortBy: string;
};

export function buildAudienceClearedState() {
  return {
    data: [],
    metaSummary: null,
    storeSummary: null,
    orderCountryRows: [],
    metaCoverage: null,
    storeCoverage: null,
    dataHealth: null,
    countriesHealth: null,
    viewNotice: null
  };
}

export function buildAudienceSourceRequestParams(context: AudienceRequestContext) {
  return {
    metaParams: {
      storeId: context.selectedStore,
      accountId: context.selectedAccount,
      dimensionType: context.activeTab,
      minSpend: context.minSpend || undefined,
      includeZeroSpend: context.includeZeroSpend ? "true" : "false",
      sortBy: context.sortBy,
      startDate: context.startStr,
      endDate: context.endStr
    },
    storeParams: context.activeTab === "country" ? {
      startDate: context.startStr,
      endDate: context.endStr,
      storeId: context.selectedStore,
      minSpend: context.minSpend || undefined,
      includeUnmappedSpend: "true"
    } : null
  };
}

export function shouldApplyAudienceSourceResult(sourceRequestKey: string, currentRequestKey: string) {
  return sourceRequestKey === currentRequestKey;
}

export function audienceMetaRowsAllowed(coverage: any) {
  const status = String(coverage?.status || "").toUpperCase();
  return (
    status === "READY" ||
    status === "PARTIAL_COVERAGE" ||
    (status === "SYNC_RUNNING" && coverage?.allowCurrentFactsWhileRunning === true)
  );
}

export function extractAudienceMetaSummary(payload: any) {
  return payload?.summary?.meta || {
    spend: payload?.summary?.totalSpend ?? null,
    impressions: payload?.summary?.totalImpressions ?? null,
    clicks: payload?.summary?.totalClicks ?? null,
    purchases: payload?.summary?.totalPurchases ?? null,
    purchaseValue: payload?.summary?.totalPurchaseValue ?? null,
    ctr: payload?.summary?.ctr ?? null,
    cpc: payload?.summary?.cpc ?? null,
    cpm: payload?.summary?.cpm ?? null,
    cpa: payload?.summary?.cpa ?? null,
    roas: payload?.summary?.roas ?? null
  };
}

function metaSummaryHasCurrentValues(metaSummary: any) {
  return Boolean(
    metaSummary &&
      (
        metaSummary.spend !== null ||
        metaSummary.impressions !== null ||
        metaSummary.clicks !== null ||
        metaSummary.purchases !== null ||
        metaSummary.purchaseValue !== null
      )
  );
}

function failClosedMetaResult(input: {
  metaCoverage: any;
  responseDateRange: any;
  lastGoodData: any;
  context: AudienceRequestContext;
  reason: string;
  message: string;
}) {
  return {
    data: [],
    metaSummary: null,
    metaCoverage: input.metaCoverage,
    dataHealth: {
      status: "RESPONSE_SCOPE_INCONSISTENT",
      reason: input.reason,
      message: input.message,
      dateRange: {
        startDate: input.context.startStr,
        endDate: input.context.endStr,
        timezone: "America/Los_Angeles"
      }
    },
    viewNotice: input.message,
    responseDateRange: input.responseDateRange,
    nextLastGoodData: input.lastGoodData,
    toastError: true
  };
}

export function resolveAudienceMetaSourceResult(input: {
  payload?: any;
  error?: any;
  context: AudienceRequestContext;
  lastGoodData: any;
}) {
  const { payload, error, context, lastGoodData } = input;

  if (error) {
    return {
      data: [],
      metaSummary: null,
      metaCoverage: { status: "ERROR" },
      dataHealth: {
        status: "ERROR",
        reason: "FETCH_FAILED_FOR_CURRENT_REQUEST",
        message: "Current audience request failed; old data was not reused.",
        dateRange: { startDate: context.startStr, endDate: context.endStr, timezone: "America/Los_Angeles" }
      },
      viewNotice: "Current audience request failed; old data was not displayed.",
      responseDateRange: null,
      nextLastGoodData: lastGoodData,
      toastError: true
    };
  }

  if (!payload) {
    return {
      data: [],
      metaSummary: null,
      metaCoverage: null,
      dataHealth: {
        status: "EMPTY_RESPONSE",
        reason: "NO_PAYLOAD_FOR_CURRENT_REQUEST",
        message: "Current audience request returned no usable payload.",
        dateRange: { startDate: context.startStr, endDate: context.endStr, timezone: "America/Los_Angeles" }
      },
      viewNotice: "Current audience request returned no usable payload.",
      responseDateRange: null,
      nextLastGoodData: lastGoodData
    };
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const metaCoverage = payload?.metaCoverage || (payload?.coverage?.status ? payload.coverage : payload?.coverage?.meta) || null;
  const responseDateRange = payload.dateRange || payload.appliedFilters || null;
  const metaSummary = extractAudienceMetaSummary(payload);

  if (isDateRangeMismatch(payload, context.startStr, context.endStr)) {
    return {
      data: [],
      metaSummary: null,
      metaCoverage,
      dataHealth: { status: "DATE_RANGE_MISMATCH", message: DATE_RANGE_MISMATCH_MESSAGE },
      viewNotice: DATE_RANGE_MISMATCH_MESSAGE,
      responseDateRange,
      nextLastGoodData: lastGoodData
    };
  }

  if (shouldPreserveLastGoodData(payload, rows, lastGoodData, context.requestKey)) {
    const safeLastGoodData = getSafeLastGoodData(lastGoodData, context.requestKey);
    if (safeLastGoodData) {
      return {
        data: safeLastGoodData.rows || safeLastGoodData.data || [],
        metaSummary: safeLastGoodData.metaSummary || null,
        metaCoverage: safeLastGoodData.metaCoverage || null,
        dataHealth: safeLastGoodData.dataHealth || null,
        viewNotice: CURRENT_RANGE_NOT_READY_MESSAGE,
        responseDateRange,
        nextLastGoodData: lastGoodData,
        preservedLastGoodData: true
      };
    }
  }

  if (rows.length > 0 && !audienceMetaRowsAllowed(metaCoverage)) {
    return failClosedMetaResult({
      metaCoverage,
      responseDateRange,
      lastGoodData,
      context,
      reason: "ROWS_VISIBLE_WHILE_COVERAGE_NOT_READY",
      message: "Audience response coverage and rows are inconsistent; possible stale rows were not displayed."
    });
  }

  if (rows.length > 0 && !metaSummaryHasCurrentValues(metaSummary)) {
    return failClosedMetaResult({
      metaCoverage,
      responseDateRange,
      lastGoodData,
      context,
      reason: "ROWS_VISIBLE_WITHOUT_CURRENT_SUMMARY",
      message: "Audience response returned rows without a current Meta summary; possible stale rows were not displayed."
    });
  }

  const nextLastGoodData = makeLastGoodData(context.requestKey, rows, {
    rows,
    metaSummary,
    dataHealth: payload.dataHealth || null,
    metaCoverage
  });

  return {
    data: rows,
    metaSummary,
    metaCoverage,
    dataHealth: payload.dataHealth || null,
    viewNotice: String(metaCoverage?.status || "").toUpperCase() === "PARTIAL_COVERAGE" ? metaCoverage?.message || null : null,
    responseDateRange,
    nextLastGoodData
  };
}

export function resolveAudienceStoreSourceResult(input: {
  payload?: any;
  error?: any;
  context: AudienceRequestContext;
}) {
  const { payload, error, context } = input;

  if (context.activeTab !== "country") {
    return {
      orderCountryRows: [],
      storeSummary: null,
      countriesHealth: null,
      storeCoverage: null,
      countriesLoading: false
    };
  }

  if (error) {
    const errData = error?.response?.data;
    return {
      orderCountryRows: [],
      storeSummary: null,
      countriesHealth: {
        status: "COUNTRIES_REQUEST_FAILED",
        reason: "ORDER_COUNTRY_AUXILIARY_REQUEST_FAILED",
        message: errData?.message || errData?.details || errData?.error || error?.message || "Store country auxiliary request failed.",
        dateRange: { startDate: context.startStr, endDate: context.endStr, timezone: "America/Los_Angeles" }
      },
      storeCoverage: { status: "ERROR" },
      countriesLoading: false
    };
  }

  if (!payload) {
    return {
      orderCountryRows: [],
      storeSummary: null,
      countriesHealth: null,
      storeCoverage: null,
      countriesLoading: false
    };
  }

  const storeCoverage = payload?.storeCoverage || payload?.coverage || null;

  if (isDateRangeMismatch(payload, context.startStr, context.endStr)) {
    return {
      orderCountryRows: [],
      storeSummary: null,
      countriesHealth: {
        status: "DATE_RANGE_MISMATCH",
        reason: "STORE_COUNTRY_DATE_RANGE_MISMATCH",
        message: DATE_RANGE_MISMATCH_MESSAGE
      },
      storeCoverage,
      countriesLoading: false
    };
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const summary = payload?.summary || null;
  const rowOrderCount = rows.reduce((sum, row) => sum + Number(row.orderCount || row.orders || 0), 0);
  const rowRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || row.totalRevenue || row.orderRevenue || 0), 0);
  const storeSummary = {
    orderCount: summary?.orderCount === null ? null : Number(summary?.orderCount ?? rowOrderCount),
    revenue: summary?.revenue === null ? null : Number(summary?.revenue ?? rowRevenue),
    averageOrderValue: summary?.averageOrderValue === null
      ? null
      : Number(summary?.averageOrderValue ?? (rowOrderCount > 0 ? rowRevenue / rowOrderCount : 0)),
    countryCount: summary?.countryCount === null ? null : Number(summary?.countryCount ?? rows.length)
  };

  return {
    orderCountryRows: rows,
    storeSummary,
    countriesHealth: payload?.dataHealth || null,
    storeCoverage,
    countriesLoading: false
  };
}
