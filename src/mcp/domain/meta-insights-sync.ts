// @ts-nocheck
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaApiResponse, MetaInsightsRow } from "../meta/types.js";
import { INSIGHTS_FIELDS, normalizeInsightsRow } from "../tools/field-policy.js";
import { buildFieldsParam } from "../utils/validation.js";
import { invalidateAdAccountAnalysisCaches } from "./cache-invalidation.js";

export const insightDaysSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(7),
  z.literal(14),
  z.literal(30),
]);

export const insightLevelSchema = z.enum(["campaign", "adset", "ad"]);
export const insightBreakdownSchema = z.enum([
  "age",
  "gender",
  "publisher_platform",
  "platform_position",
  "impression_device",
]);

const DEFAULT_EXTRA_BREAKDOWNS: Array<z.infer<typeof insightBreakdownSchema>> = [
  "age",
  "gender",
  "publisher_platform",
  "platform_position",
  "impression_device",
];

export interface SyncMetaInsightsInput {
  adAccountId: string;
  days: z.infer<typeof insightDaysSchema>;
  level?: z.infer<typeof insightLevelSchema>;
  countryBreakdown?: boolean;
  syncBreakdowns?: boolean;
  breakdowns?: Array<z.infer<typeof insightBreakdownSchema>>;
  maxPages?: number;
  since?: string;
  until?: string;
}

export interface SyncActiveMetaInsightsInput {
  days?: z.infer<typeof insightDaysSchema>;
  since?: string;
  until?: string;
  level?: z.infer<typeof insightLevelSchema>;
  countryBreakdown?: boolean;
  syncBreakdowns?: boolean;
  breakdowns?: Array<z.infer<typeof insightBreakdownSchema>>;
  maxPages?: number;
  accountLimit?: number;
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateRangeForLastDays(days: number): { since: Date; until: Date } {
  const until = dateOnly(new Date());
  const since = new Date(until);
  since.setUTCDate(until.getUTCDate() - days + 1);
  return { since, until };
}

function parseDateParam(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return dateOnly(date);
}

function dateRangeForInput(input: SyncMetaInsightsInput): { since: Date; until: Date; days: number } {
  const until = parseDateParam(input.until);
  const since = parseDateParam(input.since);
  if (since || until) {
    const resolvedUntil = until ?? dateOnly(new Date());
    const resolvedSince = since ?? new Date(resolvedUntil);
    if (!since) resolvedSince.setUTCDate(resolvedUntil.getUTCDate() - input.days + 1);
    if (resolvedSince > resolvedUntil) throw new Error("since must be before or equal to until");
    const days = Math.round((resolvedUntil.getTime() - resolvedSince.getTime()) / 86_400_000) + 1;
    if (days > 366) throw new Error("Meta insights date range cannot exceed 366 days");
    return { since: resolvedSince, until: resolvedUntil, days };
  }
  return { ...dateRangeForLastDays(input.days), days: input.days };
}

function toDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toInt(value: unknown): number | undefined {
  const number = toNumber(value);
  return number === undefined ? undefined : Math.round(number);
}

function uniqueBreakdowns(input: SyncMetaInsightsInput): Array<z.infer<typeof insightBreakdownSchema>> {
  if (!input.syncBreakdowns) return [];
  const requested = input.breakdowns && input.breakdowns.length > 0
    ? input.breakdowns
    : DEFAULT_EXTRA_BREAKDOWNS;
  return [...new Set(requested.map((value) => insightBreakdownSchema.parse(value)))];
}

function entityIdForLevel(row: Record<string, unknown>, level: z.infer<typeof insightLevelSchema>): string | undefined {
  if (level === "campaign") return String(row.campaign_id ?? "") || undefined;
  if (level === "adset") return String(row.adset_id ?? "") || undefined;
  return String(row.ad_id ?? "") || undefined;
}

function metricsJson(row: Record<string, unknown>): Prisma.InputJsonObject {
  return {
    spend: toNumber(row.spend) ?? 0,
    impressions: toInt(row.impressions) ?? 0,
    reach: toInt(row.reach) ?? 0,
    frequency: toNumber(row.frequency) ?? 0,
    clicks: toInt(row.clicks) ?? 0,
    ctr: toNumber(row.ctr) ?? 0,
    cpc: toNumber(row.cpc) ?? 0,
    cpm: toNumber(row.cpm) ?? 0,
    purchases: toInt(row.purchases) ?? 0,
    purchaseValue: toNumber(row.purchase_value) ?? 0,
    purchaseRoas: toNumber(row.purchase_roas) ?? 0,
    addToCart: toInt(row.add_to_cart) ?? 0,
    initiateCheckout: toInt(row.initiate_checkout) ?? 0,
    costPerPurchase: toNumber(row.cost_per_purchase) ?? 0,
  };
}

async function fetchInsightsPages(
  path: string,
  params: Record<string, string | number | boolean>,
  maxPages: number,
): Promise<MetaInsightsRow[]> {
  const rows: MetaInsightsRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const response = await metaApiClient.get<MetaApiResponse<MetaInsightsRow>>(path, {
      ...params,
      after,
    });
    rows.push(...(response.data ?? []));
    after = response.paging?.cursors?.after;
    if (!after || !response.paging?.next) break;
  }
  return rows;
}

