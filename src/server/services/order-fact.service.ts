import prisma from "../../db/index.js";
import { OrderFactParams, OrderFactSummary, DateRange } from "./data-pipeline-fact.types.js";
import dayjs from "dayjs";
import {
  classifyPlatformOrderValidity,
  type StorePlatform
} from "./store-sync-core.js";

export type StoreOrderFactWarningCode =
  | "ORDER_DEDUP_FALLBACK_USED"
  | "ORDER_STORE_SCOPE_UNAVAILABLE"
  | "PLATFORM_ORDER_RULE_UNAVAILABLE"
  | "PAYMENT_STATUS_UNAVAILABLE"
  | "PAYMENT_STATUS_UNRECOGNIZED"
  | "REFUND_AMOUNT_UNAVAILABLE"
  | "ORDER_BUSINESS_TIME_UNAVAILABLE"
  | "PROFIT_UNAVAILABLE";

export type SupportedOrderPlatform = StorePlatform;

export type NormalizedStoreOrderFact = {
  orderKey: string;
  usedFallbackKey: boolean;
  rows: any[];
  countryCode: string;
  countryName: string;
  grossSales: number;
  revenue: number;
  profit: number | null;
  refunded: boolean;
  refundedAt: string | null;
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

function finiteStoreId(value: unknown): number | null {
  const storeId = finiteNumberOrNull(value);
  return storeId !== null && Number.isInteger(storeId) && storeId > 0 ? storeId : null;
}

export function getStoreOrderBusinessKey(row: any): {
  key: string | null;
  fallbackUsed: boolean;
  storeScopeUnavailable: boolean;
} {
  const storeId = finiteStoreId(row?.storeId);
  if (storeId === null) {
    return { key: null, fallbackUsed: false, storeScopeUnavailable: true };
  }

  const orderId = typeof row?.orderId === "string" ? row.orderId.trim() : row?.orderId;
  if (orderId) {
    return {
      key: `store:${storeId}:order:${String(orderId)}`,
      fallbackUsed: false,
      storeScopeUnavailable: false
    };
  }

  if (row?.id !== null && row?.id !== undefined && String(row.id).trim()) {
    return {
      key: `store:${storeId}:db:${String(row.id)}`,
      fallbackUsed: true,
      storeScopeUnavailable: false
    };
  }

  return { key: null, fallbackUsed: true, storeScopeUnavailable: false };
}

function normalizeSupportedPlatform(value: unknown): SupportedOrderPlatform | null {
  const platform = String(value || "").trim().toLowerCase();
  return platform === "shopline" || platform === "shopify" || platform === "shoplazza"
    ? platform
    : null;
}

export function resolveOrderPlatform(
  row: any,
  storePlatformById: Map<number, string | null | undefined> = new Map()
): SupportedOrderPlatform | null {
  const storeId = finiteStoreId(row?.storeId);
  const candidates = [
    row?.storePlatform,
    row?.platform,
    row?.store?.platform,
    storeId === null ? null : storePlatformById.get(storeId)
  ];

  for (const candidate of candidates) {
    const platform = normalizeSupportedPlatform(candidate);
    if (platform) return platform;
  }
  return null;
}

export function classifyOrderValidity(input: {
  platform: SupportedOrderPlatform | null;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  cancelledAt?: unknown;
  paidAt?: unknown;
}): { valid: boolean; warning: StoreOrderFactWarningCode | null } {
  if (!input.platform) {
    return { valid: false, warning: "PLATFORM_ORDER_RULE_UNAVAILABLE" };
  }
  const result = classifyPlatformOrderValidity({
    platform: input.platform,
    paymentStatus: input.paymentStatus,
    fulfillmentStatus: input.fulfillmentStatus,
    cancelledAt: input.cancelledAt,
    paidAt: input.paidAt
  });
  const warning = result.reason === "PAYMENT_STATUS_UNAVAILABLE" ||
    result.reason === "PAYMENT_STATUS_UNRECOGNIZED"
    ? result.reason
    : null;
  return { valid: result.valid, warning };
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

function resolveOrderProfit(rows: any[]): number | null {
  const values = rows
    .map(row => finiteNumberOrNull(row?.profit))
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;
  return values.every(value => value === values[0])
    ? values[0]
    : values.reduce((sum, value) => sum + value, 0);
}

function resolveRefundAmount(rows: any[]) {
  const refundKeys = ["refundAmount", "refundedAmount", "totalRefunded", "refund_total"];
  const amounts: number[] = [];

  for (const row of rows) {
    for (const key of refundKeys) {
      const amount = finiteNumberOrNull(row[key]);
      if (amount !== null) {
        amounts.push(amount);
        break;
      }
    }
  }

  if (amounts.length === 0) return null;
  return amounts.every(amount => amount === amounts[0])
    ? amounts[0]
    : amounts.reduce((sum, amount) => sum + amount, 0);
}

function isRefundedOrderRow(row: any): boolean {
  const paymentStatus = String(row?.paymentStatus || "").trim().toLowerCase();
  return Boolean(row?.refunded) || paymentStatus === "refunded" || paymentStatus === "partially_refunded";
}

function resolveRefundedAt(rows: any[]): string | null {
  const dates = rows
    .map(row => row?.refundedAt)
    .filter(value => value !== null && value !== undefined && value !== "")
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  return dates[0]?.toISOString() || null;
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

  for (const row of rows) {
    const validity = classifyOrderValidity({
      platform: resolveOrderPlatform(row),
      paymentStatus: row?.paymentStatus,
      fulfillmentStatus: row?.fulfillmentStatus,
      cancelledAt: row?.cancelledAt,
      paidAt: row?.paidAt ?? row?.paid_at ?? row?.rawPaidAt ?? row?.created_at_utc
    });
    if (!validity.valid) {
      if (validity.warning) warnings.add(validity.warning);
      continue;
    }

    const { key, fallbackUsed, storeScopeUnavailable } = getStoreOrderBusinessKey(row);
    if (storeScopeUnavailable || !key) {
      warnings.add("ORDER_STORE_SCOPE_UNAVAILABLE");
      continue;
    }
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
    const grossSales = resolveOrderRevenue(groupedRows);
    const profit = resolveOrderProfit(groupedRows);
    const refunded = groupedRows.some(isRefundedOrderRow);
    const refundedAt = refunded ? resolveRefundedAt(groupedRows) : null;
    const refundAmount = refunded ? resolveRefundAmount(groupedRows) : 0;
    const refundAmountAvailable = !refunded || refundAmount !== null;
    const businessDateRange = resolveBusinessDateRange(groupedRows);
    const isLegacy = businessDateRange.first === null || businessDateRange.last === null;

    if (profit === null) warnings.add("PROFIT_UNAVAILABLE");
    if (!refundAmountAvailable) warnings.add("REFUND_AMOUNT_UNAVAILABLE");
    if (!businessDateRange.first || !businessDateRange.last) warnings.add("ORDER_BUSINESS_TIME_UNAVAILABLE");

    orders.push({
      orderKey,
      usedFallbackKey: fallbackKeys.has(orderKey),
      rows: groupedRows,
      countryCode,
      countryName,
      grossSales,
      revenue: grossSales,
      profit,
      refunded,
      refundedAt,
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
  const storeIds = Array.from(new Set(orders.map(order => order.storeId).filter(id => Number.isInteger(id))));
  const stores = storeIds.length > 0
    ? await prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, platform: true }
      })
    : [];
  const storePlatformById = new Map(stores.map(store => [store.id, store.platform]));

  return orders.map(order => ({
    ...order,
    storePlatform: storePlatformById.get(order.storeId) || null
  }));
}

export async function getStoreOrderSummary(params: OrderFactParams): Promise<OrderFactSummary> {
  const filteredOrders = await getStoreOrderFacts(params);
  const normalized = normalizeStoreOrderFacts(filteredOrders);
  const includedOrderRows = normalized.orders.flatMap(order => order.rows);

  let ordersCount = 0;
  let totalSales = 0;
  let refundedOrderCount = 0;
  let knownRefundAmount = 0;
  let refundAmountAvailable = true;

  let legacyFallbackOrdersCount = 0;
  let legacyFallbackRevenue = 0;
  const legacyFallbackUsed = normalized.orders.some(o => o.isLegacy);

  normalized.orders.forEach((val) => {
    const salesVal = val.grossSales;
    if (val.isLegacy) {
      legacyFallbackOrdersCount++;
      legacyFallbackRevenue += salesVal;
    } else {
      ordersCount++;
      totalSales += salesVal;
      if (val.refunded) {
        refundedOrderCount++;
        if (!val.refundAmountAvailable || val.refundAmount === null) {
          refundAmountAvailable = false;
        } else {
          knownRefundAmount += val.refundAmount;
        }
      }
    }
  });

  const refundAmount = refundAmountAvailable ? knownRefundAmount : null;
  const refundOrderRate = ordersCount > 0 ? refundedOrderCount / ordersCount : 0;
  const refundAmountRate = refundAmountAvailable && totalSales > 0
    ? knownRefundAmount / totalSales
    : null;
  const aov = ordersCount > 0 ? totalSales / ordersCount : 0;

  return {
    ordersCount,
    totalSales,
    aov,
    refundedOrderCount,
    refundAmount,
    refundAmountAvailable,
    refundOrderRate,
    refundAmountRate,
    refundRate: refundOrderRate,
    refundRateBasis: "orders",
    legacyFallbackOrdersCount,
    legacyFallbackRevenue,
    legacyFallbackUsed,
    orders: includedOrderRows,
    warnings: normalized.warnings,
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
