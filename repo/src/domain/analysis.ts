import { z } from "zod";
import { prisma } from "../db/prisma.js";
import {
  buildAiAdvice,
  classifyCountryRecommendation,
  judgeCreativePerformance,
  ratio,
  round,
} from "./analysis-rules.js";
import { cacheKey, defaultTtlSeconds, withCache } from "../../packages/cache/src/index.js";

export const analysisRangeSchema = z.object({
  storeId: z.string().min(1),
  since: z.string().optional(),
  until: z.string().optional(),
});

export const trendAnalysisSchema = z.object({
  storeId: z.string().min(1),
  until: z.string().optional(),
});

export type AnalysisRangeInput = z.input<typeof analysisRangeSchema>;
export type TrendAnalysisInput = z.input<typeof trendAnalysisSchema>;

interface Range {
  since: Date;
  until: Date;
  untilExclusive: Date;
  days: number;
}

interface OrderMetricRow {
  id: string;
  createdAt: Date;
  storeLocalDate: Date | null;
  country: string | null;
  currency: string | null;
  totalAmount: unknown;
}

interface OrderItemRow {
  orderId: string;
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  sku: string | null;
  quantity: number;
  price: unknown;
  totalPrice: unknown;
  order: {
    country: string | null;
    createdAt: Date;
    storeLocalDate: Date | null;
  };
}

interface InsightMetricRow {
  adAccountId: string;
  date: Date;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  country: string | null;
  spend: unknown;
  impressions: number | null;
  reach: number | null;
  frequency: unknown;
  clicks: number | null;
  purchases: number | null;
  purchaseValue: unknown;
  addToCart: number | null;
  initiateCheckout: number | null;
}

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

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateOnly(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return dateOnly(date);
}

