import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, refreshMeta, refreshStore, executeView } = vi.hoisted(() => ({
  prismaMock: {
    dataCenterRefreshRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    store: { findMany: vi.fn(), findUnique: vi.fn() },
    dataCenterStoreDaily: { count: vi.fn() }
  },
  refreshMeta: vi.fn(),
  refreshStore: vi.fn(),
  executeView: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("./datacenter-meta-ledger.service.js", () => ({ refreshMetaDataCenterLedger: refreshMeta }));
vi.mock("./store-data-pipeline.service.js", () => ({ executeStoreDataPipeline: refreshStore }));
vi.mock("./sync-view-task-executor.service.js", () => ({ executeSyncViewTask: executeView }));

import { ensureDataCenterFreshness, ensureDataCenterViewFreshness } from "./data-center-auto-refresh.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dataCenterRefreshRun.findFirst.mockResolvedValue(null);
  prismaMock.dataCenterRefreshRun.create.mockResolvedValue({ id: "run-1" });
  prismaMock.dataCenterRefreshRun.update.mockResolvedValue({});
  prismaMock.store.findMany.mockResolvedValue([{ id: 1, name: "Store 1" }]);
  prismaMock.store.findUnique.mockResolvedValue({ id: 1, name: "Store 1", mode: "production", domain: "live.example.com" });
  refreshMeta.mockResolvedValue({ recordsFetched: 1, recordsSaved: 1, recordsUpdated: 0, failedAccounts: [] });
  refreshStore.mockResolvedValue({
    status: "SUCCESS",
    orderSync: { error: null },
    ledger: { status: "SUCCESS", uniqueOrderCount: 1, recordsSaved: 1, error: null },
    failedSlices: []
  });
  executeView.mockImplementation(async ({ taskType }: any) => ({
    taskType,
    status: "SUCCESS",
    recordsFetched: 1,
    recordsSaved: 1,
    recordsUpdated: 0,
    failedAccounts: [],
    failedSlices: [],
    truncated: false
  }));
});

describe("data center refresh scheduling", () => {
  it("keeps the light cycle limited to account and store ledgers", async () => {
    const result = await ensureDataCenterFreshness({
      force: true,
      mode: "blocking",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03"
    });

    expect(refreshMeta).toHaveBeenCalledTimes(1);
    expect(refreshStore).toHaveBeenCalledTimes(1);
    expect(executeView).not.toHaveBeenCalled();
    expect(result.status).toBe("SUCCESS");
  });

  it("runs audience and creative through the same canonical view executor", async () => {
    const result = await ensureDataCenterViewFreshness({
      force: true,
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03"
    });

    expect(executeView).toHaveBeenNthCalledWith(1, expect.objectContaining({ taskType: "sync_view_audience" }));
    expect(executeView).toHaveBeenNthCalledWith(2, expect.objectContaining({ taskType: "sync_view_creatives" }));
    expect(result.status).toBe("SUCCESS");
  });

  it("returns PARTIAL_SUCCESS when one view source fails after another saves rows", async () => {
    executeView
      .mockResolvedValueOnce({ taskType: "sync_view_audience", status: "SUCCESS", recordsFetched: 2, recordsSaved: 2, recordsUpdated: 0, failedAccounts: [], failedSlices: [], truncated: false })
      .mockResolvedValueOnce({ taskType: "sync_view_creatives", status: "FAILED", recordsFetched: 0, recordsSaved: 0, recordsUpdated: 0, failedAccounts: [{ accountId: "act_2" }], failedSlices: [], truncated: false });

    const result = await ensureDataCenterViewFreshness({ force: true, requestedStartDate: "2026-07-01", requestedEndDate: "2026-07-03" });
    expect(result.status).toBe("PARTIAL_SUCCESS");
  });

  it("distinguishes all-success empty from all-failed empty", async () => {
    executeView.mockResolvedValue({ taskType: "view", status: "NO_NEW_DATA", recordsFetched: 0, recordsSaved: 0, recordsUpdated: 0, failedAccounts: [], failedSlices: [], truncated: false });
    const empty = await ensureDataCenterViewFreshness({ force: true, requestedStartDate: "2026-07-01", requestedEndDate: "2026-07-03" });
    expect(empty.status).toBe("NO_NEW_DATA");

    executeView.mockResolvedValue({ taskType: "view", status: "FAILED", recordsFetched: 0, recordsSaved: 0, recordsUpdated: 0, failedAccounts: [{ accountId: "act_1" }], failedSlices: [], truncated: false });
    const failed = await ensureDataCenterViewFreshness({ force: true, requestedStartDate: "2026-07-01", requestedEndDate: "2026-07-03" });
    expect(failed.status).toBe("FAILED");
  });

  it("uses store-scoped locks for view refresh runs", async () => {
    prismaMock.dataCenterRefreshRun.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "running-store-1" });

    const result = await ensureDataCenterViewFreshness({
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03",
      storeId: 1
    });

    expect(result).toMatchObject({
      skipped: true,
      status: "RUNNING",
      reason: "AUTO_VIEW_REFRESH_ALREADY_RUNNING",
      scope: "store:1"
    });
    expect(prismaMock.dataCenterRefreshRun.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ scope: "store:1", startDate: "2026-07-01", endDate: "2026-07-03" })
    }));
    expect(prismaMock.dataCenterRefreshRun.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ scope: "store:1", status: "running" })
    }));
    expect(executeView).not.toHaveBeenCalled();
  });

  it("SYNC-07 all-store excludes sandbox", async () => {
    await ensureDataCenterFreshness({
      force: true,
      mode: "blocking",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03"
    });

    expect(prismaMock.store.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        NOT: expect.arrayContaining([
          { mode: "sandbox" }
        ])
      })
    });
  });

  it("SYNC-08 interval not due is SKIPPED", async () => {
    prismaMock.dataCenterRefreshRun.findFirst.mockResolvedValueOnce({ id: "recent" });

    const result = await ensureDataCenterViewFreshness({
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03"
    });

    expect(result).toMatchObject({
      skipped: true,
      status: "SKIPPED",
      reason: "AUTO_VIEW_REFRESH_INTERVAL_NOT_DUE"
    });
  });

  it("SYNC-09 light refresh store/date scoped lock", async () => {
    prismaMock.dataCenterRefreshRun.findFirst.mockResolvedValueOnce({ id: "running-light" });

    await ensureDataCenterFreshness({
      mode: "background",
      storeId: 1,
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03"
    });

    expect(prismaMock.dataCenterRefreshRun.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        type: "auto_light_refresh",
        scope: "store:1",
        startDate: "2026-07-01",
        endDate: "2026-07-03"
      })
    });
  });

  it("checks blocking_if_missing by store and requested date range", async () => {
    prismaMock.dataCenterStoreDaily.count.mockResolvedValue(1);

    const result = await ensureDataCenterFreshness({
      mode: "blocking_if_missing",
      storeId: 1,
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03"
    });

    expect(prismaMock.dataCenterStoreDaily.count).toHaveBeenCalledWith({
      where: {
        storeId: 1,
        date: { gte: "2026-07-01", lte: "2026-07-03" }
      }
    });
    expect(result).toMatchObject({ status: "SKIPPED", reason: "BACKGROUND_TRIGGERED" });
  });

  it("marks light refresh PARTIAL when Meta ledger reports failed accounts", async () => {
    refreshMeta.mockResolvedValue({
      recordsFetched: 1,
      recordsSaved: 1,
      recordsUpdated: 0,
      failedAccounts: [{ accountId: "act_1", message: "slice failed" }]
    });

    const result = await ensureDataCenterFreshness({
      force: true,
      mode: "blocking",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-03"
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.meta?.failedAccounts).toEqual([{ accountId: "act_1", message: "slice failed" }]);
  });
});
