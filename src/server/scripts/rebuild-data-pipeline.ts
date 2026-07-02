import { runDataCenterRebuild } from "../services/data-center-rebuild.service.js";

async function main() {
  const startDate = process.env.START_DATE || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = process.env.END_DATE || new Date().toISOString().slice(0, 10);

  const result = await runDataCenterRebuild({
    startDate,
    endDate,
    storeId: process.env.STORE_ID || null,
    accountId: process.env.ACCOUNT_ID || null,
    includeMetaAccounts: process.env.INCLUDE_META_ACCOUNTS !== "false",
    includeMetaStructure: process.env.INCLUDE_META_STRUCTURE !== "false",
    includeMetaRawFacts: process.env.INCLUDE_META_RAW_FACTS !== "false",
    includeMetaLedger: process.env.INCLUDE_META_LEDGER !== "false",
    includeAudience: process.env.INCLUDE_AUDIENCE !== "false",
    includeStoreOrders: process.env.INCLUDE_STORE_ORDERS !== "false",
    includeStoreLedger: process.env.INCLUDE_STORE_LEDGER !== "false",
    rebuildStoreOrders: process.env.REBUILD_STORE_ORDERS === "true"
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.success || result.status === "FAILED") {
    process.exit(1);
  }
}

main().catch(error => {
  console.error("Data Center rebuild failed:", error);
  process.exit(1);
});
