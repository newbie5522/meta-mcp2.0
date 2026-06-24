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

  // STRICT RULE: Dashboard overview MUST ONLY query DataCenterMetaAccountDaily and DataCenterStoreDaily
  const [
    storeCount,
    activeStoreCount,
    rawStores,
    adAccountCount,
    mappedAdAccounts,
    adAccounts,
    recentLogs,
    storeDailyLedgers,
    metaDailyLedgers,
    ordersForProducts
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
    prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5
    }),
    prisma.dataCenterStoreDaily.findMany({
      where: {
        date: { gte: sinceStr, lte: untilStr }
      }
    }),
    prisma.dataCenterMetaAccountDaily.findMany({
      where: {
        date: { gte: sinceStr, lte: untilStr }
      }
    }),
    // We only query Order specifically for the top products SKU list (as declared under data-products schema)
    prisma.order.findMany({
      where: {
        OR: [
          { store_local_date: { gte: sinceStr, lte: untilStr } },
          { store_local_date: null, createdAt: { gte: since.toDate(), lte: until.toDate() } }
        ]
      },
      select: {
        id: true,
        orderId: true,
        productId: true,
        revenue: true
      }
    })
  ]);

  // 1. Aggregate store metrics purely from DataCenterStoreDaily ledger
  let storeSales = 0;
  let storeOrderCount = 0;
  const storeOrderStats = new Map<number, { count: number; sales: number }>();

  for (const row of storeDailyLedgers) {
    const gross = toNumber(row.grossSales);
    const count = toNumber(row.orderCount);
    storeSales += gross;
    storeOrderCount += count;

    const sId = row.storeId;
    if (!storeOrderStats.has(sId)) {
      storeOrderStats.set(sId, { count: 0, sales: 0 });
    }
    const st = storeOrderStats.get(sId)!;
    st.count += count;
    st.sales += gross;
  }

  // 2. Aggregate meta metrics purely from DataCenterMetaAccountDaily ledger
  let metaSpend = 0;
  let metaPurchases = 0;
  let metaPurchaseValue = 0;
  let impressions = 0;
  let clicks = 0;
  const accountStats = new Map<string, { spend: number; imp: number; clicks: number; pur: number; pVal: number }>();

  for (const row of metaDailyLedgers) {
    const normId = normalizeMetaAccountId(row.accountId);
    const s = toNumber(row.spend);
    const p = toNumber(row.purchases);
    const pv = toNumber(row.purchaseValue);
    const imp = toNumber(row.impressions);
    const clk = toNumber(row.clicks);

    metaSpend += s;
    metaPurchases += p;
    metaPurchaseValue += pv;
    impressions += imp;
    clicks += clk;

    if (!accountStats.has(normId)) {
      accountStats.set(normId, { spend: 0, imp: 0, clicks: 0, pur: 0, pVal: 0 });
    }
    const ast = accountStats.get(normId)!;
    ast.spend += s;
    ast.imp += imp;
    ast.clicks += clk;
    ast.pur += p;
    ast.pVal += pv;
  }

  // Assemble stores list using computed ledger data
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

  // Assemble accounts list using computed ledger data
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

  // 3. Aggregate product level stats specifically from raw order rows for top products SKU list
  const productStats = new Map<string, { orderCount: number; quantity: number; sales: number; uniqueOrderIds?: Set<string> }>();
  for (const order of ordersForProducts) {
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

  const products = Array.from(productStats.entries()).map(([id, st]) => ({
    productName: `Product ${id.substring(0, 6)}`,
    sku: id,
    orderCount: st.orderCount,
    quantity: st.quantity,
    sales: st.sales
  })).sort((a, b) => b.sales - a.sales).slice(0, 50);

  // Data readiness counters
  const totalStoreLedgerCount = storeDailyLedgers.length;
  const totalMetaLedgerCount = metaDailyLedgers.length;

  const dataReadiness = [
    {
      key: "insights",
      label: "广告成效数据",
      status: totalMetaLedgerCount > 0 ? "ready" : "missing",
      records: totalMetaLedgerCount,
      note: totalMetaLedgerCount > 0 ? "成效数据已同步" : "请先绑定广告账户并执行同步"
    },
    {
      key: "orders",
      label: "店铺订单数据",
      status: totalStoreLedgerCount > 0 ? "ready" : "missing",
      records: totalStoreLedgerCount,
      note: totalStoreLedgerCount > 0 ? "订单数据已同步" : "请配置店铺并同步历史订单"
    }
  ];

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
