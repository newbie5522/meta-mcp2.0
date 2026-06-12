// @ts-nocheck
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { accountStatusLabel, plainMetaAccountId } from "./ad-accounts.js";
import { judgeCreativePerformance, ratio, round, type AiAdvice } from "./analysis-rules.js";
import { cacheKey, defaultTtlSeconds, withCache } from "../../packages/cache/src/index.js";

export const accountAnalysisQuerySchema = z.object({
  adAccountId: z.string().min(1),
  since: z.string().optional(),
  until: z.string().optional(),
});

export type AccountAnalysisInput = z.input<typeof accountAnalysisQuerySchema>;

interface Range {
  since: Date;
  until: Date;
  untilExclusive: Date;
  days: number;
}

interface InsightMetricRow {
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

interface Metrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  purchases: number;
  purchaseValue: number;
  roas: number | null;
  addToCart: number;
  initiateCheckout: number;
  costPerPurchase: number | null;
}

type EntityKind = "account" | "campaign" | "adset" | "ad";

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

function resolveRange(input: { since?: string; until?: string }, defaultDays = 30): Range {
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

function summarizeInsights(rows: InsightMetricRow[]): Metrics {
  const spend = rows.reduce((sum, row) => sum + toNumber(row.spend), 0);
  const impressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
  const reach = rows.reduce((sum, row) => sum + (row.reach ?? 0), 0);
  const clicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
  const purchases = rows.reduce((sum, row) => sum + (row.purchases ?? 0), 0);
  const purchaseValue = rows.reduce((sum, row) => sum + toNumber(row.purchaseValue), 0);
  const addToCart = rows.reduce((sum, row) => sum + (row.addToCart ?? 0), 0);
  const initiateCheckout = rows.reduce((sum, row) => sum + (row.initiateCheckout ?? 0), 0);
  const frequencyRows = rows.map((row) => toNumber(row.frequency)).filter((value) => value > 0);
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
    roas: ratio(purchaseValue, spend),
    addToCart,
    initiateCheckout,
    costPerPurchase: ratio(spend, purchases),
  };
}

function metricsPayload(metrics: Metrics) {
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
    roas: round(metrics.roas, 3),
    addToCart: metrics.addToCart,
    initiateCheckout: metrics.initiateCheckout,
    costPerPurchase: round(metrics.costPerPurchase, 3),
  };
}

function groupRows(rows: InsightMetricRow[], keyFor: (row: InsightMetricRow) => string | null) {
  const groups = new Map<string, InsightMetricRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return groups;
}

function actionLabel(metrics: Metrics): string {
  const roas = metrics.roas ?? 0;
  const ctr = metrics.ctr ?? 0;
  if (metrics.spend <= 0) return "观察";
  if (metrics.spend >= 50 && metrics.purchases === 0) return "建议降预算";
  if (metrics.clicks >= 100 && metrics.purchases === 0) return "检查转化链路";
  if (roas >= 3 && metrics.purchases >= 3) return "建议加预算";
  if (roas >= 1.5 && metrics.purchases > 0) return "建议保持";
  if (ctr < 0.8 && metrics.spend >= 20) return "补充素材";
  if (roas > 0 && roas < 1 && metrics.spend >= 30) return "建议降预算";
  return "继续观察";
}

