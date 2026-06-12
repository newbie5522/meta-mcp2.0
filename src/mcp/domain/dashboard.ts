// @ts-nocheck
import { prisma } from "../db/prisma.js";
import { getNumericAccountId } from "../../server/utils.js";
import { cacheDelete, cacheKey, defaultTtlSeconds, withCache } from "../../packages/cache/src/index.js";

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const number = value.toNumber();
    return Number.isFinite(number) ? number : 0;
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getDashboardSummary(options: { refresh?: boolean; since?: Date; until?: Date } = {}) {
  const until = dateOnly(options.until ?? new Date());
  const since = dateOnly(options.since ?? addDays(until, -29));
  const untilExclusive = addDays(until, 1);
  const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86_400_000) + 1);
  const rangeKey = `${formatDate(since)}:${formatDate(until)}`;
  const key = cacheKey.dashboard(rangeKey);
  if (options.refresh) await cacheDelete(key);
  return withCache(key, defaultTtlSeconds.dashboard, async () => {
    const [
      storeCount,
      activeStoreCount,
      stores,
      adAccountCount,
      mappedAdAccountCount,
      adAccounts,
      campaignCount,
      adsetCount,
      adCount,
      totalInsightCount,
      creativeCount,
      breakdownCount,
      totalOrderCount,
      latestInsight,
      latestOrder,
      latestCreative,
      latestBreakdown,
      orders,
      orderItems,
      insights,
      syncCounts,
      pendingAiSuggestions,
      recentLogs,
    ] =
      await Promise.all([
        prisma.store.count(),
        prisma.store.count({ where: { status: "active" } }),
        prisma.store.findMany({
          select: {
            id: true,
            name: true,
            platform: true,
            domain: true,
            status: true,
            currency: true,
            _count: {
              select: {
                orders: true,
                adAccountMaps: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.adAccount.count({ where: { recentActivity90d: true } }),
        prisma.storeAdAccountMap.count(),
        prisma.adAccount.findMany({
          where: { recentActivity90d: true },
          select: {
            id: true,
            metaAccountId: true,
            name: true,
            status: true,
            storeMap: {
              select: {
                store: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
        prisma.campaign.count(),
        prisma.adSet.count(),
        prisma.ad.count(),
        prisma.metaDailyInsight.count(),
        prisma.metaAdCreative.count(),
        prisma.metaBreakdown.count(),
        prisma.order.count(),
        prisma.metaDailyInsight.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { date: true, updatedAt: true },
        }),
        prisma.order.findFirst({
          orderBy: { updatedAtSystem: "desc" },
          select: { createdAt: true, updatedAtSystem: true },
        }),
        prisma.metaAdCreative.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
        }),
        prisma.metaBreakdown.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { date: true, updatedAt: true },
        }),
        prisma.order.findMany({
          where: {
            storeLocalDate: {
              gte: since,
              lte: until,
            },
          },
          select: {
            id: true,
            storeId: true,
            totalAmount: true,
            currency: true,
          },
        }),
        prisma.orderItem.findMany({
          where: {
            order: {
              storeLocalDate: {
                gte: since,
                lte: until,
              },
            },
          },
          select: {
            orderId: true,
            productName: true,
            sku: true,
            quantity: true,
            totalPrice: true,
            price: true,
            order: {
              select: {
                storeId: true,
                totalAmount: true,
              },
            },
          },
        }),
        prisma.metaDailyInsight.findMany({
          where: {
            date: {
              gte: since,
              lte: until,
            },
          },
          select: {
            adAccountId: true,
            spend: true,
            impressions: true,
            clicks: true,
            purchases: true,
            purchaseValue: true,
          },
        }),
        prisma.syncLog.groupBy({
          by: ["status"],
          _count: { _all: true },
          where: {
            startedAt: {
              gte: since,
            },
          },
        }),
        prisma.aiActionSuggestion.count({ where: { status: "pending" } }),
        prisma.syncLog.findMany({
          orderBy: { startedAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            recordsFetched: true,
            recordsSaved: true,
            errorMessage: true,
          },
        }),
      ]);

    const orderCount = orders.length;
    const storeSales = orders.reduce((sum, order) => sum + toNumber(order.totalAmount), 0);
    const metaSpend = insights.reduce((sum, row) => sum + toNumber(row.spend), 0);
    const metaPurchaseValue = insights.reduce((sum, row) => sum + toNumber(row.purchaseValue), 0);
    const impressions = insights.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
    const clicks = insights.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
    const metaPurchases = insights.reduce((sum, row) => sum + (row.purchases ?? 0), 0);

    const salesByStore = new Map<string, { orders: number; sales: number }>();
    for (const order of orders) {
      const bucket = salesByStore.get(order.storeId) ?? { orders: 0, sales: 0 };
      bucket.orders += 1;
      bucket.sales += toNumber(order.totalAmount);
      salesByStore.set(order.storeId, bucket);
    }

    const insightByAccount = new Map<string, {
      spend: number;
      impressions: number;
      clicks: number;
      purchases: number;
      purchaseValue: number;
    }>();
    for (const row of insights) {
      const bucket = insightByAccount.get(row.adAccountId) ?? {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchaseValue: 0,
      };
      bucket.spend += toNumber(row.spend);
      bucket.impressions += row.impressions ?? 0;
      bucket.clicks += row.clicks ?? 0;
      bucket.purchases += row.purchases ?? 0;
      bucket.purchaseValue += toNumber(row.purchaseValue);
      insightByAccount.set(row.adAccountId, bucket);
    }

    const productBuckets = new Map<string, {
      productName: string;
      sku: string | null;
      orders: Set<string>;
      quantity: number;
      sales: number;
    }>();
    for (const item of orderItems) {
      const productName = item.productName || "未命名产品";
      const sku = item.sku || null;
      const key = `${productName}::${sku ?? ""}`;
      const bucket = productBuckets.get(key) ?? {
        productName,
        sku,
        orders: new Set<string>(),
        quantity: 0,
        sales: 0,
      };
      const lineTotal = toNumber(item.totalPrice) || toNumber(item.price) * item.quantity;
      bucket.orders.add(item.orderId);
      bucket.quantity += item.quantity;
      bucket.sales += lineTotal;
      productBuckets.set(key, bucket);
    }

    const syncHealth = syncCounts.reduce(
      (acc, row) => ({ ...acc, [row.status]: row._count._all }),
      { pending: 0, running: 0, success: 0, failed: 0 } as Record<string, number>,
      );

    const latestLogByType = new Map<string, typeof recentLogs[number]>();
    for (const log of recentLogs) {
      if (!latestLogByType.has(log.type)) latestLogByType.set(log.type, log);
    }
    const dataReadiness = [
      {
        key: "meta_ad_accounts",
        label: "Meta 广告账户",
        status: adAccountCount > 0 ? "ready" : "missing",
        records: adAccountCount,
        latestDataAt: null,
        latestSyncAt: latestLogByType.get("meta_ad_accounts")?.finishedAt ?? latestLogByType.get("meta_ad_accounts")?.startedAt ?? null,
        note: adAccountCount > 0 ? "账户基础数据可用" : "尚未同步广告账户",
      },
      {
        key: "meta_structure",
        label: "Campaign / Ad Set / Ad 结构",
        status: campaignCount + adsetCount + adCount > 0 ? "ready" : "missing",
        records: campaignCount + adsetCount + adCount,
        latestDataAt: null,
        latestSyncAt: latestLogByType.get("meta_structure")?.finishedAt ?? latestLogByType.get("meta_structure")?.startedAt ?? null,
        note: `Campaign ${campaignCount}，Ad Set ${adsetCount}，Ad ${adCount}`,
      },
      {
        key: "meta_insights",
        label: "Meta 消耗与转化",
        status: totalInsightCount > 0 ? "ready" : "missing",
        records: totalInsightCount,
        latestDataAt: latestInsight?.date ?? null,
        latestSyncAt: latestLogByType.get("meta_insights")?.finishedAt ?? latestLogByType.get("meta_insights")?.startedAt ?? latestInsight?.updatedAt ?? null,
        note: insights.length > 0 ? `当前范围有 ${insights.length} 行 Insights` : "当前范围暂无 Insights",
      },
      {
        key: "meta_creatives",
        label: "Meta 素材快照",
        status: creativeCount > 0 ? "ready" : "missing",
        records: creativeCount,
        latestDataAt: latestCreative?.updatedAt ?? null,
        latestSyncAt: latestLogByType.get("meta_creatives")?.finishedAt ?? latestLogByType.get("meta_creatives")?.startedAt ?? latestCreative?.updatedAt ?? null,
        note: creativeCount > 0 ? "可用于素材分析和 Creative Copilot" : "尚未同步素材快照",
      },
      {
        key: "meta_breakdowns",
        label: "国家 / 年龄 / 版位 Breakdown",
        status: breakdownCount > 0 ? "ready" : "missing",
        records: breakdownCount,
        latestDataAt: latestBreakdown?.date ?? null,
        latestSyncAt: latestBreakdown?.updatedAt ?? null,
        note: breakdownCount > 0 ? "可用于国家、人群、版位分析" : "尚未同步 Breakdown",
      },
      {
        key: "orders",
        label: "店铺订单",
        status: totalOrderCount > 0 ? "ready" : "missing",
        records: totalOrderCount,
        latestDataAt: latestOrder?.createdAt ?? null,
        latestSyncAt: latestLogByType.get("orders")?.finishedAt ?? latestLogByType.get("orders")?.startedAt ?? latestOrder?.updatedAtSystem ?? null,
        note: orderCount > 0 ? `当前范围有 ${orderCount} 笔订单` : "当前范围暂无订单",
      },
    ];

    return {
      range: {
        since: formatDate(since),
        until: formatDate(until),
        days,
      },
      storeCount,
      activeStoreCount,
      adAccountCount,
      mappedAdAccountCount,
      overview: {
        storeOrderCount: orderCount,
        storeSales: round(storeSales),
        metaSpend: round(metaSpend),
        realRoas: safeRatio(storeSales, metaSpend) === null ? null : round(safeRatio(storeSales, metaSpend) ?? 0, 3),
        metaRoas: safeRatio(metaPurchaseValue, metaSpend) === null ? null : round(safeRatio(metaPurchaseValue, metaSpend) ?? 0, 3),
        metaPurchases,
        metaPurchaseValue: round(metaPurchaseValue),
        impressions,
        clicks,
        ctr: safeRatio(clicks * 100, impressions) === null ? null : round(safeRatio(clicks * 100, impressions) ?? 0, 3),
      },
      stores: stores
        .map((store) => {
          const storeMetrics = salesByStore.get(store.id) ?? { orders: 0, sales: 0 };
          return {
            id: store.id,
            name: store.name,
            platform: store.platform,
            domain: store.domain,
            status: store.status,
            currency: store.currency,
            mappedAccounts: store._count.adAccountMaps,
            orderCount: storeMetrics.orders,
            sales: round(storeMetrics.sales),
          };
        })
        .sort((a, b) => b.sales - a.sales || b.orderCount - a.orderCount),
      accounts: adAccounts
        .map((account) => {
          const metrics = insightByAccount.get(account.id) ?? {
            spend: 0,
            impressions: 0,
            clicks: 0,
            purchases: 0,
            purchaseValue: 0,
          };
          return {
            id: account.id,
            metaAccountId: getNumericAccountId(account.fb_account_id || account.metaAccountId),
            name: account.name,
            status: account.status,
            storeName: account.storeMap?.store?.name ?? null,
            spend: round(metrics.spend),
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            purchases: metrics.purchases,
            purchaseValue: round(metrics.purchaseValue),
            roas: safeRatio(metrics.purchaseValue, metrics.spend) === null
              ? null
              : round(safeRatio(metrics.purchaseValue, metrics.spend) ?? 0, 3),
          };
        })
        .sort((a, b) => b.spend - a.spend || b.purchaseValue - a.purchaseValue)
        .slice(0, 10),
      products: [...productBuckets.values()]
        .map((product) => ({
          productName: product.productName,
          sku: product.sku,
          orderCount: product.orders.size,
          quantity: product.quantity,
          sales: round(product.sales),
        }))
        .sort((a, b) => b.sales - a.sales || b.orderCount - a.orderCount)
        .slice(0, 10),
      syncHealth,
      ai: {
        pendingSuggestions: pendingAiSuggestions,
      },
      dataReadiness,
      recentLogs,
    };
  });
}
