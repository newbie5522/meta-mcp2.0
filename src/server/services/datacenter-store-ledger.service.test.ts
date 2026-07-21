import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    store: { findUnique: vi.fn() },
    order: { findMany: vi.fn() },
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
});
