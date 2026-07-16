// @ts-nocheck
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezonePlugin from "dayjs/plugin/timezone.js";
import prisma from "../../db/index.js";
import { getBusinessNow } from "../../shared/business-time.js";
import { refreshMetaDataCenterLedger } from "./datacenter-meta-ledger.service.js";
import { refreshStoreDataCenterLedger } from "./datacenter-store-ledger.service.js";
import { executeSyncViewTask } from "./sync-view-task-executor.service.js";
import { deriveCanonicalSyncStatus } from "../types/sync-tasks.js";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const AUTO_REFRESH_ENABLED = process.env.DATA_CENTER_AUTO_REFRESH_ENABLED !== "false";
const AUTO_REFRESH_INTERVAL_MS = Number(process.env.DATA_CENTER_AUTO_REFRESH_INTERVAL_MS || 10 * 60 * 1000);
const AUTO_REFRESH_STALE_SECONDS = Number(process.env.DATA_CENTER_AUTO_REFRESH_STALE_SECONDS || 10 * 60);
const AUTO_REFRESH_LOOKBACK_DAYS = Number(process.env.DATA_CENTER_AUTO_REFRESH_LOOKBACK_DAYS || 3);
const AUTO_VIEW_REFRESH_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.DATA_CENTER_VIEW_REFRESH_INTERVAL_MS || 60 * 60 * 1000)
);

function buildAutoViewScope(storeId?: number | null) {
  return `store:${storeId ?? "all"}`;
}

export async function ensureDataCenterViewFreshness(params?: {
  requestedStartDate?: string;
  requestedEndDate?: string;
  storeId?: number | null;
  force?: boolean;
}) {
  const endDate = params?.requestedEndDate || getBusinessNow().format("YYYY-MM-DD");
  const startDate = params?.requestedStartDate || getBusinessNow().subtract(AUTO_REFRESH_LOOKBACK_DAYS - 1, "day").format("YYYY-MM-DD");
  const scope = buildAutoViewScope(params?.storeId ?? null);
  const recent = !params?.force && await prisma.dataCenterRefreshRun.findFirst({
    where: {
      type: "auto_view_refresh",
      scope,
      startDate,
      endDate,
      status: { in: ["SUCCESS", "PARTIAL_SUCCESS", "NO_NEW_DATA"] },
      finishedAt: { gte: new Date(Date.now() - AUTO_VIEW_REFRESH_INTERVAL_MS) }
    },
    orderBy: { startedAt: "desc" }
  });
  if (recent) return { skipped: true, status: "NO_NEW_DATA", reason: "AUTO_VIEW_REFRESH_INTERVAL_NOT_DUE", startDate, endDate, scope };

  const running = await prisma.dataCenterRefreshRun.findFirst({
    where: {
      type: "auto_view_refresh",
      scope,
      startDate,
      endDate,
      status: "running",
      startedAt: { gte: dayjs().subtract(30, "minute").toDate() }
    }
  });
  if (running) return { skipped: true, status: "RUNNING", reason: "AUTO_VIEW_REFRESH_ALREADY_RUNNING", startDate, endDate, scope };

  const run = await prisma.dataCenterRefreshRun.create({
    data: { type: "auto_view_refresh", scope, startDate, endDate, status: "running", startedAt: new Date() }
  });
  const days = Math.max(1, dayjs(endDate).diff(dayjs(startDate), "day") + 1);
  const receipts: any[] = [];
  const failedSlices: any[] = [];
  for (const taskType of ["sync_view_audience", "sync_view_creatives"] as const) {
    try {
      receipts.push(await executeSyncViewTask({
        taskType,
        startDate,
        endDate,
        days,
        storeId: params?.storeId || null,
        triggeredBy: "auto_view_refresh"
      }));
    } catch (error: any) {
      failedSlices.push({ taskType, message: error?.message || String(error) });
    }
  }
  const totals = receipts.reduce((sum, receipt) => ({
    recordsFetched: sum.recordsFetched + Number(receipt.recordsFetched || 0),
    recordsSaved: sum.recordsSaved + Number(receipt.recordsSaved || 0),
    recordsUpdated: sum.recordsUpdated + Number(receipt.recordsUpdated || 0),
    failedAccounts: [...sum.failedAccounts, ...(receipt.failedAccounts || [])],
    failedSlices: [...sum.failedSlices, ...(receipt.failedSlices || []), ...(receipt.status === "FAILED" ? [{ taskType: receipt.taskType, message: receipt.message }] : [])],
    truncated: sum.truncated || Boolean(receipt.truncated)
  }), { recordsFetched: 0, recordsSaved: 0, recordsUpdated: 0, failedAccounts: [] as any[], failedSlices: [...failedSlices] as any[], truncated: false });
  const status = deriveCanonicalSyncStatus(totals);
  const finishedAt = new Date();
  await prisma.dataCenterRefreshRun.update({
    where: { id: run.id },
    data: {
      status,
      recordsFetched: totals.recordsFetched,
      recordsSaved: totals.recordsSaved,
      recordsUpdated: totals.recordsUpdated,
      diagnosticsJson: JSON.stringify({ receipts, failedSlices: totals.failedSlices }),
      error: status === "FAILED" ? "AUTO_VIEW_REFRESH_FAILED" : null,
      finishedAt
    }
  });
  return { skipped: false, status, reason: "COMPLETED", startDate, endDate, scope, receipts, ...totals, finishedAt: finishedAt.toISOString() };
}

