import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    store: { findUnique: vi.fn() },
    order: { findMany: vi.fn() },
    syncLog: { findUnique: vi.fn() },
    dataCenterStoreDaily: { upsert: vi.fn() }
  }
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));

import { refreshStoreDataCenterLedger } from "./datacenter-store-ledger.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findUnique.mockResolvedValue({
    id: 1,
    name: "Store 1",
    platform: "shoplazza",
    domain: "shop.example.com",
    timezone: "America/Los_Angeles"
  });
  prismaMock.dataCenterStoreDaily.upsert.mockImplementation(async ({ create }: any) => create);
  prismaMock.syncLog.findUnique.mockResolvedValue(null);
});

describe("data center store ledger Order projection", () => {
  it("projects DataCenterStoreDaily from Order only and counts each orderTotal once", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "line-1",
        storeId: 1,
        orderId: "order-1",
        store_local_date: "2026-07-01",
        orderTotal: 200,
        revenue: 90,
        paymentStatus: "paid"
      },
      {
        id: "line-2",
        storeId: 1,
        orderId: "order-1",
        store_local_date: "2026-07-01",
        orderTotal: 200,
        revenue: 110,
        paymentStatus: "paid"
      }
    ]);

    const result = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      rangeVerified: true
    });

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ storeId: 1 })
    }));
    expect(prismaMock.dataCenterStoreDaily.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        orderCount: 1,
        grossSales: 200,
        amountSource: "Order.orderTotal"
      })
    }));
    expect(result).toMatchObject({
      source: "Order",
      dateField: "Order.store_local_date",
      uniqueOrderCount: 1,
      totalGrossSales: 200
    });
  });

  it("does not create zero snapshots for unverified empty ranges", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      rangeVerified: false
    });
    expect(prismaMock.dataCenterStoreDaily.upsert).not.toHaveBeenCalled();
  });

  it("PIPE-06 allows zero snapshots only with verified source SyncLog coverage", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      storeId: 1,
      status: "success",
      rangeStart: new Date("2026-07-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-03T23:59:59.000Z"),
      metadata: JSON.stringify({
        coverageComplete: true,
        truncated: false,
        failedSlices: []
      })
    });

    const result = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      rangeVerified: true,
      sourceSyncTaskId: "task-1",
      sourceSyncFinishedAt: new Date("2026-07-04T00:00:00.000Z")
    });

    expect(prismaMock.dataCenterStoreDaily.upsert).toHaveBeenCalledTimes(3);
    expect(result.rangeVerified).toBe(true);
  });

  it("PIPE-07 does not overwrite zero days when source SyncLog evidence is incomplete", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      storeId: 1,
      status: "success",
      rangeStart: new Date("2026-07-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-03T23:59:59.000Z"),
      metadata: JSON.stringify({
        coverageComplete: true,
        truncated: true,
        failedSlices: []
      })
    });

    const result = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      rangeVerified: true,
      sourceSyncTaskId: "task-1"
    });

    expect(prismaMock.dataCenterStoreDaily.upsert).not.toHaveBeenCalled();
    expect(result.rangeVerified).toBe(false);
  });
});
