import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, syncCenterMock, uuidMock, refreshStoreLedgerMock } = vi.hoisted(() => ({
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
  refreshStoreLedgerMock: vi.fn()
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
vi.mock("../services/datacenter-store-ledger.service.js", () => ({ refreshStoreDataCenterLedger: refreshStoreLedgerMock }));
vi.mock("../services/datacenter-meta-ledger.service.js", () => ({ refreshMetaDataCenterLedger: vi.fn() }));
vi.mock("../services/meta-audience-breakdown-sync.service.js", () => ({ syncMetaAudienceBreakdown: vi.fn() }));
vi.mock("uuid", () => ({ v4: uuidMock }));

import router from "./sync.routes";

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
  refreshStoreLedgerMock.mockResolvedValue({ recordsSaved: 0 });
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