export async function ensureDataCenterFreshness(params?: {
  reason?: "server_boot" | "timer" | "api_request" | "manual_internal";
  requestedStartDate?: string;
  requestedEndDate?: string;
  storeId?: number | null;
  force?: boolean;
  mode?: "background" | "blocking_if_missing" | "blocking";
}): Promise<{
  skipped: boolean;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  reason: string;
  startDate: string;
  endDate: string;
  meta?: {
    recordsFetched: number;
    recordsSaved: number;
    recordsUpdated: number;
    failedAccounts?: any[];
  };
  stores?: Array<{
    storeId: number;
    storeName: string;
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    totalFetched?: number;
    snapshots?: number;
    errorMessage?: string | null;
  }>;
  startedAt?: string;
  finishedAt?: string;
}> {
  // Calculate default dates
  const businessToday = getBusinessNow().format("YYYY-MM-DD");
  const defaultStartDate = getBusinessNow()
    .subtract(AUTO_REFRESH_LOOKBACK_DAYS - 1, "day")
    .format("YYYY-MM-DD");
  const defaultEndDate = businessToday;

  const finalStartDate = params?.requestedStartDate || defaultStartDate;
  const finalEndDate = params?.requestedEndDate || defaultEndDate;

  // Let's check if disabled
  if (!AUTO_REFRESH_ENABLED && !params?.force) {
    return {
      skipped: true,
      status: "SKIPPED",
      reason: "AUTO_REFRESH_DISABLED",
      startDate: finalStartDate,
      endDate: finalEndDate
    };
  }

  // Check running lock
  const running = await prisma.dataCenterRefreshRun.findFirst({
    where: {
      type: "auto_light_refresh",
      status: "running",
      startedAt: {
        gte: dayjs().subtract(15, "minute").toDate()
      }
    }
  });

  if (running) {
    return {
      skipped: true,
      status: "SKIPPED",
      reason: "AUTO_REFRESH_ALREADY_RUNNING",
      startDate: finalStartDate,
      endDate: finalEndDate
    };
  }

  // Check stale check
  if (!params?.force) {
    const lastSuccessful = await prisma.dataCenterRefreshRun.findFirst({
      where: {
        type: "auto_light_refresh",
        status: { in: ["SUCCESS", "PARTIAL", "success", "partial", "SUCCESS", "PARTIAL"] },
        finishedAt: {
          gte: dayjs().subtract(AUTO_REFRESH_STALE_SECONDS, "second").toDate()
        }
      }
    });

    if (lastSuccessful) {
      return {
        skipped: true,
        status: "SKIPPED",
        reason: "AUTO_REFRESH_STALE_CHECK_PASSED",
        startDate: finalStartDate,
        endDate: finalEndDate
      };
    }
  }

  const mode = params?.mode || "background";

  let wantsBlocking = mode === "blocking";

  if (mode === "blocking_if_missing") {
    const ledgerCount = await prisma.dataCenterStoreDaily.count({
      where: {
        ...(params?.storeId ? { storeId: params.storeId } : {}),
        date: {
          gte: finalStartDate,
          lte: finalEndDate
        }
      }
    });
    if (ledgerCount === 0) {
      wantsBlocking = true;
    } else {
      wantsBlocking = false;
    }
  }

  const doRef = async () => {
    return runActualRefresh({
      startDate: finalStartDate,
      endDate: finalEndDate,
      storeId: params?.storeId || null
    });
  };

  if (!wantsBlocking) {
    doRef().catch(err => {
      console.error("[DataCenterAutoRefresh] background refresh error:", err);
    });

    return {
      skipped: false,
      status: "SKIPPED",
      reason: "BACKGROUND_TRIGGERED",
      startDate: finalStartDate,
      endDate: finalEndDate
    };
  }

  let completed = false;
  const timeoutPromise = new Promise<"TIMEOUT">((resolve) => {
    setTimeout(() => {
      if (!completed) resolve("TIMEOUT");
    }, 8000);
  });

  const winner = await Promise.race([doRef(), timeoutPromise]);
  completed = true;

  if (winner === "TIMEOUT") {
    return {
      skipped: false,
      status: "PARTIAL",
      reason: "TIMEOUT_BLOCKING",
      startDate: finalStartDate,
      endDate: finalEndDate,
      meta: {
        recordsFetched: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        refreshing: true
      }
    };
  } else {
    return winner;
  }
}

