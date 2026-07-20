import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, productsMock, coverageMock } = vi.hoisted(() => ({
  prismaMock: {
    store: { findMany: vi.fn() },
    adAccount: { count: vi.fn(), findMany: vi.fn() },
    syncLog: { findMany: vi.fn() },
    dataCenterStoreDaily: { findMany: vi.fn() },
    dataCenterMetaAccountDaily: { findMany: vi.fn() },
    aiActionSuggestion: { count: vi.fn() }
  },
  productsMock: vi.fn(),
  coverageMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({ normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}` }));
vi.mock("./product-intelligence.service.js", () => ({ getProductIntelligence: productsMock }));
vi.mock("./data-coverage.service.js", () => ({ getCoverageMap: coverageMock }));

import { getDashboardSummary } from "./dashboard.service";

const readyCoverage = {
  storeCoverage: { status: "READY" },
  metaCoverage: { status: "READY" },
  productCoverage: { status: "READY" }
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findMany.mockResolvedValue([
    { id: 1, name: "Live", status: "active", platform: "shopline", domain: "live.example.com", accounts: [], accountMappings: [] },
    { id: 2, name: "Inactive", status: "inactive", platform: "shopline", domain: "inactive.example.com", accounts: [], accountMappings: [] }
  ]);
  prismaMock.adAccount.count.mockResolvedValue(1);
  prismaMock.adAccount.findMany.mockResolvedValue([
    { id: 10, fb_account_id: "act_1", fb_account_name: "Account 1", activityStatus: "1", recentActivity90d: true, storeId: 1, store: { name: "Live" } }
  ]);
  prismaMock.syncLog.findMany.mockResolvedValue([]);
  prismaMock.dataCenterStoreDaily.findMany.mockResolvedValue([{ storeId: 1, grossSales: 100, orderCount: 2 }]);
  prismaMock.dataCenterMetaAccountDaily.findMany.mockResolvedValue([{ storeId: 1, accountId: "1", spend: 25, purchases: 1, purchaseValue: 50, impressions: 1000, clicks: 20 }]);
  prismaMock.aiActionSuggestion.count.mockResolvedValue(0);
  productsMock.mockResolvedValue([{ storeId: 1, productId: "p1", productName: "Product 1", sku: "SKU-1", orders: 2, revenue: 100 }]);
  coverageMock.mockResolvedValue(readyCoverage);
});

describe("dashboard summary", () => {
  it("OVERVIEW-03 products use Product service output", async () => {
    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(productsMock).toHaveBeenCalledWith("2026-07-01", "2026-07-07", "all");
    expect(summary.products).toEqual([{
      productId: "p1",
      productName: "Product 1",
      sku: "SKU-1",
      orderCount: 2,
      quantity: null,
      sales: 100
    }]);
  });

  it("OVERVIEW-05 sandbox/demo excluded", async () => {
    await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(prismaMock.store.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        NOT: expect.arrayContaining([{ mode: "sandbox" }])
      }),
      include: { accounts: true, accountMappings: true }
    });
  });

  it("OVERVIEW-06 activeStoreCount differs from total when inactive exists", async () => {
    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(summary.storeCount).toBe(2);
    expect(summary.activeStoreCount).toBe(1);
  });

  it("OVERVIEW-07 fact-only account has real id and UNKNOWN", async () => {
    prismaMock.adAccount.findMany.mockResolvedValue([]);

    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(summary.accounts[0]).toMatchObject({
      id: "act_1",
      metaAccountId: "act_1",
      name: null,
      status: "UNKNOWN",
      structureAvailable: false,
      hasPerformanceFacts: true
    });
    expect(summary.accounts[0].id).not.toContain("synth_");
  });

  it("OVERVIEW-08 Store NOT_SYNCED renders N/A", async () => {
    coverageMock.mockResolvedValue({
      ...readyCoverage,
      storeCoverage: { status: "NOT_SYNCED" }
    });

    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(summary.overview.storeSales).toBeNull();
    expect(summary.stores[0].sales).toBeNull();
  });

  it("OVERVIEW-09 Meta TRUE_EMPTY renders 0", async () => {
    prismaMock.dataCenterMetaAccountDaily.findMany.mockResolvedValue([]);
    coverageMock.mockResolvedValue({
      ...readyCoverage,
      metaCoverage: { status: "TRUE_EMPTY" }
    });

    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(summary.overview.metaSpend).toBe(0);
    expect(summary.overview.metaPurchases).toBe(0);
  });

  it("RC-05 excludes non-production store facts from overview and rows", async () => {
    prismaMock.dataCenterStoreDaily.findMany.mockResolvedValue([
      { storeId: 1, grossSales: 100, orderCount: 2 },
      { storeId: 999, grossSales: 900, orderCount: 9 }
    ]);
    prismaMock.dataCenterMetaAccountDaily.findMany.mockResolvedValue([
      { storeId: 1, accountId: "1", spend: 25, purchases: 1, purchaseValue: 50, impressions: 1000, clicks: 20 },
      { storeId: 999, accountId: "999", spend: 900, purchases: 9, purchaseValue: 999, impressions: 9000, clicks: 900 }
    ]);
    productsMock.mockResolvedValue([
      { storeId: 1, productId: "p1", productName: "Product 1", sku: "SKU-1", orders: 2, revenue: 100 },
      { storeId: 999, productId: "p-demo", productName: "Demo Product", sku: "DEMO", orders: 9, revenue: 900 }
    ]);

    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(summary.overview.storeSales).toBe(100);
    expect(summary.overview.storeOrderCount).toBe(2);
    expect(summary.overview.metaSpend).toBe(25);
    expect(summary.products.map((product: any) => product.productId)).toEqual(["p1"]);
    expect(summary.accounts.map((account: any) => account.metaAccountId)).toEqual(["act_1"]);
  });

  it("RC-05 overview totals equal returned store and account rows", async () => {
    prismaMock.dataCenterStoreDaily.findMany.mockResolvedValue([
      { storeId: 1, grossSales: 100, orderCount: 2 },
      { storeId: 2, grossSales: 50, orderCount: 1 }
    ]);
    prismaMock.dataCenterMetaAccountDaily.findMany.mockResolvedValue([
      { storeId: 1, accountId: "1", spend: 25, purchases: 1, purchaseValue: 50, impressions: 1000, clicks: 20 },
      { storeId: 2, accountId: "2", spend: 5, purchases: 0, purchaseValue: 0, impressions: 100, clicks: 2 }
    ]);

    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(summary.overview.storeSales).toBe(summary.stores.reduce((sum: number, store: any) => sum + Number(store.sales || 0), 0));
    expect(summary.overview.storeOrderCount).toBe(summary.stores.reduce((sum: number, store: any) => sum + Number(store.orderCount || 0), 0));
    expect(summary.overview.metaSpend).toBe(summary.accounts.reduce((sum: number, account: any) => sum + Number(account.spend || 0), 0));
  });

  it("CARRY-OV-01~05 counts only production or unbound recent active ad accounts", async () => {
    prismaMock.store.findMany.mockResolvedValue([
      { id: 1, name: "Live", status: "active", platform: "shopline", domain: "live.example.com", accounts: [], accountMappings: [] }
    ]);
    prismaMock.adAccount.findMany.mockResolvedValue([
      { id: 10, fb_account_id: "act_prod", fb_account_name: "Production active", activityStatus: "1", recentActivity90d: true, storeId: 1, store: { name: "Live" } },
      { id: 11, fb_account_id: "act_unbound", fb_account_name: "Unbound active", activityStatus: "1", recentActivity90d: true, storeId: null, store: null },
      { id: 12, fb_account_id: "act_sandbox", fb_account_name: "Sandbox active", activityStatus: "1", recentActivity90d: true, storeId: 3, store: { name: "Sandbox" } },
      { id: 13, fb_account_id: "act_demo", fb_account_name: "Demo active", activityStatus: "1", recentActivity90d: true, storeId: 2, store: { name: "Shopline Fashion Store" } },
      { id: 14, fb_account_id: "act_inactive", fb_account_name: "Inactive", activityStatus: "1", recentActivity90d: false, storeId: 1, store: { name: "Live" } }
    ]);
    prismaMock.dataCenterMetaAccountDaily.findMany.mockResolvedValue([]);

    const summary = await getDashboardSummary({ since: new Date("2026-07-01"), until: new Date("2026-07-07") });

    expect(summary.adAccountCount).toBe(2);
  });
});
