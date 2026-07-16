import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { axiosGet, prismaMock } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  prismaMock: {
    adAccount: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    ad: { findUnique: vi.fn() },
    factMetaPerformance: { findUnique: vi.fn(), upsert: vi.fn() },
    syncLog: { create: vi.fn() }
  }
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));
vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({
  getMetaToken: vi.fn().mockResolvedValue("token"),
  getNumericAccountId: (value: string) => value.replace("act_", ""),
  normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}`
}));

import {
  fetchMetaInsightEdges,
  syncMetaInsightsForActiveAccounts
} from "./meta-insights.service";

beforeEach(() => {
  vi.clearAllMocks();
  const account = {
    fb_account_id: "act_1",
    fb_account_name: "Account 1",
    currency: "USD",
    store: null
  };
  prismaMock.adAccount.findMany.mockResolvedValue([account]);
  prismaMock.adAccount.findUnique.mockResolvedValue(account);
  prismaMock.factMetaPerformance.findUnique.mockResolvedValue(null);
  prismaMock.factMetaPerformance.upsert.mockResolvedValue({});
  prismaMock.ad.findUnique.mockResolvedValue(null);
  prismaMock.syncLog.create.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Meta insight completeness", () => {
  it("marks a remaining next page as truncated at maxPages", async () => {
    axiosGet.mockResolvedValue({
      data: {
        data: [{ date_start: "2026-07-01" }],
        paging: { cursors: { after: "next" }, next: "https://next" }
      }
    });

    const receipt = await fetchMetaInsightEdges("/act_1/insights", {}, "token", 1);

    expect(receipt.truncated).toBe(true);
    expect(receipt.coverageComplete).toBe(false);
    expect(receipt.failedSlices[0]).toMatchObject({ truncated: true });
  });

  it("returns PARTIAL_SUCCESS when one level fails after another level saved rows", async () => {
    vi.useFakeTimers();
    const accountRow = {
      date_start: "2026-07-01",
      spend: "10",
      impressions: "100",
      clicks: "10",
      actions: [],
      action_values: []
    };
    axiosGet.mockResolvedValueOnce({ data: { data: [accountRow], paging: {} } });
    for (let index = 0; index < 5; index++) {
      axiosGet.mockRejectedValueOnce({
        response: { data: { error: { message: "campaign failed", code: 190 } } }
      });
    }
    axiosGet.mockResolvedValue({ data: { data: [], paging: {} } });

    const promise = syncMetaInsightsForActiveAccounts({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      accountId: "act_1"
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.recordsSaved).toBe(1);
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(result.failedAccounts).toEqual([
      expect.objectContaining({ accountId: "act_1", level: "campaign", message: "campaign failed" })
    ]);
    expect(result.coverageComplete).toBe(false);
  });
});
