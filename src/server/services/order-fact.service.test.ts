import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    order: {
      findMany: vi.fn(),
      count: vi.fn()
    },
    store: {
      findMany: vi.fn()
    }
  }
}));

vi.mock("../../db/index.js", () => ({
  default: prismaMock,
  prisma: prismaMock
}));

import {
  getStoreOrderFacts,
  getStoreOrderSummary,
  normalizeStoreOrderFacts
} from "./order-fact.service";
import { classifyPlatformOrderValidity } from "./store-sync-core";

const dateRange = {
  startDate: "2026-07-01",
  endDate: "2026-07-07"
};

function orderFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-default",
    orderId: "order-default",
    storeId: 1,
    paymentStatus: "paid",
    storePlatform: "shopify",
    orderTotal: null,
    revenue: 0,
    profit: 0,
    refunded: false,
    refundAmount: null,
    shippingCountryCode: "US",
    shippingCountryName: "United States",
    billingCountryCode: "US",
    billingCountryName: "United States",
    store_local_date: "2026-07-02",
    createdAt: new Date("2026-07-02T08:00:00.000Z"),
    created_at_utc: new Date("2026-07-02T08:00:00.000Z"),
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findMany.mockResolvedValue([{ id: 1, platform: "shopify" }]);
});

describe("store order fact shared contract", () => {
  it("uses one platform-specific payment status contract for sync and facts", async () => {
    // Arrange
    const excludedStatuses = ["waiting", "unpaid", "failed", "cancelled", "canceled", "voided", "pending", "authorized", "partially_paid"];
    const includedStatuses = ["paid", "partially_refunded", "refunded", "  PAID  "];
    prismaMock.order.findMany.mockResolvedValueOnce([
      ...excludedStatuses.map((status, index) => orderFixture({
        id: `excluded-${index}`,
        orderId: `excluded-${index}`,
        paymentStatus: status
      })),
      ...includedStatuses.map((status, index) => orderFixture({
        id: `included-${index}`,
        orderId: `included-${index}`,
        paymentStatus: status
      }))
    ]);

    // Act
    const rows = await getStoreOrderFacts(dateRange);

    // Assert
    for (const status of excludedStatuses) {
      expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: status, paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(false);
    }
    for (const status of includedStatuses) {
      expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: status, paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(true);
    }
    const normalized = normalizeStoreOrderFacts(rows);
    expect(normalized.orders.map(order => order.rows[0].orderId)).toEqual([
      "included-0",
      "included-1",
      "included-2",
      "included-3"
    ]);
  });

  it("requires final successful payment evidence and rejects pending for every platform", () => {
    expect(classifyPlatformOrderValidity({ platform: "shopline", paymentStatus: "pending", paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(false);
    expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: "pending", paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(false);
    expect(classifyPlatformOrderValidity({ platform: "shoplazza", paymentStatus: "pending", paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(false);
    expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: "authorized", paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(false);
    expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: "partially_paid", paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(false);
    expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: "paid" }).valid).toBe(false);
    expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: "refunded", paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(true);
    expect(classifyPlatformOrderValidity({ platform: "shopify", paymentStatus: "partially_refunded", paidAt: "2026-07-02T08:00:00.000Z" }).valid).toBe(true);
    expect(classifyPlatformOrderValidity({
      platform: "shopline",
      paymentStatus: "paid",
      paidAt: "2026-07-02T08:00:00.000Z",
      cancelledAt: "2026-07-02T00:00:00.000Z"
    }).valid).toBe(false);
    expect(classifyPlatformOrderValidity({ platform: "shopline", paymentStatus: "mystery" })).toEqual({
      valid: false,
      reason: "PAYMENT_STATUS_UNRECOGNIZED"
    });

    const normalized = normalizeStoreOrderFacts([
      orderFixture({ id: "unknown-platform", orderId: "unknown-platform", storePlatform: "unknown" }),
      orderFixture({ id: "unknown-status", orderId: "unknown-status", paymentStatus: "mystery" })
    ]);
    expect(normalized.orders).toHaveLength(0);
    expect(normalized.warnings).toContain("PLATFORM_ORDER_RULE_UNAVAILABLE");
    expect(normalized.warnings).toContain("PAYMENT_STATUS_UNRECOGNIZED");
  });

  it("deduplicates line rows by real orderId", () => {
    // Arrange
    const rows = [
      orderFixture({ id: "line-1", orderId: "order-100", orderTotal: 120, revenue: 70 }),
      orderFixture({ id: "line-2", orderId: "order-100", orderTotal: 120, revenue: 50 })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders).toHaveLength(1);
    expect(normalized.orders[0].orderKey).toBe("store:1:order:order-100");
    expect(normalized.orders[0].usedFallbackKey).toBe(false);
    expect(normalized.orders[0].revenue).toBe(120);
    expect(normalized.warnings).not.toContain("ORDER_DEDUP_FALLBACK_USED");
  });

  it("warns when database id fallback is used", () => {
    // Arrange
    const rows = [
      orderFixture({ id: "db-fallback-1", orderId: null, orderTotal: 80, revenue: 80 })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders).toHaveLength(1);
    expect(normalized.orders[0].orderKey).toBe("store:1:db:db-fallback-1");
    expect(normalized.orders[0].usedFallbackKey).toBe(true);
    expect(normalized.warnings).toContain("ORDER_DEDUP_FALLBACK_USED");
  });

  it("uses available refund amount without inferring a full refund", () => {
    // Arrange
    const rows = [
      orderFixture({
        id: "refund-line-1",
        orderId: "order-refund-available",
        orderTotal: 100,
        revenue: 60,
        refunded: true,
        refundAmount: 25
      }),
      orderFixture({
        id: "refund-line-2",
        orderId: "order-refund-available",
        orderTotal: 100,
        revenue: 40,
        refunded: true,
        refundAmount: null
      })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders).toHaveLength(1);
    expect(normalized.orders[0].revenue).toBe(100);
    expect(normalized.orders[0].refundAmountAvailable).toBe(true);
    expect(normalized.orders[0].refundAmount).toBe(25);
    expect(normalized.orders[0].refundAmount).not.toBe(100);
    expect(normalized.warnings).not.toContain("REFUND_AMOUNT_UNAVAILABLE");
  });

  it("does not infer full refund when refund amount is unavailable", () => {
    // Arrange
    const rows = [
      orderFixture({
        id: "refund-unavailable",
        orderId: "order-refund-unavailable",
        orderTotal: 150,
        revenue: 150,
        refunded: true,
        refundAmount: null
      })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders).toHaveLength(1);
    expect(normalized.orders[0].refundAmountAvailable).toBe(false);
    expect(normalized.orders[0].refundAmount).toBeNull();
    expect(normalized.orders[0].refundAmount).not.toBe(150);
    expect(normalized.warnings).toContain("REFUND_AMOUNT_UNAVAILABLE");
  });

  it("uses orderTotal once for multi-line revenue when orderTotal is available", () => {
    // Arrange
    const rows = [
      orderFixture({ id: "total-line-1", orderId: "order-total", orderTotal: 200, revenue: 90 }),
      orderFixture({ id: "total-line-2", orderId: "order-total", orderTotal: 200, revenue: 110 })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders).toHaveLength(1);
    expect(normalized.orders[0].revenue).toBe(200);
  });

  it("sums line revenue only when orderTotal is unavailable", () => {
    // Arrange
    const rows = [
      orderFixture({ id: "line-revenue-1", orderId: "order-line-revenue", orderTotal: null, revenue: 45 }),
      orderFixture({ id: "line-revenue-2", orderId: "order-line-revenue", orderTotal: null, revenue: 55 })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders).toHaveLength(1);
    expect(normalized.orders[0].revenue).toBe(100);
  });

  it("preserves real zero profit", () => {
    // Arrange
    const rows = [
      orderFixture({ id: "zero-profit", orderId: "order-zero-profit", orderTotal: 100, profit: 0 })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders[0].profit).toBe(0);
    expect(normalized.warnings).not.toContain("PROFIT_UNAVAILABLE");
  });

  it("keeps profit unavailable instead of estimating it", () => {
    // Arrange
    const rows = [
      orderFixture({ id: "missing-profit", orderId: "order-missing-profit", orderTotal: 100, profit: null })
    ];

    // Act
    const normalized = normalizeStoreOrderFacts(rows);

    // Assert
    expect(normalized.orders[0].profit).toBeNull();
    expect(normalized.warnings).toContain("PROFIT_UNAVAILABLE");
  });

  it("uses store_local_date by default and keeps legacy createdAt fallback disabled", async () => {
    // Arrange
    prismaMock.order.findMany.mockResolvedValueOnce([]);

    // Act
    await getStoreOrderFacts(dateRange);

    // Assert
    expect(prismaMock.order.findMany).toHaveBeenCalledWith({
      where: {
        store_local_date: {
          gte: "2026-07-01",
          lte: "2026-07-07"
        }
      },
      orderBy: { createdAt: "desc" }
    });
    const where = prismaMock.order.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.createdAt).toBeUndefined();
  });

  it("scopes getStoreOrderFacts to requested storeId and ignores all or undefined store ids", async () => {
    // Arrange
    prismaMock.order.findMany.mockResolvedValue([]);

    // Act
    await getStoreOrderFacts({ ...dateRange, storeId: "all" });
    await getStoreOrderFacts({ ...dateRange, storeId: undefined });
    await getStoreOrderFacts({ ...dateRange, storeId: "undefined" });
    await getStoreOrderFacts({ ...dateRange, storeId: "2" });

    // Assert
    expect(prismaMock.order.findMany.mock.calls[0][0].where.storeId).toBeUndefined();
    expect(prismaMock.order.findMany.mock.calls[1][0].where.storeId).toBeUndefined();
    expect(prismaMock.order.findMany.mock.calls[2][0].where.storeId).toBeUndefined();
    expect(prismaMock.order.findMany.mock.calls[3][0].where.storeId).toBe(2);
    expect(Number.isNaN(prismaMock.order.findMany.mock.calls[2][0].where.storeId)).toBe(false);
  });

  it("summarizes shared order facts with payment filtering, deduplication, refunds, and AOV", async () => {
    // Arrange
    prismaMock.order.findMany.mockResolvedValueOnce([
      orderFixture({
        id: "summary-line-1",
        orderId: "summary-order-1",
        orderTotal: 100,
        revenue: 60,
        refunded: true,
        refundAmount: 10
      }),
      orderFixture({
        id: "summary-line-2",
        orderId: "summary-order-1",
        orderTotal: 100,
        revenue: 40,
        refunded: true,
        refundAmount: null
      }),
      orderFixture({
        id: "summary-order-2",
        orderId: "summary-order-2",
        orderTotal: null,
        revenue: 50,
        refunded: false
      }),
      orderFixture({
        id: "summary-excluded",
        orderId: "summary-excluded",
        paymentStatus: "pending",
        orderTotal: 999,
        revenue: 999
      })
    ]);

    // Act
    const summary = await getStoreOrderSummary(dateRange);

    // Assert
    expect(summary.ordersCount).toBe(2);
    expect(summary.totalSales).toBe(150);
    expect(summary.aov).toBe(75);
    expect(summary.refundAmount).toBe(10);
    expect(summary.refundRate).toBeCloseTo(1 / 2);
    expect(summary.refundAmountRate).toBeCloseTo(10 / 150);
    expect(summary.refundRateBasis).toBe("orders");
    expect(summary.legacyFallbackOrdersCount).toBe(0);
    expect(summary.legacyFallbackRevenue).toBe(0);
    expect(summary.legacyFallbackUsed).toBe(false);
    expect(summary.orders.map(row => row.orderId)).toEqual([
      "summary-order-1",
      "summary-order-1",
      "summary-order-2"
    ]);
    expect(summary.orders).toHaveLength(3);
    expect(summary.orders.every(row =>
      typeof row.orderId === "string" &&
      row.storeId === 1
    )).toBe(true);
    expect(summary.orders.some(row =>
      row.orderId === "summary-excluded"
    )).toBe(false);
  });

  it("counts explicit legacy fallback rows separately when fallback is requested", async () => {
    // Arrange
    prismaMock.order.findMany.mockResolvedValueOnce([
      orderFixture({
        id: "legacy-order",
        orderId: "legacy-order",
        orderTotal: 70,
        revenue: 70,
        store_local_date: null
      })
    ]);

    // Act
    const summary = await getStoreOrderSummary({
      ...dateRange,
      includeLegacyCreatedAtFallback: true
    });

    // Assert
    expect(prismaMock.order.findMany.mock.calls[0][0].where.OR).toBeDefined();
    expect(summary.ordersCount).toBe(0);
    expect(summary.totalSales).toBe(0);
    expect(summary.legacyFallbackOrdersCount).toBe(1);
    expect(summary.legacyFallbackRevenue).toBe(70);
    expect(summary.legacyFallbackUsed).toBe(true);
  });
});
