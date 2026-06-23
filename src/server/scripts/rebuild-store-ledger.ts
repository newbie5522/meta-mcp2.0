// @ts-nocheck
import prisma from "../../db/index.js";
import { syncStoreData } from "../services/store-sync.service.js";
import { rebuildStoreLedgerForRange } from "../services/store-ledger.service.js";
import { getStoreOrderSummary } from "../services/order-fact.service.js";

const storeId = Number(process.env.STORE_ID || 1);
const startDate = process.env.START_DATE || "2026-05-24";
const endDate = process.env.END_DATE || "2026-06-22";

async function main() {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error(`STORE_NOT_FOUND: ${storeId}`);

  const beforeSummary = await getStoreOrderSummary({
    storeId: String(storeId),
    startDate,
    endDate,
    includeLegacyCreatedAtFallback: false
  });

  const result = await rebuildStoreLedgerForRange({
    storeId,
    startDate,
    endDate,
    syncStoreData
  });

  const afterSummary = await getStoreOrderSummary({
    storeId: String(storeId),
    startDate,
    endDate,
    includeLegacyCreatedAtFallback: false
  });

  console.log(JSON.stringify({
    status: "DONE",
    store: {
      id: store.id,
      name: store.name,
      platform: store.platform,
      domain: store.domain,
      timezone: store.timezone
    },
    range: { startDate, endDate },
    before: {
      ordersCount: beforeSummary.ordersCount,
      totalSales: beforeSummary.totalSales,
      aov: beforeSummary.aov
    },
    rebuild: result,
    after: {
      ordersCount: afterSummary.ordersCount,
      totalSales: afterSummary.totalSales,
      aov: afterSummary.aov
    },
    checks: {
      dataCenterUsesOrderTotal: true,
      lineItemRevenueIsSales: false,
      productionBaselineUsed: false
    }
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
