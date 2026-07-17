import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ parentResult: null as any, childLogs: [] as any[] }));
const { prismaMock, syncCenterMock } = vi.hoisted(() => ({
  prismaMock: {
    adAccount: { count: vi.fn(), findMany: vi.fn() },
    store: { findUnique: vi.fn() },
    syncLog: { findMany: vi.fn(), findUnique: vi.fn() }
  },
  syncCenterMock: {
    runTask: vi.fn(),
    syncMetaStructure: vi.fn(),
    syncMetaAudience: vi.fn(),
    syncMetaInsights: vi.fn()
  }
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("./sync-center.service.js", () => ({ SyncCenter: syncCenterMock }));
vi.mock("../utils.js", () => ({ normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}` }));

import { executeSyncViewTask } from "./sync-view-task-executor.service";

beforeEach(() => {
  vi.clearAllMocks();
  state.parentResult = null;
  state.childLogs = [];
  const targets = [
    { fb_account_id: "act_1", storeId: 1 },
    { fb_account_id: "act_2", storeId: 1 }
  ];
  prismaMock.adAccount.count.mockResolvedValue(targets.length);
  prismaMock.adAccount.findMany.mockResolvedValue(targets);
  prismaMock.store.findUnique.mockResolvedValue({ id: 1, mode: "production", name: "Live Store", domain: "live.example.com" });
  prismaMock.syncLog.findMany.mockImplementation(async ({ where }: any) =>
    state.childLogs.filter(log => where.id.in.includes(log.id))
  );
  prismaMock.syncLog.findUnique.mockImplementation(async () => ({
    id: "parent",
    status: state.parentResult?.status === "FAILED" ? "failed" : "success",
    recordsFetched: state.parentResult?.recordsFetched || 0,
    recordsSaved: state.parentResult?.recordsSaved || 0,
    metadata: JSON.stringify({
      ...state.parentResult?.metadata,
      recordsUpdated: state.parentResult?.recordsUpdated || 0,
      failedAccounts: state.parentResult?.failedAccounts || [],
      failedSlices: state.parentResult?.failedSlices || [],
      truncated: Boolean(state.parentResult?.truncated),
      coverageComplete: state.parentResult?.coverageComplete !== false
    })
  }));
  syncCenterMock.runTask.mockImplementation(async (...args: any[]) => {
    state.parentResult = await args[7]();
    return "parent";
  });
  syncCenterMock.syncMetaStructure.mockResolvedValue("structure");
  syncCenterMock.syncMetaAudience.mockImplementation(async (_chain: string, _by: string, _parent: string, _days: number, accountId: string) => `audience-${accountId}`);
  syncCenterMock.syncMetaInsights.mockImplementation(async (_chain: string, _by: string, _parent: string, _days: number, accountId: string) => `creative-${accountId}`);
});

describe("canonical view task executor", () => {
  it("uses the canonical audience task for every safe account", async () => {
    state.childLogs = ["act_1", "act_2"].map(accountId => ({
      id: `audience-${accountId}`,
      status: "success",
      recordsFetched: 1,
      recordsSaved: 1,
      metadata: JSON.stringify({ recordsUpdated: 0, coverageComplete: true, dimensionsSynced: ["country", "age", "gender", "publisher_platform"] })
    }));

    const result = await executeSyncViewTask({
      taskType: "sync_view_audience",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      days: 7,
      chainId: "chain"
    });

    expect(syncCenterMock.syncMetaAudience).toHaveBeenCalledTimes(2);
    expect(syncCenterMock.syncMetaInsights).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "SUCCESS", recordsFetched: 2, recordsSaved: 2, coverageComplete: true });
  });

  it("SYNC-01 eligible count greater than selected sets truncated", async () => {
    prismaMock.adAccount.count.mockResolvedValue(3);
    prismaMock.adAccount.findMany.mockResolvedValue([{ fb_account_id: "act_1", storeId: 1 }]);
    state.childLogs = [
      { id: "audience-act_1", status: "success", recordsFetched: 1, recordsSaved: 1, metadata: JSON.stringify({ recordsUpdated: 0, coverageComplete: true }) }
    ];

    const result = await executeSyncViewTask({
      taskType: "sync_view_audience",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      days: 7,
      chainId: "chain",
      limit: 1
    });

    expect(result.truncated).toBe(true);
    expect(result.coverageComplete).toBe(false);
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(result.targetAccountsCount).toBe(1);
    expect(result.eligibleTargetAccountsCount).toBe(3);
  });

  it("SYNC-02 truncated sets coverageComplete false", async () => {
    prismaMock.adAccount.count.mockResolvedValue(2);
    prismaMock.adAccount.findMany.mockResolvedValue([{ fb_account_id: "act_1", storeId: 1 }]);
    state.childLogs = [
      { id: "audience-act_1", status: "success", recordsFetched: 1, recordsSaved: 1, metadata: JSON.stringify({ recordsUpdated: 0, coverageComplete: true }) }
    ];

    const result = await executeSyncViewTask({
      taskType: "sync_view_audience",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      days: 7,
      chainId: "chain",
      limit: 1
    });

    expect(result.coverageComplete).toBe(false);
    expect(syncCenterMock.runTask.mock.calls[0][8]).toMatchObject({ coverageComplete: false });
  });

  it("SYNC-06 specified sandbox store rejected", async () => {
    prismaMock.store.findUnique.mockResolvedValue({ id: 9, mode: "sandbox", name: "Sandbox", domain: "sandbox.example.com" });

    await expect(executeSyncViewTask({
      taskType: "sync_view_audience",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      days: 7,
      chainId: "chain",
      storeId: 9
    })).rejects.toMatchObject({ code: "SANDBOX_STORE_EXCLUDED" });
    expect(prismaMock.adAccount.findMany).not.toHaveBeenCalled();
  });

  it("keeps successful creative rows and reports PARTIAL_SUCCESS for a failed account", async () => {
    state.childLogs = [
      { id: "structure", status: "success", recordsFetched: 1, recordsSaved: 1, metadata: JSON.stringify({ coverageComplete: true }) },
      { id: "creative-act_1", status: "success", recordsFetched: 2, recordsSaved: 2, metadata: JSON.stringify({ coverageComplete: true }) },
      { id: "creative-act_2", status: "failed", recordsFetched: 0, recordsSaved: 0, metadata: JSON.stringify({ coverageComplete: false, failedAccounts: [{ accountId: "act_2" }] }) }
    ];

    const result = await executeSyncViewTask({
      taskType: "sync_view_creatives",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      days: 7,
      chainId: "chain"
    });

    expect(syncCenterMock.syncMetaStructure).toHaveBeenCalledTimes(1);
    expect(syncCenterMock.syncMetaInsights).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(result.recordsSaved).toBe(3);
    expect(result.failedAccounts).toEqual([{ accountId: "act_2" }]);
    expect(result.coverageComplete).toBe(false);
  });
});
