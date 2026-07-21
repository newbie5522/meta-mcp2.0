import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("data center rebuild store caller contract", () => {
  it("routes store rebuild through the single store data pipeline", () => {
    const source = readFileSync("src/server/services/data-center-rebuild.service.ts", "utf8");
    expect(source).toContain("executeStoreDataPipeline");
    expect(source).not.toContain("refreshStoreDataCenterLedger");
  });
});