function entitySuggestions(kind: EntityKind, metrics: Metrics): string[] {
  const suggestions = new Set<string>();
  const roas = metrics.roas ?? 0;
  const ctr = metrics.ctr ?? 0;
  const frequency = metrics.frequency ?? 0;

  if (metrics.spend <= 0) {
    suggestions.add("当前没有消耗数据，先确认 Insights 同步范围是否覆盖该对象。");
  }
  if (metrics.spend >= 50 && metrics.purchases === 0) {
    suggestions.add("有消耗但没有订单，建议收缩预算或暂停观察，由运营人工确认后执行。");
  }
  if (metrics.clicks >= 100 && metrics.purchases === 0) {
    suggestions.add("点击量充足但没有购买，优先检查落地页、支付链路、价格和受众匹配。");
  }
  if (ctr < 0.8 && metrics.spend >= 20) {
    suggestions.add(kind === "ad"
      ? "CTR 偏低，建议替换前 3 秒 Hook、主图或首屏文案。"
      : "CTR 偏低，建议拆看广告素材，优先替换低点击素材。");
  }
  if (frequency >= 3 && ctr < 1) {
    suggestions.add("频次偏高且点击偏弱，存在素材疲劳风险，建议补充新素材。");
  }
  if (roas >= 3 && metrics.purchases >= 3) {
    suggestions.add("ROAS 和订单量较好，建议小幅加预算并持续观察 3 天趋势。");
  } else if (roas >= 1.5 && metrics.purchases > 0) {
    suggestions.add("转化表现尚可，建议保持结构，并观察国家、素材和广告组拆分机会。");
  } else if (roas > 0 && roas < 1 && metrics.spend >= 30) {
    suggestions.add("ROAS 偏低，建议降低预算或缩小投放范围。");
  }
  if (metrics.addToCart > 0 && metrics.initiateCheckout === 0) {
    suggestions.add("有加购但缺少结账，建议检查购物车到结账的承接。");
  }
  if (metrics.initiateCheckout > 0 && metrics.purchases === 0) {
    suggestions.add("有发起结账但没有购买，建议检查支付、运费和优惠配置。");
  }

  if (suggestions.size === 0) {
    suggestions.add("暂无明显异常，建议继续观察并和近 3 天趋势对比。");
  }
  return [...suggestions];
}

function accountAdvice(metrics: Metrics): AiAdvice {
  const suggestions = entitySuggestions("account", metrics);
  const mainIssues = suggestions.filter((item) =>
    item.includes("偏低") ||
    item.includes("没有订单") ||
    item.includes("转化链路") ||
    item.includes("疲劳") ||
    item.includes("ROAS")
  );

  return {
    currentConclusion: metrics.spend > 0
      ? `账户当前消耗 ${round(metrics.spend, 2) ?? 0}，Meta ROAS ${round(metrics.roas, 2) ?? "N/A"}，归因订单 ${metrics.purchases}。`
      : "当前时间范围内没有账户消耗数据，分析可信度有限。",
    mainIssues: mainIssues.length > 0 ? mainIssues : ["暂无明显严重异常，建议继续按 Campaign、Ad Set、Ad 三个层级拆看。"],
    dataBasis: [
      `消耗：${round(metrics.spend, 2) ?? 0}`,
      `展示：${metrics.impressions}`,
      `点击：${metrics.clicks}`,
      `CTR：${round(metrics.ctr, 3) ?? "N/A"}%`,
      `购买：${metrics.purchases}`,
      `购买金额：${round(metrics.purchaseValue, 2) ?? 0}`,
      `Meta ROAS：${round(metrics.roas, 3) ?? "N/A"}`,
    ],
    suggestedActions: suggestions,
    riskWarnings: [
      "本页只基于已同步到本地数据库的 Meta Insights 做只读分析，不会自动修改广告账户。",
      "预算、暂停、排除国家、拆系列等动作都必须由运营人员在 Meta 后台人工确认后执行。",
    ],
    operatorChecklist: [
      "先同步该账户最近 30 天广告数据，再刷新本页分析。",
      "优先查看高消耗低转化的 Campaign、Ad Set 和 Ad。",
      "对 CTR 低的广告优先换 Hook 或素材；对点击高但无购买的对象优先检查落地页和支付链路。",
      "加预算建议采用小幅递增，并至少观察 3 天。",
    ],
  };
}

