export const SAFE_VIEW_SYNC_TASKS = new Set<string>([
  "sync_view_ad_hierarchy",
  "sync_view_audience",
  "sync_view_creatives",
  "sync_view_account_data",
  "sync_view_store_data",
  "sync_view_products"
]);

export function isManualSyncRequired(input: {
  taskType: string;
  rebuild?: unknown;
  baselineRevenue?: unknown;
}): boolean {
  if (input.rebuild === true || input.rebuild === "true") return true;
  if (
    input.baselineRevenue !== undefined &&
    input.baselineRevenue !== null &&
    input.baselineRevenue !== ""
  ) return true;
  return !SAFE_VIEW_SYNC_TASKS.has(String(input.taskType || ""));
}
