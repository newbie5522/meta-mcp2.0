import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, syncCenterMock, uuidMock, executeStoreDataPipelineMock } = vi.hoisted(() => ({
  prismaMock: {
    syncLog: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn()
    },
    store: { findMany: vi.fn() }
  },
  syncCenterMock: {
    syncMetaAccounts: vi.fn(),
    syncMetaActivity: vi.fn(),
    syncStoreOrders: vi.fn()
  },
  uuidMock: vi.fn(),
  executeStoreDataPipelineMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock("../services/sync-center.service.js", () => ({ SyncCenter: syncCenterMock }));
vi.mock("../utils.js", () => ({ getMetaToken: vi.fn(), normalizeMetaAccountId: (value: string) => value }));
vi.mock("../services/store-sync.service.js", () => ({ syncStoreData: vi.fn() }));
vi.mock("../services/meta-insights.service.js", () => ({ syncMetaInsightsForActiveAccounts: vi.fn() }));
vi.mock("../services/store-ledger.service.js", () => ({ rebuiltStoreOrderSummary: vi.fn(), rebuildStoreLedgerForRange: vi.fn() }));
vi.mock("../services/meta-ledger.service.js", () => ({ cleanMetaAccountFactsForRange: vi.fn() }));
vi.mock("../services/meta-realtime-sync.service.js", () => ({ syncMetaAccountSpendRealtime: vi.fn() }));
vi.mock("../services/order-fact.service.js", () => ({ getStoreOrderSummary: vi.fn() }));
vi.mock("../services/store-data-pipeline.service.js", () => ({ executeStoreDataPipeline: executeStoreDataPipelineMock }));
vi.mock("../services/datacenter-meta-ledger.service.js", () => ({ refreshMetaDataCenterLedger: vi.fn() }));
vi.mock("../services/meta-audience-breakdown-sync.service.js", () => ({ syncMetaAudienceBreakdown: vi.fn() }));
vi.mock("uuid", () => ({ v4: uuidMock }));

import router, { deriveSyncStatus } from "./sync.routes";

function responseMock() {
  const response: any = {
    statusCode: 200,
    body: null,
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    })
  };
  return response;
}

async function invokeTrigger(body: Record<string, unknown>) {
  const layer = (router as any).stack.find((candidate: any) => candidate.route?.path === "/sync/trigger");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const response = responseMock();
  await handler({ body }, response);
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENABLE_MANUAL_SYNC;
  uuidMock.mockReturnValue("chain-test");
  prismaMock.syncLog.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.syncLog.findFirst.mockResolvedValue(null);
  prismaMock.syncLog.findMany.mockResolvedValue([]);
  prismaMock.store.findMany.mockResolvedValue([{
    id: 1,
    name: "Test Store",
    platform: "shopify",
    mode: "production",
    shopify_token: "test-token"
  }]);
  syncCenterMock.syncMetaAccounts.mockResolvedValue("task-accounts");
  syncCenterMock.syncMetaActivity.mockResolvedValue("task-activity");
  syncCenterMock.syncStoreOrders.mockResolvedValue("task-store");
  executeStoreDataPipelineMock.mockResolvedValue({
    storeId: 1,
    status: "SUCCESS",
    orderSync: {
      taskId: "task-store",
      status: "SUCCESS",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      coverageComplete: true,
      truncated: false,
      error: null
    },
    ledger: {
      status: "SUCCESS",
      source: "Order",
      dateField: "Order.store_local_date",
      recordsFetched: 0,
      recordsSaved: 0,
      uniqueOrderCount: 0,
      error: null
    },
    failedSlices: []
  });
});

describe("deriveSyncStatus", () => {
  it("returns NO_NEW_DATA when there are no failures or records", () => {
    expect(deriveSyncStatus({
      hasFailedTask: false,
      failedAccounts: [],
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0
    })).toBe("NO_NEW_DATA");
  });

  it("returns SUCCESS when records exist without failures", () => {
    expect(deriveSyncStatus({
      hasFailedTask: false,
      failedAccounts: [],
      recordsFetched: 1,
      recordsSaved: 0,
      recordsUpdated: 0
    })).toBe("SUCCESS");
  });

  it("returns PARTIAL_SUCCESS when failures and records both exist", () => {
    expect(deriveSyncStatus({
      hasFailedTask: true,
      failedAccounts: [{ accountId: "account-1", message: "partial failure" }],
      recordsFetched: 1,
      recordsSaved: 0,
      recordsUpdated: 0
    })).toBe("PARTIAL_SUCCESS");
  });

  it("returns FAILED when a failure has no records", () => {
    expect(deriveSyncStatus({
      hasFailedTask: true,
      failedAccounts: [{ accountId: "account-1", message: "sync failed" }],
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0
    })).toBe("FAILED");
  });

  it("treats failed slices as PARTIAL_SUCCESS when records exist", () => {
    expect(deriveSyncStatus({
      hasFailedTask: false,
      failedAccounts: [],
      failedSlices: [{ accountId: "act_1", slice: "2026-07-01" }],
      truncated: false,
      coverageComplete: true,
      recordsFetched: 3,
      recordsSaved: 3,
      recordsUpdated: 0
    })).toBe("PARTIAL_SUCCESS");
  });

  it("treats truncated or incomplete coverage as FAILED without saved records", () => {
    expect(deriveSyncStatus({
      hasFailedTask: false,
      failedAccounts: [],
      failedSlices: [],
      truncated: true,
      coverageComplete: false,
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0
    })).toBe("FAILED");
  });
});

