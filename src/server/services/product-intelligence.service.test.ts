import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    order: { findMany: vi.fn() },
    store: { findMany: vi.fn() },
    product: { findMany: vi.fn() }
  }
}));

vi.mock("../../db/index.js", () => ({
  default: prismaMock,
  prisma: prismaMock
}));

import { getProductIntelligence } from "./product-intelligence.service";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-default",
    orderId: "order-default",
    storeId: 1,
    productId: "product-a",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    orderTotal: 100,
    revenue: 100,
    profit: 20,
    refunded: false,
    store_local_date: "2026-07-02",
    createdAt: new Date("2026-07-02T08:00:00.000Z"),
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findMany.mockResolvedValue([
    { id: 1, platform: "shopify" },
    { id: 2, platform: "shopline" }
  ]);
  prismaMock.product.findMany.mockResolvedValue([
    { id: "product-a", name: "Product A", sku: "SKU-A", category: "Category A" },
    { id: "product-b", name: "Product B", sku: "SKU-B", category: "Category B" }
  ]);
});

describe("product intelligence canonical order contract", () => {
  it("keeps refunded orders and counts one order for multiple lines of the same product", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      orderRow({ id: "line-1", revenue: 40, refunded: true }),
      orderRow({ id: "line-2", revenue: 60, refunded: true })
    ]);

    const products = await getProductIntelligence("2026-07-01", "2026-07-07");

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      productId: "product-a",
      revenue: 100,
      revenueAvailable: true,
      orders: 1,
      refundedOrders: 1,
      refundRate: 1,
      firstOrderAt: "2026-07-02",
      lastOrderAt: "2026-07-02"
    });
  });

  it("uses only each product line revenue and never allocates order total or profit", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      orderRow({ id: "product-a-line", productId: "product-a", revenue: 60, orderTotal: 500 }),
      orderRow({ id: "product-b-line", productId: "product-b", revenue: 40, orderTotal: 500 })
    ]);

    const products = await getProductIntelligence("2026-07-01", "2026-07-07");
    const productA = products.find(product => product.productId === "product-a");
    const productB = products.find(product => product.productId === "product-b");

    expect(productA?.revenue).toBe(60);
    expect(productB?.revenue).toBe(40);
    expect(productA?.orders).toBe(1);
    expect(productB?.orders).toBe(1);
    expect(productA?.profit).toBeNull();
    expect(productA?.warnings).toContain("PRODUCT_PROFIT_ALLOCATION_UNAVAILABLE");
  });

  it("keeps equal order ids isolated by store and applies per-store query scope", async () => {
    const storeOne = orderRow({ id: "store-1-line", storeId: 1, orderId: "shared-order", revenue: 70 });
    const storeTwo = orderRow({ id: "store-2-line", storeId: 2, orderId: "shared-order", revenue: 30 });
    prismaMock.order.findMany
      .mockResolvedValueOnce([storeOne, storeTwo])
      .mockResolvedValueOnce([storeTwo]);

    const allStores = await getProductIntelligence("2026-07-01", "2026-07-07", "all");
    const oneStore = await getProductIntelligence("2026-07-01", "2026-07-07", "2");

    expect(allStores.map(product => product.storeId).sort()).toEqual([1, 2]);
    expect(oneStore).toHaveLength(1);
    expect(oneStore[0].storeId).toBe(2);
    expect(prismaMock.order.findMany.mock.calls[0][0].where.storeId).toBeUndefined();
    expect(prismaMock.order.findMany.mock.calls[1][0].where.storeId).toBe(2);
    expect(prismaMock.order.findMany.mock.calls[1][0].where.store_local_date).toEqual({
      gte: "2026-07-01",
      lte: "2026-07-07"
    });
  });

  it("marks product line revenue unavailable when any contributing line is missing", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      orderRow({ id: "known-line", revenue: 25 }),
      orderRow({ id: "missing-line", revenue: null })
    ]);

    const [product] = await getProductIntelligence("2026-07-01", "2026-07-07");

    expect(product.revenue).toBeNull();
    expect(product.revenueAvailable).toBe(false);
    expect(product.averageOrderValue).toBeNull();
    expect(product.warnings).toContain("PRODUCT_REVENUE_UNAVAILABLE");
  });

  it("weights refund rate by distinct normalized orders and uses business dates", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      orderRow({ id: "order-1", orderId: "order-1", revenue: 10, refunded: true, store_local_date: "2026-07-01" }),
      orderRow({ id: "order-2", orderId: "order-2", revenue: 20, refunded: false, store_local_date: "2026-07-03" }),
      orderRow({ id: "order-3", orderId: "order-3", revenue: 30, refunded: true, store_local_date: "2026-07-05" })
    ]);

    const [product] = await getProductIntelligence("2026-07-01", "2026-07-07");

    expect(product.orders).toBe(3);
    expect(product.refundedOrders).toBe(2);
    expect(product.refundRate).toBeCloseTo(2 / 3);
    expect(product.firstOrderAt).toBe("2026-07-01");
    expect(product.lastOrderAt).toBe("2026-07-05");
  });
});
