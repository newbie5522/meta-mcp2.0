// @ts-nocheck
import prisma from '../../db/index.js';

export async function getProductIntelligence(startDate: string, endDate: string) {
  // 1. Fetch Orders within date range
  // We fetch a slightly wider buffer of orders in terms of database timestamps
  // to ensure that store_local_date or UTC fallbacks are comprehensively included
  const rawOrders = await prisma.order.findMany({
    where: {
      createdAt: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`)
      }
    }
  });

  // 2. Filter orders by store_local_date; use createdAt only when local date is absent
  const filteredOrders = rawOrders.filter(order => {
    let orderDateStr = order.store_local_date;
    if (!orderDateStr && order.createdAt) {
      try {
        orderDateStr = new Date(order.createdAt).toISOString().split('T')[0];
      } catch (e) {
        orderDateStr = "";
      }
    }
    return orderDateStr && orderDateStr >= startDate && orderDateStr <= endDate;
  });

  // Group by productId
  const grouped = filteredOrders.reduce((acc, curr) => {
    const pid = curr.productId || "unknown";
    if (!acc[pid]) {
      acc[pid] = {
        productId: pid,
        storeId: curr.storeId,
        allOrders: [],
        validOrders: []
      };
    }
    acc[pid].allOrders.push(curr);

    // Apply exclusion patterns for valid sales orders:
    // - paymentStatus in ["waiting", "unpaid", "pending", "failed", "cancelled", "canceled"]
    // - fulfillmentStatus in ["cancelled", "canceled"]
    // - refunded === true
    const payStatus = (curr.paymentStatus || "").toLowerCase();
    const fulStatus = (curr.fulfillmentStatus || "").toLowerCase();
    
    const isExcluded = 
      ["waiting", "unpaid", "pending", "failed", "cancelled", "canceled"].includes(payStatus) ||
      ["cancelled", "canceled"].includes(fulStatus) ||
      curr.refunded === true;

    if (!isExcluded) {
      acc[pid].validOrders.push(curr);
    }

    return acc;
  }, {} as Record<string, any>);

  // Gather all unique productIds to fetch metadata from Product table
  const uniqueProductIds = Object.keys(grouped).filter(id => id !== "unknown");
  const dbProducts = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds } }
  });
  const productMap = new Map(dbProducts.map(p => [p.id, p]));

  // Build intelligence records
  const resultList = Object.values(grouped).map(group => {
    const { productId, storeId, allOrders, validOrders } = group;

    // Retrieve metadata
    const productMeta = productMap.get(productId);
    const hasProductMeta = !!productMeta;
    
    const productName = productMeta?.name || `Product ${productId}`;
    const sku = productMeta?.sku || productId;
    const category = productMeta?.category || "unknown";

    // 1. orders: valid orders quantity
    const ordersCount = validOrders.length;

    // 2. revenue:优先使用 orderTotal, 为空时使用 revenue
    const revenueSum = validOrders.reduce((sum, order) => {
      const val = (order.orderTotal !== null && order.orderTotal !== undefined && order.orderTotal > 0)
        ? order.orderTotal
        : (order.revenue || 0);
      return sum + val;
    }, 0);

    // 3. profit: 使用 Order.profit, 如果为空 or 0 不伪造
    const profitSum = validOrders.reduce((sum, order) => sum + (order.profit || 0), 0);

    // 4. averageOrderValue = revenue / orders
    const averageOrderValue = ordersCount > 0 ? revenueSum / ordersCount : 0;

    // 5. refundRate = refunded orders / total orders
    const totalCount = allOrders.length;
    const refundedCount = allOrders.filter(o => o.refunded).length;
    const refundRate = totalCount > 0 ? refundedCount / totalCount : 0;

    // 6. order timeline
    let firstOrderAt = null;
    let lastOrderAt = null;
    if (allOrders.length > 0) {
      const dates = allOrders.map(o => new Date(o.createdAt).getTime()).filter(t => !isNaN(t));
      if (dates.length > 0) {
        firstOrderAt = new Date(Math.min(...dates)).toISOString();
        lastOrderAt = new Date(Math.max(...dates)).toISOString();
      }
    }

    return {
      id: productId,
      productId,
      storeId,
      productName,
      sku,
      category,
      revenue: revenueSum,
      orders: ordersCount,
      profit: profitSum,
      averageOrderValue,
      refundRate,
      firstOrderAt,
      lastOrderAt,
      // Fixed specifications for adspend and roas (never fake or proportion-risk)
      adSpend: null,
      productRoas: null,
      profitRoas: null,
      source: "Order",
      dataSourceExplain: {
        primarySource: "Order",
        productTableUsedForMetadataOnly: hasProductMeta,
        revenueRule: "orderTotal preferred, revenue used only when orderTotal is absent",
        invalidOrderExcluded: true,
        adSpendAvailable: false,
        adSpendReason: "Product-level ad spend is not available until product-to-ad attribution is rebuilt."
      }
    };
  });

  // Sort by revenue descending
  return resultList.sort((a, b) => b.revenue - a.revenue);
}

