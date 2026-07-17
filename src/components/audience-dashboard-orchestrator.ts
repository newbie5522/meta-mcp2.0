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
    summary: null,
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
      summary: null,
      metaCoverage: { status: "ERROR" },
      dataHealth: {
        status: "ERROR",
        reason: "FETCH_FAILED_FOR_CURRENT_REQUEST",
        message: "当前受众筛选周期请求失败，未使用旧数据。",
        dateRange: { startDate: context.startStr, endDate: context.endStr, timezone: "America/Los_Angeles" }
      },
      viewNotice: "当前受众筛选周期请求失败，未展示旧数据。",
      responseDateRange: null,
      nextLastGoodData: lastGoodData,
      toastError: true
    };
  }

  if (!payload) {
    return {
      data: [],
      summary: null,
      metaCoverage: null,
      dataHealth: {
        status: "EMPTY_RESPONSE",
        reason: "NO_PAYLOAD_FOR_CURRENT_REQUEST",
        message: "当前受众筛选周期没有返回有效数据，未使用旧数据。",
        dateRange: { startDate: context.startStr, endDate: context.endStr, timezone: "America/Los_Angeles" }
      },
      viewNotice: "当前受众筛选周期没有返回有效数据。",
      responseDateRange: null,
      nextLastGoodData: lastGoodData
    };
  }

  const rows = payload.rows || [];
  const metaCoverage = payload.metaCoverage || payload.coverage?.meta || null;
  const responseDateRange = payload.dateRange || payload.appliedFilters || null;

  if (isDateRangeMismatch(payload, context.startStr, context.endStr)) {
    return {
      data: [],
      summary: null,
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
        summary: safeLastGoodData.summary || null,
        metaCoverage: safeLastGoodData.metaCoverage || null,
        dataHealth: safeLastGoodData.dataHealth || null,
        viewNotice: CURRENT_RANGE_NOT_READY_MESSAGE,
        responseDateRange,
        nextLastGoodData: lastGoodData,
        preservedLastGoodData: true
      };
    }
  }

  const nextLastGoodData = makeLastGoodData(context.requestKey, rows, {
    rows,
    summary: payload.summary || null,
    dataHealth: payload.dataHealth || null,
    metaCoverage
  });

  return {
    data: rows,
    summary: payload.summary || null,
    metaCoverage,
    dataHealth: payload.dataHealth || null,
    viewNotice: null,
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
      countriesHealth: null,
      storeCoverage: null,
      countriesLoading: false
    };
  }

  if (error) {
    const errData = error?.response?.data;
    return {
      orderCountryRows: [],
      countriesHealth: {
        status: "COUNTRIES_REQUEST_FAILED",
        reason: "ORDER_COUNTRY_AUXILIARY_REQUEST_FAILED",
        message: errData?.message || errData?.details || errData?.error || error?.message || "店铺订单国家辅助请求失败。",
        dateRange: { startDate: context.startStr, endDate: context.endStr, timezone: "America/Los_Angeles" }
      },
      storeCoverage: { status: "ERROR" },
      countriesLoading: false
    };
  }

  return {
    orderCountryRows: payload?.rows || [],
    countriesHealth: payload?.dataHealth || null,
    storeCoverage: payload?.storeCoverage || payload?.coverage || null,
    countriesLoading: false
  };
}
