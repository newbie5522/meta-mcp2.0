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
vi.mock("./datacenter-store-ledger.service.js", () => ({ refreshStoreDataCenterLedger: refreshStore }));
vi.mock("./sync-view-task-executor.service.js", () => ({ executeSyncViewTask: executeView }));

import { ensureDataCenterFreshness, ensureDataCenterViewFreshness } from "./data-center-auto-refresh.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dataCenterRefreshRun.findFirst.mockResolvedValue(null);
  prismaMock.dataCenterRefreshRun.create.mockResolvedValue({ id: "run-1" });
  prismaMock.dataCenterRefreshRun.update.mockResolvedValue({});
  prismaMock.store.findMany.mockResolvedValue([{ id: 1, name: "Store 1" }]);
  refreshMeta.mockResolvedValue({ recordsFetched: 1, recordsSaved: 1, recordsUpdated: 0, failedAccounts: [] });
  refreshStore.mockResolvedValue({ snapshots: [{ orderCount: 1 }] });
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
});
