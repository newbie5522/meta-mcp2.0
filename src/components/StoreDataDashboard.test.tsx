import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/StoreDataDashboard.tsx"), "utf8");

describe("Store page request contract", () => {
  it("STORE-01 old response ignored", () => {
    expect(source).toContain("shouldApplyLatestRequest");
    expect(source).toContain("latestRequestIdRef");
    expect(source).toContain("latestRequestKeyRef");
  });

  it("STORE-02 canceled request does not toast", () => {
    expect(source).toContain("isCanceledRequest(error)");
    expect(source.indexOf("if (!isCurrent() || isCanceledRequest(error)) return")).toBeLessThan(source.indexOf("toast.error"));
  });

  it("STORE-03 request key excludes local search and sort", () => {
    const keyBlock = source.slice(source.indexOf("const currentRequestKey"), source.indexOf("const latestRequestIdRef"));
    expect(keyBlock).toContain('page: "stores"');
    expect(keyBlock).not.toContain("search");
    expect(keyBlock).not.toContain("sort");
  });
});