function resolveRange(input: { since?: string; until?: string }, defaultDays = 7): Range {
  const until = parseDateOnly(input.until) ?? dateOnly(new Date());
  const since = parseDateOnly(input.since) ?? addDays(until, -defaultDays + 1);
  if (since > until) {
    throw new Error("since must be before or equal to until");
  }
  const days = Math.round((until.getTime() - since.getTime()) / 86_400_000) + 1;
  if (days > 366) {
    throw new Error("date range cannot exceed 366 days");
  }
  return { since, until, untilExclusive: addDays(until, 1), days };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangePayload(range: Range) {
  return {
    since: formatDate(range.since),
    until: formatDate(range.until),
    days: range.days,
  };
}

async function getStoreContext(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: {
      adAccountMaps: {
        include: {
          adAccount: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!store) throw new Error("Store not found");
  const adAccounts = store.adAccountMaps.map((mapping) => mapping.adAccount);
  return {
    store,
    adAccounts,
    adAccountIds: adAccounts.map((account) => account.id),
  };
}

async function fetchOrders(storeId: string, range: Range): Promise<OrderMetricRow[]> {
  return prisma.order.findMany({
    where: {
      storeId,
      storeLocalDate: {
        gte: range.since,
        lte: range.until,
      },
    },
    select: {
      id: true,
      createdAt: true,
      storeLocalDate: true,
      country: true,
      currency: true,
      totalAmount: true,
    },
  });
}

async function fetchOrderItems(storeId: string, range: Range): Promise<OrderItemRow[]> {
  return prisma.orderItem.findMany({
    where: {
      order: {
        storeId,
        storeLocalDate: {
          gte: range.since,
          lte: range.until,
        },
      },
    },
    select: {
      orderId: true,
      productId: true,
      productName: true,
      variantId: true,
      sku: true,
      quantity: true,
      price: true,
      totalPrice: true,
      order: {
        select: {
          country: true,
          createdAt: true,
          storeLocalDate: true,
        },
      },
    },
  });
}

async function fetchInsights(adAccountIds: string[], range: Range): Promise<InsightMetricRow[]> {
  if (adAccountIds.length === 0) return [];
  return prisma.metaDailyInsight.findMany({
    where: {
      adAccountId: { in: adAccountIds },
      date: {
        gte: range.since,
        lte: range.until,
      },
    },
    select: {
      adAccountId: true,
      date: true,
      campaignId: true,
      campaignName: true,
      adsetId: true,
      adsetName: true,
      adId: true,
      adName: true,
      country: true,
      spend: true,
      impressions: true,
      reach: true,
      frequency: true,
      clicks: true,
      purchases: true,
      purchaseValue: true,
      addToCart: true,
      initiateCheckout: true,
    },
  });
}

function summarizeOrders(orders: OrderMetricRow[]) {
  return {
    orderCount: orders.length,
    sales: orders.reduce((sum, order) => sum + toNumber(order.totalAmount), 0),
  };
}

function summarizeInsights(rows: InsightMetricRow[]) {
  const spend = rows.reduce((sum, row) => sum + toNumber(row.spend), 0);
  const impressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
  const reach = rows.reduce((sum, row) => sum + (row.reach ?? 0), 0);
  const clicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
  const purchases = rows.reduce((sum, row) => sum + (row.purchases ?? 0), 0);
  const purchaseValue = rows.reduce((sum, row) => sum + toNumber(row.purchaseValue), 0);
  const addToCart = rows.reduce((sum, row) => sum + (row.addToCart ?? 0), 0);
  const initiateCheckout = rows.reduce((sum, row) => sum + (row.initiateCheckout ?? 0), 0);
  const frequencyRows = rows
    .map((row) => toNumber(row.frequency))
    .filter((value) => value > 0);
  const frequency = frequencyRows.length > 0
    ? frequencyRows.reduce((sum, value) => sum + value, 0) / frequencyRows.length
    : null;
  return {
    spend,
    impressions,
    reach,
    frequency,
    clicks,
    ctr: ratio(clicks * 100, impressions),
    cpc: ratio(spend, clicks),
    cpm: ratio(spend * 1000, impressions),
    purchases,
    purchaseValue,
    metaRoas: ratio(purchaseValue, spend),
    addToCart,
    initiateCheckout,
    costPerPurchase: ratio(spend, purchases),
  };
}

function metricsPayload(metrics: ReturnType<typeof summarizeInsights>) {
  return {
    spend: round(metrics.spend, 2) ?? 0,
    impressions: metrics.impressions,
    reach: metrics.reach,
    frequency: round(metrics.frequency, 2),
    clicks: metrics.clicks,
    ctr: round(metrics.ctr, 3),
    cpc: round(metrics.cpc, 3),
    cpm: round(metrics.cpm, 3),
    purchases: metrics.purchases,
    purchaseValue: round(metrics.purchaseValue, 2) ?? 0,
    metaRoas: round(metrics.metaRoas, 3),
    addToCart: metrics.addToCart,
    initiateCheckout: metrics.initiateCheckout,
    costPerPurchase: round(metrics.costPerPurchase, 3),
  };
}

function storePayload(store: { id: string; name: string; platform: string; domain: string; currency: string | null }) {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform,
    domain: store.domain,
    currency: store.currency,
  };
}

function bucketOrdersByDate(orders: OrderMetricRow[]) {
  const buckets = new Map<string, { date: string; orders: number; sales: number }>();
  for (const order of orders) {
    const date = formatDate(dateOnly(order.storeLocalDate ?? order.createdAt));
    const bucket = buckets.get(date) ?? { date, orders: 0, sales: 0 };
    bucket.orders += 1;
    bucket.sales += toNumber(order.totalAmount);
    buckets.set(date, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({ ...row, sales: round(row.sales, 2) ?? 0 }));
}

function coreProblemSummary(input: {
  spend: number;
  realRoas: number | null;
  metaRoas: number | null;
  orderGap: number;
}) {
  if (input.spend <= 0) return "缺少广告花费数据，优先确认 Meta Insights 同步和广告账户映射。";
  if ((input.realRoas ?? 0) < 1) return "真实 ROAS 偏低，优先排查低效国家、落地页承接和素材转化。";
  if (Math.abs(input.orderGap) >= 5) return "真实订单与 Meta 归因订单差异较大，优先排查归因与映射。";
  if ((input.metaRoas ?? 0) - (input.realRoas ?? 0) >= 1) return "Meta ROAS 高于真实 ROAS，预算判断需要以店铺真实收入为准。";
  return "整体未发现严重异常，可继续按国家、产品和素材维度优化。";
}

async function computeStoreOverviewAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  const context = await getStoreContext(parsed.storeId);
  const orders = await fetchOrders(parsed.storeId, range);
  const insights = await fetchInsights(context.adAccountIds, range);
  const orderMetrics = summarizeOrders(orders);
  const adMetrics = summarizeInsights(insights);
  const realRoas = ratio(orderMetrics.sales, adMetrics.spend);
  const orderGap = orderMetrics.orderCount - adMetrics.purchases;
  const advice = buildAiAdvice({
    orderCount: orderMetrics.orderCount,
    sales: orderMetrics.sales,
    spend: adMetrics.spend,
    realRoas,
    metaRoas: adMetrics.metaRoas,
    metaPurchases: adMetrics.purchases,
    orderGap,
  });

  return {
    range: rangePayload(range),
    store: storePayload(context.store),
    mappedAdAccounts: context.adAccounts.map((account) => ({
      id: account.id,
      metaAccountId: account.metaAccountId,
      name: account.name,
      currency: account.currency,
      status: account.status,
    })),
    metrics: {
      storeOrderCount: orderMetrics.orderCount,
      storeSales: round(orderMetrics.sales, 2) ?? 0,
      adSpend: round(adMetrics.spend, 2) ?? 0,
      realRoas: round(realRoas, 3),
      metaRoas: round(adMetrics.metaRoas, 3),
      metaAttributedOrders: adMetrics.purchases,
      orderGap,
      meta: metricsPayload(adMetrics),
    },
    coreProblemSummary: coreProblemSummary({
      spend: adMetrics.spend,
      realRoas,
      metaRoas: adMetrics.metaRoas,
      orderGap,
    }),
    aiAdvice: advice,
  };
}

async function computeStoreAdAccountAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  const context = await getStoreContext(parsed.storeId);
  const orders = await fetchOrders(parsed.storeId, range);
  const insights = await fetchInsights(context.adAccountIds, range);
  const totalSpend = summarizeInsights(insights).spend;

  const byAccount = new Map<string, InsightMetricRow[]>();
  for (const row of insights) {
    const bucket = byAccount.get(row.adAccountId) ?? [];
    bucket.push(row);
    byAccount.set(row.adAccountId, bucket);
  }

  return {
    range: rangePayload(range),
    store: storePayload(context.store),
    storeOrderTrend: bucketOrdersByDate(orders),
    accounts: context.adAccounts.map((account) => {
      const metrics = summarizeInsights(byAccount.get(account.id) ?? []);
      const roas = metrics.metaRoas;
      const budgetAdvice = metrics.spend <= 0
        ? "建议先同步数据"
        : (roas ?? 0) >= 2.5 && metrics.purchases >= 3
          ? "建议加预算"
          : (roas ?? 0) < 1 && metrics.spend >= 30
            ? "建议降预算"
            : "建议观察";
      return {
        adAccountId: account.id,
        metaAccountId: account.metaAccountId,
        name: account.name,
        spend: round(metrics.spend, 2) ?? 0,
        spendShare: round(ratio(metrics.spend * 100, totalSpend), 2),
        metaPurchases: metrics.purchases,
        metaRoas: round(metrics.metaRoas, 3),
        possibleLeakAttribution: metrics.purchases === 0 && metrics.spend > 0,
        possibleOverAttribution: metrics.purchases > orders.length && orders.length > 0,
        budgetAdvice,
      };
    }),
  };
}

async function computeCountryAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  const context = await getStoreContext(parsed.storeId);
  const orders = await fetchOrders(parsed.storeId, range);
  const insights = await fetchInsights(context.adAccountIds, range);

  const countries = new Map<string, { country: string; orders: number; sales: number; insightRows: InsightMetricRow[] }>();
  for (const order of orders) {
    const country = (order.country || "UNKNOWN").toUpperCase();
    const bucket = countries.get(country) ?? { country, orders: 0, sales: 0, insightRows: [] };
    bucket.orders += 1;
    bucket.sales += toNumber(order.totalAmount);
    countries.set(country, bucket);
  }
  for (const row of insights) {
    const country = (row.country || "UNKNOWN").toUpperCase();
    const bucket = countries.get(country) ?? { country, orders: 0, sales: 0, insightRows: [] };
    bucket.insightRows.push(row);
    countries.set(country, bucket);
  }

  return {
    range: rangePayload(range),
    store: storePayload(context.store),
    countries: [...countries.values()]
      .map((bucket) => {
        const metrics = summarizeInsights(bucket.insightRows);
        const realRoas = ratio(bucket.sales, metrics.spend);
        return {
          country: bucket.country,
          storeOrderCount: bucket.orders,
          storeSales: round(bucket.sales, 2) ?? 0,
          metaSpend: round(metrics.spend, 2) ?? 0,
          realRoas: round(realRoas, 3),
          metaRoas: round(metrics.metaRoas, 3),
          recommendation: classifyCountryRecommendation({
            orders: bucket.orders,
            sales: bucket.sales,
            spend: metrics.spend,
            realRoas,
            metaRoas: metrics.metaRoas,
          }),
        };
      })
      .sort((a, b) => b.metaSpend - a.metaSpend || b.storeSales - a.storeSales),
  };
}

