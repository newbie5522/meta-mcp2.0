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

function parseMetadata(value: unknown): any {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : null;
}

async function canWriteZeroCoverageSnapshots(params: {
  storeId: number;
  startDate: string;
  endDate: string;
  rangeVerified?: boolean;
  sourceSyncTaskId?: string | null;
}) {
  if (!params.rangeVerified || !params.sourceSyncTaskId) return false;
  const log = await prisma.syncLog.findUnique({
    where: { id: params.sourceSyncTaskId }
  });
  const metadata = parseMetadata(log?.metadata);
  const failedSlices = Array.isArray(metadata.failedSlices) ? metadata.failedSlices : [];
  return (
    log?.status === "success" &&
    Number(log?.storeId) === Number(params.storeId) &&
    metadata.coverageComplete === true &&
    metadata.truncated !== true &&
    failedSlices.length === 0 &&
    dateOnly(log?.rangeStart || metadata.rangeStart) === params.startDate &&
    dateOnly(log?.rangeEnd || metadata.rangeEnd) === params.endDate
  );
}

export async function refreshStoreDataCenterLedger(params: {
  storeId: number;
  startDate: string;
  endDate: string;
  rangeVerified?: boolean;
  sourceSyncTaskId?: string | null;
  sourceSyncFinishedAt?: Date | null;
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
  const sourceSyncLog = params.sourceSyncTaskId
    ? await prisma.syncLog.findUnique({ where: { id: params.sourceSyncTaskId } })
    : null;
  const sourceSyncMetadata = parseMetadata(sourceSyncLog?.metadata);
  const timezoneSource = sourceSyncMetadata?.timezoneSource || sourceSyncMetadata?.diagnostics?.timezoneSource || null;
  const sourceTimezone = sourceSyncMetadata?.timezone || sourceSyncMetadata?.diagnostics?.timezoneAfter || store.timezone || "";

  const byDate = projectionDayMap(projection.days);
  const zeroCoverageAllowed = await canWriteZeroCoverageSnapshots(params);
  const writeDates = zeroCoverageAllowed
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
        timezone: sourceTimezone,
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
          timezone: sourceTimezone,
          timezoneSource,
          rangeVerified: zeroCoverageAllowed,
          sourceSyncTaskId: params.sourceSyncTaskId || null,
          sourceSyncFinishedAt: params.sourceSyncFinishedAt?.toISOString?.() || null,
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
        timezone: sourceTimezone,
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
          timezone: sourceTimezone,
          timezoneSource,
          rangeVerified: zeroCoverageAllowed,
          sourceSyncTaskId: params.sourceSyncTaskId || null,
          sourceSyncFinishedAt: params.sourceSyncFinishedAt?.toISOString?.() || null,
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
    timezone: sourceTimezone,
    timezoneSource,
    source: "Order",
    dateField: "Order.store_local_date",
    totalFetched: rows.length,
    recordsFetched: rows.length,
    recordsSaved: snapshots.length,
    uniqueOrderCount: projection.totalOrderCount,
    totalGrossSales: projection.totalGrossSales,
    rangeVerified: zeroCoverageAllowed,
    warnings: projection.warnings,
    snapshots
  };
}
