export const DATA_VIEW_PRESERVE_STATUSES = new Set(["SYNC_RUNNING"]);

export const DATE_RANGE_MISMATCH_MESSAGE =
  "接口返回周期与当前筛选周期不一致，当前数据已清空。";

export const CURRENT_RANGE_NOT_READY_MESSAGE =
  "正在同步；当前展示的是同一筛选范围上次成功结果。";

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
    payload?.coverage?.status ||
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
      status === "SYNC_RUNNING" &&
      payload?.allowStaleWhileRunning === true
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

export function canUseLastGoodData(lastGoodData: any, currentRequestKey: string) {
  return Boolean(
    lastGoodData &&
      currentRequestKey &&
      lastGoodData.requestKey === currentRequestKey
  );
}

export function getSafeLastGoodData(lastGoodData: any, currentRequestKey: string) {
  return canUseLastGoodData(lastGoodData, currentRequestKey) ? lastGoodData : null;
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
