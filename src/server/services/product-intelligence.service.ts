import prisma from "../../db/index.js";
import { getStoreOrderFacts, normalizeStoreOrderFacts } from "./order-fact.service.js";

export type ProductIntelligenceWarning =
  | "PRODUCT_REVENUE_UNAVAILABLE"
  | "PRODUCT_PROFIT_ALLOCATION_UNAVAILABLE";

export type ProductIntelligenceRecord = {
  id: string;
  productId: string;
  storeId: number | null;
  productName: string;
  sku: string;
  category: string;
  revenue: number | null;
  revenueAvailable: boolean;
  orders: number;
  refundedOrders: number;
  profit: null;
  averageOrderValue: number | null;
  refundRate: number | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  warnings: ProductIntelligenceWarning[];
  source: "Order";
};

type ProductAggregate = {
  id: string;
  productId: string;
  storeId: number | null;
  revenue: number;
  revenueAvailable: boolean;
  orderKeys: Set<string>;
  refundedOrderKeys: Set<string>;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  warnings: Set<ProductIntelligenceWarning>;
};

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function productIdForRow(row: any): string {
  const productId = String(row?.productId || "").trim();
  return productId || "unknown";
}

export async function getProductIntelligence(
  startDate: string,
  endDate: string,
  storeId: string = "all"
): Promise<ProductIntelligenceRecord[]> {
  const rows = await getStoreOrderFacts({ startDate, endDate, storeId });
  const normalized = normalizeStoreOrderFacts(rows);
  const aggregates = new Map<string, ProductAggregate>();

  for (const order of normalized.orders) {
    const rowsByProductId = new Map<string, any[]>();
    for (const row of order.rows) {
      const productId = productIdForRow(row);
      const productRows = rowsByProductId.get(productId) || [];
      productRows.push(row);
      rowsByProductId.set(productId, productRows);
    }

    for (const [productId, productRows] of rowsByProductId.entries()) {
      const rawStoreId = finiteNumberOrNull(productRows[0]?.storeId);
      const productStoreId = rawStoreId !== null && Number.isInteger(rawStoreId)
        ? rawStoreId
        : null;
      const aggregateId = `store:${productStoreId ?? "unknown"}:product:${productId}`;
      let aggregate = aggregates.get(aggregateId);
      if (!aggregate) {
        aggregate = {
          id: aggregateId,
          productId,
          storeId: productStoreId,
          revenue: 0,
          revenueAvailable: true,
          orderKeys: new Set<string>(),
          refundedOrderKeys: new Set<string>(),
          firstOrderAt: null,
          lastOrderAt: null,
          warnings: new Set<ProductIntelligenceWarning>([
            "PRODUCT_PROFIT_ALLOCATION_UNAVAILABLE"
          ])
        };
        aggregates.set(aggregateId, aggregate);
      }

      aggregate.orderKeys.add(order.orderKey);
      if (order.refunded) aggregate.refundedOrderKeys.add(order.orderKey);

      for (const productRow of productRows) {
        const lineRevenue = finiteNumberOrNull(productRow?.revenue);
        if (lineRevenue === null) {
          aggregate.revenueAvailable = false;
          aggregate.warnings.add("PRODUCT_REVENUE_UNAVAILABLE");
        } else {
          aggregate.revenue += lineRevenue;
        }
      }

      if (order.businessDateFirst) {
        if (!aggregate.firstOrderAt || order.businessDateFirst < aggregate.firstOrderAt) {
          aggregate.firstOrderAt = order.businessDateFirst;
        }
      }
      if (order.businessDateLast) {
        if (!aggregate.lastOrderAt || order.businessDateLast > aggregate.lastOrderAt) {
          aggregate.lastOrderAt = order.businessDateLast;
        }
      }
    }
  }

  const productIds = Array.from(new Set(
    Array.from(aggregates.values())
      .map(aggregate => aggregate.productId)
      .filter(productId => productId !== "unknown")
  ));
  const products = productIds.length > 0
    ? await prisma.product.findMany({ where: { id: { in: productIds } } })
    : [];
  const productById = new Map(products.map(product => [product.id, product]));

  return Array.from(aggregates.values())
    .map((aggregate): ProductIntelligenceRecord => {
      const product = productById.get(aggregate.productId);
      const orders = aggregate.orderKeys.size;
      const refundedOrders = aggregate.refundedOrderKeys.size;
      const revenue = aggregate.revenueAvailable ? aggregate.revenue : null;
      return {
        id: aggregate.id,
        productId: aggregate.productId,
        storeId: aggregate.storeId,
        productName: product?.name || `Product ${aggregate.productId}`,
        sku: product?.sku || aggregate.productId,
        category: product?.category || "Uncategorized",
        revenue,
        revenueAvailable: aggregate.revenueAvailable,
        orders,
        refundedOrders,
        profit: null,
        averageOrderValue: revenue !== null && orders > 0 ? revenue / orders : null,
        refundRate: orders > 0 ? refundedOrders / orders : null,
        firstOrderAt: aggregate.firstOrderAt,
        lastOrderAt: aggregate.lastOrderAt,
        warnings: Array.from(aggregate.warnings),
        source: "Order"
      };
    })
    .sort((left, right) => {
      if (left.revenue === null && right.revenue === null) return left.id.localeCompare(right.id);
      if (left.revenue === null) return 1;
      if (right.revenue === null) return -1;
      return right.revenue - left.revenue;
    });
}