async function computeProductAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  const context = await getStoreContext(parsed.storeId);
  const items = await fetchOrderItems(parsed.storeId, range);
  const products = new Map<string, {
    productName: string;
    sku: string | null;
    productId: string | null;
    variantId: string | null;
    orderIds: Set<string>;
    quantity: number;
    sales: number;
    countries: Map<string, number>;
  }>();

  for (const item of items) {
    const name = item.productName || "UNKNOWN_PRODUCT";
    const sku = item.sku || null;
    const key = `${name}::${sku ?? ""}`;
    const bucket = products.get(key) ?? {
      productName: name,
      sku,
      productId: item.productId,
      variantId: item.variantId,
      orderIds: new Set<string>(),
      quantity: 0,
      sales: 0,
      countries: new Map<string, number>(),
    };
    const lineTotal = toNumber(item.totalPrice) || toNumber(item.price) * item.quantity;
    const country = (item.order.country || "UNKNOWN").toUpperCase();
    bucket.orderIds.add(item.orderId);
    bucket.quantity += item.quantity;
    bucket.sales += lineTotal;
    bucket.countries.set(country, (bucket.countries.get(country) ?? 0) + 1);
    products.set(key, bucket);
  }

  return {
    range: rangePayload(range),
    store: storePayload(context.store),
    products: [...products.values()]
      .map((product) => {
        const orderCount = product.orderIds.size;
        const mainCountries = [...product.countries.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([country, orders]) => ({ country, orders }));
        const concentrated = mainCountries[0] && mainCountries[0].orders / Math.max(orderCount, 1) >= 0.6;
        const topCountry = mainCountries[0]?.country ?? null;
        const suggestion = orderCount >= 8 && concentrated
          ? "适合单独开产品系列，并优先围绕主力国家扩量。"
          : orderCount >= 3 && product.sales > 0
            ? "建议补充新素材，继续混投验证国家和受众。"
            : "继续混投观察，等待更多订单样本后再单独拆系列。";
        return {
          productName: product.productName,
          sku: product.sku,
          productId: product.productId,
          variantId: product.variantId,
          orderCount,
          quantity: product.quantity,
          sales: round(product.sales, 2) ?? 0,
          mainCountries,
          topCountry,
          suitableForSingleCampaign: orderCount >= 8 && Boolean(concentrated),
          suitableForMixedCampaign: orderCount < 8 || !concentrated,
          suitableForNewCreative: orderCount >= 3 && product.sales > 0,
          suggestion,
        };
      })
      .sort((a, b) => b.sales - a.sales || b.orderCount - a.orderCount),
  };
}

