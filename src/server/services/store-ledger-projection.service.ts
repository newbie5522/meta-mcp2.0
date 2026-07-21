import { normalizeStoreOrderFacts } from "./order-fact.service.js";

export type LedgerProjectionDay = {
  date: string;
  orderCount: number;
  grossSales: number;
  aov: number;
  orderIds: string[];
};

export type StoreLedgerProjection = {
  storeId: number;
  startDate: string;
  endDate: string;
  source: "Order";
  dateField: "Order.store_local_date";
  days: LedgerProjectionDay[];
  totalOrderCount: number;
  totalGrossSales: number;
  warnings: string[];
};

export type StoreLedgerProjectionComparison = {
  canonicalProjection: StoreLedgerProjection;
  shoplineCompatibilityProjection: StoreLedgerProjection;
  warnings: string[];
};

type ProjectionInput = {
  storeId: number;
  startDate: string;
  endDate: string;
  rows: any[];
};

const SHOPLINE_COMPATIBILITY_ALLOWED_PAYMENT_STATUSES = new Set([
  "paid",
  "partially_paid",
  "partially_refunded"
]);

const SHOPLINE_COMPATIBILITY_EXCLUDED_PAYMENT_STATUSES = new Set([
  "pending",
  "refunded",
  "cancelled",
  "canceled",
  "voided",
  "unpaid",
  "waiting",
  "failed"
]);

const SHOPLINE_COMPATIBILITY_AMOUNT_FIELDS = [
  "total_price",
  "total_amount",
  "order_total",
  "orderTotal",
  "payment_total",
  "paid_total",
  "current_total_price",
  "line_items_sum"
];

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}

function roundMoney(value: number) {
  return Number(value.toFixed(4));
}

