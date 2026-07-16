import { describe, expect, it } from "vitest";
import { buildAudienceClearedState } from "./AudienceAnalysisDashboard";

describe("Audience independent source reset contract", () => {
  it("clears Meta and Store audience state together when the request key changes", () => {
    expect(buildAudienceClearedState()).toEqual({
      data: [],
      summary: null,
      orderCountryRows: [],
      metaCoverage: null,
      storeCoverage: null,
      dataHealth: null,
      countriesHealth: null,
      viewNotice: null
    });
  });
});
