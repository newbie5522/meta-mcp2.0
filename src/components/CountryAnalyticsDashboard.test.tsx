import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(resolve(process.cwd(), "src/components/CountryAnalyticsDashboard.tsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/server/services/country-analytics.service.ts"), "utf8");
const routes = readFileSync(resolve(process.cwd(), "src/server/routes/data-center.routes.ts"), "utf8");

describe("Country analytics contract", () => {
  it("COUNTRY-01 old response ignored", () => {
    expect(component).toContain("shouldApplyLatestRequest");
    expect(component).toContain("countryRequestIdRef");
    expect(component).toContain("countryRequestKeyRef");
  });

  it("COUNTRY-02 canceled request does not clear new data", () => {
    expect(component).toContain("isCanceledRequest(requestError)");
    expect(component).toContain("if (!isCurrent() || isCanceledRequest(requestError)) return");
  });

  it("COUNTRY-03 meta unavailable remains N/A for structure-only countries", () => {
    expect(service).toContain("factRowCount");
    expect(service).toContain("hasMetaFacts");
    expect(routes).toContain("countryMetaMetric");
    expect(routes).toContain("row.hasMetaFacts");
  });
});