async function computeCreativeAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  const context = await getStoreContext(parsed.storeId);
  const insights = await fetchInsights(context.adAccountIds, range);
  const ads = new Map<string, { adAccountId: string; adId: string; adName: string | null; rows: InsightMetricRow[] }>();

  for (const row of insights) {
    if (!row.adId) continue;
    const key = `${row.adAccountId}:${row.adId}`;
    const bucket = ads.get(key) ?? { adAccountId: row.adAccountId, adId: row.adId, adName: row.adName, rows: [] };
    bucket.rows.push(row);
    if (!bucket.adName && row.adName) bucket.adName = row.adName;
    ads.set(key, bucket);
  }
  const adIds = [...new Set([...ads.values()].map((ad) => ad.adId))];
  const snapshots = adIds.length > 0
    ? await prisma.metaAdCreative.findMany({
      where: {
        adAccountId: { in: context.adAccountIds },
        adId: { in: adIds },
      },
    })
    : [];
  const snapshotsByKey = new Map(snapshots.map((snapshot) => [`${snapshot.adAccountId}:${snapshot.adId}`, snapshot]));

  return {
    range: rangePayload(range),
    store: storePayload(context.store),
    note: "Creative fields are loaded from local meta_ad_creatives snapshots. Run creative sync after ad structure changes.",
    creatives: [...ads.values()]
      .map((ad) => {
        const metrics = summarizeInsights(ad.rows);
        const snapshot = snapshotsByKey.get(`${ad.adAccountId}:${ad.adId}`);
        const creativeJudgement = judgeCreativePerformance({
          spend: metrics.spend,
          ctr: metrics.ctr,
          cpc: metrics.cpc,
          cpm: metrics.cpm,
          purchases: metrics.purchases,
          roas: metrics.metaRoas,
          frequency: metrics.frequency,
        });
        const suggestion = creativeJudgement === "可扩量"
          ? "保留当前素材方向，生成相似 Hook 和本地化版本后小幅扩量。"
          : creativeJudgement === "高点击低转化"
            ? "Hook 有吸引力但承接弱，优先检查产品页、价格、国家和受众匹配。"
            : creativeJudgement === "低点击高转化"
              ? "转化质量不错但点击不足，建议重做首屏、标题或前三秒 Hook。"
              : creativeJudgement === "疲劳"
                ? "存在疲劳风险，建议尽快补充新素材或替换 Hook。"
                : creativeJudgement === "需替换 Hook"
                  ? "点击吸引力不足，建议替换前三秒 Hook、主图或开场文案。"
                  : "继续观察，并对比 3 天和 7 天趋势。";
        return {
          adId: ad.adId,
          creativeId: snapshot?.creativeId ?? null,
          adName: snapshot?.adName ?? ad.adName,
          title: snapshot?.title ?? null,
          body: snapshot?.body ?? null,
          imageUrl: snapshot?.imageUrl ?? null,
          videoId: snapshot?.videoId ?? null,
          linkUrl: snapshot?.linkUrl ?? null,
          spend: round(metrics.spend, 2) ?? 0,
          ctr: round(metrics.ctr, 3),
          cpc: round(metrics.cpc, 3),
          cpm: round(metrics.cpm, 3),
          purchases: metrics.purchases,
          roas: round(metrics.metaRoas, 3),
          creativeJudgement,
          suggestion,
        };
      })
      .sort((a, b) => b.spend - a.spend),
  };
}

