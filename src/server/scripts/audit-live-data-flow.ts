import prisma from "../../db/index.js";
import { getMetaToken } from "../utils.js";
import dayjs from "dayjs";

async function main() {
  const startDate = dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const endDate = dayjs().format("YYYY-MM-DD");

  console.log("=================== LIVE DATA FLOW AUDIT ===================");

  // 1. Meta Token Presence
  let metaTokenExists = false;
  let maskedTokenStr = "None";
  try {
    const rawToken = await getMetaToken();
    if (rawToken) {
      metaTokenExists = true;
      if (rawToken.length > 8) {
        maskedTokenStr = `${rawToken.slice(0, 4)}...${rawToken.slice(-4)} (length: ${rawToken.length})`;
      } else {
        maskedTokenStr = "Present but very short";
      }
    }
  } catch (err: any) {
    console.error("Error retrieving Meta Token:", err.message);
  }
  console.log(`1. Meta Token Extracted: ${metaTokenExists ? "YES" : "NO"} (${maskedTokenStr})`);

  // 2. Counts
  const adAccountCount = await prisma.adAccount.count();
  console.log(`2. AdAccount Count: ${adAccountCount}`);

  const storeCount = await prisma.store.count();
  console.log(`3. Store Count: ${storeCount}`);

  // Production stores with token
  const productionStores = await prisma.store.findMany({
    where: {
      mode: { in: ["production", "生产"] }
    }
  });
  const productionWithTokenCount = productionStores.filter(
    s => s.shopify_token || s.shopline_token || s.shoplazza_token
  ).length;
  console.log(`4. Production and Token-bearing Store Count: ${productionWithTokenCount}`);

  // FactMetaPerformance metrics
  const factMetaTotalCount = await prisma.factMetaPerformance.count();
  const factMetaRangeCount = await prisma.factMetaPerformance.count({
    where: {
      date: { gte: startDate, lte: endDate }
    }
  });
  console.log(`5. FactMetaPerformance Total Count: ${factMetaTotalCount}`);
  console.log(`6. FactMetaPerformance Current Date Range [${startDate} ~ ${endDate}] Count: ${factMetaRangeCount}`);

  // Order metrics
  const orderTotalCount = await prisma.order.count();
  const orderRangeCount = await prisma.order.count({
    where: {
      store_local_date: { gte: startDate, lte: endDate }
    }
  });
  console.log(`7. Order Total Count: ${orderTotalCount}`);
  console.log(`8. Order Current Date Range [${startDate} ~ ${endDate}] Count: ${orderRangeCount}`);

  // Recent 10 SyncLogs
  console.log("\n9. Recent 10 SyncLogs:");
  const syncLogs = await prisma.syncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 10
  });

  if (syncLogs.length === 0) {
    console.log("   (No Sync Logs Found)");
  } else {
    for (const log of syncLogs) {
      let targetAccountsCount = "N/A";
      let targetStoresCount = "N/A";
      let recordsFailed = 0;
      if (log.metadata) {
        try {
          const meta = JSON.parse(log.metadata);
          if (meta.targetAccountsCount !== undefined) targetAccountsCount = meta.targetAccountsCount;
          if (meta.targetStoresCount !== undefined) targetStoresCount = meta.targetStoresCount;
          if (meta.recordsFailed !== undefined) recordsFailed = meta.recordsFailed;
        } catch (_) {}
      }

      console.log(`   - [${log.startedAt?.toISOString()}] Type: ${log.taskType || log.type} | Status: ${log.status}`);
      console.log(`     Fetched: ${log.recordsFetched || 0} | Saved: ${log.recordsSaved || 0} | Failed: ${recordsFailed}`);
      console.log(`     Target Accounts: ${targetAccountsCount} | Target Stores: ${targetStoresCount}`);
      if (log.errorMessage) {
        console.log(`     Error: ${log.errorMessage}`);
      }
    }
  }

  // Recent 5 FactMetaPerformances
  console.log("\n10. Recent 5 FactMetaPerformance Records:");
  const recentFacts = await prisma.factMetaPerformance.findMany({
    orderBy: { date: "desc" },
    take: 5
  });
  if (recentFacts.length === 0) {
    console.log("    (No performance records written yet)");
  } else {
    for (const f of recentFacts) {
      console.log(`    - ID: ${f.id} | Account: ${f.account_id} | Date: ${f.date} | Level: ${f.level} | Spend: ${f.spend || 0} | ROAS: ${f.roas || 0}`);
    }
  }

  // Recent 5 Orders
  console.log("\n11. Recent 5 Order Records:");
  const recentOrders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 5
  });
  if (recentOrders.length === 0) {
    console.log("    (No order records written yet)");
  } else {
    for (const o of recentOrders) {
      console.log(`    - Code: ${o.orderId || o.id} | StoreID: ${o.storeId} | Local Date: ${o.store_local_date} | Sales: ${o.revenue || o.orderTotal || 0} | Synced At: ${o.createdAt?.toISOString()}`);
    }
  }

  console.log("============================================================");
}

main()
  .catch((e) => {
    console.error("Audit Live Data Flow failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
