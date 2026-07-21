// @ts-nocheck
import prisma from "../../db/index.js";
import { SyncCenter } from "./sync-center.service.js";
import { refreshStoreDataCenterLedger } from "./datacenter-store-ledger.service.js";

export type StorePipelineStatus = "SUCCESS" | "NO_NEW_DATA" | "PARTIAL_SUCCESS" | "FAILED";

export type StorePipelineReceipt = {
  storeId: number;
  storeName: string;
  platform: string;
  timezone: string;
  timezoneSource: string;
  startDate: string;
  endDate: string;
  status: StorePipelineStatus;
  orderSync: {
    taskId: string | null;
    status: string;
    recordsFetched: number;
    recordsSaved: number;
    recordsUpdated: number;
    coverageComplete: boolean;
    truncated: boolean;
    error: string | null;
  };
  ledger: {
    status: "SUCCESS" | "SKIPPED" | "FAILED";
    source: "Order";
    dateField: "Order.store_local_date";
    recordsFetched: number;
    recordsSaved: number;
    uniqueOrderCount: number;
    totalGrossSales: number;
    error: string | null;
  };
  failedSlices: any[];
};

function parseMetadata(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function normalizeTaskStatus(status: unknown) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "success") return "SUCCESS";
  if (value === "failed") return "FAILED";
  if (value === "running") return "RUNNING";
  if (value === "pending") return "PENDING";
  return value ? value.toUpperCase() : "UNKNOWN";
}

function metadataTimezoneSource(metadata: any) {
  return metadata?.timezoneSource || metadata?.diagnostics?.timezoneSource || "";
}

function metadataTimezone(metadata: any, store: any) {
  return metadata?.timezone || metadata?.diagnostics?.timezoneAfter || store?.timezone || "";
}

export async function executeStoreDataPipeline(input: {
  store: any;
  chainId: string;
  triggeredBy: string;
  startDate: string;
  endDate: string;
  days: number;
  previousTaskId?: string | null;
  rebuild?: boolean;
  baselineRevenue?: number;
}): Promise<StorePipelineReceipt> {
  const store = input.store;
  const baseReceipt: StorePipelineReceipt = {
    storeId: store.id,
    storeName: store.name,
    platform: String(store.platform || "unknown").toLowerCase(),
    timezone: store.timezone || "",
    timezoneSource: "",
    startDate: input.startDate,
    endDate: input.endDate,
    status: "FAILED",
    orderSync: {
      taskId: null,
      status: "NOT_RUN",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      coverageComplete: false,
      truncated: false,
      error: null
    },
    ledger: {
      status: "SKIPPED",
      source: "Order",
      dateField: "Order.store_local_date",
      recordsFetched: 0,
      recordsSaved: 0,
      uniqueOrderCount: 0,
      totalGrossSales: 0,
      error: null
    },
    failedSlices: []
  };

  let taskId: string | null = null;
  try {
    taskId = await SyncCenter.syncStoreOrders(
      store.id,
      input.chainId,
      input.triggeredBy,
      input.previousTaskId || null,
      input.days,
      input.startDate,
      input.endDate,
      {
        baselineRevenue: input.baselineRevenue,
        rebuild: Boolean(input.rebuild)
      }
    );
  } catch (error: any) {
    baseReceipt.orderSync.error = error?.message || String(error);
    baseReceipt.failedSlices.push({ storeId: store.id, step: "sync_store_orders", message: baseReceipt.orderSync.error });
    return baseReceipt;
  }

  const log = taskId ? await prisma.syncLog.findUnique({ where: { id: taskId } }) : null;
  const metadata = parseMetadata(log?.metadata);
  const orderStatus = normalizeTaskStatus(log?.status);
  const recordsFetched = Number(log?.recordsFetched ?? metadata.recordsFetched ?? 0);
  const recordsSaved = Number(log?.recordsSaved ?? metadata.recordsSaved ?? 0);
  const recordsUpdated = Number(metadata.recordsUpdated ?? 0);
  const coverageComplete = metadata.coverageComplete !== false && log?.status === "success";
  const truncated = metadata.truncated === true;
  const error = log?.errorMessage || log?.error || metadata.errorMessage || metadata.error || null;

  baseReceipt.orderSync = {
    taskId,
    status: orderStatus,
    recordsFetched,
    recordsSaved,
    recordsUpdated,
    coverageComplete,
    truncated,
    error
  };
  baseReceipt.timezone = metadataTimezone(metadata, store);
  baseReceipt.timezoneSource = metadataTimezoneSource(metadata);

  if (orderStatus === "FAILED") {
    baseReceipt.status = "FAILED";
    baseReceipt.failedSlices.push({ storeId: store.id, step: "sync_store_orders", message: error || "Sync task failed" });
    return baseReceipt;
  }

  try {
    const ledger = await refreshStoreDataCenterLedger({
      storeId: store.id,
      startDate: input.startDate,
      endDate: input.endDate,
      rangeVerified: coverageComplete
    });
    baseReceipt.ledger = {
      status: "SUCCESS",
      source: "Order",
      dateField: "Order.store_local_date",
      recordsFetched: Number(ledger.recordsFetched ?? ledger.totalFetched ?? 0),
      recordsSaved: Number(ledger.recordsSaved ?? ledger.snapshots?.length ?? 0),
      uniqueOrderCount: Number(ledger.uniqueOrderCount ?? 0),
      totalGrossSales: Number(ledger.totalGrossSales ?? 0),
      error: null
    };
  } catch (error: any) {
    baseReceipt.ledger = {
      status: "FAILED",
      source: "Order",
      dateField: "Order.store_local_date",
      recordsFetched: 0,
      recordsSaved: 0,
      uniqueOrderCount: 0,
      totalGrossSales: 0,
      error: error?.message || String(error)
    };
    baseReceipt.failedSlices.push({ storeId: store.id, step: "refresh_store_datacenter_ledger", message: baseReceipt.ledger.error });
  }

  if (baseReceipt.ledger.status === "FAILED") {
    baseReceipt.status = "PARTIAL_SUCCESS";
  } else if (recordsFetched === 0 && recordsSaved === 0 && coverageComplete) {
    baseReceipt.status = "NO_NEW_DATA";
  } else {
    baseReceipt.status = "SUCCESS";
  }

  return baseReceipt;
}