function windowRange(until: Date, days: number): Range {
  const start = addDays(until, -days + 1);
  return { since: start, until, untilExclusive: addDays(until, 1), days };
}

async function computeTrendAnalysis(input: TrendAnalysisInput) {
  const parsed = trendAnalysisSchema.parse(input);
  const until = parseDateOnly(parsed.until) ?? dateOnly(new Date());
  const context = await getStoreContext(parsed.storeId);
  const maxRange = windowRange(until, 30);
  const orders = await fetchOrders(parsed.storeId, maxRange);
  const insights = await fetchInsights(context.adAccountIds, maxRange);
  const windows = [1, 3, 7, 14, 30].map((days) => {
    const range = windowRange(until, days);
    const windowOrders = orders.filter((order) => {
      const orderDate = order.storeLocalDate ?? order.createdAt;
      return orderDate >= range.since && orderDate <= range.until;
    });
    const windowInsights = insights.filter((row) => row.date >= range.since && row.date <= range.until);
    const orderMetrics = summarizeOrders(windowOrders);
    const adMetrics = summarizeInsights(windowInsights);
    return {
      days,
      since: formatDate(range.since),
      until: formatDate(range.until),
      storeOrderCount: orderMetrics.orderCount,
      storeSales: round(orderMetrics.sales, 2) ?? 0,
      spend: round(adMetrics.spend, 2) ?? 0,
      ctr: round(adMetrics.ctr, 3),
      cpm: round(adMetrics.cpm, 3),
      cpa: round(adMetrics.costPerPurchase, 3),
      purchases: adMetrics.purchases,
      realRoas: round(ratio(orderMetrics.sales, adMetrics.spend), 3),
      metaRoas: round(adMetrics.metaRoas, 3),
    };
  });
  const byDays = new Map(windows.map((window) => [window.days, window]));
  const w3 = byDays.get(3);
  const w14 = byDays.get(14);
  const w30 = byDays.get(30);

  const countryCounts = new Map<string, number>();
  for (const order of orders) {
    const country = (order.country || "UNKNOWN").toUpperCase();
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
  }
  const topCountry = [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const totalOrders = orders.length;

  return {
    range: rangePayload(maxRange),
    store: storePayload(context.store),
    windows,
    signals: {
      ctrDeclining: Boolean(w3?.ctr && w14?.ctr && w3.ctr < w14.ctr * 0.85),
      cpmRising: Boolean(w3?.cpm && w14?.cpm && w3.cpm > w14.cpm * 1.15),
      cpaWorsening: Boolean(w3?.cpa && w14?.cpa && w3.cpa > w14.cpa * 1.15),
      ordersConcentratedInCountry: Boolean(topCountry && totalOrders > 0 && topCountry[1] / totalOrders >= 0.6),
      topOrderCountry: topCountry ? { country: topCountry[0], orders: topCountry[1] } : null,
      creativeFatigueRisk: Boolean(w3?.ctr && w30?.ctr && w3.ctr < w30.ctr * 0.8 && w3.cpm && w30?.cpm && w3.cpm > w30.cpm),
    },
  };
}

function rangeKey(range: Pick<Range, "since" | "until">): string {
  return `${formatDate(range.since)}:${formatDate(range.until)}`;
}

export async function getStoreOverviewAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  return withCache(
    cacheKey.storeSummary(parsed.storeId, rangeKey(range)),
    defaultTtlSeconds.summary,
    () => computeStoreOverviewAnalysis(parsed),
  );
}

