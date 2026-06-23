import prisma from "../../db/index.js";
import { OrderFactParams, OrderFactSummary, DateRange } from "./data-pipeline-fact.types.js";
import dayjs from "dayjs";

export function isPaymentStatusExcluded(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return ["waiting", "unpaid", "pending", "cancelled", "voided"].includes(s);
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

  const uniqueOrdersMap = new Map<string, { orderTotal: number; refunded: boolean; isLegacy: boolean; items: any[] }>();

  for (const o of filteredOrders) {
    const oId = o.orderId || o.id;
    const isLegacy = !o.store_local_date;

    if (!uniqueOrdersMap.has(oId)) {
      uniqueOrdersMap.set(oId, {
        orderTotal: o.orderTotal != null && o.orderTotal > 0 ? o.orderTotal : (o.revenue || 0),
        refunded: o.refunded || false,
        isLegacy,
        items: [o],
      });
    } else {
      const existing = uniqueOrdersMap.get(oId)!;
      if ((existing.orderTotal === 0 || existing.orderTotal === (existing.items[0]?.revenue || 0)) && o.orderTotal != null && o.orderTotal > 0) {
        existing.orderTotal = o.orderTotal;
      }
      existing.items.push(o);
    }
  }

  let ordersCount = 0;
  let totalSales = 0;
  let refundAmount = 0;

  let legacyFallbackOrdersCount = 0;
  let legacyFallbackRevenue = 0;
  const legacyFallbackUsed = Array.from(uniqueOrdersMap.values()).some(o => o.isLegacy);

  uniqueOrdersMap.forEach((val) => {
    const salesVal = val.orderTotal;
    if (val.isLegacy) {
      legacyFallbackOrdersCount++;
      legacyFallbackRevenue += salesVal;
    } else {
      ordersCount++;
      totalSales += salesVal;
      if (val.refunded) {
        refundAmount += salesVal;
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
