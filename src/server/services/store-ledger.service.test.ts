import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    order: {
      findMany: vi.fn(),
      deleteMany: vi.fn()
    }
  }
}));

vi.mock("../../db/index.js", () => ({
  default: prismaMock,
  prisma: prismaMock
}));

import { rebuildStoreLedgerForRange } from "./store-ledger.service";

const params = {
  storeId: 7,
  startDate: "2026-07-01",
  endDate: "2026-07-07"
};

const expectedWhere = {
  storeId: 7,
  store_local_date: {
    gte: "2026-07-01",
    lte: "2026-07-07"
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rebuildStoreLedgerForRange non-destructive sync", () => {
  it("reads before, syncs, then reads after without deleting existing orders", async () => {
    const before = [{ id: "old-line", orderId: "order-1", orderTotal: 50, revenue: 50 }];
    const after = [
      { id: "line-1", orderId: "order-1", orderTotal: 120, revenue: 70 },
      { id: "line-2", orderId: "order-1", orderTotal: 120, revenue: 50 }
    ];
    prismaMock.order.findMany.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const syncStoreData = vi.fn().mockResolvedValue({ saved: 1 });

    const result = await rebuildStoreLedgerForRange({ ...params, syncStoreData });

    expect(prismaMock.order.findMany).toHaveBeenNthCalledWith(1, { where: expectedWhere });
    expect(prismaMock.order.findMany).toHaveBeenNthCalledWith(2, { where: expectedWhere });
    expect(prismaMock.order.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      syncStoreData.mock.invocationCallOrder[0]
    );
    expect(syncStoreData.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.order.findMany.mock.invocationCallOrder[1]
    );
    expect(syncStoreData).toHaveBeenCalledOnce();
    expect(syncStoreData).toHaveBeenCalledWith(
      "2026-07-01",
      "2026-07-07",
      "7",
      { rebuild: true }
    );
    expect(prismaMock.order.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      deletedRows: 0,
      beforeRows: 1,
      afterRows: 2,
      uniqueOrderCount: 1,
      orderTotalSum: 120,
      lineRevenueSum: 120,
      syncResult: { saved: 1 }
    });
  });

  it("preserves the original error and does not query after or delete on sync failure", async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      { id: "old-line", orderId: "order-1", orderTotal: 50, revenue: 50 }
    ]);
    const syncStoreData = vi.fn().mockRejectedValue(new Error("STORE_API_FAILED"));

    await expect(rebuildStoreLedgerForRange({ ...params, syncStoreData })).rejects.toThrow("STORE_API_FAILED");

    expect(prismaMock.order.findMany).toHaveBeenCalledOnce();
    expect(prismaMock.order.deleteMany).not.toHaveBeenCalled();
    expect(syncStoreData).toHaveBeenCalledOnce();
  });

  it("uses database ids for separate orders when orderId is unavailable", async () => {
    const after = [
      { id: "db-line-1", orderId: null, orderTotal: 20, revenue: 20 },
      { id: "db-line-2", orderId: null, orderTotal: 30, revenue: 30 }
    ];
    prismaMock.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(after);
    const syncStoreData = vi.fn().mockResolvedValue({ saved: 2 });

    const result = await rebuildStoreLedgerForRange({ ...params, syncStoreData });

    expect(result.uniqueOrderCount).toBe(2);
    expect(result.orders.map((order: any) => order.orderId)).toEqual(["db-line-1", "db-line-2"]);
    expect(prismaMock.order.deleteMany).not.toHaveBeenCalled();
  });
});
