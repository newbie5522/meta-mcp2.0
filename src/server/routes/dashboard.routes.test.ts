import { beforeEach, describe, expect, it, vi } from "vitest";

const { summaryMock, freshnessMock, refreshMock } = vi.hoisted(() => ({
  summaryMock: vi.fn(),
  freshnessMock: vi.fn(),
  refreshMock: vi.fn()
}));

vi.mock("../services/dashboard.service.js", () => ({ getDashboardSummary: summaryMock }));
vi.mock("../services/data-center-auto-refresh.service.js", () => ({
  ensureDataCenterFreshness: refreshMock,
  getFreshnessMeta: freshnessMock
}));

import router from "./dashboard.routes";

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

function findRoute(method: "get" | "post", path: string) {
  return (router as any).stack.find((layer: any) =>
    layer.route?.path === path && layer.route?.methods?.[method]
  ).route.stack[0].handle;
}

describe("dashboard routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summaryMock.mockResolvedValue({
      dateRange: { startDate: "2026-07-01", endDate: "2026-07-07" },
      storeCoverage: { status: "READY" },
      metaCoverage: { status: "READY" },
      productCoverage: { status: "READY" }
    });
    freshnessMock.mockResolvedValue({ refreshing: false });
    refreshMock.mockResolvedValue({ status: "SUCCESS" });
  });

  it("OVERVIEW-01 GET dashboard has no refresh call", async () => {
    const handler = findRoute("get", "/");
    const res = responseMock();
    await handler({ query: { since: "2026-07-01", until: "2026-07-07" } }, res);

    expect(summaryMock).toHaveBeenCalledWith({
      since: new Date("2026-07-01"),
      until: new Date("2026-07-07")
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      storeCoverage: { status: "READY" },
      metaCoverage: { status: "READY" },
      productCoverage: { status: "READY" }
    });
  });

  it("OVERVIEW-02 POST refresh calls ensureDataCenterFreshness", async () => {
    const handler = findRoute("post", "/refresh");
    const res = responseMock();
    await handler({ body: { startDate: "2026-07-01", endDate: "2026-07-07", storeId: "5" } }, res);

    expect(refreshMock).toHaveBeenCalledWith({
      reason: "manual_internal",
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-07",
      storeId: 5,
      force: true,
      mode: "blocking"
    });
    expect(res.body).toEqual({ status: "SUCCESS" });
  });
});
