import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, fetchPlatformStoreTimezoneMock } = vi.hoisted(() => ({
  prismaMock: {
    store: {
      findUnique: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findUnique.mockResolvedValue(null);
  prismaMock.store.findFirst.mockResolvedValue(null);
  prismaMock.store.create.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  prismaMock.store.update.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  prismaMock.order.count.mockResolvedValue(0);
});

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
