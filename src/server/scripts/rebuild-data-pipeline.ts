import prisma from "../../db/index.js";
import { fetchStoreOrdersCanonical, saveCanonicalOrdersToDb } from "../services/store-sync-core.ts";
import SyncCenter from "../services/sync-center.service.js";
import dayjs from "dayjs";

async function main() {
  console.log("==========================================================================");
  console.log("             REBUILD GLOBAL DATA PIPELINE PIPELINE MAIN RUNNER            ");
  console.log("==========================================================================");

  const rawStoreId = process.env.STORE_ID;
  const storeId = rawStoreId ? parseInt(rawStoreId, 10) : 1;
  const startDate = process.env.START_DATE || "2026-06-21";
  const endDate = process.env.END_DATE || "2026-06-21";
  
  const rawBaselineOrders = process.env.BASELINE_ORDERS;
  const rawBaselineRevenue = process.env.BASELINE_REVENUE;
  const baselineOrders = rawBaselineOrders ? parseInt(rawBaselineOrders, 10) : 17;
  const baselineRevenue = rawBaselineRevenue ? parseFloat(rawBaselineRevenue) : 715.78;

  console.log(`Targeting Store ID            : ${storeId}`);
  console.log(`Targeting Start Date          : ${startDate}`);
  console.log(`Targeting End Date            : ${endDate}`);
  console.log(`Baseline Order Count Target   : ${baselineOrders}`);
  console.log(`Baseline Sales Revenue Target: US$${baselineRevenue}`);

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) {
    console.error(`Status: BLOCKED - Store with ID=${storeId} does not exist in the database.`);
    process.exit(1);
  }

  console.log(`Found Store                   : ${store.name} (${store.platform})`);
  console.log(`Configured Store Timezone     : ${store.timezone}`);

  const platform = store.platform as any;
  const token = store.shopline_token || store.shopify_token || store.shoplazza_token;
  if (!token) {
    console.warn(`Warning: Store with ID=${storeId} has no API tokens configured. Using placeholder mock check for safety.`);
    process.exit(1);
  }

  // 1. Core Fetching via Sync Core with Dynamic Score Optimization
  console.log("\n[Pipeline core] Fetching canonical orders across platform APIs...");
  const result = await fetchStoreOrdersCanonical({
    platform,
    storeId,
    domain: store.domain,
    token,
    startDate,
    endDate,
    timezone: store.timezone || "America/Los_Angeles",
    baseline: {
      orders: baselineOrders,
      revenue: baselineRevenue
    }
  });

  console.log("\n[Pipeline core] Diagnostics Info:");
  console.log(JSON.stringify(result.diagnostics, null, 2));

  console.log(`\n[Pipeline core] Retrieved ${result.orders.length} valid canonical orders within date range.`);

  // 2. Transact Order fields and line item facts to database
  console.log("[Pipeline core] Saving canonical orders and line items to the database...");
  const saveStats = await saveCanonicalOrdersToDb(result.orders);
  console.log(`Database write success statistics: Fetched=${saveStats.fetched} | Saved=${saveStats.saved} | Updated=${saveStats.updated}`);

  // 3. Command summary regeneration pipeline
  console.log("\n[Pipeline core] Rebuilding daily rollups & dashboard ROAS summaries...");
  // We can calculate current days interval to rebuild summaries covering the date range
  const dateDays = dayjs(dayjs()).diff(dayjs(startDate), "day") + 5;
  const rebuildDays = Math.max(90, dateDays);

  const chainId = "sc-rebuild-chain-" + Math.random().toString(36).substring(2, 8);
  console.log(`Executing summaries with chain ID: ${chainId} and span: ${rebuildDays} days`);

  await SyncCenter.rebuildStoreSummary(chainId, "pipeline_rebuild", null, rebuildDays);
  await SyncCenter.rebuildRoasSummary(chainId, "pipeline_rebuild", null, rebuildDays);
  await SyncCenter.rebuildDashboardSummary(chainId, "pipeline_rebuild", null, rebuildDays);

  console.log("\n==========================================================================");
  console.log("            PIPELINE REBUILD TERMINATED SUCCESSFULLY!                     ");
  console.log("==========================================================================");
}

main()
  .catch(err => {
    console.error("Pipeline run failed with fatal error:", err);
    process.exit(1);
  });
