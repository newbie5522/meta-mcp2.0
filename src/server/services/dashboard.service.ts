// @ts-nocheck
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { normalizeMetaAccountId } from "../utils.js";

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export async function getDashboardSummary(options: { refresh?: boolean; since?: Date; until?: Date } = {}) {
  const until = options.until ? dayjs(options.until) : dayjs().endOf('day');
  const since = options.since ? dayjs(options.since) : dayjs(until).subtract(29, 'day').startOf('day');
  
  const sinceStr = since.format('YYYY-MM-DD');
  const untilStr = until.format('YYYY-MM-DD');
  const days = until.diff(since, 'day') + 1;

  const [
    storeCount,
    activeStoreCount,
    rawStores,
    adAccountCount,
    mappedAdAccounts,
    adAccounts,
    totalInsightCount, // represents FactMetaPerformance count now
    creativeCount,
    totalOrderCount,
    orders,
    insights,
    recentLogs
  ] = await Promise.all([
    prisma.store.count(),
    prisma.store.count(),
    prisma.store.findMany({
      include: { accounts: true, accountMappings: true }
    }),
    prisma.adAccount.count({ where: { recentActivity90d: true } }),
    prisma.accountMapping.count({ where: { storeId: { not: null } } }),
    prisma.adAccount.findMany({ 
      include: { store: true } 
    }),
    prisma.factMetaPerformance.count({ where: { level: "account" } }),
    prisma.adCreative.count(),
    prisma.order.count(),
    prisma.order.findMany({
      where: {
        OR: [
          {
            store_local_date: {
              gte: sinceStr,
              lte: untilStr
            }
          },
          {
            store_local_date: null,
            createdAt: { gte: since.toDate(), lte: until.toDate() }
          }
        ]
      }
    }),
    prisma.factMetaPerformance.findMany({
      where: {
        date: { gte: sinceStr, lte: untilStr },
        level: "account"
      }
    }),
    prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5
    })
  ]);

  // Group by orderId to calculate actual unique orders and de-duplicate order totals
  const uniqueOrdersMap = new Map<string, { orderTotal: number; refunded: boolean; storeId: number }>();
  for (const order of orders) {
    const oId = order.orderId || order.id;
    if (!uniqueOrdersMap.has(oId)) {
      uniqueOrdersMap.set(oId, {
        orderTotal: order.orderTotal != null && order.orderTotal > 0 ? order.orderTotal : toNumber(order.revenue),
        refunded: order.refunded || false,
        storeId: order.storeId
      });
    } else {
      const existing = uniqueOrdersMap.get(oId)!;
      // If we don't have a direct orderTotal from the platform, accumulate internal item revenues
      if (order.orderTotal == null || order.orderTotal === 0) {
        existing.orderTotal += toNumber(order.revenue);
      }
    }
  }

  // Aggregate global and store specific metrics from unique orders
  let storeSales = 0;
  const storeOrderStats = new Map<number, { count: number; sales: number }>();

  uniqueOrdersMap.forEach((uo, oId) => {
    storeSales += uo.orderTotal;

    if (!storeOrderStats.has(uo.storeId)) {
      storeOrderStats.set(uo.storeId, { count: 0, sales: 0 });
    }
    const st = storeOrderStats.get(uo.storeId)!;
    st.count += 1;
    st.sales += uo.orderTotal;
  });

  const storeOrderCount = uniqueOrdersMap.size;

  // Aggregate product level statistics
  const productStats = new Map<string, { orderCount: number; quantity: number; sales: number; uniqueOrderIds?: Set<string> }>();
  for (const order of orders) {
    const pId = order.productId || "unknown";
    if (!productStats.has(pId)) {
      productStats.set(pId, { orderCount: 0, quantity: 0, sales: 0, uniqueOrderIds: new Set<string>() });
    }
    const ps = productStats.get(pId)!;
    ps.quantity += 1;
    ps.sales += toNumber(order.revenue);
    const oId = order.orderId || order.id;
    ps.uniqueOrderIds?.add(oId);
  }

  productStats.forEach((ps) => {
    ps.orderCount = ps.uniqueOrderIds ? ps.uniqueOrderIds.size : ps.quantity;
    delete ps.uniqueOrderIds;
  });

  const accountStats = new Map<string, { spend: number; imp: number; clicks: number; pur: number; pVal: number }>();
  let metaSpend = 0, metaPurchases = 0, metaPurchaseValue = 0, impressions = 0, clicks = 0;

  for (const row of insights) {
    const normId = normalizeMetaAccountId(row.account_id || row.accountId);

    metaSpend += toNumber(row.spend);
    metaPurchases += toNumber(row.purchases);
    metaPurchaseValue += toNumber(row.purchase_value !== undefined ? row.purchase_value : row.purchaseValue);
    impressions += toNumber(row.impressions);
    clicks += toNumber(row.clicks);

    if (!accountStats.has(normId)) {
      accountStats.set(normId, { spend: 0, imp: 0, clicks: 0, pur: 0, pVal: 0 });
    }
    const ast = accountStats.get(normId)!;
    ast.spend += toNumber(row.spend);
    ast.imp += toNumber(row.impressions);
    ast.clicks += toNumber(row.clicks);
    ast.pur += toNumber(row.purchases);
    ast.pVal += toNumber(row.purchase_value !== undefined ? row.purchase_value : row.purchaseValue);
  }

  const stores = rawStores.map(s => {
    const stats = storeOrderStats.get(s.id) || { count: 0, sales: 0 };
    return {
      id: String(s.id),
      name: s.name,
      platform: s.platform || "shopline",
      domain: s.domain || "",
      status: s.status || "active",
      currency: "USD",
      mappedAccounts: s.accounts.length + s.accountMappings.length,
      orderCount: stats.count,
      sales: stats.sales
    };
  }).sort((a, b) => b.sales - a.sales);

  const accountsMap = new Map<string, any>();
  for (const a of adAccounts) {
    const normId = normalizeMetaAccountId(a.fb_account_id);
    accountsMap.set(normId, {
      id: String(a.id),
      metaAccountId: a.fb_account_id,
      name: a.fb_account_name || `Account ${normId}`,
      status: String(a.activityStatus || '1'),
      storeName: a.store?.name,
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      roas: null
    });
  }

  accountStats.forEach((st, accId) => {
    const normId = normalizeMetaAccountId(accId);
    let accEntry = accountsMap.get(normId);
    if (!accEntry) {
      accEntry = {
        id: `synth_${normId}`,
        metaAccountId: normId,
        name: `Meta Account ${normId}`,
        status: "1",
        storeName: undefined,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchaseValue: 0,
        roas: null
      };
      accountsMap.set(normId, accEntry);
    }
    accEntry.spend = st.spend;
    accEntry.impressions = st.imp;
    accEntry.clicks = st.clicks;
    accEntry.purchases = st.pur;
    accEntry.purchaseValue = st.pVal;
    accEntry.roas = safeRatio(st.pVal, st.spend);
  });

  const accounts = Array.from(accountsMap.values())
    .filter(a => a.spend > 0)
    .sort((a, b) => b.spend - a.spend);

  const products = Array.from(productStats.entries()).map(([id, st]) => ({
    productName: `Product ${id.substring(0,6)}`,
    sku: id,
    orderCount: st.orderCount,
    quantity: st.quantity,
    sales: st.sales
  })).sort((a, b) => b.sales - a.sales).slice(0, 50);

  const dataReadiness = [
    {
      key: "insights",
      label: "广告成效数据",
      status: totalInsightCount > 0 ? "ready" : "missing",
      records: totalInsightCount,
      note: totalInsightCount > 0 ? "成效数据已同步" : "请先绑定广告账户并执行同步"
    },
    {
      key: "orders",
      label: "店铺订单数据",
      status: totalOrderCount > 0 ? "ready" : "missing",
      records: totalOrderCount,
      note: totalOrderCount > 0 ? "订单数据已同步" : "请配置店铺并同步历史订单"
    }
  ];

  // Fetch true number of actual pending recommendations from database
  const pendingSuggestionsCount = await prisma.aiActionSuggestion.count({
    where: { status: "pending" }
  });

  return {
    range: { since: sinceStr, until: untilStr, days },
    storeCount,
    activeStoreCount,
    adAccountCount,
    mappedAdAccountCount: mappedAdAccounts || adAccounts.filter(a => a.storeId).length,
    overview: {
      storeOrderCount,
      storeSales,
      metaSpend,
      realRoas: safeRatio(storeSales, metaSpend),
      metaRoas: safeRatio(metaPurchaseValue, metaSpend),
      metaPurchases,
      metaPurchaseValue,
      impressions,
      clicks,
      ctr: safeRatio(clicks, impressions) ? (clicks/impressions)*100 : 0
    },
    stores,
    accounts,
    products,
    syncHealth: {
      success: recentLogs.filter(l => l.status === 'success').length,
      failed: recentLogs.filter(l => l.status === 'failed').length,
      running: recentLogs.filter(l => l.status === 'running').length
    },
    ai: { pendingSuggestions: pendingSuggestionsCount },
    dataReadiness,
    recentLogs
  };
}
