// @ts-nocheck
import { prisma } from "../db/prisma.js";

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

function enabled(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

export async function getSystemConfigSummary() {
  const [
    stores,
    activeStores,
    shoplineStores,
    shoplazzaStores,
    adAccounts,
    mappedAccounts,
    aiProviders,
    recentLogs,
  ] = await Promise.all([
    prisma.store.count(),
    prisma.store.count({ where: { status: "active" } }),
    prisma.store.count({ where: { platform: "shopline" } }),
    prisma.store.count({ where: { platform: "shoplazza" } }),
    prisma.adAccount.count(),
    prisma.accountMapping.count(),
    prisma.aiProvider.count({ where: { enabled: true } }),
    prisma.syncLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        type: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        recordsFetched: true,
        recordsSaved: true,
      },
    }),
  ]);

  return {
    meta: {
      tokenConfigured: hasValue(process.env.META_ACCESS_TOKEN) || hasValue(process.env.META_TOKENS),
      apiVersion: process.env.META_API_VERSION || "v25.0",
      readOnlyMode: process.env.READ_ONLY_MODE !== "false",
      accountSyncEnabled: enabled(process.env.META_AD_ACCOUNTS_SYNC_ENABLED, true),
      insightsSyncEnabled: enabled(process.env.META_INSIGHTS_SYNC_ENABLED, true),
      structureSyncEnabled: enabled(process.env.META_STRUCTURE_SYNC_ENABLED, true),
      activeAccountWindowDays: Number(
        process.env.META_AD_ACCOUNTS_ACTIVE_LAST_DAYS || process.env.META_ACTIVE_ACCOUNT_WINDOW_DAYS || 90,
      ),
      insightAccountLimit: Number(process.env.META_INSIGHTS_SYNC_ACCOUNT_LIMIT || 50),
    },
    stores: {
      total: stores,
      active: activeStores,
      shopline: shoplineStores,
      shoplazza: shoplazzaStores,
      tokenStorage: "encrypted",
    },
    ai: {
      enabledProviders: aiProviders,
      keyStorage: "encrypted",
      frontendExposure: "masked",
    },
    sync: {
      workerEnabled: enabled(process.env.WORKER_ENABLED, true),
      orderSyncEnabled: enabled(process.env.ORDER_SYNC_ENABLED, true),
      redisConfigured: hasValue(process.env.REDIS_URL),
      workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 1),
      metaIntervalMinutes: Number(
        process.env.META_INSIGHTS_SYNC_INTERVAL_MINUTES || process.env.META_SYNC_INTERVAL_MINUTES || 60,
      ),
      orderIntervalMinutes: Number(process.env.ORDER_SYNC_INTERVAL_MINUTES || 60),
      recentLogs,
    },
    security: {
      apiKeyConfigured: hasValue(process.env.API_KEY),
      sessionSecretConfigured: hasValue(process.env.SESSION_SECRET),
      tokenEncryptionKeyConfigured: hasValue(process.env.TOKEN_ENCRYPTION_KEY),
      corsOrigin: process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || "",
      corsWildcard: (process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN) === "*",
      httpsRequired: process.env.NODE_ENV === "production",
      metaWriteBlocked: process.env.READ_ONLY_MODE !== "false",
    },
    data: {
      adAccounts,
      mappedAccounts,
      unmappedAccounts: Math.max(0, adAccounts - mappedAccounts),
    },
  };
}
