import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/server/services/data-coverage.service.ts"), "utf8");

describe("data coverage service contract", () => {
  it("COV-SVC-01 scope matching uses buildCoverageScopeKey", () => {
    expect(source).toContain("export function buildCoverageScopeKey");
    expect(source).toContain("matchesScope(log, metadata, query, scopeKey)");
  });

  it("COV-SVC-02 exact range is required", () => {
    expect(source).toContain("const exactRange = range.start === query.requestedStartDate && range.end === query.requestedEndDate");
    expect(source).toContain("if (!exactRange) continue");
  });

  it("COV-SVC-03 failed count includes failed accounts and failed slices", () => {
    expect(source).toContain("metadata.failedAccounts");
    expect(source).toContain("metadata.failedSlices");
    expect(source).toContain("failedCount");
  });

  it("COV-SVC-04 coverageComplete missing is not defaulted true", () => {
    expect(source).toContain("evidenceCoverageComplete = metadata.coverageComplete === true");
    expect(source).not.toContain("coverageComplete !== false");
  });

  it("COV-SVC-05 order facts use store_local_date", () => {
    expect(source).toContain('dateField = "store_local_date"');
  });
});
