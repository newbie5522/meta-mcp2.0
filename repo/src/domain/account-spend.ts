import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { accountStatusLabel, plainMetaAccountId } from "./ad-accounts.js";
import { cacheKey, defaultTtlSeconds, withCache } from "../../packages/cache/src/index.js";

export const accountSpendQuerySchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
});

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return dateOnly(date);
}

function resolveRange(input: z.infer<typeof accountSpendQuerySchema>) {
  const until = parseDate(input.until) ?? dateOnly(new Date());
  const since = parseDate(input.since) ?? addDays(until, -29);
  if (since > until) throw new Error("since must be before until");
  return { since, until };
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function getAccountSpendReport(input: unknown) {
  const query = accountSpendQuerySchema.parse(input);
  const range = resolveRange(query);
  const rangeKey = `${range.since.toISOString().slice(0, 10)}:${range.until.toISOString().slice(0, 10)}`;

  return withCache(cacheKey.accountSummary("all", rangeKey), defaultTtlSeconds.summary, async () => {
    const accounts = await prisma.adAccount.findMany({
      where: {
        status: "1",
        recentActivity90d: true,
      },
      include: {
        storeMap: {
          include: {
            store: {
              select: {
                name: true,
              },
            },
          },
        },
        dailyInsights: {
          where: {
            date: {
              gte: range.since,
              lte: range.until,
            },
          },
          select: {
            date: true,
            spend: true,
            impressions: true,
            reach: true,
            clicks: true,
            purchases: true,
            purchaseValue: true,
            addToCart: true,
            initiateCheckout: true,
          },
        },
      },
      orderBy: [{ name: "asc" }, { metaAccountId: "asc" }],
    });

    return {
      range: {
        since: range.since.toISOString().slice(0, 10),
        until: range.until.toISOString().slice(0, 10),
      },
      accounts: accounts.map((account) => {
        const spend = account.dailyInsights.reduce((sum, row) => sum + toNumber(row.spend), 0);
        const impressions = account.dailyInsights.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
        const reach = account.dailyInsights.reduce((sum, row) => sum + (row.reach ?? 0), 0);
        const clicks = account.dailyInsights.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
        const purchases = account.dailyInsights.reduce((sum, row) => sum + (row.purchases ?? 0), 0);
        const purchaseValue = account.dailyInsights.reduce((sum, row) => sum + toNumber(row.purchaseValue), 0);
        const addToCart = account.dailyInsights.reduce((sum, row) => sum + (row.addToCart ?? 0), 0);
        const initiateCheckout = account.dailyInsights.reduce((sum, row) => sum + (row.initiateCheckout ?? 0), 0);
        const insightDates = account.dailyInsights
          .map((row) => row.date)
          .sort((a, b) => a.getTime() - b.getTime());
        const firstInsightDate = insightDates[0]?.toISOString().slice(0, 10) ?? null;
        const lastInsightDate = insightDates.at(-1)?.toISOString().slice(0, 10) ?? null;
        return {
          id: account.id,
          accountId: plainMetaAccountId(account.metaAccountId),
          name: account.name,
          status: accountStatusLabel(account.status),
          storeName: account.storeMap?.store?.name ?? "",
          spend: round(spend, 2) ?? 0,
          impressions,
          reach,
          clicks,
          ctr: round(ratio(clicks * 100, impressions), 3),
          cpc: round(ratio(spend, clicks), 3),
          cpm: round(ratio(spend * 1000, impressions), 3),
          purchases,
          costPerPurchase: round(ratio(spend, purchases), 3),
          purchaseValue: round(purchaseValue, 2) ?? 0,
          roas: round(ratio(purchaseValue, spend), 3),
          addToCart,
          addToCartRate: round(ratio(addToCart * 100, clicks), 3),
          initiateCheckout,
          checkoutRate: round(ratio(initiateCheckout * 100, clicks), 3),
          insightRows: account.dailyInsights.length,
          firstInsightDate,
          lastInsightDate,
        };
      }),
    };
  });
}
