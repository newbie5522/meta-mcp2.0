export const DATA_VIEW_PRESERVE_STATUSES = new Set([
  "SYNC_RUNNING",
  "NO_NEW_DATA",
  "STRUCTURE_WITHOUT_FACTS",
  "MISSING_META_BREAKDOWN",
  "META_BREAKDOWN_NOT_READY",
  "EMPTY_FACTS",
  "EMPTY",
  "EMPTY_STRUCTURE"
]);

export const DATE_RANGE_MISMATCH_MESSAGE =
  "接口返回周期与当前筛选周期不一致，已保留同一请求下的上次成功数据。";

export const CURRENT_RANGE_NOT_READY_MESSAGE =
  "当前请求暂无可展示的新数据，已保留同一请求下的上次成功数据。";

type RequestKeyParts = Record<string, unknown>;

function normalizeRequestKeyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "all";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRequestKeyValue).join(",");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function buildDataViewRequestKey(parts: RequestKeyParts) {
  return Object.keys(parts)
    .sort()
    .map((key) => `${key}:${normalizeRequestKeyValue(parts[key])}`)
    .join("|");
}

export function getPayloadStatus(payload: any) {
  return String(
    payload?.dataHealth?.status ||
    payload?.health?.status ||
    payload?.status ||
    ""
  ).toUpperCase();
}

export function shouldPreserveLastGoodData(
  payload: any,
  rows: any[],
  lastGoodData: any,
  currentRequestKey: string
) {
  const status = getPayloadStatus(payload);
  return Boolean(
    lastGoodData &&
      lastGoodData.requestKey === currentRequestKey &&
      rows.length === 0 &&
      DATA_VIEW_PRESERVE_STATUSES.has(status)
  );
}

export function makeLastGoodData(
  requestKey: string,
  data: any,
  meta: Record<string, unknown> = {}
) {
  return {
    requestKey,
    data,
    ...meta
  };
}

export function responseDateRangeMatches(payload: any, startDate: string, endDate: string) {
  const responseStart =
    payload?.appliedFilters?.startDate ||
    payload?.dateRange?.startDate ||
    payload?.dataHealth?.dateRange?.startDate ||
    payload?.health?.dateRange?.startDate ||
    payload?.startDate;
  const responseEnd =
    payload?.appliedFilters?.endDate ||
    payload?.dateRange?.endDate ||
    payload?.dataHealth?.dateRange?.endDate ||
    payload?.health?.dateRange?.endDate ||
    payload?.endDate;

  if (!responseStart || !responseEnd) return true;
  return String(responseStart) === startDate && String(responseEnd) === endDate;
}

export function isDateRangeMismatch(payload: any, startDate: string, endDate: string) {
  return !responseDateRangeMatches(payload, startDate, endDate);
}
