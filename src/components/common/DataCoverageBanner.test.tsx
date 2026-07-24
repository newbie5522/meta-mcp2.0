import { describe, expect, it } from "vitest";
import { DataCoverageBanner, coverageClass } from "./DataCoverageBanner";

describe("DataCoverageBanner", () => {
  it("BANNER-01 READY hidden", () => {
    expect(DataCoverageBanner({ coverage: { status: "READY" } })).toBeNull();
  });

  it("BANNER-01B READY/COVERED/SUCCESS use green success class", () => {
    expect(coverageClass("READY")).toContain("emerald");
    expect(coverageClass("COVERED")).toContain("emerald");
    expect(coverageClass("SUCCESS")).toContain("emerald");
  });

  it("BANNER-02 RUNNING blue neutral", () => {
    expect(coverageClass("SYNC_RUNNING")).toContain("blue");
  });

  it("BANNER-03 NOT_SYNCED blue neutral", () => {
    expect(coverageClass("NOT_SYNCED")).toContain("blue");
  });

  it("BANNER-04 PARTIAL amber", () => {
    expect(coverageClass("PARTIAL_COVERAGE")).toContain("amber");
  });

  it("BANNER-05 ERROR red", () => {
    expect(coverageClass("ERROR")).toContain("red");
  });

  it("BANNER-06 TRUE_EMPTY green neutral", () => {
    expect(coverageClass("TRUE_EMPTY")).toContain("emerald");
  });
});
