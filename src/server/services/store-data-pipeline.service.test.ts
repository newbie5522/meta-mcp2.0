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
      coverageComplete: true,
      truncated: false,
      failedSlices: [],
      status: "SUCCESS"
    }),
    finishedAt: new Date("2026-07-02T01:00:00.000Z")
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
    expect(refreshLedgerMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceSyncTaskId: "task-1",
      sourceSyncFinishedAt: expect.any(Date)
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

  it("PIPE-03 truncated sync skips ledger refresh and returns PARTIAL_SUCCESS", async () => {
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      status: "success",
      recordsFetched: 2,
      recordsSaved: 2,
      metadata: JSON.stringify({
        coverageComplete: false,
        truncated: true,
        failedSlices: [],
        status: "PARTIAL_SUCCESS"
      })
    });

    const receipt = await executeStoreDataPipeline({
      store,
      chainId: "chain-1",
      triggeredBy: "test",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      days: 2
    });

    expect(refreshLedgerMock).not.toHaveBeenCalled();
    expect(receipt.status).toBe("PARTIAL_SUCCESS");
    expect(receipt.ledger.status).toBe("SKIPPED");
  });

  it("PIPE-04 failedSlices prevent verified range ledger coverage", async () => {
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      status: "success",
      recordsFetched: 2,
      recordsSaved: 2,
      metadata: JSON.stringify({
        coverageComplete: true,
        truncated: false,
        failedSlices: [{ page: 2 }],
        status: "PARTIAL_SUCCESS"
      })
    });

    const receipt = await executeStoreDataPipeline({
      store,
      chainId: "chain-1",
      triggeredBy: "test",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      days: 2
    });

    expect(refreshLedgerMock).not.toHaveBeenCalled();
    expect(receipt.status).toBe("PARTIAL_SUCCESS");
    expect(receipt.ledger.status).toBe("SKIPPED");
    expect(receipt.failedSlices).toEqual([{ page: 2 }]);
  });

  it("PIPE-05 RUNNING/PENDING skips ledger refresh", async () => {
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      status: "running",
      recordsFetched: 0,
      recordsSaved: 0,
      metadata: JSON.stringify({})
    });

    const receipt = await executeStoreDataPipeline({
      store,
      chainId: "chain-1",
      triggeredBy: "test",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      days: 2
    });

    expect(refreshLedgerMock).not.toHaveBeenCalled();
    expect(receipt.status).toBe("RUNNING");
    expect(receipt.ledger.status).toBe("SKIPPED");
  });

  it("PIPE-06 verified NO_NEW_DATA is explicit before allowing zero-day ledger", async () => {
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      status: "success",
      recordsFetched: 0,
      recordsSaved: 0,
      metadata: JSON.stringify({
        coverageComplete: true,
        truncated: false,
        failedSlices: [],
        status: "NO_NEW_DATA"
      })
    });

    const receipt = await executeStoreDataPipeline({
      store,
      chainId: "chain-1",
      triggeredBy: "test",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      days: 2
    });

    expect(refreshLedgerMock).toHaveBeenCalledWith(expect.objectContaining({
      rangeVerified: true
    }));
    expect(receipt.status).toBe("NO_NEW_DATA");
  });

  it("returns FAILED for true order sync exceptions without wrapping as no data", async () => {
    syncStoreOrdersMock.mockRejectedValue(new Error("orders unavailable"));

    const receipt = await executeStoreDataPipeline({
      store,
      chainId: "chain-1",
      triggeredBy: "test",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      days: 2
    });

    expect(receipt.status).toBe("FAILED");
    expect(receipt.orderSync.error).toBe("orders unavailable");
    expect(refreshLedgerMock).not.toHaveBeenCalled();
  });
});
