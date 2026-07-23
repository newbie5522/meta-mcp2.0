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

  it("projects Shoplazza orders by store_local_date without mixing other stores or duplicate lines", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "line-1",
        storeId: 1,
        platform: "shoplazza",
        orderId: "slz-1",
        store_local_date: "2026-07-01",
        orderTotal: 120,
        revenue: 60,
        paymentStatus: "paid"
      },
      {
        id: "line-2",
        storeId: 1,
        platform: "shoplazza",
        orderId: "slz-1",
        store_local_date: "2026-07-01",
        orderTotal: 120,
        revenue: 60,
        paymentStatus: "paid"
      },
      {
        id: "other-store-line",
        storeId: 2,
        platform: "shoplazza",
        orderId: "slz-2",
        store_local_date: "2026-07-01",
        orderTotal: 999,
        revenue: 999,
        paymentStatus: "paid"
      },
      {
        id: "outside-date",
        storeId: 1,
        platform: "shoplazza",
        orderId: "slz-3",
        store_local_date: "2026-07-03",
        orderTotal: 300,
        revenue: 300,
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
      where: {
        storeId: 1,
        store_local_date: {
          gte: "2026-07-01",
          lte: "2026-07-01"
        }
      }
    }));
    expect(result.uniqueOrderCount).toBe(1);
    expect(result.totalGrossSales).toBe(120);
    expect(prismaMock.dataCenterStoreDaily.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        orderCount: 1,
        grossSales: 120,
        orderIdsJson: JSON.stringify(["store:1:order:slz-1"])
      })
    }));
  });

  it("LEDGER-SLZ-TZ-01 records system_default Shoplazza source evidence while projecting Orders into Ledger", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "line-1",
        storeId: 1,
        platform: "shoplazza",
        orderId: "slz-1",
        store_local_date: "2026-07-01",
        store_timezone: "America/Los_Angeles",
        orderTotal: 120,
        revenue: 120,
        paymentStatus: "paid"
      }
    ]);
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      storeId: 1,
      status: "success",
      rangeStart: new Date("2026-07-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-01T23:59:59.000Z"),
      metadata: JSON.stringify({
        timezone: "America/Los_Angeles",
        timezoneSource: "system_default",
        coverageComplete: true,
        truncated: false,
        failedSlices: []
      })
    });

    const result = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      rangeVerified: true,
      sourceSyncTaskId: "task-1"
    });

    expect(result).toMatchObject({
      timezone: "America/Los_Angeles",
      timezoneSource: "system_default",
      uniqueOrderCount: 1,
      totalGrossSales: 120
    });
    expect(prismaMock.dataCenterStoreDaily.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        orderCount: 1,
        grossSales: 120,
        diagnosticsJson: expect.stringContaining("\"timezoneSource\":\"system_default\"")
      })
    }));
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

  it("LEDGER-IDEMP-01 produces stable replacement values across repeated rebuilds", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "line-1",
        storeId: 1,
        orderId: "order-1",
        store_local_date: "2026-07-01",
        orderTotal: 50,
        revenue: 50,
        paymentStatus: "paid"
      }
    ]);

    const first = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01"
    });
    const firstUpdate = prismaMock.dataCenterStoreDaily.upsert.mock.calls[0][0].update;
    prismaMock.dataCenterStoreDaily.upsert.mockClear();
    const second = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01"
    });
    const secondUpdate = prismaMock.dataCenterStoreDaily.upsert.mock.calls[0][0].update;

    expect(second).toMatchObject({
      uniqueOrderCount: first.uniqueOrderCount,
      totalGrossSales: first.totalGrossSales
    });
    expect(secondUpdate.orderCount).toBe(firstUpdate.orderCount);
    expect(secondUpdate.grossSales).toBe(firstUpdate.grossSales);
    expect(secondUpdate).not.toHaveProperty("increment");
  });

  it("LEDGER-DEDUPE-01 counts duplicate storeId + orderId line rows once", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { id: "line-1", storeId: 1, orderId: "dup-1", store_local_date: "2026-07-01", orderTotal: 80, revenue: 30, paymentStatus: "paid" },
      { id: "line-2", storeId: 1, orderId: "dup-1", store_local_date: "2026-07-01", orderTotal: 80, revenue: 50, paymentStatus: "paid" }
    ]);

    const result = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01"
    });

    expect(result.uniqueOrderCount).toBe(1);
    expect(result.totalGrossSales).toBe(80);
  });

  it("LEDGER-DATE-01 queries only Order.store_local_date for the business range", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-02"
    });

    const where = prismaMock.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      storeId: 1,
      store_local_date: { gte: "2026-07-01", lte: "2026-07-02" }
    });
    expect(JSON.stringify(where)).not.toContain("createdAt");
  });

  it("LEDGER-STORE-01 keeps projection scoped to the requested store only", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { id: "line-1", storeId: 1, orderId: "store-1-order", store_local_date: "2026-07-01", orderTotal: 20, revenue: 20, paymentStatus: "paid" },
      { id: "line-2", storeId: 2, orderId: "store-2-order", store_local_date: "2026-07-01", orderTotal: 999, revenue: 999, paymentStatus: "paid" }
    ]);

    const result = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01"
    });

    expect(result.uniqueOrderCount).toBe(1);
    expect(result.totalGrossSales).toBe(20);
  });

  it("LEDGER-REPLACE-01 overwrites stale values instead of incrementing them", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { id: "line-1", storeId: 1, orderId: "order-1", store_local_date: "2026-07-01", orderTotal: 25, revenue: 25, paymentStatus: "paid" }
    ]);

    await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01"
    });

    expect(prismaMock.dataCenterStoreDaily.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        orderCount: 1,
        grossSales: 25
      })
    }));
    expect(prismaMock.dataCenterStoreDaily.upsert.mock.calls[0][0].update.orderCount).not.toEqual(expect.objectContaining({
      increment: expect.anything()
    }));
  });

  it("LEDGER-STALE-01 writes controlled zero snapshots for verified empty dates", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.syncLog.findUnique.mockResolvedValue({
      id: "task-1",
      storeId: 1,
      status: "success",
      rangeStart: new Date("2026-07-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-02T23:59:59.000Z"),
      metadata: JSON.stringify({
        coverageComplete: true,
        truncated: false,
        failedSlices: []
      })
    });

    const result = await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      rangeVerified: true,
      sourceSyncTaskId: "task-1"
    });

    expect(prismaMock.dataCenterStoreDaily.upsert).toHaveBeenCalledTimes(2);
    for (const call of prismaMock.dataCenterStoreDaily.upsert.mock.calls) {
      expect(call[0].update).toMatchObject({ orderCount: 0, grossSales: 0, netSales: 0, aov: 0 });
    }
    expect(result.recordsSaved).toBe(2);
  });

  it("LEDGER-SCOPE-01 writes only the requested store/date keys", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { id: "line-1", storeId: 1, orderId: "order-1", store_local_date: "2026-07-01", orderTotal: 25, revenue: 25, paymentStatus: "paid" }
    ]);

    await refreshStoreDataCenterLedger({
      storeId: 1,
      startDate: "2026-07-01",
      endDate: "2026-07-01"
    });

    expect(prismaMock.dataCenterStoreDaily.upsert.mock.calls[0][0].where).toEqual({
      storeId_date: { storeId: 1, date: "2026-07-01" }
    });
  });
});
