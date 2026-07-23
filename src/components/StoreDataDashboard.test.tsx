import { describe, expect, it } from "vitest";
import { buildDataViewRequestKey, isDateRangeMismatch, shouldApplyLatestRequest } from "../lib/data-view-state";
import {
  formatStoreAovText,
  formatStoreOrderText,
  formatStoreSalesText,
  getStoreSyncStatusLabel
} from "./StoreDataDashboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Store page request contract", () => {
  it("STORE-01 old main response ignored", () => {
    expect(shouldApplyLatestRequest({
      requestId: 1,
      latestRequestId: 2,
      sourceRequestKey: "stores:old",
      latestRequestKey: "stores:new"
    })).toBe(false);
  });

  it("RC-03 ignores an older deferred reconciliation response after a newer one wins", async () => {
    const oldRecon = deferred<{ storeId: number; dateRange: { startDate: string; endDate: string } }>();
    const newRecon = deferred<{ storeId: number; dateRange: { startDate: string; endDate: string } }>();
    const latestRequestId = 2;
    const latestRequestKey = buildDataViewRequestKey({
      page: "store-reconciliation",
      storeId: 2,
      startDate: "2026-07-08",
      endDate: "2026-07-14"
    });

    newRecon.resolve({ storeId: 2, dateRange: { startDate: "2026-07-08", endDate: "2026-07-14" } });
    await newRecon.promise;
    expect(shouldApplyLatestRequest({
      requestId: 2,
      latestRequestId,
      sourceRequestKey: latestRequestKey,
      latestRequestKey
    })).toBe(true);

    oldRecon.resolve({ storeId: 1, dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } });
    await oldRecon.promise;
    expect(shouldApplyLatestRequest({
      requestId: 1,
      latestRequestId,
      sourceRequestKey: buildDataViewRequestKey({
        page: "store-reconciliation",
        storeId: 1,
        startDate: "2026-07-01",
        endDate: "2026-07-07"
      }),
      latestRequestKey
    })).toBe(false);
  });

  it("RC-03 rejects reconciliation payloads for a different date range", () => {
    expect(isDateRangeMismatch(
      { dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" } },
      "2026-07-08",
      "2026-07-14"
    )).toBe(true);
  });

  it("STORE-03 request key excludes local search and sort", () => {
    const key = buildDataViewRequestKey({
      page: "stores",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      scope: "all_stores"
    });

    expect(key).toContain("page:stores");
    expect(key).not.toContain("search");
    expect(key).not.toContain("sort");
  });

  it("Romanticed partial rows keep real order, sales, and AOV values", () => {
    const row = { orderCount: 3, grossSales: 150, aov: 50, syncStatus: "PARTIAL_SUCCESS" };

    expect(formatStoreOrderText(row)).toBe("3 单");
    expect(formatStoreSalesText(row)).toBe("$150.00");
    expect(formatStoreAovText(row)).toBe("$50.00");
    expect(getStoreSyncStatusLabel(row.syncStatus)).toBe("部分完成");
  });

  it("distinguishes zero orders from unsynced order fields", () => {
    expect(formatStoreOrderText({ orderCount: 0 })).toBe("0 单");
    expect(formatStoreSalesText({ grossSales: 0 })).toBe("$0.00");
    expect(formatStoreAovText({ aov: 0 })).toBe("$0.00");
    expect(formatStoreOrderText({ orderCount: null })).toBe("未同步");
    expect(formatStoreSalesText({ grossSales: null })).toBe("未同步");
  });

  it("FAILED is not displayed as no orders", () => {
    expect(getStoreSyncStatusLabel("FAILED")).toBe("同步失败");
    expect(formatStoreOrderText({ orderCount: null })).toBe("未同步");
  });

  it("NO_NEW_DATA uses a neutral synced status label", () => {
    expect(getStoreSyncStatusLabel("NO_NEW_DATA")).toBe("已同步，无新数据");
  });
});
