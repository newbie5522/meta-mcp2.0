import { describe, expect, it } from "vitest";
import { isManualSyncRequired, SAFE_VIEW_SYNC_TASKS } from "./sync-manual-guard";

describe("manual sync guard", () => {
  it("allows exactly the six safe view tasks without the manual flag", () => {
    expect(Array.from(SAFE_VIEW_SYNC_TASKS)).toEqual([
      "sync_view_ad_hierarchy",
      "sync_view_audience",
      "sync_view_creatives",
      "sync_view_account_data",
      "sync_view_store_data",
      "sync_view_products"
    ]);
    for (const taskType of SAFE_VIEW_SYNC_TASKS) {
      expect(isManualSyncRequired({ taskType })).toBe(false);
    }
  });

  it("requires manual sync for direct, ledger refresh, rebuild, baseline and unknown tasks", () => {
    expect(isManualSyncRequired({ taskType: "sync_store_orders" })).toBe(true);
    expect(isManualSyncRequired({ taskType: "refresh_store_datacenter_ledger" })).toBe(true);
    expect(isManualSyncRequired({ taskType: "sync_view_products", rebuild: true })).toBe(true);
    expect(isManualSyncRequired({ taskType: "sync_view_products", rebuild: "true" })).toBe(true);
    expect(isManualSyncRequired({ taskType: "sync_view_products", baselineRevenue: 0 })).toBe(true);
    expect(isManualSyncRequired({ taskType: "unknown_task" })).toBe(true);
  });
});
