// @ts-nocheck
import { metaApiClient } from "../meta/client.js";
import type { MetaAdAccount, MetaApiResponse, MetaInsightsRow } from "../meta/types.js";
import { prisma } from "../db/prisma.js";
import { ACCOUNT_FIELDS } from "../tools/field-policy.js";
import { buildFieldsParam } from "../utils/validation.js";
import { normalizeMetaAccountId, getNumericAccountId } from "../../server/utils.js";

function toMetaAccountId(account: MetaAdAccount): string {
  const accountId = account.account_id ?? account.id;
  if (!accountId) {
    throw new Error("Meta account response did not include account_id");
  }
  return normalizeMetaAccountId(accountId);
}

function normalizeStatus(status: number | undefined): string | null {
  return status === undefined ? null : String(status);
}

export function plainMetaAccountId(metaAccountId: string): string {
  return getNumericAccountId(metaAccountId);
}

export function accountStatusLabel(status: string | null | undefined): "活跃" | "停用" {
  return status === "1" ? "活跃" : "停用";
}

function daysRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(until.getUTCDate() - days + 1);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function hasRecentDelivery(metaAccountId: string, activeLastDays: number): Promise<boolean> {
  const range = daysRange(activeLastDays);
  const response = await metaApiClient.get<MetaApiResponse<MetaInsightsRow>>(
    `/${metaAccountId}/insights`,
    {
      fields: "spend,impressions,clicks",
      level: "account",
      time_range: JSON.stringify(range),
      limit: 1,
    },
  );
  const row = response.data?.[0];
  if (!row) return false;
  return numberValue(row.spend) > 0 || numberValue(row.impressions) > 0 || numberValue(row.clicks) > 0;
}

export interface SyncMetaAdAccountsOptions {
  limit?: number;
  activeLastDays?: number;
}

export async function syncMetaAdAccounts(input: SyncMetaAdAccountsOptions = {}) {
  const limit = input.limit ?? 500;
  const activeLastDays = input.activeLastDays ?? 90;
  const checkedAt = new Date();
  const log = await prisma.syncLog.create({
    data: {
      type: "meta_ad_accounts",
      status: "running",
      metadata: { limit, activeLastDays },
    },
  });

  try {
    const response = await metaApiClient.get<MetaApiResponse<MetaAdAccount>>("/me/adaccounts", {
      fields: buildFieldsParam(ACCOUNT_FIELDS),
      limit,
    });
    const accounts = response.data ?? [];
    let saved = 0;
    let skippedInactive = 0;
    let skippedNoRecentDelivery = 0;

    for (const account of accounts) {
      const metaAccountId = toMetaAccountId(account);
      const status = normalizeStatus(account.account_status);
      if (status !== "1") {
        await prisma.adAccount.updateMany({
          where: { metaAccountId },
          data: {
            name: account.name,
            currency: account.currency,
            timezone: account.timezone_name,
            status,
            recentActivity90d: false,
            lastActivityCheckedAt: checkedAt,
            lastSyncedAt: checkedAt,
          },
        });
        skippedInactive++;
        continue;
      }

      const hasActivity = await hasRecentDelivery(metaAccountId, activeLastDays);
      if (!hasActivity) {
        await prisma.adAccount.updateMany({
          where: { metaAccountId },
          data: {
            name: account.name,
            currency: account.currency,
            timezone: account.timezone_name,
            status,
            recentActivity90d: false,
            lastActivityCheckedAt: checkedAt,
            lastSyncedAt: checkedAt,
          },
        });
        skippedNoRecentDelivery++;
        continue;
      }

      await prisma.adAccount.upsert({
        where: { metaAccountId },
        update: {
          name: account.name,
          currency: account.currency,
          timezone: account.timezone_name,
          status,
          recentActivity90d: true,
          lastActivityCheckedAt: checkedAt,
          lastSyncedAt: checkedAt,
        },
        create: {
          metaAccountId,
          name: account.name,
          currency: account.currency,
          timezone: account.timezone_name,
          status,
          recentActivity90d: true,
          lastActivityCheckedAt: checkedAt,
          lastSyncedAt: checkedAt,
        },
      });
      saved++;
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFetched: accounts.length,
        recordsSaved: saved,
        metadata: {
          limit,
          activeLastDays,
          skippedInactive,
          skippedNoRecentDelivery,
        },
      },
    });

    return { fetched: accounts.length, saved, skippedInactive, skippedNoRecentDelivery };
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

export async function listAdAccounts() {
  const accounts = await prisma.adAccount.findMany({
    where: {
      status: "1",
      recentActivity90d: true,
    },
    orderBy: [{ name: "asc" }, { metaAccountId: "asc" }],
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
  return accounts.map((account) => ({
    ...account,
    displayAccountId: plainMetaAccountId(account.metaAccountId),
    displayStatus: accountStatusLabel(account.status),
  }));
}