function dateOnly(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function inRange(date: string | null, startDate: string, endDate: string) {
  return Boolean(date && date >= startDate && date <= endDate);
}

function scopedOrderId(row: any) {
  const storeId = Number(row?.storeId);
  const orderId = row?.orderId !== null && row?.orderId !== undefined && String(row.orderId).trim()
    ? String(row.orderId).trim()
    : String(row?.id || "").trim();
  if (!Number.isInteger(storeId) || storeId <= 0 || !orderId) return null;
  return `store:${storeId}:order:${orderId}`;
}

function lineItemsSum(row: any): number | null {
  const direct = money(row?.line_items_sum);
  if (direct !== null) return direct;
  const lineItems = Array.isArray(row?.lineItems)
    ? row.lineItems
    : Array.isArray(row?.line_items)
      ? row.line_items
      : null;
  if (!lineItems) return null;
  return roundMoney(lineItems.reduce((sum: number, item: any) => {
    const quantity = money(item?.quantity) ?? 1;
    const price = money(item?.price ?? item?.unitPrice ?? item?.amount ?? item?.total);
    const total = money(item?.total ?? item?.lineTotal);
    return sum + (total ?? (price === null ? 0 : price * quantity));
  }, 0));
}

function firstMoneyByPriority(rows: any[], fields: string[]) {
  for (const field of fields) {
    for (const row of rows) {
      const amount = field === "line_items_sum" ? lineItemsSum(row) : money(row?.[field]);
      if (amount !== null) return amount;
    }
  }
  return null;
}

function sumRevenue(rows: any[]) {
  return roundMoney(rows.reduce((sum, row) => sum + (money(row?.revenue) ?? 0), 0));
}

function groupRowsByScopedOrder(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = scopedOrderId(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

function emptyProjection(input: { storeId: number; startDate: string; endDate: string; warnings?: string[] }): StoreLedgerProjection {
  return {
    storeId: input.storeId,
    startDate: input.startDate,
    endDate: input.endDate,
    source: "Order",
    dateField: "Order.store_local_date",
    days: [],
    totalOrderCount: 0,
    totalGrossSales: 0,
    warnings: input.warnings || []
  };
}

function buildProjectionFromEntries(input: {
  storeId: number;
  startDate: string;
  endDate: string;
  entries: Array<{ date: string; orderId: string; amount: number }>;
  warnings: string[];
}): StoreLedgerProjection {
  const byDate = new Map<string, { orderIds: Set<string>; grossSales: number }>();
  for (const entry of input.entries) {
    if (!inRange(entry.date, input.startDate, input.endDate)) continue;
    if (!byDate.has(entry.date)) {
      byDate.set(entry.date, { orderIds: new Set(), grossSales: 0 });
    }
    const day = byDate.get(entry.date)!;
    if (!day.orderIds.has(entry.orderId)) {
      day.orderIds.add(entry.orderId);
      day.grossSales = roundMoney(day.grossSales + entry.amount);
    }
  }

  const days = Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => {
      const orderIds = Array.from(day.orderIds).sort();
      const grossSales = roundMoney(day.grossSales);
      const orderCount = orderIds.length;
      return {
        date,
        orderCount,
        grossSales,
        aov: orderCount > 0 ? roundMoney(grossSales / orderCount) : 0,
        orderIds
      };
    });

  const totalOrderCount = days.reduce((sum, day) => sum + day.orderCount, 0);
  const totalGrossSales = roundMoney(days.reduce((sum, day) => sum + day.grossSales, 0));

  return {
    ...emptyProjection(input),
    days,
    totalOrderCount,
    totalGrossSales,
    warnings: Array.from(new Set(input.warnings)).sort()
  };
}

export function buildCanonicalStoreLedgerProjection(input: ProjectionInput): StoreLedgerProjection {
  const warnings = new Set<string>();
  const rows = input.rows
    .filter(row => Number(row?.storeId) === input.storeId)
    .filter(row => {
      if (Array.isArray(row?.lineItems) && row.lineItems.length === 0) {
        warnings.add("MISSING_FROM_ORDER_FACT");
        return false;
      }
      if (!dateOnly(row?.store_local_date)) {
        warnings.add("ORDER_STORE_LOCAL_DATE_UNAVAILABLE");
        return false;
      }
      return true;
    })
    .map(row => ({
      ...row,
      storePlatform: row?.storePlatform || row?.platform || "shopline"
    }));

  const normalized = normalizeStoreOrderFacts(rows);
  for (const warning of normalized.warnings) warnings.add(warning);

  const entries = normalized.orders
    .map(order => {
      const firstRow = order.rows[0] || {};
      const orderId = scopedOrderId(firstRow);
      const date = order.businessDateFirst;
      if (!orderId || !date) return null;
      return {
        date,
        orderId,
        amount: roundMoney(order.grossSales)
      };
    })
    .filter((entry): entry is { date: string; orderId: string; amount: number } => Boolean(entry));

  return buildProjectionFromEntries({
    storeId: input.storeId,
    startDate: input.startDate,
    endDate: input.endDate,
    entries,
    warnings: Array.from(warnings)
  });
}

function isShoplineCompatibilityOrderAllowed(rows: any[]) {
  const row = rows[0] || {};
  const paymentStatus = String(row?.paymentStatus ?? row?.financial_status ?? row?.payment_status ?? "").trim().toLowerCase();
  const fulfillmentStatus = String(row?.fulfillmentStatus ?? row?.fulfillment_status ?? "").trim().toLowerCase();
  const cancelledAt = row?.cancelledAt ?? row?.cancelled_at;

  if (cancelledAt !== null && cancelledAt !== undefined && cancelledAt !== "") return false;
  if (SHOPLINE_COMPATIBILITY_EXCLUDED_PAYMENT_STATUSES.has(paymentStatus)) return false;
  if (SHOPLINE_COMPATIBILITY_ALLOWED_PAYMENT_STATUSES.has(paymentStatus)) return true;
  if (!paymentStatus) return true;
  return fulfillmentStatus === "fulfilled";
}

function resolveShoplineLedgerDate(rows: any[]) {
  const fields = [
    "paid_at",
    "paidAt",
    "processed_at",
    "processedAt",
    "completed_at",
    "completedAt",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
    "store_local_date"
  ];
  for (const field of fields) {
    for (const row of rows) {
      const date = dateOnly(row?.[field]);
      if (date) return date;
    }
  }
  return null;
}

function resolveShoplineCompatibilityAmount(rows: any[]) {
  return firstMoneyByPriority(rows, SHOPLINE_COMPATIBILITY_AMOUNT_FIELDS) ?? sumRevenue(rows);
}

export function buildShoplineCompatibilityStoreLedgerProjection(input: ProjectionInput): StoreLedgerProjection {
  const warnings = new Set<string>();
  const entries: Array<{ date: string; orderId: string; amount: number }> = [];
  const grouped = groupRowsByScopedOrder(input.rows.filter(row => Number(row?.storeId) === input.storeId));

  for (const [orderId, rows] of grouped.entries()) {
    if (!isShoplineCompatibilityOrderAllowed(rows)) {
      warnings.add("SHOPLINE_COMPATIBILITY_STATUS_EXCLUDED");
      continue;
    }

    if (rows.some(row => Array.isArray(row?.lineItems) && row.lineItems.length === 0)) {
      warnings.add("MISSING_FROM_ORDER_FACT");
    }

    const date = resolveShoplineLedgerDate(rows);
    if (!date) {
      warnings.add("SHOPLINE_COMPATIBILITY_DATE_UNAVAILABLE");
      continue;
    }

    entries.push({
      date,
      orderId,
      amount: resolveShoplineCompatibilityAmount(rows)
    });
  }

  return buildProjectionFromEntries({
    storeId: input.storeId,
    startDate: input.startDate,
    endDate: input.endDate,
    entries,
    warnings: Array.from(warnings)
  });
}

export function buildStoreLedgerProjectionComparison(input: ProjectionInput): StoreLedgerProjectionComparison {
  const canonicalProjection = buildCanonicalStoreLedgerProjection(input);
  const shoplineCompatibilityProjection = buildShoplineCompatibilityStoreLedgerProjection(input);
  return {
    canonicalProjection,
    shoplineCompatibilityProjection,
    warnings: Array.from(new Set([
      ...canonicalProjection.warnings,
      ...shoplineCompatibilityProjection.warnings
    ])).sort()
  };
}