export async function getStoreAdAccountAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  return withCache(
    cacheKey.accountSummary(`store:${parsed.storeId}`, rangeKey(range)),
    defaultTtlSeconds.summary,
    () => computeStoreAdAccountAnalysis(parsed),
  );
}

export async function getCountryAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  return withCache(
    cacheKey.countryAnalysis(parsed.storeId, rangeKey(range)),
    defaultTtlSeconds.breakdown,
    () => computeCountryAnalysis(parsed),
  );
}

export async function getProductAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  return withCache(
    cacheKey.productAnalysis(parsed.storeId, rangeKey(range)),
    defaultTtlSeconds.breakdown,
    () => computeProductAnalysis(parsed),
  );
}

export async function getCreativeAnalysis(input: AnalysisRangeInput) {
  const parsed = analysisRangeSchema.parse(input);
  const range = resolveRange(parsed);
  return withCache(
    cacheKey.creativeAnalysis(parsed.storeId, rangeKey(range)),
    defaultTtlSeconds.breakdown,
    () => computeCreativeAnalysis(parsed),
  );
}

export async function getTrendAnalysis(input: TrendAnalysisInput) {
  const parsed = trendAnalysisSchema.parse(input);
  const until = parseDateOnly(parsed.until) ?? dateOnly(new Date());
  return withCache(
    cacheKey.trendAnalysis(parsed.storeId, formatDate(until)),
    defaultTtlSeconds.breakdown,
    () => computeTrendAnalysis(parsed),
  );
}
