// @ts-nocheck
import prisma from "../../db/index.js";
import { buildCanonicalStoreLedgerProjection } from "./store-ledger-projection.service.js";

function dateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  for (let cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function projectionDayMap(days: any[]) {
  const map = new Map<string, any>();
  for (const day of days || []) {
    map.set(day.date, day);
  }
  return map;
}

export async function refreshStoreDataCenterLedger(params: {
  storeId: number;
  startDate: string;
  endDate: string;
  rangeVerified?: boolean;
}) {
  const store = await prisma.store.findUnique({
    where: { id: Number(params.storeId) }
  });

  if (!store) throw new Error(`STORE_NOT_FOUND:${params.storeId}`);

  const rows = await prisma.order.findMany({
    where: {
      storeId: store.id,
      store_local_date: {
        gte: params.startDate,
        lte: params.endDate
      }
    },
    orderBy: [
      { store_local_date: "asc" },
      { orderId: "asc" },
      { id: "asc" }
    ]
  });

  const projection = buildCanonicalStoreLedgerProjection({
    storeId: store.id,
    startDate: params.startDate,
    endDate: params.endDate,
    rows
  });

  const byDate = projectionDayMap(projection.days);
  const writeDates = params.rangeVerified
    ? dateRange(params.startDate, params.endDate)
    : Array.from(byDate.keys()).sort();

  const snapshots = [];
  for (const date of writeDates) {
    const day = byDate.get(date) || {
      date,
      orderCount: 0,
      grossSales: 0,
      aov: 0,
      orderIds: []
    };
    const grossSales = roundMoney(day.grossSales || 0);
    const orderCount = Number(day.orderCount || 0);
    const aov = orderCount > 0 ? roundMoney(grossSales / orderCount) : 0;
    const digestObj = {
      source: "Order",
      dateField: "Order.store_local_date",
      orderIds: day.orderIds || []
    };

    const snapshot = await prisma.dataCenterStoreDaily.upsert({
      where: {
        storeId_date: {
          storeId: store.id,
          date
        }
      },
      update: {
        storeName: store.name,
        platform: store.platform,
        domain: store.domain,
        timezone: store.timezone || "",
        currency: "USD",
        orderCount,
        grossSales,
        netSales: grossSales,
        aov,
        amountSource: "Order.orderTotal",
        orderIdsJson: JSON.stringify(day.orderIds || []),
        rawDigestJson: JSON.stringify(digestObj),
        apiRawDigestJson: JSON.stringify(digestObj),
        diagnosticsJson: JSON.stringify({
          source: "Order",
          dateField: "Order.store_local_date",
          rangeVerified: Boolean(params.rangeVerified),
          warnings: projection.warnings
        }),
        apiFetchedAt: new Date()
      },
      create: {
        storeId: store.id,
        storeName: store.name,
        platform: store.platform,
        domain: store.domain,
        date,
        timezone: store.timezone || "",
        currency: "USD",
        orderCount,
        grossSales,
        netSales: grossSales,
        aov,
        amountSource: "Order.orderTotal",
        orderIdsJson: JSON.stringify(day.orderIds || []),
        rawDigestJson: JSON.stringify(digestObj),
        apiRawDigestJson: JSON.stringify(digestObj),
        diagnosticsJson: JSON.stringify({
          source: "Order",
          dateField: "Order.store_local_date",
          rangeVerified: Boolean(params.rangeVerified),
          warnings: projection.warnings
        }),
        apiFetchedAt: new Date()
      }
    });

    snapshots.push(snapshot);
  }

  return {
    storeId: store.id,
    storeName: store.name,
    platform: String(store.platform || "unknown").toLowerCase(),
    timezone: store.timezone || "",
    source: "Order",
    dateField: "Order.store_local_date",
    totalFetched: rows.length,
    recordsFetched: rows.length,
    recordsSaved: snapshots.length,
    uniqueOrderCount: projection.totalOrderCount,
    totalGrossSales: projection.totalGrossSales,
    warnings: projection.warnings,
    snapshots
  };
}
