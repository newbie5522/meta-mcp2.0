import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, syncStoreOrdersMock, refreshLedgerMock } = vi.hoisted(() => ({
  prismaMock: {
    syncLog: { findUnique: vi.fn() }
  },
  syncStoreOrdersMock: vi.fn(),
  refreshLedgerMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("./sync-center.service.js", () => ({ SyncCenter: { syncStoreOrders: syncStoreOrdersMock } }));
vi.mock("./datacenter-store-ledger.service.js", () => ({ refreshStoreDataCenterLedger: refreshLedgerMock }));

import { executeStoreDataPipeline } from "./store-data-pipeline.service";

const store = { id: 1, name: "Store 1", platform: "shopify", timezone: "America/New_York" };

beforeEach(() => {
  vi.clearAllMocks();
  syncStoreOrdersMock.mockResolvedValue("task-1");
  prismaMock.syncLog.findUnique.mockResolvedValue({
    id: "task-1",
    status: "success",
    recordsFetched: 2,
    recordsSaved: 2,
    metadata: JSON.stringify({
      recordsUpdated: 0,
      timezone: "America/New_York",
      timezoneSource: "platform_shop_api",
      coverageComplete: true
    })
  });
  refreshLedgerMock.mockResolvedValue({
    recordsFetched: 2,
    recordsSaved: 1,
    uniqueOrderCount: 2
  });
});

describe("single canonical store data pipeline", () => {
  it("runs order sync before Order-only ledger projection", async () => {
    const receipt = await executeStoreDataPipeline({
      store,
      chainId: "chain-1",
      triggeredBy: "test",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      days: 2
    });

    expect(syncStoreOrdersMock).toHaveBeenCalledWith(
      1,
      "chain-1",
      "test",
      null,
      2,
      "2026-07-01",
      "2026-07-02",
      { baselineRevenue: undefined, rebuild: false }
    );
    expect(refreshLedgerMock).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 1,
      rangeVerified: true
    }));
    expect(receipt).toMatchObject({
      status: "SUCCESS",
      orderSync: { taskId: "task-1", recordsFetched: 2, recordsSaved: 2 },
      ledger: { source: "Order", dateField: "Order.store_local_date", uniqueOrderCount: 2 }
    });
  });

  it("returns PARTIAL_SUCCESS when ledger fails after order sync succeeds", async () => {
    refreshLedgerMock.mockRejectedValue(new Error("ledger failed"));
    const receipt = await executeStoreDataPipeline({
      store,
      chainId: "chain-1",
      triggeredBy: "test",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      days: 2
    });
    expect(receipt.status).toBe("PARTIAL_SUCCESS");
    expect(receipt.ledger.status).toBe("FAILED");
  });
});
