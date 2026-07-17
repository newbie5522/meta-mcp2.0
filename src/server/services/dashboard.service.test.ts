import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, productsMock, coverageMock } = vi.hoisted(() => ({
  prismaMock: {
    store: { findMany: vi.fn() },
    adAccount: { count: vi.fn(), findMany: vi.fn() },
    accountMapping: { count: vi.fn() },
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
  prismaMock.accountMapping.count.mockResolvedValue(1);
  prismaMock.adAccount.findMany.mockResolvedValue([
    { id: 10, fb_account_id: "act_1", fb_account_name: "Account 1", activityStatus: "1", store: { name: "Live" } }
  ]);
  prismaMock.syncLog.findMany.mockResolvedValue([]);
  prismaMock.dataCenterStoreDaily.findMany.mockResolvedValue([{ storeId: 1, grossSales: 100, orderCount: 2 }]);
  prismaMock.dataCenterMetaAccountDaily.findMany.mockResolvedValue([{ accountId: "1", spend: 25, purchases: 1, purchaseValue: 50, impressions: 1000, clicks: 20 }]);
  prismaMock.aiActionSuggestion.count.mockResolvedValue(0);
  productsMock.mockResolvedValue([{ productId: "p1", productName: "Product 1", sku: "SKU-1", orders: 2, revenue: 100 }]);
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
});
