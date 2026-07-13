import prisma from "../../db/index.js";
import { OrderFactParams, OrderFactSummary, DateRange } from "./data-pipeline-fact.types.js";
import dayjs from "dayjs";

export function isPaymentStatusExcluded(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return ["waiting", "unpaid", "pending", "cancelled", "voided"].includes(s);
}

export type StoreOrderFactWarningCode =
  | "ORDER_DEDUP_FALLBACK_USED"
  | "REFUND_AMOUNT_UNAVAILABLE"
  | "ORDER_BUSINESS_TIME_UNAVAILABLE"
  | "PROFIT_UNAVAILABLE";

export type NormalizedStoreOrderFact = {
  orderKey: string;
  usedFallbackKey: boolean;
  rows: any[];
  countryCode: string;
  countryName: string;
  revenue: number;
  profit: number | null;
  refunded: boolean;
  refundAmount: number | null;
  refundAmountAvailable: boolean;
  businessDateFirst: string | null;
  businessDateLast: string | null;
  isLegacy: boolean;
};

export type NormalizedStoreOrderFactsResult = {
  orders: NormalizedStoreOrderFact[];
  warnings: StoreOrderFactWarningCode[];
};

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasOwnValue(row: any, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key) && row[key] !== null && row[key] !== undefined;
}

export function getStoreOrderBusinessKey(row: any) {
  const orderId = typeof row?.orderId === "string" ? row.orderId.trim() : row?.orderId;
  if (orderId) {
    return { key: String(orderId), fallbackUsed: false };
  }
  return { key: String(row?.id), fallbackUsed: true };
}

function resolveOrderCountry(rows: any[]) {
  for (const row of rows) {
    if (row.shippingCountryCode) {
      const code = String(row.shippingCountryCode).trim().toUpperCase();
      return {
        countryCode: code,
        countryName: row.shippingCountryName || code
      };
    }
  }

  for (const row of rows) {
    if (row.billingCountryCode) {
      const code = String(row.billingCountryCode).trim().toUpperCase();
      return {
        countryCode: code,
        countryName: row.billingCountryName || code
      };
    }
  }

  return {
    countryCode: "UNKNOWN",
    countryName: "Unknown Country"
  };
}

function resolveOrderRevenue(rows: any[]) {
  for (const row of rows) {
    const orderTotal = finiteNumberOrNull(row.orderTotal);
    if (orderTotal !== null) return orderTotal;
  }

  return rows.reduce((sum, row) => sum + (finiteNumberOrNull(row.revenue) || 0), 0);
}

function resolveOrderProfit(rows: any[]) {
  if (!rows.every(row => hasOwnValue(row, "profit"))) return null;
  return rows.reduce((sum, row) => sum + (finiteNumberOrNull(row.profit) || 0), 0);
}

function resolveRefundAmount(rows: any[]) {
  const refundKeys = ["refundAmount", "refundedAmount", "totalRefunded", "refund_total"];
  let foundAmount = false;
  let total = 0;

  for (const row of rows) {
    for (const key of refundKeys) {
      const amount = finiteNumberOrNull(row[key]);
      if (amount !== null) {
        foundAmount = true;
        total += amount;
        break;
      }
    }
  }

  return foundAmount ? total : null;
}

function resolveBusinessDateRange(rows: any[]) {
  const dates = rows
    .map(row => typeof row.store_local_date === "string" ? row.store_local_date.trim() : "")
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();

  return {
    first: dates[0] || null,
    last: dates[dates.length - 1] || null
  };
}