export async function syncMetaInsightsForAdAccount(input: SyncMetaInsightsInput) {
  const days = insightDaysSchema.parse(input.days);
  const level = insightLevelSchema.parse(input.level ?? "ad");
  const countryBreakdown = input.countryBreakdown ?? true;
  const maxPages = Math.min(20, Math.max(1, input.maxPages ?? 10));
  const extraBreakdowns = uniqueBreakdowns(input);
  const adAccount = await prisma.adAccount.findUniqueOrThrow({ where: { id: input.adAccountId } });
  const range = dateRangeForInput({ ...input, days });

  const log = await prisma.syncLog.create({
    data: {
      type: "meta_insights",
      status: "running",
      adAccountId: adAccount.id,
      rangeStart: range.since,
      rangeEnd: range.until,
      metadata: { days: range.days, level, countryBreakdown, breakdowns: extraBreakdowns, maxPages, since: toDateParam(range.since), until: toDateParam(range.until) },
    },
  });

  try {
    const params: Record<string, string | number | boolean> = {
      fields: buildFieldsParam(INSIGHTS_FIELDS),
      level,
      time_increment: 1,
      time_range: JSON.stringify({
        since: toDateParam(range.since),
        until: toDateParam(range.until),
      }),
      use_unified_attribution_setting: true,
      limit: 1000,
    };
    if (countryBreakdown) {
      params.breakdowns = "country";
    }

    const insightRows = await fetchInsightsPages(
      `/${adAccount.metaAccountId}/insights`,
      params,
      maxPages,
    );
    const rows = insightRows.map(normalizeInsightsRow);
    const breakdownRows: Array<{
      breakdownType: z.infer<typeof insightBreakdownSchema>;
      row: Record<string, unknown>;
    }> = [];

    for (const breakdown of extraBreakdowns) {
      const rawRows = await fetchInsightsPages(
        `/${adAccount.metaAccountId}/insights`,
        {
          ...params,
          breakdowns: breakdown,
        },
        maxPages,
      );
      breakdownRows.push(
        ...rawRows.map((row) => ({
          breakdownType: breakdown,
          row: normalizeInsightsRow(row),
        })),
      );
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.metaDailyInsight.deleteMany({
        where: {
          adAccountId: adAccount.id,
          date: {
            gte: range.since,
            lte: range.until,
          },
        },
      });

      if (rows.length > 0) {
        await tx.metaDailyInsight.createMany({
          data: rows.map((row) => ({
            adAccountId: adAccount.id,
            date: new Date(String(row.date)),
            campaignId: String(row.campaign_id ?? "") || undefined,
            campaignName: String(row.campaign_name ?? "") || undefined,
            adsetId: String(row.adset_id ?? "") || undefined,
            adsetName: String(row.adset_name ?? "") || undefined,
            adId: String(row.ad_id ?? "") || undefined,
            adName: String(row.ad_name ?? "") || undefined,
            country: String(row.country ?? "") || undefined,
            spend: toNumber(row.spend),
            impressions: toInt(row.impressions),
            reach: toInt(row.reach),
            frequency: toNumber(row.frequency),
            clicks: toInt(row.clicks),
            ctr: toNumber(row.ctr),
            cpc: toNumber(row.cpc),
            cpm: toNumber(row.cpm),
            purchases: toInt(row.purchases),
            purchaseValue: toNumber(row.purchase_value),
            purchaseRoas: toNumber(row.purchase_roas),
            addToCart: toInt(row.add_to_cart),
            initiateCheckout: toInt(row.initiate_checkout),
            costPerPurchase: toNumber(row.cost_per_purchase),
          })),
        });
      }

      if (extraBreakdowns.length > 0) {
        await tx.metaBreakdown.deleteMany({
          where: {
            adAccountId: adAccount.id,
            date: {
              gte: range.since,
              lte: range.until,
            },
            level,
            breakdownType: { in: extraBreakdowns },
          },
        });

        if (breakdownRows.length > 0) {
          await tx.metaBreakdown.createMany({
            data: breakdownRows
              .map(({ breakdownType, row }) => ({
                adAccountId: adAccount.id,
                date: new Date(String(row.date)),
                level,
                entityId: entityIdForLevel(row, level),
                entityName: String(
                  level === "campaign"
                    ? row.campaign_name ?? ""
                    : level === "adset"
                      ? row.adset_name ?? ""
                      : row.ad_name ?? "",
                ) || undefined,
                breakdownType,
                breakdownValue: String(row[breakdownType] ?? "") || "unknown",
                metrics: metricsJson(row),
              }))
              .filter((row) => !Number.isNaN(row.date.getTime())),
          });
        }
      }
    });

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFetched: rows.length + breakdownRows.length,
        recordsSaved: rows.length + breakdownRows.length,
        metadata: {
          days: range.days,
          level,
          countryBreakdown,
          breakdowns: extraBreakdowns,
          breakdownRowsFetched: breakdownRows.length,
          maxPages,
          since: toDateParam(range.since),
          until: toDateParam(range.until),
        },
      },
    });

    await invalidateAdAccountAnalysisCaches({
      adAccountId: adAccount.id,
      since: range.since,
      until: range.until,
    });

    return { fetched: rows.length + breakdownRows.length, saved: rows.length + breakdownRows.length, insightRows: rows.length, breakdownRows: breakdownRows.length };
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function syncMetaInsightsForStore(
  storeId: string,
  days: z.infer<typeof insightDaysSchema>,
  maxPages = 10,
  options: Pick<SyncMetaInsightsInput, "level" | "countryBreakdown" | "syncBreakdowns" | "breakdowns" | "since" | "until"> = {},
) {
  const mappings = await prisma.storeAdAccountMap.findMany({
    where: { storeId },
    select: { adAccountId: true },
  });
  const results = [];
  for (const mapping of mappings) {
    results.push(await syncMetaInsightsForAdAccount({ adAccountId: mapping.adAccountId, days, maxPages, ...options }));
  }
  return results;
}

export async function syncMetaInsightsForActiveAccounts(input: SyncActiveMetaInsightsInput = {}) {
  const days = insightDaysSchema.parse(input.days ?? 30);
  const accountLimit = Math.min(500, Math.max(1, input.accountLimit ?? Number(process.env.META_INSIGHTS_SYNC_ACCOUNT_LIMIT ?? 50)));
  const accounts = await prisma.adAccount.findMany({
    where: {
      status: "1",
      recentActivity90d: true,
    },
    select: { id: true },
    orderBy: [{ lastSyncedAt: "asc" }, { updatedAt: "asc" }],
    take: accountLimit,
  });
  const results = [];
  for (const account of accounts) {
    results.push(await syncMetaInsightsForAdAccount({
      adAccountId: account.id,
      days,
      since: input.since,
      until: input.until,
      level: input.level,
      countryBreakdown: input.countryBreakdown,
      syncBreakdowns: input.syncBreakdowns,
      breakdowns: input.breakdowns,
      maxPages: input.maxPages,
    }));
  }
  return {
    accounts: accounts.length,
    fetched: results.reduce((sum, item) => sum + item.fetched, 0),
    saved: results.reduce((sum, item) => sum + item.saved, 0),
    results,
  };
}
