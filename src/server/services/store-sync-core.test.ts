import { describe, expect, it } from "vitest";
import { fetchStoreOrdersCanonical } from "./store-sync-core";

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
});
