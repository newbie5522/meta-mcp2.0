import { prisma } from "../db/prisma.js";
import { syncMetaAdAccounts } from "../domain/ad-accounts.js";
import { syncStoreOrders } from "../domain/order-sync.js";
import { syncMetaInsightsForActiveAccounts, syncMetaInsightsForStore } from "../domain/meta-insights-sync.js";
import { syncMetaStructureForActiveAccounts } from "../domain/meta-structure-sync.js";
import { syncMetaCreativeSnapshotsForActiveAccounts } from "../domain/meta-creatives-sync.js";
import { retryFailedSyncLogs } from "../domain/sync-logs.js";
import { runMediaBuyingRuleMonitor } from "../domain/rule-monitor.js";
import { logger } from "../utils/logger.js";

function readBool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function startInterval(name: string, intervalMinutes: number, task: () => Promise<void>): void {
  const intervalMs = intervalMinutes * 60_000;
  const firstDelayMs = readInt("SYNC_START_DELAY_SECONDS", 30, 1, 3600) * 1000;
  setTimeout(() => {
    task().catch((error) => logger.error({ error, job: name }, "Scheduled sync failed"));
  }, firstDelayMs).unref();

  setInterval(() => {
    task().catch((error) => logger.error({ error, job: name }, "Scheduled sync failed"));
  }, intervalMs).unref();

  logger.info({ name, intervalMinutes }, "Scheduled sync job registered");
}

async function syncActiveStoreOrders(): Promise<void> {
  const lookbackDays = readInt("ORDER_SYNC_LOOKBACK_DAYS", 3, 1, 30);
  const limit = readInt("ORDER_SYNC_LIMIT", 100, 1, 250);
  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd);
  rangeStart.setUTCDate(rangeEnd.getUTCDate() - lookbackDays + 1);

  const stores = await prisma.store.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  for (const store of stores) {
    await syncStoreOrders({
      storeId: store.id,
      rangeStart,
      rangeEnd,
      limit,
    });
  }
}

async function syncActiveStoreMetaInsights(): Promise<void> {
  const days = readInt("META_INSIGHTS_SYNC_DAYS", 3, 1, 30);
  const maxPages = readInt("META_INSIGHTS_SYNC_MAX_PAGES", 10, 1, 20);
  const accountLimit = readInt("META_INSIGHTS_SYNC_ACCOUNT_LIMIT", 50, 1, 500);
  const syncBreakdowns = readBool("META_BREAKDOWN_SYNC_ENABLED", true);
  const allowedDays = [1, 3, 7, 14, 30] as const;
  const normalizedDays = allowedDays.includes(days as typeof allowedDays[number])
    ? days as typeof allowedDays[number]
    : 3;
  const stores = await prisma.store.findMany({
    where: {
      status: "active",
      adAccountMaps: {
        some: {},
      },
    },
    select: { id: true },
  });

  for (const store of stores) {
    await syncMetaInsightsForStore(store.id, normalizedDays, maxPages, {
      level: "ad",
      countryBreakdown: true,
      syncBreakdowns,
    });
  }
  if (stores.length === 0 || readBool("META_INSIGHTS_SYNC_UNMAPPED_ACCOUNTS", true)) {
    await syncMetaInsightsForActiveAccounts({
      days: normalizedDays,
      maxPages,
      accountLimit,
      level: "ad",
      countryBreakdown: true,
      syncBreakdowns,
    });
  }
}

async function syncActiveMetaAdAccounts(): Promise<void> {
  await syncMetaAdAccounts({
    limit: readInt("META_AD_ACCOUNTS_SYNC_LIMIT", 500, 1, 500),
    activeLastDays: readInt("META_AD_ACCOUNTS_ACTIVE_LAST_DAYS", 90, 1, 365),
  });
}

async function syncActiveMetaStructure(): Promise<void> {
  await syncMetaStructureForActiveAccounts(
    readInt("META_STRUCTURE_SYNC_LIMIT", 500, 1, 500),
    readInt("META_STRUCTURE_SYNC_MAX_PAGES", 10, 1, 20),
  );
}

async function syncActiveMetaCreatives(): Promise<void> {
  await syncMetaCreativeSnapshotsForActiveAccounts(
    readInt("META_CREATIVES_SYNC_LIMIT", 250, 1, 500),
    readInt("META_CREATIVES_SYNC_MAX_PAGES", 10, 1, 20),
  );
}

export function startSyncScheduler(options: { force?: boolean } = {}): void {
  if (!options.force && !readBool("SYNC_SCHEDULER_ENABLED")) {
    return;
  }

  if (readBool("ORDER_SYNC_ENABLED")) {
    startInterval(
      "orders",
      readInt("ORDER_SYNC_INTERVAL_MINUTES", 1440, 5, 10_080),
      syncActiveStoreOrders,
    );
  }

  if (readBool("META_AD_ACCOUNTS_SYNC_ENABLED")) {
    startInterval(
      "meta_ad_accounts",
      readInt("META_AD_ACCOUNTS_SYNC_INTERVAL_MINUTES", 360, 30, 10_080),
      syncActiveMetaAdAccounts,
    );
  }

  if (readBool("META_STRUCTURE_SYNC_ENABLED")) {
    startInterval(
      "meta_structure",
      readInt("META_STRUCTURE_SYNC_INTERVAL_MINUTES", 120, 30, 10_080),
      syncActiveMetaStructure,
    );
  }

  if (readBool("META_CREATIVES_SYNC_ENABLED")) {
    startInterval(
      "meta_creatives",
      readInt("META_CREATIVES_SYNC_INTERVAL_MINUTES", 720, 30, 10_080),
      syncActiveMetaCreatives,
    );
  }

  if (readBool("META_INSIGHTS_SYNC_ENABLED")) {
    startInterval(
      "meta_insights",
      readInt("META_INSIGHTS_SYNC_INTERVAL_MINUTES", 1440, 5, 10_080),
      syncActiveStoreMetaInsights,
    );
  }

  if (readBool("FAILED_SYNC_RETRY_ENABLED")) {
    startInterval(
      "failed_sync_retry",
      readInt("FAILED_SYNC_RETRY_INTERVAL_MINUTES", 60, 5, 1440),
      async () => {
        await retryFailedSyncLogs(readInt("FAILED_SYNC_RETRY_LIMIT", 10, 1, 20));
      },
    );
  }

  if (readBool("RULE_MONITOR_ENABLED", true)) {
    startInterval(
      "rule_monitor",
      readInt("RULE_MONITOR_INTERVAL_MINUTES", 60, 15, 1440),
      async () => {
        await runMediaBuyingRuleMonitor();
      },
    );
  }
}
