import fs from "node:fs";
import path from "node:path";

type Status = "PASS" | "FAIL" | "WARNING";

interface CheckResult {
  name: string;
  status: Status;
  details: string;
}

const root = process.cwd();

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function check(name: string, condition: boolean, passDetails: string, failDetails: string, statusOnFalse: Status = "FAIL"): CheckResult {
  return {
    name,
    status: condition ? "PASS" : statusOnFalse,
    details: condition ? passDetails : failDetails,
  };
}

function printResults(title: string, results: CheckResult[]) {
  console.log(`\n${title}`);
  for (const result of results) {
    console.log(`[${result.status}] ${result.name} - ${result.details}`);
  }
}

const settingsRoutes = readFile("src/server/routes/settings.routes.ts");
const metaConfigPage = readFile("src/components/MetaConfigPage.tsx");
const accountsRoutes = readFile("src/server/routes/accounts.routes.ts");
const mappingsRoutes = readFile("src/server/routes/mappings.routes.ts");
const storesRoutes = readFile("src/server/routes/stores.routes.ts");

const syncCenterFiles = [
  ["settings save", settingsRoutes],
  ["stores save", storesRoutes],
  ["mappings save", mappingsRoutes],
];

const results: CheckResult[] = [
  check(
    "GET /api/settings masks sensitive values",
    settingsRoutes.includes("isSensitiveSettingKey") &&
      settingsRoutes.includes("maskSecret") &&
      settingsRoutes.includes('normalized.includes("TOKEN")') &&
      settingsRoutes.includes("config[s.key] = isSensitiveSettingKey(s.key) ? maskSecret(s.value) : s.value"),
    "settings response uses maskSecret for TOKEN/SECRET/API_KEY/ACCESS_KEY keys",
    "settings response is not statically proven to mask sensitive values"
  ),
  check(
    "MetaConfigPage tracks saved token without storing the mask as the real token",
    metaConfigPage.includes("hasSavedToken") &&
      metaConfigPage.includes("maskedToken") &&
      metaConfigPage.includes("setToken('')") &&
      !metaConfigPage.includes("setToken(fbToken)") &&
      !metaConfigPage.includes("localStorage"),
    "frontend keeps only saved-token state and masked display text",
    "frontend may still store masked/full token as editable token or localStorage state"
  ),
  check(
    "MetaConfigPage manual fetch does not depend on token state",
    /const\s+fetchAccountsAndTest\s*=\s*async\s*\(\s*\)/.test(metaConfigPage) &&
      metaConfigPage.includes("fetchAccountsAndTest();") &&
      !metaConfigPage.includes("fetchAccountsAndTest(token") &&
      !metaConfigPage.includes("currentToken"),
    "manual fetch calls backend diagnostics and active-list without passing frontend token state",
    "manual fetch may still short-circuit on masked token state"
  ),
  check(
    "MetaConfigPage calls token diagnostic and active-list endpoints",
    metaConfigPage.includes("axios.get('/api/accounts/test-token')") &&
      metaConfigPage.includes("axios.get('/api/accounts/active-list')"),
    "frontend requests /api/accounts/test-token and /api/accounts/active-list",
    "frontend does not statically call both required account endpoints"
  ),
  check(
    "/api/accounts/active-list reads token on the backend",
    /router\.get\("\/active-list"[\s\S]*?getMetaToken\(\)/.test(accountsRoutes) &&
      accountsRoutes.includes('token.includes("...")'),
    "active-list uses getMetaToken() from DB/settings and rejects masked tokens",
    "active-list token source or masked-token rejection is missing"
  ),
  check(
    "/api/mappings/batch rejects empty accountId",
    mappingsRoutes.includes("INVALID_ACCOUNT_ID") && mappingsRoutes.includes("accountId is required and cannot be empty"),
    "empty accountId returns INVALID_ACCOUNT_ID",
    "empty accountId rejection is missing"
  ),
  check(
    "/api/mappings/batch rejects missing AdAccount",
    mappingsRoutes.includes("ACCOUNT_NOT_FOUND") &&
      mappingsRoutes.includes("prisma.adAccount.findUnique") &&
      !mappingsRoutes.includes("prisma.store.create"),
    "mappings require an existing AdAccount and do not auto-create stores",
    "mappings may allow unknown accounts or auto-create stores"
  ),
  check(
    "Unmap keeps AdAccount and sets storeId null",
    mappingsRoutes.includes("action: 'unmapped'") &&
      mappingsRoutes.includes("prisma.adAccount.update") &&
      mappingsRoutes.includes("data: { storeId: null }"),
    "unmap updates AdAccount.storeId to null instead of deleting the account",
    "unmap preservation contract is missing"
  ),
  check(
    "DELETE AdAccount endpoint is disabled",
    storesRoutes.includes('router.delete("/:id/accounts/:accountId"') &&
      storesRoutes.includes("status(410)") &&
      storesRoutes.includes("AdAccount deletion is disabled. Use unmap instead."),
    "legacy delete endpoint returns HTTP 410 with the required message",
    "legacy AdAccount delete endpoint is not disabled"
  ),
  check(
    "Store GET returns safe DTO",
    storesRoutes.includes("function sanitizeStore") &&
      storesRoutes.includes("shopline_token_configured") &&
      storesRoutes.includes("res.json(stores.map(sanitizeStore))") &&
      storesRoutes.includes("res.json(sanitizeStore(store))"),
    "store list/detail responses omit raw platform tokens and expose configured flags",
    "store list/detail safe DTO contract is missing"
  ),
  check(
    "Store save preserves existing token unless user enters a new token",
    storesRoutes.includes("function isTokenInput") &&
      storesRoutes.includes('!value.includes("...")') &&
      storesRoutes.includes("dataToSave[tokenField] = submittedToken") &&
      storesRoutes.includes("const existingToken = existingStore?.[tokenField] || \"\""),
    "blank or masked token input is not used to overwrite existing store tokens",
    "store save may overwrite an existing token with blank/masked input"
  ),
  ...syncCenterFiles.map(([name, file]) =>
    check(
      `${name} does not trigger SyncCenter`,
      !file.includes("SyncCenter"),
      "no SyncCenter reference in this save route",
      "save route contains SyncCenter reference"
    )
  ),
];

printResults("CONFIG CONTRACT SMOKE", results);

const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARNING");

console.log(`\nSummary: ${results.length - failures.length - warnings.length} passed, ${warnings.length} warnings, ${failures.length} failed.`);

if (failures.length > 0) {
  process.exit(1);
}

