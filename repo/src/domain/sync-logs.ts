import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { syncStoreOrders } from "./order-sync.js";
import { syncMetaInsightsForAdAccount, insightDaysSchema, insightLevelSchema } from "./meta-insights-sync.js";
import { syncMetaCreativeSnapshotsForAdAccount } from "./meta-creatives-sync.js";
import { syncMetaStructureForAdAccount } from "./meta-structure-sync.js";
import { syncStoreProfile } from "./store-profile.js";

const syncTypes = [
  "store_profile",
  "orders",
  "meta_ad_accounts",
  "meta_insights",
  "meta_creatives",
  "meta_structure",
  "mapping_import",
] as const;

const syncTypeLabels: Record<typeof syncTypes[number], string> = {
  store_profile: "店铺资料",
  orders: "店铺订单",
  meta_ad_accounts: "Meta 账户",
  meta_insights: "Meta Insights",
  meta_creatives: "Meta 素材",
  meta_structure: "Meta 结构",
  mapping_import: "映射导入",
};

export const syncLogQuerySchema = z.object({
  type: z.enum([
    "store_profile",
    "orders",
    "meta_ad_accounts",
    "meta_insights",
    "meta_creatives",
    "meta_structure",
    "mapping_import",
  ]).optional(),
  storeId: z.string().optional(),
  adAccountId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listSyncLogs(input: unknown) {
  const query = syncLogQuerySchema.parse(input);
  return prisma.syncLog.findMany({
    where: {
      type: query.type,
      storeId: query.storeId,
      adAccountId: query.adAccountId,
    },
    orderBy: { startedAt: "desc" },
    take: query.limit,
    select: {
      id: true,
      type: true,
      status: true,
      storeId: true,
      adAccountId: true,
      startedAt: true,
      finishedAt: true,
      rangeStart: true,
      rangeEnd: true,
      recordsFetched: true,
      recordsSaved: true,
      errorMessage: true,
      metadata: true,
    },
  });
}

function readMetadataValue(metadata: unknown, key: string): unknown {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
  return (metadata as Record<string, unknown>)[key];
}

function readBool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function addMinutes(date: Date | null | undefined, minutes: number): Date | null {
  if (!date) return null;
  return new Date(date.getTime() + minutes * 60_000);
}

function intervalForType(type: typeof syncTypes[number]): number | null {
  if (type === "orders") return readInt("ORDER_SYNC_INTERVAL_MINUTES", 1440, 5, 10_080);
  if (type === "meta_ad_accounts") return readInt("META_AD_ACCOUNTS_SYNC_INTERVAL_MINUTES", 360, 30, 10_080);
  if (type === "meta_structure") return readInt("META_STRUCTURE_SYNC_INTERVAL_MINUTES", 360, 30, 10_080);
  if (type === "meta_insights") return readInt("META_INSIGHTS_SYNC_INTERVAL_MINUTES", 1440, 5, 10_080);
  if (type === "meta_creatives") return readInt("META_CREATIVES_SYNC_INTERVAL_MINUTES", 720, 30, 10_080);
  if (type === "store_profile") return readInt("STORE_PROFILE_SYNC_INTERVAL_MINUTES", 1440, 30, 10_080);
  return null;
}

function enabledForType(type: typeof syncTypes[number]): boolean {
  if (type === "orders") return readBool("ORDER_SYNC_ENABLED");
  if (type === "meta_ad_accounts") return readBool("META_AD_ACCOUNTS_SYNC_ENABLED");
  if (type === "meta_structure") return readBool("META_STRUCTURE_SYNC_ENABLED");
  if (type === "meta_insights") return readBool("META_INSIGHTS_SYNC_ENABLED");
  if (type === "meta_creatives") return readBool("META_CREATIVES_SYNC_ENABLED");
  if (type === "store_profile") return readBool("STORE_PROFILE_SYNC_ENABLED");
  return false;
}

function healthFrom(input: { enabled: boolean; running: number; failed: number; lastStatus?: string | null }) {
  if (!input.enabled) return "disabled";
  if (input.running > 0) return "running";
  if (input.failed > 0 || input.lastStatus === "failed") return "attention";
  if (input.lastStatus === "success") return "healthy";
  return "idle";
}

export async function getSyncOperationsSummary() {
  const [logs, failedQueue, runningCount, failedCount, successCount] = await Promise.all([
    prisma.syncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 300,
      select: {
        id: true,
        type: true,
        status: true,
        storeId: true,
        adAccountId: true,
        startedAt: true,
        finishedAt: true,
        recordsFetched: true,
        recordsSaved: true,
        errorMessage: true,
        metadata: true,
      },
    }),
    prisma.syncLog.findMany({
      where: { status: "failed" },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        status: true,
        storeId: true,
        adAccountId: true,
        startedAt: true,
        finishedAt: true,
        recordsFetched: true,
        recordsSaved: true,
        errorMessage: true,
        metadata: true,
      },
    }),
    prisma.syncLog.count({ where: { status: "running" } }),
    prisma.syncLog.count({ where: { status: "failed" } }),
    prisma.syncLog.count({ where: { status: "success" } }),
  ]);

  const recentByType = new Map<typeof syncTypes[number], typeof logs[number]>();
  const countsByType = new Map<typeof syncTypes[number], { success: number; failed: number; running: number; pending: number }>();
  for (const type of syncTypes) {
    countsByType.set(type, { success: 0, failed: 0, running: 0, pending: 0 });
  }
  for (const log of logs) {
    const type = log.type as typeof syncTypes[number];
    if (!recentByType.has(type)) recentByType.set(type, log);
    const counts = countsByType.get(type);
    if (counts && log.status in counts) {
      counts[log.status as keyof typeof counts] += 1;
    }
  }

  const operations = syncTypes.map((type) => {
    const latest = recentByType.get(type);
    const counts = countsByType.get(type) ?? { success: 0, failed: 0, running: 0, pending: 0 };
    const enabled = enabledForType(type);
    const intervalMinutes = intervalForType(type);
    return {
      type,
      label: syncTypeLabels[type],
      enabled,
      intervalMinutes,
      nextRunAt: enabled && intervalMinutes ? addMinutes(latest?.startedAt, intervalMinutes) : null,
      health: healthFrom({ enabled, running: counts.running, failed: counts.failed, lastStatus: latest?.status }),
      latest,
      counts,
    };
  });

  return {
    scheduler: {
      enabled: readBool("SYNC_SCHEDULER_ENABLED") || readBool("WORKER_ENABLED", true),
      startDelaySeconds: readInt("SYNC_START_DELAY_SECONDS", 30, 1, 3600),
      failedRetryEnabled: readBool("FAILED_SYNC_RETRY_ENABLED"),
      failedRetryIntervalMinutes: readInt("FAILED_SYNC_RETRY_INTERVAL_MINUTES", 60, 5, 1440),
      ruleMonitorEnabled: readBool("RULE_MONITOR_ENABLED", true),
      ruleMonitorIntervalMinutes: readInt("RULE_MONITOR_INTERVAL_MINUTES", 60, 15, 1440),
    },
    totals: {
      recentSampleSize: logs.length,
      running: runningCount,
      failed: failedCount,
      success: successCount,
      failedQueue: failedQueue.length,
    },
    operations,
    failedQueue,
    recentLogs: logs.slice(0, 100),
  };
}