async function runActualRefresh(params: {
  startDate: string;
  endDate: string;
  storeId: number | null;
}) {
  const startedAt = new Date();
  const run = await prisma.dataCenterRefreshRun.create({
    data: {
      type: "auto_light_refresh",
      scope: "datacenter",
      startDate: params.startDate,
      endDate: params.endDate,
      status: "running",
      startedAt
    }
  });

  let recordsFetched = 0;
  let recordsSaved = 0;
  let recordsUpdated = 0;
  let metaFailedAccounts: any[] = [];
  const storesResult: any[] = [];
  let overallStatus: "SUCCESS" | "PARTIAL" | "FAILED" = "SUCCESS";

  try {
    // 1. Refresh Meta ledger
    try {
      const metaRes = await refreshMetaDataCenterLedger({
        startDate: params.startDate,
        endDate: params.endDate,
        storeId: params.storeId,
        includeUnmapped: true
      });
      recordsFetched += metaRes.recordsFetched || 0;
      recordsSaved += metaRes.recordsSaved || 0;
      recordsUpdated += metaRes.recordsUpdated || 0;
      metaFailedAccounts = metaRes.failedAccounts || [];
      if (metaFailedAccounts.length > 0) {
        overallStatus = "PARTIAL";
      }
    } catch (metaErr: any) {
      console.error("[DataCenterAutoRefresh] refreshMetaDataCenterLedger failed:", metaErr);
      overallStatus = "PARTIAL";
      metaFailedAccounts.push({
        accountId: "GLOBAL_REFRESH_ERROR",
        message: metaErr?.message || String(metaErr)
      });
    }

    // 2. Refresh active stores
    let storesToSync = [];
    if (params.storeId) {
      const singleStore = await prisma.store.findUnique({
        where: { id: params.storeId }
      });
      if (singleStore) {
        storesToSync.push(singleStore);
      }
    } else {
      storesToSync = await prisma.store.findMany();
    }

    for (const store of storesToSync) {
      try {
        const storeRes = await refreshStoreDataCenterLedger({
          storeId: store.id,
          startDate: params.startDate,
          endDate: params.endDate
        });

        const snapshotFetched = storeRes.snapshots?.reduce((s: number, r: any) => s + Number(r.orderCount || 0), 0) || 0;

        storesResult.push({
          storeId: store.id,
          storeName: store.name,
          status: "SUCCESS",
          totalFetched: snapshotFetched,
          snapshots: storeRes.snapshots?.length || 0,
          errorMessage: null
        });
      } catch (storeErr: any) {
        console.error(`[DataCenterAutoRefresh] refreshStoreDataCenterLedger failed for store ${store.name} (${store.id}):`, storeErr);
        overallStatus = "PARTIAL";
        storesResult.push({
          storeId: store.id,
          storeName: store.name,
          status: "FAILED",
          totalFetched: 0,
          snapshots: 0,
          errorMessage: storeErr?.message || String(storeErr)
        });
      }
    }

    const allStoresFailed = storesResult.length > 0 && storesResult.every(s => s.status === "FAILED");
    if (allStoresFailed && metaFailedAccounts.length > 0 && recordsFetched === 0) {
      overallStatus = "FAILED";
    }

    const finishedAt = new Date();
    await prisma.dataCenterRefreshRun.update({
      where: { id: run.id },
      data: {
        status: overallStatus,
        recordsFetched,
        recordsSaved,
        recordsUpdated,
        diagnosticsJson: JSON.stringify({
          storesResult,
          failedAccounts: metaFailedAccounts
        }),
        finishedAt
      }
    });

    return {
      skipped: false,
      status: overallStatus,
      reason: "COMPLETED",
      startDate: params.startDate,
      endDate: params.endDate,
      meta: {
        recordsFetched,
        recordsSaved,
        recordsUpdated,
        failedAccounts: metaFailedAccounts
      },
      stores: storesResult,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    };

  } catch (err: any) {
    console.error("[DataCenterAutoRefresh] critical error in actual refresh execution:", err);
    const finishedAt = new Date();
    try {
      await prisma.dataCenterRefreshRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: err?.message || String(err),
          finishedAt
        }
      });
    } catch {}

    return {
      skipped: false,
      status: "FAILED",
      reason: err?.message || String(err),
      startDate: params.startDate,
      endDate: params.endDate,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    };
  }
}

