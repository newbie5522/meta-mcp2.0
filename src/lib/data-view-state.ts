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
  "返回数据日期范围与当前筛选不一致，已保留上次成功数据。";

export const CURRENT_RANGE_NOT_READY_MESSAGE =
  "当前周期数据未就绪，仍展示上次成功数据。";

export function getPayloadStatus(payload: any) {
  return String(
    payload?.dataHealth?.status ||
    payload?.health?.status ||
    payload?.status ||
    ""
  ).toUpperCase();
}

export function shouldPreserveLastGoodData(payload: any, rows: any[], lastGoodData: any) {
  const status = getPayloadStatus(payload);
  return Boolean(lastGoodData && rows.length === 0 && DATA_VIEW_PRESERVE_STATUSES.has(status));
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