export async function retryFailedSyncLogs(limit = 10) {
  const logs = await prisma.syncLog.findMany({
    where: {
      status: "failed",
      type: { in: ["store_profile", "orders", "meta_insights", "meta_creatives", "meta_structure"] },
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      storeId: true,
      adAccountId: true,
      rangeStart: true,
      rangeEnd: true,
      metadata: true,
    },
  });

  const results: Array<{
    syncLogId: string;
    type: string;
    status: "retried" | "skipped" | "failed";
    message?: string;
  }> = [];

  for (const log of logs) {
    try {
      if (log.type === "store_profile") {
        if (!log.storeId) {
          results.push({ syncLogId: log.id, type: log.type, status: "skipped", message: "Missing storeId." });
          continue;
        }
        await syncStoreProfile(log.storeId);
        results.push({ syncLogId: log.id, type: log.type, status: "retried" });
        continue;
      }

      if (log.type === "orders") {
        if (!log.storeId) {
          results.push({ syncLogId: log.id, type: log.type, status: "skipped", message: "Missing storeId." });
          continue;
        }
        await syncStoreOrders({
          storeId: log.storeId,
          rangeStart: log.rangeStart ?? undefined,
          rangeEnd: log.rangeEnd ?? undefined,
        });
        results.push({ syncLogId: log.id, type: log.type, status: "retried" });
        continue;
      }

      if (log.type === "meta_insights") {
        if (!log.adAccountId) {
          results.push({ syncLogId: log.id, type: log.type, status: "skipped", message: "Missing adAccountId." });
          continue;
        }
        const days = insightDaysSchema.safeParse(readMetadataValue(log.metadata, "days"));
        const level = insightLevelSchema.safeParse(readMetadataValue(log.metadata, "level"));
        const countryBreakdown = readMetadataValue(log.metadata, "countryBreakdown");
        const maxPages = readMetadataValue(log.metadata, "maxPages");
        await syncMetaInsightsForAdAccount({
          adAccountId: log.adAccountId,
          days: days.success ? days.data : 7,
          level: level.success ? level.data : "ad",
          countryBreakdown: typeof countryBreakdown === "boolean" ? countryBreakdown : true,
          maxPages: typeof maxPages === "number" ? maxPages : 10,
        });
        results.push({ syncLogId: log.id, type: log.type, status: "retried" });
        continue;
      }

      if (log.type === "meta_creatives") {
        if (!log.adAccountId) {
          results.push({ syncLogId: log.id, type: log.type, status: "skipped", message: "Missing adAccountId." });
          continue;
        }
        const limit = readMetadataValue(log.metadata, "limit");
        await syncMetaCreativeSnapshotsForAdAccount({
          adAccountId: log.adAccountId,
          limit: typeof limit === "number" ? limit : 250,
        });
        results.push({ syncLogId: log.id, type: log.type, status: "retried" });
      }

      if (log.type === "meta_structure") {
        if (!log.adAccountId) {
          results.push({ syncLogId: log.id, type: log.type, status: "skipped", message: "Missing adAccountId." });
          continue;
        }
        const limit = readMetadataValue(log.metadata, "limit");
        const maxPages = readMetadataValue(log.metadata, "maxPages");
        await syncMetaStructureForAdAccount({
          adAccountId: log.adAccountId,
          limit: typeof limit === "number" ? limit : 500,
          maxPages: typeof maxPages === "number" ? maxPages : 10,
        });
        results.push({ syncLogId: log.id, type: log.type, status: "retried" });
      }
    } catch (error) {
      results.push({
        syncLogId: log.id,
        type: log.type,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scanned: logs.length,
    retried: results.filter((result) => result.status === "retried").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