export function normalizeStoreOrderFacts(rows: any[]): NormalizedStoreOrderFactsResult {
  const warnings = new Set<StoreOrderFactWarningCode>();
  const ordersGroupedByKey = new Map<string, any[]>();
  const fallbackKeys = new Set<string>();

  for (const row of rows.filter(order => !isPaymentStatusExcluded(order?.paymentStatus))) {
    const { key, fallbackUsed } = getStoreOrderBusinessKey(row);
    if (fallbackUsed) {
      fallbackKeys.add(key);
      warnings.add("ORDER_DEDUP_FALLBACK_USED");
    }
    if (!ordersGroupedByKey.has(key)) {
      ordersGroupedByKey.set(key, []);
    }
    ordersGroupedByKey.get(key)!.push(row);
  }

  const orders: NormalizedStoreOrderFact[] = [];

  for (const [orderKey, groupedRows] of ordersGroupedByKey.entries()) {
    const { countryCode, countryName } = resolveOrderCountry(groupedRows);
    const revenue = resolveOrderRevenue(groupedRows);
    const profit = resolveOrderProfit(groupedRows);
    const refunded = groupedRows.some(row => Boolean(row.refunded));
    const refundAmount = refunded ? resolveRefundAmount(groupedRows) : 0;
    const refundAmountAvailable = !refunded || refundAmount !== null;
    const businessDateRange = resolveBusinessDateRange(groupedRows);
    const isLegacy = groupedRows.some(row => !row.store_local_date);

    if (profit === null) warnings.add("PROFIT_UNAVAILABLE");
    if (!refundAmountAvailable) warnings.add("REFUND_AMOUNT_UNAVAILABLE");
    if (!businessDateRange.first || !businessDateRange.last) warnings.add("ORDER_BUSINESS_TIME_UNAVAILABLE");

    orders.push({
      orderKey,
      usedFallbackKey: fallbackKeys.has(orderKey),
      rows: groupedRows,
      countryCode,
      countryName,
      revenue,
      profit,
      refunded,
      refundAmount,
      refundAmountAvailable,
      businessDateFirst: businessDateRange.first,
      businessDateLast: businessDateRange.last,
      isLegacy
    });
  }

  return {
    orders,
    warnings: Array.from(warnings)
  };
}

export async function getStoreOrderFacts(params: OrderFactParams) {
  const { startDate, endDate, storeId, includeLegacyCreatedAtFallback = false } = params;

  const whereClause: any = {};
  if (storeId && storeId !== "all" && storeId !== "undefined") {
    whereClause.storeId = Number(storeId);
  }

  if (!includeLegacyCreatedAtFallback) {
    whereClause.store_local_date = {
      gte: startDate,
      lte: endDate,
    };
  } else {
    whereClause.OR = [
      {
        store_local_date: {
          gte: startDate,
          lte: endDate,
        },
      },
      {
        store_local_date: null,
        createdAt: {
          gte: dayjs(startDate).startOf("day").toDate(),
          lte: dayjs(endDate).endOf("day").toDate(),
        },
      },
    ];
  }

  const orders = await prisma.order.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
  });

  // Filter excluded payment statuses
  return orders.filter(o => !isPaymentStatusExcluded(o.paymentStatus));
}

export async function getStoreOrderSummary(params: OrderFactParams): Promise<OrderFactSummary> {
  const filteredOrders = await getStoreOrderFacts(params);
  const normalized = normalizeStoreOrderFacts(filteredOrders);

  let ordersCount = 0;
  let totalSales = 0;
  let refundAmount = 0;

  let legacyFallbackOrdersCount = 0;
  let legacyFallbackRevenue = 0;
  const legacyFallbackUsed = normalized.orders.some(o => o.isLegacy);

  normalized.orders.forEach((val) => {
    const salesVal = val.revenue;
    if (val.isLegacy) {
      legacyFallbackOrdersCount++;
      legacyFallbackRevenue += salesVal;
    } else {
      ordersCount++;
      totalSales += salesVal;
      if (val.refunded && val.refundAmountAvailable) {
        refundAmount += val.refundAmount || 0;
      }
    }
  });

  const refundRate = totalSales > 0 ? refundAmount / totalSales : 0;
  const aov = ordersCount > 0 ? totalSales / ordersCount : 0;

  return {
    ordersCount,
    totalSales,
    aov,
    refundAmount,
    refundRate,
    legacyFallbackOrdersCount,
    legacyFallbackRevenue,
    legacyFallbackUsed,
    orders: filteredOrders,
  };
}

export async function getOrderDateSourceAudit(params: DateRange) {
  const total = await prisma.order.count();
  const validLocalDate = await prisma.order.count({
    where: {
      store_local_date: {
        gte: params.startDate,
        lte: params.endDate,
      },
    },
  });
  const missingLocalDate = await prisma.order.count({
    where: { store_local_date: null },
  });

  return {
    totalOrdersInDb: total,
    validLocalDateInRange: validLocalDate,
    missingLocalDateTotal: missingLocalDate,
  };
}
