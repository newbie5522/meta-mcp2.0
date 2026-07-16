import { describe, expect, it } from "vitest";
import { resolveCampaignStructureFields } from "./data-center.routes";

describe("Data Center hierarchy response contract", () => {
  it("does not fabricate campaign objective, budget, or active status", () => {
    expect(resolveCampaignStructureFields({ region: "US" })).toEqual({
      status: "UNKNOWN",
      objective: null,
      budget: null
    });
  });

  it("preserves a real campaign status without inventing unavailable fields", () => {
    expect(resolveCampaignStructureFields({ status: "PAUSED", region: "US" })).toEqual({
      status: "PAUSED",
      objective: null,
      budget: null
    });
  });

  it("keeps unavailable campaign budget and objective explicit for canonical hierarchy consumers", () => {
    const fields = resolveCampaignStructureFields(null);

    expect(fields.objective).toBeNull();
    expect(fields.budget).toBeNull();
    expect(fields.status).toBe("UNKNOWN");
  });
});