describe("POST /sync/trigger derived status", () => {
  it("returns a neutral NO_NEW_DATA success response", async () => {
    const response = await invokeTrigger({ taskType: "sync_view_products" });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("NO_NEW_DATA");
    expect(response.body.message).toContain("没有新的订单数据");
  });

  it("returns HTTP 500 and the failure contract for a failed task with no records", async () => {
    prismaMock.syncLog.findMany.mockResolvedValue([{
      status: "failed",
      recordsFetched: 0,
      recordsSaved: 0,
      metadata: {
        message: "Store order sync failed",
        failedAccounts: [{ accountId: "store-1", message: "token expired" }]
      }
    }]);

    const response = await invokeTrigger({ taskType: "sync_view_products" });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      status: "FAILED",
      error: "SYNC_TASK_FAILED",
      message: "Store order sync failed",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      failedAccounts: [{ accountId: "store-1", message: "token expired" }],
      chainId: "chain-test",
      taskType: "sync_view_products",
      taskIds: ["task-store"]
    });
  });

  it("returns a warning PARTIAL_SUCCESS response when records and failures coexist", async () => {
    prismaMock.syncLog.findMany.mockResolvedValue([{
      status: "failed",
      recordsFetched: 1,
      recordsSaved: 1,
      metadata: {
        failedAccounts: [{ accountId: "store-1", message: "one page failed" }]
      }
    }]);

    const response = await invokeTrigger({ taskType: "sync_view_products" });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("PARTIAL_SUCCESS");
    expect(response.body.message).toContain("部分任务执行失败");
  });

  it("surfaces slice coverage fields in partial success responses", async () => {
    prismaMock.syncLog.findMany.mockResolvedValue([{
      status: "success",
      recordsFetched: 2,
      recordsSaved: 2,
      metadata: {
        failedSlices: [{ accountId: "act_1", slice: "creative:2" }],
        truncated: true,
        coverageComplete: false
      }
    }]);

    const response = await invokeTrigger({ taskType: "sync_view_products" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      status: "PARTIAL_SUCCESS",
      failedSlices: [{ accountId: "act_1", slice: "creative:2" }],
      truncated: true,
      coverageComplete: false
    });
  });
});

describe("POST /sync/trigger manual guard", () => {
  it("allows a safe view task when manual sync is disabled", async () => {
    const response = await invokeTrigger({ taskType: "sync_view_products" });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.taskType).toBe("sync_view_products");
    expect(uuidMock).toHaveBeenCalledOnce();
  });

  it("returns 403 for a direct sync before any task work", async () => {
    const response = await invokeTrigger({ taskType: "sync_meta_accounts" });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: "MANUAL_SYNC_DISABLED",
      message: "Manual sync is disabled."
    });
    expect(uuidMock).not.toHaveBeenCalled();
    expect(prismaMock.syncLog.updateMany).not.toHaveBeenCalled();
    expect(syncCenterMock.syncMetaAccounts).not.toHaveBeenCalled();
  });

  it("returns 403 for rebuild and baseline options on otherwise safe tasks", async () => {
    const rebuildResponse = await invokeTrigger({ taskType: "sync_view_products", rebuild: true });
    const baselineResponse = await invokeTrigger({ taskType: "sync_view_products", baselineRevenue: 0 });

    expect(rebuildResponse.statusCode).toBe(403);
    expect(baselineResponse.statusCode).toBe(403);
    expect(uuidMock).not.toHaveBeenCalled();
  });

  it("allows a direct task when ENABLE_MANUAL_SYNC is true", async () => {
    process.env.ENABLE_MANUAL_SYNC = "true";

    const response = await invokeTrigger({ taskType: "sync_meta_accounts" });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(syncCenterMock.syncMetaAccounts).toHaveBeenCalled();
    expect(syncCenterMock.syncMetaActivity).toHaveBeenCalled();
  });
});
