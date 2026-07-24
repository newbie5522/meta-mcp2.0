import { describe, expect, it } from "vitest";
import {
  buildCanonicalStoreLedgerProjection,
  buildShoplineCompatibilityStoreLedgerProjection,
  buildStoreLedgerProjectionComparison
} from "./store-ledger-projection.service";

const range = { storeId: 1, startDate: "2026-07-01", endDate: "2026-07-31" };

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-1",
    storeId: 1,
    orderId: "order-1",
    storePlatform: "shopline",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    orderTotal: 100,
    revenue: 100,
    store_local_date: "2026-07-10",
    created_at_utc: new Date("2026-07-10T10:00:00.000Z"),
    paid_at: "2026-07-10T10:00:00.000Z",
    created_at: "2026-07-10T09:00:00.000Z",
    createdAt: new Date("2026-07-10T09:00:00.000Z"),
    ...overrides
  };
}

describe("Shopline canonical ledger parity projection", () => {
  it("PARITY-01 paid Shopline is included by both projections", () => {
    const comparison = buildStoreLedgerProjectionComparison({ ...range, rows: [order()] });
    expect(comparison.canonicalProjection.totalOrderCount).toBe(1);
    expect(comparison.shoplineCompatibilityProjection.totalOrderCount).toBe(1);
  });

  it("PARITY-02 pending Shopline is excluded by canonical and compatibility projections", () => {
    const rows = [order({ paymentStatus: "pending" })];
    expect(buildCanonicalStoreLedgerProjection({ ...range, rows }).totalOrderCount).toBe(0);
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalOrderCount).toBe(0);
  });

  it("PARITY-03 fully refunded Shopline retains original gross sales in both projections", () => {
    const rows = [order({ paymentStatus: "refunded" })];
    expect(buildCanonicalStoreLedgerProjection({ ...range, rows }).totalOrderCount).toBe(1);
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalOrderCount).toBe(1);
  });

  it("PARITY-04 partially refunded Shopline is included by both projections", () => {
    const rows = [order({ paymentStatus: "partially_refunded" })];
    expect(buildCanonicalStoreLedgerProjection({ ...range, rows }).totalGrossSales).toBe(100);
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalGrossSales).toBe(100);
  });

  it("PARITY-05 blank paymentStatus is rejected by canonical and compatibility projections", () => {
    const rows = [order({ paymentStatus: "" })];
    expect(buildCanonicalStoreLedgerProjection({ ...range, rows }).totalOrderCount).toBe(0);
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalOrderCount).toBe(0);
  });

  it("PARITY-06 no lineItems is reported as MISSING_FROM_ORDER_FACT and not counted by canonical", () => {
    const rows = [order({ lineItems: [] })];
    const canonical = buildCanonicalStoreLedgerProjection({ ...range, rows });
    const compatibility = buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows });
    expect(canonical.totalOrderCount).toBe(0);
    expect(canonical.warnings).toContain("MISSING_FROM_ORDER_FACT");
    expect(compatibility.totalOrderCount).toBe(1);
    expect(compatibility.warnings).toContain("MISSING_FROM_ORDER_FACT");
  });

  it("PARITY-07 compatibility keeps total_price priority over current_total_price", () => {
    const rows = [order({ total_price: 150, current_total_price: 120, orderTotal: 120 })];
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalGrossSales).toBe(150);
    expect(buildCanonicalStoreLedgerProjection({ ...range, rows }).totalGrossSales).toBe(120);
  });

  it("PARITY-08 compatibility uses payment_total when earlier amount fields are absent", () => {
    const rows = [order({ orderTotal: null, revenue: 0, payment_total: 88 })];
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalGrossSales).toBe(88);
  });

  it("PARITY-09 compatibility uses paid_total when earlier amount fields are absent", () => {
    const rows = [order({ orderTotal: null, revenue: 0, paid_total: 77 })];
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalGrossSales).toBe(77);
  });

  it("PARITY-10 paid_at and created_at cross-day uses paid_at for compatibility and store_local_date for canonical", () => {
    const rows = [order({
      orderId: "cross-paid",
      store_local_date: "2026-07-09",
      paid_at: "2026-07-10T01:00:00.000Z",
      created_at: "2026-07-09T23:00:00.000Z"
    })];
    expect(buildCanonicalStoreLedgerProjection({ ...range, rows }).days[0].date).toBe("2026-07-09");
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).days[0].date).toBe("2026-07-10");
  });

  it("PARITY-11 processed_at is rejected when final payment evidence is absent", () => {
    const rows = [order({
      orderId: "processed-order",
      paid_at: null,
      created_at_utc: null,
      processed_at: "2026-07-11T01:00:00.000Z",
      created_at: "2026-07-10T23:00:00.000Z"
    })];
    expect(buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows }).totalOrderCount).toBe(0);
  });

  it("PARITY-12 multi-line orderTotal is counted once", () => {
    const rows = [
      order({ id: "line-1", orderId: "multi", orderTotal: 200, revenue: 90 }),
      order({ id: "line-2", orderId: "multi", orderTotal: 200, revenue: 110 })
    ];
    const canonical = buildCanonicalStoreLedgerProjection({ ...range, rows });
    const compatibility = buildShoplineCompatibilityStoreLedgerProjection({ ...range, rows });
    expect(canonical.totalOrderCount).toBe(1);
    expect(canonical.totalGrossSales).toBe(200);
    expect(compatibility.totalOrderCount).toBe(1);
    expect(compatibility.totalGrossSales).toBe(200);
  });

  it("PARITY-13 same orderId with different storeId is not merged", () => {
    const rows = [
      order({ storeId: 1, orderId: "shared", orderTotal: 100 }),
      order({ storeId: 2, orderId: "shared", orderTotal: 200 })
    ];
    const storeOne = buildCanonicalStoreLedgerProjection({ ...range, storeId: 1, rows });
    const storeTwo = buildCanonicalStoreLedgerProjection({ ...range, storeId: 2, rows });
    expect(storeOne.totalGrossSales).toBe(100);
    expect(storeTwo.totalGrossSales).toBe(200);
    expect(storeOne.days[0].orderIds).toEqual(["store:1:order:shared"]);
    expect(storeTwo.days[0].orderIds).toEqual(["store:2:order:shared"]);
  });

  it("PARITY-14 missing Order.store_local_date is rejected by canonical projection", () => {
    const rows = [order({ store_local_date: null })];
    const canonical = buildCanonicalStoreLedgerProjection({ ...range, rows });
    expect(canonical.totalOrderCount).toBe(0);
    expect(canonical.warnings).toContain("ORDER_STORE_LOCAL_DATE_UNAVAILABLE");
  });
});
