// @ts-nocheck
import prisma from "../../db/index.js";

function money(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function firstPositiveCandidate(candidates: Array<{ field: string; value: number }>) {
  for (const c of candidates) {
    if (c.value > 0) return c;
  }
  return { field: "ZERO", value: 0 };
}

export function extractOrderLedgerAmount(platform: string, raw: any) {
  const lineItems = Array.isArray(raw?.line_items) ? raw.line_items : [];
  const lineItemsSum = money(lineItems.reduce((s: number, li: any) => {
    const qty = money(li.quantity || 1);
    const price = money(li.price ?? li.unit_price ?? li.unitPrice);
    return s + qty * price;
  }, 0));

  const candidates = {
    paid_total: money(raw.paid_total ?? raw.paidTotal ?? raw.payment_total ?? raw.paymentTotal),
    payment_total: money(raw.payment_total ?? raw.paymentTotal ?? raw.payments?.total),
    total_price: money(raw.total_price ?? raw.totalPrice ?? raw.total?.price ?? raw.total?.amount),
    current_total_price: money(raw.current_total_price ?? raw.currentTotalPrice),
    total_amount: money(raw.total_amount ?? raw.totalAmount ?? raw.amount),
    order_total: money(raw.order_total ?? raw.orderTotal),
    subtotal_price: money(raw.subtotal_price ?? raw.subtotalPrice),
    current_subtotal_price: money(raw.current_subtotal_price ?? raw.currentSubtotalPrice),
    total_discounts: money(raw.total_discounts ?? raw.totalDiscounts),
    total_tax: money(raw.total_tax ?? raw.totalTax),
    shipping_total: money(raw.shipping_total ?? raw.total_shipping_price_set?.shop_money?.amount),
    net_subtotal_less_discount: money(
      money(raw.current_subtotal_price ?? raw.subtotal_price ?? raw.total_line_items_price) -
      money(raw.total_discounts ?? raw.totalDiscounts ?? raw.discount_amount)
    ),
    line_items_sum: lineItemsSum
  };

  const p = String(platform || "shopline").toLowerCase();

  let priority: Array<{ field: string; value: number }> = [];

  priority = [
    { field: "current_total_price", value: candidates.current_total_price },
    { field: "total_price", value: candidates.total_price },
    { field: "total_amount", value: candidates.total_amount },
    { field: "order_total", value: candidates.order_total },
    { field: "LINE_ITEM_FALLBACK", value: candidates.line_items_sum }
  ];

  const selected = firstPositiveCandidate(priority);

  return {
    orderTotal: selected.value,
    orderTotalSource: selected.field,
    revenueCandidates: candidates,
    lineItemsSum
  };
}

export async function rebuildStoreLedgerForRange(params: {
  storeId: number;
  startDate: string;
  endDate: string;
  syncStoreData: Function;
}) {
  const before = await prisma.order.findMany({
    where: {
      storeId: params.storeId,
      store_local_date: {
        gte: params.startDate,
        lte: params.endDate
      }
    }
  });

  const deleted = await prisma.order.deleteMany({
    where: {
      storeId: params.storeId,
      store_local_date: {
        gte: params.startDate,
        lte: params.endDate
      }
    }
  });

  const syncResult = await params.syncStoreData(params.startDate, params.endDate, String(params.storeId), {
    rebuild: true
  });

  const after = await prisma.order.findMany({
    where: {
      storeId: params.storeId,
      store_local_date: {
        gte: params.startDate,
        lte: params.endDate
      }
    }
  });

  const byOrder = new Map<string, any>();
  for (const o of after) {
    const key = o.orderId || o.id;
    if (!byOrder.has(key)) {
      byOrder.set(key, {
        orderId: key,
        orderTotal: Number(o.orderTotal || 0),
        rows: 0,
        lineRevenue: 0,
        paymentStatus: o.paymentStatus
      });
    }
    const item = byOrder.get(key);
    item.rows += 1;
    item.lineRevenue += Number(o.revenue || 0);
  }

  const uniqueOrders = Array.from(byOrder.values());

  return {
    deletedRows: deleted.count,
    beforeRows: before.length,
    afterRows: after.length,
    uniqueOrderCount: uniqueOrders.length,
    orderTotalSum: Number(uniqueOrders.reduce((s, o) => s + Number(o.orderTotal || 0), 0).toFixed(2)),
    lineRevenueSum: Number(uniqueOrders.reduce((s, o) => s + Number(o.lineRevenue || 0), 0).toFixed(2)),
    syncResult,
    orders: uniqueOrders
  };
}
