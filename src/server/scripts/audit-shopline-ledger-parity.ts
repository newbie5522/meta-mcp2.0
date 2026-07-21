import prisma from "../../db/index.js";
import { buildStoreLedgerProjectionComparison, type StoreLedgerProjection } from "../services/store-ledger-projection.service.js";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function money(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : 0;
}

function parseOrderIdsJson(value: unknown) {
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function baselineByDate(rows: any[]) {
  return rows.map(row => ({
    date: row.date,
    orderCount: Number(row.orderCount || 0),
    grossSales: money(row.grossSales),
    aov: Number(row.orderCount || 0) > 0 ? money(Number(row.grossSales || 0) / Number(row.orderCount || 0)) : 0,
    orderIds: parseOrderIdsJson(row.orderIdsJson)
  }));
}

function totals(days: Array<{ orderCount: number; grossSales: number }>) {
  const orderCount = days.reduce((sum, day) => sum + Number(day.orderCount || 0), 0);
  const grossSales = money(days.reduce((sum, day) => sum + Number(day.grossSales || 0), 0));
  return { orderCount, grossSales };
}

function projectionDayMap(projection: StoreLedgerProjection) {
  return new Map(projection.days.map(day => [day.date, day]));
}

function idSet(days: Array<{ orderIds: string[] }>) {
  return new Set(days.flatMap(day => day.orderIds || []));
}

function diffSets(left: Set<string>, right: Set<string>) {
  return Array.from(left).filter(value => !right.has(value)).sort();
}

function compareDaily(baselineDays: ReturnType<typeof baselineByDate>, projection: StoreLedgerProjection, label: string) {
  const mismatches: any[] = [];
  const projectionDays = projectionDayMap(projection);
  const dates = Array.from(new Set([
    ...baselineDays.map(day => day.date),
    ...projection.days.map(day => day.date)
  ])).sort();

  for (const date of dates) {
    const baseline = baselineDays.find(day => day.date === date) || { date, orderCount: 0, grossSales: 0, aov: 0, orderIds: [] };
    const projected = projectionDays.get(date) || { date, orderCount: 0, grossSales: 0, aov: 0, orderIds: [] };
    const countDiff = Number(projected.orderCount || 0) - Number(baseline.orderCount || 0);
    const grossSalesDiff = money(Number(projected.grossSales || 0) - Number(baseline.grossSales || 0));
    const aovDiff = money(Number(projected.aov || 0) - Number(baseline.aov || 0));
    if (countDiff !== 0 || Math.abs(grossSalesDiff) > 0.01 || Math.abs(aovDiff) > 0.01) {
      mismatches.push({
        projection: label,
        date,
        baseline: {
          orderCount: baseline.orderCount,
          grossSales: baseline.grossSales,
          aov: baseline.aov
        },
        projected: {
          orderCount: projected.orderCount,
          grossSales: projected.grossSales,
          aov: projected.aov
        },
        diff: { orderCount: countDiff, grossSales: grossSalesDiff, aov: aovDiff }
      });
    }
  }
  return mismatches;
}

async function main() {
  const storeId = Number(requiredEnv("STORE_ID"));
  const startDate = requiredEnv("START_DATE");
  const endDate = requiredEnv("END_DATE");
  if (!Number.isInteger(storeId) || storeId <= 0) throw new Error("STORE_ID must be a positive integer");

  const [store, orders, ledgerRows] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, platform: true }
    }),
    prisma.order.findMany({
      where: {
        storeId,
        OR: [
          { store_local_date: { gte: startDate, lte: endDate } },
          { store_local_date: null }
        ]
      },
      orderBy: [{ store_local_date: "asc" }, { createdAt: "asc" }]
    }),
    prisma.dataCenterStoreDaily.findMany({
      where: {
        storeId,
        date: { gte: startDate, lte: endDate }
      },
      orderBy: { date: "asc" }
    })
  ]);

  const rows = orders.map(order => ({
    ...order,
    storePlatform: store?.platform || "shopline"
  }));
  const comparison = buildStoreLedgerProjectionComparison({ storeId, startDate, endDate, rows });
  const baselineDays = baselineByDate(ledgerRows);
  const baseline = totals(baselineDays);
  const canonical = {
    orderCount: comparison.canonicalProjection.totalOrderCount,
    grossSales: comparison.canonicalProjection.totalGrossSales
  };
  const compatibility = {
    orderCount: comparison.shoplineCompatibilityProjection.totalOrderCount,
    grossSales: comparison.shoplineCompatibilityProjection.totalGrossSales
  };
  const baselineIds = idSet(baselineDays);
  const canonicalIds = idSet(comparison.canonicalProjection.days);
  const compatibilityIds = idSet(comparison.shoplineCompatibilityProjection.days);
  const dailyMismatches = [
    ...compareDaily(baselineDays, comparison.canonicalProjection, "canonical"),
    ...compareDaily(baselineDays, comparison.shoplineCompatibilityProjection, "compatibility")
  ];
  const missingOrderIds = [
    ...diffSets(baselineIds, canonicalIds).map(orderId => ({ projection: "canonical", orderId })),
    ...diffSets(baselineIds, compatibilityIds).map(orderId => ({ projection: "compatibility", orderId }))
  ];
  const extraOrderIds = [
    ...diffSets(canonicalIds, baselineIds).map(orderId => ({ projection: "canonical", orderId })),
    ...diffSets(compatibilityIds, baselineIds).map(orderId => ({ projection: "compatibility", orderId }))
  ];
  const amountMismatches = dailyMismatches.filter(item => Math.abs(item.diff.grossSales) > 0.01);
  const dateMismatches = dailyMismatches.filter(item => item.diff.orderCount !== 0);
  const statusMismatches = comparison.warnings
    .filter(warning => warning.includes("STATUS"))
    .map(warning => ({ warning }));
  const pass =
    baseline.orderCount === canonical.orderCount &&
    baseline.orderCount === compatibility.orderCount &&
    Math.abs(baseline.grossSales - canonical.grossSales) <= 0.01 &&
    Math.abs(baseline.grossSales - compatibility.grossSales) <= 0.01 &&
    dailyMismatches.length === 0 &&
    missingOrderIds.length === 0 &&
    extraOrderIds.length === 0 &&
    amountMismatches.length === 0 &&
    dateMismatches.length === 0;

  console.log(JSON.stringify({
    storeId,
    store: store ? { id: store.id, name: store.name, platform: store.platform } : null,
    period: { startDate, endDate },
    baseline,
    canonical,
    compatibility,
    dailyMismatches,
    missingOrderIds,
    extraOrderIds,
    amountMismatches,
    dateMismatches,
    statusMismatches,
    warnings: comparison.warnings,
    pass
  }, null, 2));
}

main()
  .catch(error => {
    console.error(JSON.stringify({
      pass: false,
      error: error?.message || String(error)
    }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