export function startDataCenterAutoRefreshLoop() {
  if (process.env.DATA_CENTER_AUTO_REFRESH_ENABLED === "false") {
    console.log("[DataCenterAutoRefresh] disabled");
    return;
  }

  console.log("[DataCenterAutoRefresh] started");

  setTimeout(() => {
    ensureDataCenterFreshness({
      reason: "server_boot",
      mode: "background"
    }).catch(err => {
      console.error("[DataCenterAutoRefresh] boot refresh failed", err);
    });
  }, 5000);

  setInterval(() => {
    ensureDataCenterFreshness({
      reason: "timer",
      mode: "background"
    }).catch(err => {
      console.error("[DataCenterAutoRefresh] timer refresh failed", err);
    });
  }, AUTO_REFRESH_INTERVAL_MS);

  setTimeout(() => {
    ensureDataCenterViewFreshness().catch(err => console.error("[DataCenterAutoRefresh] boot view refresh failed", err));
  }, 15000);

  setInterval(() => {
    ensureDataCenterViewFreshness().catch(err => console.error("[DataCenterAutoRefresh] timer view refresh failed", err));
  }, AUTO_VIEW_REFRESH_INTERVAL_MS);
}

export async function getFreshnessMeta() {
  const AUTO_REFRESH_ENABLED = process.env.DATA_CENTER_AUTO_REFRESH_ENABLED !== "false";
  
  // Find latest completed or running auto refresh run
  const latestRun = await prisma.dataCenterRefreshRun.findFirst({
    where: {
      type: "auto_light_refresh"
    },
    orderBy: {
      startedAt: "desc"
    }
  });

  const isRunning = latestRun?.status === "running" && latestRun.startedAt > new Date(Date.now() - 15 * 60 * 1000);

  let secondsSinceLatestAutoRefresh: number | null = null;
  if (latestRun?.finishedAt) {
    secondsSinceLatestAutoRefresh = Math.max(0, Math.floor((Date.now() - latestRun.finishedAt.getTime()) / 1000));
  } else if (latestRun?.startedAt && isRunning) {
    secondsSinceLatestAutoRefresh = Math.max(0, Math.floor((Date.now() - latestRun.startedAt.getTime()) / 1000));
  }

  return {
    autoRefreshEnabled: AUTO_REFRESH_ENABLED,
    latestAutoRefreshAt: (latestRun?.finishedAt || latestRun?.startedAt || null)?.toISOString() || null,
    latestAutoRefreshStatus: (latestRun?.status as "success" | "partial" | "failed" | "running" | null) || null,
    secondsSinceLatestAutoRefresh,
    refreshing: !!isRunning,
    source: "DataCenterAutoRefresh" as const
  };
}
