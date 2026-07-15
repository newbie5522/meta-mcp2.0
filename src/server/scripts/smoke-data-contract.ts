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

function modelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model\\s+${modelName}\\s+\\{[\\s\\S]*?\\n\\}`));
  return match ? match[0] : "";
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

const schema = readFile("prisma/schema.prisma");
const adAccountModel = modelBlock(schema, "AdAccount");
const accountMappingModel = modelBlock(schema, "AccountMapping");
const orderModel = modelBlock(schema, "Order");

const accountsRoutes = readFile("src/server/routes/accounts.routes.ts");
const mappingsRoutes = readFile("src/server/routes/mappings.routes.ts");
const syncRoutes = readFile("src/server/routes/sync.routes.ts");
const syncManualGuard = readFile("src/server/services/sync-manual-guard.ts");
const dataCenterRoutes = readFile("src/server/routes/data-center.routes.ts");
const orderFactService = readFile("src/server/services/order-fact.service.ts");
const storeSyncService = readFile("src/server/services/store-sync.service.ts");
const metaPerformanceFactService = readFile("src/server/services/meta-performance-fact.service.ts");
const mappingFactService = readFile("src/server/services/mapping-fact.service.ts");
const auditService = readFile("src/server/services/data-pipeline-audit.service.ts");
const metaHierarchySyncService = readFile("src/server/services/meta-hierarchy-sync.service.ts");

const adAccountRuntimeFiles = [
  ["src/server/routes/accounts.routes.ts", accountsRoutes],
  ["src/server/routes/mappings.routes.ts", mappingsRoutes],
  ["src/server/routes/sync.routes.ts", syncRoutes],
  ["src/server/services/meta-hierarchy-sync.service.ts", metaHierarchySyncService],
];
const adAccountDeleteHits = adAccountRuntimeFiles
  .filter(([, file]) => /prisma\.adAccount\.(delete|deleteMany)/.test(file))
  .map(([name]) => name);

const syncTriggerBlock = syncRoutes.slice(syncRoutes.indexOf('router.post("/sync/trigger"'));
const syncGuardCallIndex = syncTriggerBlock.indexOf("isManualSyncRequired({ taskType, rebuild, baselineRevenue })");
const syncChainIdIndex = syncTriggerBlock.indexOf("const chainId = uuidv4()");
const syncRunningCheckIndex = syncTriggerBlock.indexOf("assertNoRunningTask");
const safeViewTaskNames = [
  "sync_view_ad_hierarchy",
  "sync_view_audience",
  "sync_view_creatives",
  "sync_view_account_data",
  "sync_view_store_data",
  "sync_view_products"
];

const results: CheckResult[] = [
  check(
    "AdAccount.storeId is nullable",
    /storeId\s+Int\?/.test(adAccountModel) && /store\s+Store\?/.test(adAccountModel) && adAccountModel.includes("onDelete: SetNull"),
    "AdAccount can exist unmapped and store deletion sets storeId null",
    "AdAccount.storeId/store relation is not nullable or lacks SetNull"
  ),
  check(
    "AccountMapping.storeId is nullable",
    /storeId\s+Int\?/.test(accountMappingModel) && /store\s+Store\?/.test(accountMappingModel) && accountMappingModel.includes("onDelete: SetNull"),
    "AccountMapping can represent unmapped account history",
    "AccountMapping.storeId/store relation is not nullable or lacks SetNull"
  ),
  check(
    "Unmapped AdAccount can be written",
    adAccountModel.includes("storeId") &&
      accountMappingModel.includes("storeId") &&
      accountsRoutes.includes("let targetStoreId: number | null = null") &&
      accountsRoutes.includes("targetStoreId = null") &&
      accountsRoutes.includes("storeId: targetStoreId") &&
      mappingsRoutes.includes("data: { storeId: null }") &&
      mappingsRoutes.includes("storeId: null"),
    "active-list and mapping write paths preserve null storeId accounts without default binding",
    "unmapped AdAccount write path is not statically proven"
  ),
  check(
    "No runtime AdAccount delete in config/sync chain",
    adAccountDeleteHits.length === 0,
    "runtime config/sync files do not call prisma.adAccount.delete/deleteMany",
    `AdAccount delete call found in: ${adAccountDeleteHits.join(", ")}`
  ),
  check(
    "No defaultStore binding in AdAccount chain",
    !/(defaultStore|prisma\.store\.findFirst\(\))/.test(accountsRoutes + mappingsRoutes + metaHierarchySyncService),
    "AdAccount sync/mapping paths do not bind unknown accounts to a default store",
    "default store lookup/binding still exists in an AdAccount chain"
  ),
  check(
    "Order has store-local fact fields",
    ["created_at_utc", "store_timezone", "store_local_datetime", "store_local_date"].every((field) => orderModel.includes(field)),
    "Order schema contains UTC, timezone, local datetime, and local date fields",
    "Order schema is missing required time fact fields"
  ),
  check(
    "Store sync uses Store.timezone for order windows",
    storeSyncService.includes("resolveStoreTimezoneForSync(store)") &&
      storeSyncService.includes("dayjs.tz(`${startDate}T00:00:00`, storeTimezone)") &&
      storeSyncService.includes("dayjs.tz(`${endDate}T23:59:59`, storeTimezone)"),
    "store sync derives request windows from Store.timezone",
    "store sync timezone request-window contract is missing"
  ),
  check(
    "Store sync computes and filters store_local_date",
    storeSyncService.includes("getStoreLocalDate") &&
      storeSyncService.includes("isStoreLocalDateWithinRange") &&
      storeSyncService.includes("store_local_date: storeLocalDate") &&
      storeSyncService.includes("store_local_datetime") &&
      storeSyncService.includes("created_at_utc"),
    "store sync writes local date/datetime/UTC fields and applies local-date range filtering",
    "store sync local-date fact write/filter contract is missing"
  ),
  check(
    "OrderFactService defaults createdAt fallback off",
    orderFactService.includes("includeLegacyCreatedAtFallback = false") &&
      orderFactService.includes("if (!includeLegacyCreatedAtFallback)") &&
      orderFactService.includes("store_local_date"),
    "Order fact reads Order.store_local_date unless explicit fallback is requested",
    "OrderFactService may default to createdAt fallback"
  ),
  check(
    "DataCenter default createdAt fallback is closed",
    !dataCenterRoutes.includes("includeLegacyCreatedAtFallback: true") &&
      dataCenterRoutes.includes("includeLegacyFallback") &&
      dataCenterRoutes.includes("legacyCreatedAtFallbackEnabled"),
    "DataCenter routes require includeLegacyFallback=true to enable legacy createdAt fallback",
    "DataCenter route still defaults to legacy createdAt fallback"
  ),
  check(
    "DataCenter does not fabricate reach from spend",
    !dataCenterRoutes.includes("spend / 0.15") && dataCenterRoutes.includes('reachSource: "not_available"'),
    "reach is marked unavailable instead of estimated from spend",
    "DataCenter still contains spend-derived reach estimation"
  ),
  check(
    "FactMetaPerformance is the Meta performance fact source",
    schema.includes("model FactMetaPerformance") &&
      metaPerformanceFactService.includes("factMetaPerformance") &&
      dataCenterRoutes.includes("getMetaAccountPerformanceFacts") &&
      dataCenterRoutes.includes('metaSource: "FactMetaPerformance"'),
    "Meta performance routes call the FactMetaPerformance fact service",
    "FactMetaPerformance fact-source contract is missing"
  ),
  check(
    "Mapping facts isolate unmapped spend",
    mappingFactService.includes("getAccountMappingFacts") &&
      mappingFactService.includes("unmappedSpendAccountsInRange") &&
      dataCenterRoutes.includes("unmappedAccountsSummary"),
    "unmapped spend is surfaced separately rather than merged into store ROAS",
    "mapping fact service contract is missing"
  ),
  check(
    "Data pipeline audit treats empty FactMetaPerformance as WARNING",
    auditService.includes("factMetaPerformanceRowsInRange === 0") &&
      auditService.includes("warnings.push") &&
      auditService.includes("FactMetaPerformance rows is empty"),
    "empty FactMetaPerformance creates a warning, not fabricated PASS data",
    "FactMetaPerformance empty-data audit warning is missing"
  ),
  check(
    "Dangerous sync endpoints require ENABLE_MANUAL_SYNC",
    safeViewTaskNames.every(taskType => syncManualGuard.includes(`"${taskType}"`)) &&
      syncManualGuard.includes("export function isManualSyncRequired") &&
      syncRoutes.includes("ENABLE_MANUAL_SYNC") &&
      syncRoutes.includes("MANUAL_SYNC_DISABLED") &&
      syncGuardCallIndex >= 0 &&
      syncChainIdIndex > syncGuardCallIndex &&
      syncRunningCheckIndex > syncGuardCallIndex &&
      syncRoutes.includes('router.get("/sync/status"') &&
      syncRoutes.includes('router.get("/sync/logs"'),
    "six safe view tasks are explicit; all other trigger work is guarded before chain/task work while status/logs remain open",
    "unified manual sync guard contract is missing or runs after task work"
  ),
];

printResults("DATA CONTRACT SMOKE", results);

const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARNING");

console.log(`\nSummary: ${results.length - failures.length - warnings.length} passed, ${warnings.length} warnings, ${failures.length} failed.`);

if (failures.length > 0) {
  process.exit(1);
}
