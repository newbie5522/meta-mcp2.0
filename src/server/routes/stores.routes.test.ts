import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, fetchPlatformStoreTimezoneMock } = vi.hoisted(() => ({
  prismaMock: {
    store: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn()
    },
    order: { count: vi.fn() },
    syncLog: { findFirst: vi.fn() }
  },
  fetchPlatformStoreTimezoneMock: vi.fn()
}));

vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../services/store-timezone.service.js", () => ({
  StoreTimezoneError: class StoreTimezoneError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, details: Record<string, unknown> = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  },
  fetchPlatformStoreTimezone: fetchPlatformStoreTimezoneMock
}));

import router from "./stores.routes";

function responseMock() {
  const response: any = {
    statusCode: 200,
    body: null,
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    })
  };
  return response;
}

function routeHandler(method: string, path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  return layer?.route?.stack?.[0]?.handle;
}

async function invokePost(body: any) {
  const response = responseMock();
  await routeHandler("post", "/")({ body, query: {}, params: {} }, response);
  return response;
}

async function invokeGet() {
  const response = responseMock();
  await routeHandler("get", "/")({ body: {}, query: {}, params: {} }, response);
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findUnique.mockResolvedValue(null);
  prismaMock.store.findFirst.mockResolvedValue(null);
  prismaMock.store.findMany.mockResolvedValue([]);
  prismaMock.store.create.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  prismaMock.store.update.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  prismaMock.order.count.mockResolvedValue(0);
  prismaMock.syncLog.findFirst.mockResolvedValue(null);
});

function storeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Romanticed",
    platform: "shoplazza",
    domain: "lachry.myshoplaza.com",
    timezone: "America/Los_Angeles",
    mode: "production",
    accounts: [],
    ...overrides
  };
}

function successfulSyncLog(diagnostics: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    id: 10,
    storeId: 1,
    taskType: "sync_store_orders",
    status: "success",
    startedAt: new Date("2026-07-22T00:00:00.000Z"),
    metadata: JSON.stringify({
      timezone: "America/Los_Angeles",
      timezoneSource: "platform_shop_api",
      timezoneVerifiedAt: "2026-07-22T00:00:00.000Z",
      diagnostics,
      ...metadata
    })
  };
}

async function getDiagnostics(diagnostics: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  prismaMock.store.findMany.mockResolvedValue([storeFixture()]);
  prismaMock.syncLog.findFirst.mockResolvedValue(successfulSyncLog(diagnostics, metadata));
  const response = await invokeGet();
  expect(response.statusCode).toBe(200);
  return response.body[0].timezoneDiagnostics;
}

describe("stores route verified timezone save contract", () => {
  it("rejects store save when timezone cannot be verified or supplied as valid IANA", async () => {
    const response = await invokePost({
      name: "No Timezone Store",
      platform: "shopline",
      domain: "",
      timezone: "GMT-7"
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe("STORE_TIMEZONE_UNVERIFIED");
  });

  it("blocks platform timezone change when existing Orders would be affected", async () => {
    prismaMock.store.findUnique.mockResolvedValue({
      id: 1,
      name: "Existing Store",
      platform: "shopify",
      domain: "shop.example.com",
      timezone: "America/Los_Angeles",
      shopify_token: "existing-token"
    });
    fetchPlatformStoreTimezoneMock.mockResolvedValue({
      timezone: "America/New_York",
      timezoneSource: "platform_shop_api",
      timezoneVerifiedAt: "2026-07-01T00:00:00.000Z",
      platformTimezoneRaw: "America/New_York"
    });
    prismaMock.order.count.mockResolvedValue(3);

    const response = await invokePost({
      id: 1,
      name: "Existing Store",
      platform: "shopify",
      domain: "shop.example.com"
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: "STORE_TIMEZONE_CHANGED",
      previousTimezone: "America/Los_Angeles",
      platformTimezone: "America/New_York",
      affectedOrderCount: 3
    });
    expect(prismaMock.store.update).not.toHaveBeenCalled();
  });
});

describe("stores route timezone timestamp diagnostics", () => {
  it("treats UTC +00:00 order timestamps as neutral encoding", async () => {
    const diagnostics = await getDiagnostics({ observedOrderOffsets: ["+00:00"] });

    expect(diagnostics.warnings).toEqual([]);
    expect(diagnostics.timestampDiagnostics).toMatchObject({
      encoding: "UTC",
      observedOffsets: ["+00:00"],
      normalizedToTimezone: "America/Los_Angeles",
      localDateField: "Order.store_local_date"
    });
  });

  it("treats a single non-UTC offset as offset-aware without warning", async () => {
    const diagnostics = await getDiagnostics({ observedOrderOffsets: ["-07:00"] });

    expect(diagnostics.warnings).toEqual([]);
    expect(diagnostics.timestampDiagnostics.encoding).toBe("OFFSET_AWARE");
  });

  it("treats mixed explicit offsets as mixed offset-aware without warning", async () => {
    const diagnostics = await getDiagnostics({ observedOrderOffsets: ["+00:00", "-07:00"] });

    expect(diagnostics.warnings).toEqual([]);
    expect(diagnostics.timestampDiagnostics.encoding).toBe("MIXED_OFFSET_AWARE");
  });

  it("warns when timezone source is unverified", async () => {
    const diagnostics = await getDiagnostics(
      { observedOrderOffsets: ["+00:00"] },
      { timezoneSource: "platform_shop_api", timezoneVerifiedAt: null }
    );

    expect(diagnostics.warnings).toContain("店铺时区尚未完成平台或人工验证。");
  });

  it("warns when the last sync did not completely cover the selected date range", async () => {
    const diagnostics = await getDiagnostics({ observedOrderOffsets: ["+00:00"], coverageComplete: false });

    expect(diagnostics.lastSyncWindow.coverageComplete).toBe(false);
    expect(diagnostics.warnings).toContain("最近一次订单同步未完整覆盖所选日期范围。");
  });

  it("warns when the last sync reached the pagination safety cap", async () => {
    const diagnostics = await getDiagnostics({ observedOrderOffsets: ["+00:00"], truncated: true });

    expect(diagnostics.lastSyncWindow.truncated).toBe(true);
    expect(diagnostics.warnings).toContain("最近一次订单同步达到分页安全上限，数据可能不完整。");
  });

  it("warns when the last sync has failed slices without returning slice details", async () => {
    const diagnostics = await getDiagnostics({
      observedOrderOffsets: ["+00:00"],
      failedSlices: [{ start: "2026-07-01", end: "2026-07-02" }]
    });

    expect(diagnostics.lastSyncWindow.failedSlicesCount).toBe(1);
    expect(diagnostics.lastSyncWindow.failedSlices).toBeUndefined();
    expect(diagnostics.warnings).toContain("最近一次订单同步存在失败分片，请查看同步详情。");
  });

  it("queries successful store order sync logs by taskType instead of type", async () => {
    await getDiagnostics({ observedOrderOffsets: ["+00:00"] });

    expect(prismaMock.syncLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        storeId: 1,
        taskType: "sync_store_orders",
        status: "success"
      })
    }));
    expect(prismaMock.syncLog.findFirst.mock.calls[0][0].where.type).toBeUndefined();
  });
});
