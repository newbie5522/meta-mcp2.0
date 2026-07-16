import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosGet, prismaMock } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  prismaMock: {
    accountMapping: { findMany: vi.fn() },
    adAccount: { findMany: vi.fn() },
    factAudienceBreakdown: { findUnique: vi.fn(), upsert: vi.fn() }
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
  fetchAudienceBreakdownEdges,
  syncMetaAudienceBreakdown as canonicalSync
} from "./meta-audience-breakdown-sync.service";
import { syncMetaAudienceBreakdown as compatibilitySync } from "./audience-insights.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.accountMapping.findMany.mockResolvedValue([]);
  prismaMock.adAccount.findMany.mockResolvedValue([]);
  prismaMock.factAudienceBreakdown.findUnique.mockResolvedValue(null);
  prismaMock.factAudienceBreakdown.upsert.mockResolvedValue({});
});

describe("canonical Audience sync", () => {
  it("makes the compatibility entrypoint use the exact canonical implementation", () => {
    expect(compatibilitySync).toBe(canonicalSync);
  });

  it("reports maxPages truncation instead of a complete success", async () => {
    axiosGet.mockResolvedValue({
      data: {
        data: [{ date_start: "2026-07-01", country: "US" }],
        paging: { cursors: { after: "next" }, next: "https://next" }
      }
    });

    const receipt = await fetchAudienceBreakdownEdges("/act_1/insights", {}, "token", 1);

    expect(receipt.rows).toHaveLength(1);
    expect(receipt.truncated).toBe(true);
    expect(receipt.coverageComplete).toBe(false);
    expect(receipt.failedSlices[0]).toMatchObject({ truncated: true });
  });

  it("returns NO_NEW_DATA without inventing a failure for a complete empty response", async () => {
    prismaMock.adAccount.findMany.mockResolvedValue([{
      fb_account_id: "act_1",
      store: null
    }]);
    axiosGet.mockResolvedValue({ data: { data: [], paging: {} } });

    const result = await canonicalSync({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      accountIds: ["act_1"],
      dimensions: ["country"]
    });

    expect(result.status).toBe("NO_NEW_DATA");
    expect(result.coverageComplete).toBe(true);
    expect(result.failedAccounts).toEqual([]);
    expect(result.failedSlices).toEqual([]);
  });
});
