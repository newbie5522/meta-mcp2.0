import prisma from "../../db/index.js";
import { fetchStoreOrdersCanonical } from "../services/store-sync-core.js";
import { normalizeTimezone as normalizeTimezoneUtil } from "../utils/timezone.js";
import { getStoreOrderSummary } from "../services/order-fact.service.js";

async function main() {
  const storeId = parseInt(process.env.STORE_ID || "1", 10);
  const startDate = process.env.START_DATE || "2026-06-22";
  const endDate = process.env.END_DATE || "2026-06-22";
  const baselineRevenue = parseFloat(process.env.BASELINE_REVENUE || "155.96");

  console.log(`[Trace Revenue] Starting trace for storeId=${storeId}, range=${startDate} to ${endDate}, baseline=${baselineRevenue}`);

  const store = await prisma.store.findUnique({
    where: { id: storeId }
  });

  if (!store) {
    console.error(`Store not found for ID ${storeId}`);
    process.exit(1);
  }

  const platform = store.platform as any;
  const token = platform === "shopify"
    ? store.shopify_token
    : platform === "shoplazza"
      ? store.shoplazza_token
      : store.shopline_token;

  if (!token) {
    console.error(`Token not found for store ID ${storeId}`);
    process.exit(1);
  }

  const timezoneBefore = store.timezone || "";
  const normalizedTimezone = normalizeTimezoneUtil(timezoneBefore, {
    id: store.id,
    domain: store.domain || "",
    name: store.name || ""
  });

  console.log(`[Trace Revenue] Normalized timezone: ${normalizedTimezone}`);

  // Fetch from DB before sync
  const currentOrdersInDb = await prisma.order.findMany({
    where: {
      storeId,
      store_local_date: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  const currentSummary = await getStoreOrderSummary({
    storeId: String(storeId),
    startDate,
    endDate
  });

  const currentOrderStats = new Map<string, { orderTotal: number, lineRevenueSum: number }>();
  for (const o of currentOrdersInDb) {
    const oId = o.orderId || o.id;
    if (!currentOrderStats.has(oId)) {
      currentOrderStats.set(oId, {
        orderTotal: o.orderTotal || 0,
        lineRevenueSum: o.revenue || 0
      });
    } else {
      const existing = currentOrderStats.get(oId)!;
      existing.lineRevenueSum = Number((existing.lineRevenueSum + (o.revenue || 0)).toFixed(2));
    }
  }

  // Fetch canonical orders with baseline context
  const canonical = await fetchStoreOrdersCanonical({
    platform,
    storeId,
    domain: store.domain || "",
    token,
    startDate,
    endDate,
    timezone: normalizedTimezone,
    storeName: store.name || "",
    baseline: {
      orders: undefined,
      revenue: baselineRevenue
    }
  });

  console.log(`\n--- Order Level Details (${canonical.orders.length} orders) ---`);
  for (const co of canonical.orders) {
    const dbStats = currentOrderStats.get(co.orderId);
    const currentOrderTotalVal = dbStats ? dbStats.orderTotal : 0;
    const currentLineRevenueSumVal = dbStats ? dbStats.lineRevenueSum : 0;

    console.log(`
orderId: ${co.orderId}
orderNumber: ${co.orderNumber}
storeLocalDate: ${co.storeLocalDate}
paymentStatus: ${co.paymentStatus}
total_price: ${co.revenueCandidates.total_price}
current_total_price: ${co.revenueCandidates.current_total_price}
total_amount: ${co.revenueCandidates.total_amount}
order_total: ${co.revenueCandidates.order_total}
subtotal_price: ${co.revenueCandidates.subtotal_price}
current_subtotal_price: ${co.revenueCandidates.current_subtotal_price}
total_discounts: ${co.revenueCandidates.total_discounts}
shipping_total: ${co.revenueCandidates.shipping_total}
total_tax: ${co.revenueCandidates.total_tax}
line_items_sum: ${co.revenueCandidates.line_items_sum}
current Order.orderTotal: ${currentOrderTotalVal}
current line revenue sum: ${currentLineRevenueSumVal}
recommendedRevenueField: ${co.revenueField}
recommendedOrderTotal: ${co.orderTotal}
`.trim());
  }

  // Aggregate sums over canonical orders
  const uniqueOrderCount = canonical.orders.length;
  let totalPriceSum = 0;
  let currentTotalPriceSum = 0;
  let totalAmountSum = 0;
  let orderTotalSum = 0;
  let subtotalPriceSum = 0;
  let currentSubtotalPriceSum = 0;
  let netSubtotalLessDiscountSum = 0;
  let lineItemsSumTotal = 0;
  let recommendedRevenue = 0;
  let currentOrderTotalSumInDb = 0;

  for (const co of canonical.orders) {
    totalPriceSum += (co.revenueCandidates.total_price || 0);
    currentTotalPriceSum += (co.revenueCandidates.current_total_price || 0);
    totalAmountSum += (co.revenueCandidates.total_amount || 0);
    orderTotalSum += (co.revenueCandidates.order_total || 0);
    subtotalPriceSum += (co.revenueCandidates.subtotal_price || 0);
    currentSubtotalPriceSum += (co.revenueCandidates.current_subtotal_price || 0);
    netSubtotalLessDiscountSum += (co.revenueCandidates.net_subtotal_less_discount || 0);
    lineItemsSumTotal += (co.revenueCandidates.line_items_sum || 0);
    recommendedRevenue += co.orderTotal;

    const dbStats = currentOrderStats.get(co.orderId);
    currentOrderTotalSumInDb += dbStats ? dbStats.orderTotal : 0;
  }

  const diffVal = recommendedRevenue - baselineRevenue;

  console.log(`
--- FINAL SUMMARY ---
uniqueOrderCount: ${uniqueOrderCount}
baselineRevenue: ${baselineRevenue.toFixed(2)}
total_price sum: ${totalPriceSum.toFixed(2)}
current_total_price sum: ${currentTotalPriceSum.toFixed(2)}
total_amount sum: ${totalAmountSum.toFixed(2)}
order_total sum: ${orderTotalSum.toFixed(2)}
subtotal_price sum: ${subtotalPriceSum.toFixed(2)}
current_subtotal_price sum: ${currentSubtotalPriceSum.toFixed(2)}
net_subtotal_less_discount sum: ${netSubtotalLessDiscountSum.toFixed(2)}
line_items_sum: ${lineItemsSumTotal.toFixed(2)}
current Order.orderTotal sum: ${currentOrderTotalSumInDb.toFixed(2)}
current DataCenter revenue: ${currentSummary.totalSales.toFixed(2)}
recommendedRevenueField: ${canonical.diagnostics.revenueField}
recommendedRevenue: ${recommendedRevenue.toFixed(2)}
diff: ${diffVal.toFixed(2)}
`.trim());

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
