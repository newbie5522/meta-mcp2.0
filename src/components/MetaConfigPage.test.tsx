import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSyncedAccounts, isPartialAccountSync } from "./MetaConfigPage";

const repoRoot = process.cwd();

function source(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Meta configuration contract", () => {
  it("CONFIG-01 test-token is POST", () => {
    const routes = source("src/server/routes/accounts.routes.ts");
    expect(routes).toContain('router.post("/test-token"');
    expect(routes).not.toContain('router.get("/test-token"');
  });

  it("CONFIG-02 GET active-list is read-only", () => {
    const routes = source("src/server/routes/accounts.routes.ts");
    const start = routes.indexOf('router.get("/active-list"');
    const end = routes.indexOf('router.post("/active-list/sync"');
    const getHandler = routes.slice(start, end);

    expect(getHandler).toContain("prisma.adAccount.findMany");
    expect(getHandler).not.toContain("axios.");
    expect(getHandler).not.toContain(".upsert(");
    expect(getHandler).not.toContain(".create(");
  });

  it("CONFIG-03 POST active-list sync writes", () => {
    const routes = source("src/server/routes/accounts.routes.ts");
    const syncHandler = routes.slice(routes.indexOf('router.post("/active-list/sync"'));

    expect(syncHandler).toContain("axios.get");
    expect(syncHandler).toContain("prisma.adAccount.upsert");
    expect(syncHandler).toContain("prisma.syncLog.create");
  });

  it("CONFIG-04 sync limit returns PARTIAL_SUCCESS", () => {
    const routes = source("src/server/routes/accounts.routes.ts");

    expect(routes).toContain("let truncatedByLimit = false");
    expect(routes).toContain('const syncStatus = truncated || rateLimited ? "PARTIAL_SUCCESS" : "SUCCESS"');
    expect(routes).toContain("status: syncStatus");
  });

  it("CONFIG-05 rate limit returns PARTIAL_SUCCESS", () => {
    const routes = source("src/server/routes/accounts.routes.ts");

    expect(routes).toContain("const rateLimited = Boolean(isRateLimited)");
    expect(routes).toContain('const syncStatus = truncated || rateLimited ? "PARTIAL_SUCCESS" : "SUCCESS"');
    expect(routes).toContain("coverageComplete: !truncated && !rateLimited");
  });

  it("CONFIG-06 page uses POST endpoints", () => {
    const page = source("src/components/MetaConfigPage.tsx");

    expect(page).toContain("axios.post('/api/accounts/test-token')");
    expect(page).toContain("axios.post('/api/accounts/active-list/sync')");
    expect(page).not.toContain("axios.get('/api/accounts/test-token')");
    expect(page).not.toContain("axios.get('/api/accounts/active-list')");
  });

  it("CONFIG-07 partial result still displays returned accounts", () => {
    const data = {
      status: "PARTIAL_SUCCESS",
      accounts: [{ id: "act_1", name: "Account 1" }]
    };

    expect(isPartialAccountSync(data)).toBe(true);
    expect(extractSyncedAccounts(data)).toEqual([{ id: "act_1", name: "Account 1" }]);
  });
});
