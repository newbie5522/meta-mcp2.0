export type DataCoverageStatus =
  | "READY"
  | "PARTIAL_COVERAGE"
  | "NOT_SYNCED"
  | "TRUE_EMPTY"
  | "SYNC_RUNNING"
  | "ERROR";

export type DataCoverageSource =
  | "META_ACCOUNT"
  | "META_AUDIENCE"
  | "META_CREATIVE"
  | "STORE_ORDER"
  | "STORE_LEDGER"
  | "PRODUCT_ORDER";

export type DataCoverageBasis =
  | "FACT_ROWS_AND_SYNC_RECEIPT"
  | "FACT_ROWS_ONLY"
  | "EXACT_EMPTY_SYNC_RECEIPT"
  | "RUNNING_SYNC"
  | "QUERY_ERROR";

export interface SyncCoverageEvidence {
  taskType: string | null;
  taskId: string | null;
  status: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  recordsFetched: number | null;
  recordsSaved: number | null;
  failedCount: number;
}

export interface DataSourceCoverage {
  source: DataCoverageSource;
  scopeKey: string;
  requestedStartDate: string;
  requestedEndDate: string;
  earliestAvailableDate: string | null;
  latestAvailableDate: string | null;
  rangeRowCount: number;
  structureRowCount: number;
  status: DataCoverageStatus;
  message: string;
  explicitRangeSyncSuccess: boolean;
  syncRunning: boolean;
  asOfTime: string | null;
  currentDayInProgress: boolean;
  coverageComplete: boolean;
  coverageBasis: DataCoverageBasis;
  syncEvidence: SyncCoverageEvidence | null;
}

export interface ResolveDataCoverageInput {
  source: DataCoverageSource;
  scopeKey: string;
  requestedStartDate: string;
  requestedEndDate: string;
  earliestAvailableDate?: string | null;
  latestAvailableDate?: string | null;
  rangeRowCount?: number;
  structureRowCount?: number;
  syncEvidence?: SyncCoverageEvidence | null;
  syncRunning?: boolean;
  queryError?: boolean;
  truncated?: boolean;
  coverageComplete?: boolean;
  asOfTime?: string | null;
  businessToday?: string;
}

function coversRequestedRange(
  start: string | null | undefined,
  end: string | null | undefined,
  requestedStartDate: string,
  requestedEndDate: string
) {
  return Boolean(start && end && start <= requestedStartDate && end >= requestedEndDate);
}

function isSuccessfulReceipt(status: string | null | undefined) {
  const normalized = String(status || "").toUpperCase();
  return normalized === "SUCCESS" || normalized === "NO_NEW_DATA";
}

function isFailedReceipt(status: string | null | undefined) {
  const normalized = String(status || "").toUpperCase();
  return normalized === "FAILED" || normalized === "ERROR";
}

function defaultBusinessToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function resolveDataCoverageStatus(input: ResolveDataCoverageInput): DataSourceCoverage {
  const earliestAvailableDate = input.earliestAvailableDate || null;
  const latestAvailableDate = input.latestAvailableDate || null;
  const rangeRowCount = Math.max(0, Number(input.rangeRowCount || 0));
  const structureRowCount = Math.max(0, Number(input.structureRowCount || 0));
  const syncEvidence = input.syncEvidence || null;
  const syncRunning = Boolean(input.syncRunning);
  const businessToday = input.businessToday || defaultBusinessToday();
  const currentDayInProgress = input.requestedStartDate <= businessToday && input.requestedEndDate >= businessToday;
  const asOfTime = input.asOfTime || null;

  const base = {
    source: input.source,
    scopeKey: input.scopeKey,
    requestedStartDate: input.requestedStartDate,
    requestedEndDate: input.requestedEndDate,
    earliestAvailableDate,
    latestAvailableDate,
    rangeRowCount,
    structureRowCount,
    explicitRangeSyncSuccess: false,
    syncRunning,
    asOfTime,
    currentDayInProgress,
    syncEvidence
  };

  if (input.queryError) {
    return {
      ...base,
      status: "ERROR",
      message: "数据覆盖查询失败。",
      coverageComplete: false,
      coverageBasis: "QUERY_ERROR"
    };
  }

  if (syncRunning) {
    return {
      ...base,
      status: "SYNC_RUNNING",
      message: "当前筛选范围正在同步。",
      coverageComplete: false,
      coverageBasis: "RUNNING_SYNC"
    };
  }

  if (syncEvidence && isFailedReceipt(syncEvidence.status)) {
    return {
      ...base,
      status: "ERROR",
      message: "当前筛选范围最近一次同步失败。",
      coverageComplete: false,
      coverageBasis: "QUERY_ERROR"
    };
  }

  const receiptCoversRange = coversRequestedRange(
    syncEvidence?.rangeStart,
    syncEvidence?.rangeEnd,
    input.requestedStartDate,
    input.requestedEndDate
  );
  const receiptComplete = Boolean(
    syncEvidence &&
      isSuccessfulReceipt(syncEvidence.status) &&
      receiptCoversRange &&
      syncEvidence.failedCount === 0 &&
      input.truncated !== true &&
      input.coverageComplete === true
  );

  if (rangeRowCount > 0) {
    return {
      ...base,
      explicitRangeSyncSuccess: receiptComplete,
      status: receiptComplete ? "READY" : "PARTIAL_COVERAGE",
      message: receiptComplete
        ? currentDayInProgress
          ? "今日数据进行中。"
          : "当前筛选范围数据已完整同步。"
        : "当前筛选范围已有事实，但缺少完整同步回执。",
      coverageComplete: receiptComplete,
      coverageBasis: receiptComplete ? "FACT_ROWS_AND_SYNC_RECEIPT" : "FACT_ROWS_ONLY"
    };
  }

  const exactEmpty = Boolean(
    receiptComplete &&
      Number(syncEvidence?.recordsFetched || 0) === 0 &&
      Number(syncEvidence?.recordsSaved || 0) === 0
  );
  if (exactEmpty) {
    return {
      ...base,
      explicitRangeSyncSuccess: true,
      status: "TRUE_EMPTY",
      message: "当前筛选范围已完成同步，确认没有业务数据。",
      coverageComplete: true,
      coverageBasis: "EXACT_EMPTY_SYNC_RECEIPT"
    };
  }

  const hasPartialEvidence = Boolean(
    earliestAvailableDate ||
      latestAvailableDate ||
      syncEvidence?.failedCount ||
      input.truncated ||
      (syncEvidence && input.coverageComplete === false)
  );
  return {
    ...base,
    status: hasPartialEvidence ? "PARTIAL_COVERAGE" : "NOT_SYNCED",
    message: hasPartialEvidence
      ? "当前筛选范围缺少完整覆盖。"
      : "当前筛选范围尚未获得可证明的同步结果。",
    coverageComplete: false,
    coverageBasis: "FACT_ROWS_ONLY"
  };
}
