// @ts-nocheck
import { z } from "zod";
import { prisma } from "../db/prisma.js";

export const audienceAnalysisQuerySchema = z.object({
  adAccountId: z.string().min(1),
  since: z.string().optional(),
  until: z.string().optional(),
  breakdown: z.enum(["gender_age", "country", "placement"]).default("country"),
});

export type AudienceAnalysisQuery = z.input<typeof audienceAnalysisQuerySchema>;

interface MetricAccumulator {
  key: string;
  label: string;
  type: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  addToCart: number;
  initiateCheckout: number;
}

function toDate(value: string | undefined, fallbackDays: number): Date {
  if (!value) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + fallbackDays);
    return date;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return Number(value.toNumber());
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricFromJson(metrics: unknown, key: string): number {
  if (!metrics || typeof metrics !== "object") return 0;
  return toNumber((metrics as Record<string, unknown>)[key]);
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function labelForBreakdown(type: string, value: string): string {
  const countries: Record<string, string> = {
    US: "美国",
    GB: "英国",
    UK: "英国",
    CA: "加拿大",
    AU: "澳大利亚",
    DE: "德国",
    FR: "法国",
    IT: "意大利",
    ES: "西班牙",
    NL: "荷兰",
    BR: "巴西",
    MX: "墨西哥",
    JP: "日本",
    KR: "韩国",
    TH: "泰国",
    VN: "越南",
    PH: "菲律宾",
  };
  const genders: Record<string, string> = { male: "男性", female: "女性", unknown: "未知性别" };
  const placements: Record<string, string> = {
    facebook: "Facebook",
    instagram: "Instagram",
    messenger: "Messenger",
    audience_network: "Audience Network",
    feed: "信息流",
    story: "快拍",
    reels: "Reels",
    instream_video: "插播视频",
    marketplace: "Marketplace",
    search: "搜索",
    mobile: "移动端",
    desktop: "桌面端",
  };
  if (type === "country") return countries[value.toUpperCase()] || value || "未知国家";
  if (type === "gender" || type === "age") return genders[value] || value || "未知受众";
  return placements[value] || value || "未知版位";
}

function suggestionFor(row: MetricAccumulator): string {
  const roas = ratio(row.purchaseValue, row.spend);
  const cpp = ratio(row.spend, row.purchases);
  if (row.spend <= 0) return "暂无消耗，继续观察";
  if (row.purchases >= 3 && roas >= 1.5) return "建议加预算或单独拆分测试";
  if (row.purchases >= 1 && roas >= 1) return "建议保持，继续观察 2-3 天";
  if (row.spend >= 50 && row.purchases === 0) return "建议降预算或排除";
  if (cpp > 0 && roas < 0.8) return "建议控制预算，检查素材与落地页";
  return "样本不足，先观察";
}

function serialize(row: MetricAccumulator) {
  const ctr = ratio(row.clicks, row.impressions) * 100;
  return {
    key: row.key,
    label: row.label,
    type: row.type,
    spend: round(row.spend),
    impressions: row.impressions,
    reach: row.reach,
    frequency: round(ratio(row.impressions, row.reach), 2),
    clicks: row.clicks,
    ctr: round(ctr, 2),
    cpc: round(ratio(row.spend, row.clicks), 2),
    cpm: round(ratio(row.spend * 1000, row.impressions), 2),
    purchases: row.purchases,
    purchaseValue: round(row.purchaseValue),
    roas: round(ratio(row.purchaseValue, row.spend), 2),
    addToCart: row.addToCart,
    initiateCheckout: row.initiateCheckout,
    costPerPurchase: round(ratio(row.spend, row.purchases), 2),
    recommendation: suggestionFor(row),
  };
}

export async function getAudienceAnalysis(input: AudienceAnalysisQuery) {
  const parsed = audienceAnalysisQuerySchema.parse(input);
  const since = toDate(parsed.since, -29);
  const until = toDate(parsed.until, 0);
  const untilExclusive = addDays(until, 1);
  const account = await prisma.adAccount.findFirst({
    where: {
      OR: [
        { id: parsed.adAccountId },
        { metaAccountId: parsed.adAccountId },
        { metaAccountId: `act_${parsed.adAccountId.replace(/^act_/, "")}` },
      ],
    },
  });
  if (!account) throw new Error("Ad account not found");

  const groups = new Map<string, MetricAccumulator>();
  const getGroup = (type: string, value: string) => {
    const safeValue = value || "unknown";
    const key = `${type}:${safeValue}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const created: MetricAccumulator = {
      key,
      label: labelForBreakdown(type, safeValue),
      type,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      purchases: 0,
      purchaseValue: 0,
      addToCart: 0,
      initiateCheckout: 0,
    };
    groups.set(key, created);
    return created;
  };

  let warning: string | undefined;

  if (parsed.breakdown === "country") {
    const rows = await prisma.metaDailyInsight.findMany({
      where: { adAccountId: account.id, date: { gte: since, lt: untilExclusive } },
      select: {
        country: true,
        spend: true,
        impressions: true,
        reach: true,
        clicks: true,
        purchases: true,
        purchaseValue: true,
        addToCart: true,
        initiateCheckout: true,
      },
    });
    for (const row of rows) {
      const group = getGroup("country", row.country || "unknown");
      group.spend += toNumber(row.spend);
      group.impressions += row.impressions || 0;
      group.reach += row.reach || 0;
      group.clicks += row.clicks || 0;
      group.purchases += row.purchases || 0;
      group.purchaseValue += toNumber(row.purchaseValue);
      group.addToCart += row.addToCart || 0;
      group.initiateCheckout += row.initiateCheckout || 0;
    }
  } else {
    const breakdownTypes = parsed.breakdown === "gender_age"
      ? ["gender", "age"]
      : ["publisher_platform", "platform_position", "impression_device"];
    const rows = await prisma.metaBreakdown.findMany({
      where: {
        adAccountId: account.id,
        date: { gte: since, lt: untilExclusive },
        breakdownType: { in: breakdownTypes },
      },
      select: { breakdownType: true, breakdownValue: true, metrics: true },
    });
    for (const row of rows) {
      const group = getGroup(row.breakdownType, row.breakdownValue);
      group.spend += metricFromJson(row.metrics, "spend");
      group.impressions += metricFromJson(row.metrics, "impressions");
      group.reach += metricFromJson(row.metrics, "reach");
      group.clicks += metricFromJson(row.metrics, "clicks");
      group.purchases += metricFromJson(row.metrics, "purchases");
      group.purchaseValue += metricFromJson(row.metrics, "purchaseValue");
      group.addToCart += metricFromJson(row.metrics, "addToCart");
      group.initiateCheckout += metricFromJson(row.metrics, "initiateCheckout");
    }
    if (rows.length === 0) {
      warning = "当前维度暂无 breakdown 入库数据，请先在 Worker 中开启 age/gender/placement breakdown 同步。";
    }
  }

  const rows = Array.from(groups.values()).map(serialize).sort((a, b) => b.spend - a.spend);
  const overview = rows.reduce(
    (acc, row) => ({
      spend: acc.spend + row.spend,
      impressions: acc.impressions + row.impressions,
      reach: acc.reach + row.reach,
      clicks: acc.clicks + row.clicks,
      purchases: acc.purchases + row.purchases,
      purchaseValue: acc.purchaseValue + row.purchaseValue,
      addToCart: acc.addToCart + row.addToCart,
    }),
    { spend: 0, impressions: 0, reach: 0, clicks: 0, purchases: 0, purchaseValue: 0, addToCart: 0 },
  );

  return {
    account: {
      id: account.id,
      metaAccountId: account.metaAccountId.replace(/^act_/, ""),
      name: account.name,
      status: account.status,
      currency: account.currency,
    },
    range: {
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    },
    breakdown: parsed.breakdown,
    warning,
    overview: {
      ...overview,
      spend: round(overview.spend),
      purchaseValue: round(overview.purchaseValue),
      ctr: round(ratio(overview.clicks, overview.impressions) * 100, 2),
      cpc: round(ratio(overview.spend, overview.clicks), 2),
      cpm: round(ratio(overview.spend * 1000, overview.impressions), 2),
      roas: round(ratio(overview.purchaseValue, overview.spend), 2),
      costPerPurchase: round(ratio(overview.spend, overview.purchases), 2),
    },
    rows,
  };
}
