import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, axiosGet } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  prismaMock: {
    syncLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    adAccount: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    campaign: { upsert: vi.fn() },
    adSet: { upsert: vi.fn(), findUnique: vi.fn() },
    ad: { upsert: vi.fn() },
    adCreative: { findUnique: vi.fn(), create: vi.fn() }
  }
}));

vi.mock("axios", () => ({ default: { get: axiosGet } }));
vi.mock("../../db/index.js", () => ({ default: prismaMock }));
vi.mock("../utils.js", () => ({
  getMetaToken: vi.fn().mockResolvedValue("token"),
  normalizeMetaAccountId: (value: string) => value.startsWith("act_") ? value : `act_${value}`
}));
vi.mock("./meta-hierarchy-sync.service.js", () => ({ ensureAdAccounts: vi.fn() }));
vi.mock("./meta-insights.service.js", () => ({ syncMetaInsightsForActiveAccounts: vi.fn() }));
vi.mock("./meta-audience-breakdown-sync.service.js", () => ({ syncMetaAudienceBreakdown: vi.fn() }));
vi.mock("./store-sync.service.js", () => ({ syncStoreData: vi.fn() }));
vi.mock("./metaFetchPatch.service.js", () => ({ extractMetaAssetHash: vi.fn() }));

import { SyncCenter } from "./sync-center.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.syncLog.findFirst.mockResolvedValue(null);
  prismaMock.syncLog.create.mockResolvedValue({});
  prismaMock.syncLog.update.mockResolvedValue({});
});

describe("SyncCenter canonical receipts", () => {
  it("writes taskType, range columns, and scope evidence from the request", async () => {
    await SyncCenter.runTask(
      "sync_meta_insights",
      "meta",
      "test",
      "chain-1",
      null,
      null,
      "act_1",
      async () => ({ recordsFetched: 1, recordsSaved: 1 }),
      {
        rangeStart: "2026-07-01",
        rangeEnd: "2026-07-07",
        scopeKey: "account:act_1",
        coverageComplete: true
      }
    );

    expect(prismaMock.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskType: "sync_meta_insights",
        adAccountId: "act_1",
        rangeStart: expect.any(Date),
        rangeEnd: expect.any(Date)
      })
    });
    const createMetadata = JSON.parse(prismaMock.syncLog.create.mock.calls[0][0].data.metadata);
    expect(createMetadata).toMatchObject({
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-07",
      scopeKey: "account:act_1",
      coverageComplete: true
    });
  });

  it("records a single-account structure error in failedAccounts", async () => {
    prismaMock.adAccount.findMany.mockResolvedValue([{
      fb_account_id: "act_1",
      storeId: null,
      store: null,
      updatedAt: new Date()
    }]);
    axiosGet.mockRejectedValue(new Error("structure unavailable"));

    await SyncCenter.syncMetaStructure("chain-2", "test", null, { accountId: "act_1" });

    const updateData = prismaMock.syncLog.update.mock.calls.at(-1)[0].data;
    const metadata = JSON.parse(updateData.metadata);
    expect(updateData.status).toBe("failed");
    expect(metadata.status).toBe("FAILED");
    expect(metadata.failedAccounts).toEqual([
      { accountId: "act_1", message: "structure unavailable" }
    ]);
    expect(metadata.coverageComplete).toBe(false);
  });
});
