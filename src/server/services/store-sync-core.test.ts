import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosGet } = vi.hoisted(() => ({
  axiosGet: vi.fn()
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));

import { fetchStoreOrdersCanonical } from "./store-sync-core";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("store sync core verified timezone contract", () => {
  it("rejects non-IANA timezone before requesting platform orders", async () => {
    await expect(fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "GMT-7"
    })).rejects.toMatchObject({ code: "STORE_TIMEZONE_UNVERIFIED" });
  });

  it("PAGE-01 natural end marks coverage complete", async () => {
    axiosGet.mockResolvedValue({ status: 200, data: { data: [] }, headers: {} });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(result.coverageComplete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.diagnostics.paginationTermination).toBe("EMPTY_PAGE");
  });

  it("PAGE-03 page 50 with next page marks truncated", async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      data: { data: [{ id: "order-1", financial_status: "paid", created_at: "2026-07-01T12:00:00Z", line_items: [] }] },
      headers: { link: '<https://shop.example.com/admin/openapi/v20260601/orders.json?page_info=next>; rel="next"' }
    });

    const result = await fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    });

    expect(axiosGet).toHaveBeenCalledTimes(50);
    expect(result.coverageComplete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.diagnostics.paginationTermination).toBe("PAGE_LIMIT");
    expect(result.failedSlices[0]).toMatchObject({ reason: "PAGE_LIMIT", truncated: true });
  });

  it("PAGE-04 request error rejects before claiming complete coverage", async () => {
    axiosGet.mockRejectedValue(new Error("network down"));

    await expect(fetchStoreOrdersCanonical({
      platform: "shopline",
      storeId: 1,
      domain: "shop.example.com",
      token: "token",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      timezone: "America/Los_Angeles"
    })).rejects.toThrow("network down");
  });
});