function countryBreakdown(rows: InsightMetricRow[]) {
  const groups = groupRows(rows, (row) => (row.country || "UNKNOWN").toUpperCase());
  return [...groups.entries()]
    .map(([country, countryRows]) => ({
      country,
      ...metricsPayload(summarizeInsights(countryRows)),
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 20);
}

async function computeAccountDetailAnalysis(input: AccountAnalysisInput) {
  const parsed = accountAnalysisQuerySchema.parse(input);
  const range = resolveRange(parsed);
  const account = await prisma.adAccount.findUnique({
    where: { id: parsed.adAccountId },
    include: {
      storeMap: {
        include: {
          store: {
            select: {
              id: true,
              name: true,
              platform: true,
              domain: true,
            },
          },
        },
      },
    },
  });
  if (!account) throw new Error("Ad account not found");

  const rows = await prisma.metaDailyInsight.findMany({
    where: {
      adAccountId: account.id,
      date: {
        gte: range.since,
        lte: range.until,
      },
    },
    select: {
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

  const overview = summarizeInsights(rows);
  const campaignIds = [...new Set(rows.map((row) => row.campaignId).filter((value): value is string => Boolean(value)))];
  const adsetIds = [...new Set(rows.map((row) => row.adsetId).filter((value): value is string => Boolean(value)))];
  const adIds = [...new Set(rows.map((row) => row.adId).filter((value): value is string => Boolean(value)))];

  const [campaignEntities, adsetEntities, adEntities] = await Promise.all([
    campaignIds.length > 0
      ? prisma.campaign.findMany({
        where: { adAccountId: account.id, metaCampaignId: { in: campaignIds } },
        select: { metaCampaignId: true, status: true, dailyBudget: true, lifetimeBudget: true, objective: true },
      })
      : [],
    adsetIds.length > 0
      ? prisma.adSet.findMany({
        where: { adAccountId: account.id, metaAdSetId: { in: adsetIds } },
        select: { metaAdSetId: true, status: true, dailyBudget: true, bidStrategy: true, optimizationGoal: true },
      })
      : [],
    adIds.length > 0
      ? prisma.ad.findMany({
        where: { adAccountId: account.id, metaAdId: { in: adIds } },
        select: { metaAdId: true, status: true, creativeId: true },
      })
      : [],
  ]);

  const campaignEntityById = new Map(campaignEntities.map((item) => [item.metaCampaignId, item]));
  const adsetEntityById = new Map(adsetEntities.map((item) => [item.metaAdSetId, item]));
  const adEntityById = new Map(adEntities.map((item) => [item.metaAdId, item]));

  const campaigns = [...groupRows(rows, (row) => row.campaignId).entries()]
    .map(([campaignId, campaignRows]) => {
      const metrics = summarizeInsights(campaignRows);
      const entity = campaignEntityById.get(campaignId);
      return {
        campaignId,
        campaignName: campaignRows.find((row) => row.campaignName)?.campaignName ?? "",
        status: entity?.status ?? null,
        dailyBudget: entity?.dailyBudget ? toNumber(entity.dailyBudget) / 100 : null,
        lifetimeBudget: entity?.lifetimeBudget ? toNumber(entity.lifetimeBudget) / 100 : null,
        objective: entity?.objective ?? null,
        ...metricsPayload(metrics),
        action: actionLabel(metrics),
        suggestions: entitySuggestions("campaign", metrics),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const adsets = [...groupRows(rows, (row) => row.adsetId).entries()]
    .map(([adsetId, adsetRows]) => {
      const metrics = summarizeInsights(adsetRows);
      const entity = adsetEntityById.get(adsetId);
      return {
        campaignId: adsetRows.find((row) => row.campaignId)?.campaignId ?? "",
        campaignName: adsetRows.find((row) => row.campaignName)?.campaignName ?? "",
        adsetId,
        adsetName: adsetRows.find((row) => row.adsetName)?.adsetName ?? "",
        status: entity?.status ?? null,
        dailyBudget: entity?.dailyBudget ? toNumber(entity.dailyBudget) / 100 : null,
        bidStrategy: entity?.bidStrategy ?? null,
        optimizationGoal: entity?.optimizationGoal ?? null,
        ...metricsPayload(metrics),
        action: actionLabel(metrics),
        suggestions: entitySuggestions("adset", metrics),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const adGroups = groupRows(rows, (row) => row.adId);
  const snapshots = adGroups.size > 0
    ? await prisma.metaAdCreative.findMany({
      where: {
        adAccountId: account.id,
        adId: { in: [...adGroups.keys()] },
      },
    })
    : [];
  const snapshotsByAdId = new Map(snapshots.map((snapshot) => [snapshot.adId, snapshot]));

  const ads = [...adGroups.entries()]
    .map(([adId, adRows]) => {
      const metrics = summarizeInsights(adRows);
      const snapshot = snapshotsByAdId.get(adId);
      const entity = adEntityById.get(adId);
      return {
        campaignId: adRows.find((row) => row.campaignId)?.campaignId ?? "",
        campaignName: adRows.find((row) => row.campaignName)?.campaignName ?? "",
        adsetId: adRows.find((row) => row.adsetId)?.adsetId ?? "",
        adsetName: adRows.find((row) => row.adsetName)?.adsetName ?? "",
        adId,
        adName: snapshot?.adName ?? adRows.find((row) => row.adName)?.adName ?? "",
        status: entity?.status ?? null,
        creativeId: snapshot?.creativeId ?? entity?.creativeId ?? null,
        title: snapshot?.title ?? null,
        body: snapshot?.body ?? null,
        linkUrl: snapshot?.linkUrl ?? null,
        ...metricsPayload(metrics),
        creativeJudgement: judgeCreativePerformance({
          spend: metrics.spend,
          ctr: metrics.ctr,
          cpc: metrics.cpc,
          cpm: metrics.cpm,
          purchases: metrics.purchases,
          roas: metrics.roas,
          frequency: metrics.frequency,
        }),
        action: actionLabel(metrics),
        suggestions: entitySuggestions("ad", metrics),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const insightDates = rows.map((row) => row.date).sort((a, b) => a.getTime() - b.getTime());
  const firstInsightDate = insightDates[0] ?? null;
  const lastInsightDate = insightDates[insightDates.length - 1] ?? null;
  const creativeCount = ads.filter((ad) => ad.creativeId || ad.title || ad.body || ad.linkUrl).length;
  const warnings: string[] = [];
  if (rows.length === 0) warnings.push("当前时间范围内没有 Insights 数据，AI 只能给出同步建议，不能判断投放表现。");
  if (campaigns.length === 0) warnings.push("缺少 Campaign 层级数据，请先刷新广告结构。");
  if (ads.length === 0) warnings.push("缺少 Ad 层级数据，无法分析单条广告表现。");
  if (ads.length > 0 && creativeCount === 0) warnings.push("缺少素材快照，Creative Copilot 和素材疲劳判断会受影响。");
  if (lastInsightDate && lastInsightDate < addDays(range.until, -1)) {
    warnings.push("最新 Insights 日期没有覆盖到结束日期附近，请确认 Meta 同步是否完成。");
  }
  const dataQuality = {
    status: rows.length === 0 ? "missing" : warnings.length > 0 ? "partial" : "ready",
    insightsRows: rows.length,
    firstInsightDate: firstInsightDate ? formatDate(firstInsightDate) : null,
    lastInsightDate: lastInsightDate ? formatDate(lastInsightDate) : null,
    campaignCount: campaigns.length,
    adsetCount: adsets.length,
    adCount: ads.length,
    creativeCount,
    warnings,
  };

  return {
    range: rangePayload(range),
    account: {
      id: account.id,
      accountId: plainMetaAccountId(account.metaAccountId),
      name: account.name,
      status: accountStatusLabel(account.status),
      currency: account.currency,
      timezone: account.timezone,
      store: account.storeMap?.store ?? null,
    },
    overview: metricsPayload(overview),
    dataQuality,
    advice: accountAdvice(overview),
    countries: countryBreakdown(rows),
    campaigns,
    adsets,
    ads,
  };
}

export async function getAccountDetailAnalysis(input: AccountAnalysisInput) {
  const parsed = accountAnalysisQuerySchema.parse(input);
  const range = resolveRange(parsed);
  const rangeKey = `${formatDate(range.since)}:${formatDate(range.until)}`;
  return withCache(
    cacheKey.accountSummary(parsed.adAccountId, rangeKey),
    defaultTtlSeconds.summary,
    () => computeAccountDetailAnalysis(parsed),
  );
}
