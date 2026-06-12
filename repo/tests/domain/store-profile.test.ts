import { describe, expect, it } from "vitest";
import { extractStoreProfile } from "../../src/domain/store-profile.js";

describe("store profile extraction", () => {
  it("extracts safe profile fields from nested platform payloads", () => {
    expect(extractStoreProfile({
      shop: {
        name: "Store A",
        currency_code: "USD",
        time_zone: "America/Los_Angeles",
        email: "private@example.com",
      },
    })).toEqual({
      name: "Store A",
      currency: "USD",
      timezone: "America/Los_Angeles",
    });
  });

  it("supports flat store payloads", () => {
    expect(extractStoreProfile({
      store_name: "Store B",
      default_currency: "EUR",
      timezone: "Europe/Paris",
    })).toEqual({
      name: "Store B",
      currency: "EUR",
      timezone: "Europe/Paris",
    });
  });
});
