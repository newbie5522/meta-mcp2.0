import prisma from "../../db/index.js";
import { v4 as uuidv4 } from "uuid";
import { SyncCenter } from "./sync-center.service.js";
import { buildCoverageScopeKey } from "./data-coverage.service.js";
import { deriveCanonicalSyncStatus, type CanonicalSyncStatus } from "../types/sync-tasks.js";
import { normalizeMetaAccountId } from "../utils.js";

export type CanonicalViewTask = "sync_view_audience" | "sync_view_creatives";

export interface ViewTaskExecutionReceipt {
  success: boolean;
  status: CanonicalSyncStatus;
  message: string;
  chainId: string;
  taskType: CanonicalViewTask;
  taskIds: string[];
  recordsFetched: number;
  recordsSaved: number;
  recordsUpdated: number;
  failedAccounts: any[];
  failedSlices: any[];
  truncated: boolean;
  coverageComplete: boolean;
  targetAccountsCount: number;
  eligibleTargetAccountsCount: number;
  startDate: string;
  endDate: string;
  dimensionsRequested?: string[];
  dimensionsSynced?: string[];
}

function metadataOf(log: any) {
  if (!log?.metadata) return {};
  if (typeof log.metadata === "object") return log.metadata;
  try { return JSON.parse(String(log.metadata)); } catch { return {}; }
}

const DEMO_STORE_NAMES = [
  "Shopline Fashion Store",
  "Shopify Electronics Hub",
  "Shoplazza Home Decor"
];

const DEMO_STORE_DOMAINS = [
  "fashion.shoplineapp.com",
  "electronics.myshopify.com",
  "decor.shoplazza.com"
];

function isSandboxOrDemoStore(store: any) {
  return (
    String(store?.mode || "").toLowerCase() === "sandbox" ||
    DEMO_STORE_NAMES.includes(String(store?.name || "")) ||
    DEMO_STORE_DOMAINS.includes(String(store?.domain || ""))
  );
}

async function resolveTargets(input: {
  accountId?: string | null;
  accountIds?: string[] | null;
  storeId?: string | number | null;
  limit?: number | string | null;
}) {
  const requested = [input.accountId, ...(Array.isArray(input.accountIds) ? input.accountIds : [])]
    .filter(Boolean)
    .map(value => normalizeMetaAccountId(String(value)))
    .filter((value, index, all) => all.indexOf(value) === index);
  const parsedLimit = input.limit === null || input.limit === undefined || input.limit === ""
    ? undefined
    : Math.max(1, Math.min(50, Number.parseInt(String(input.limit), 10) || 1));
  const parsedStoreId = input.storeId && input.storeId !== "all" ? Number(input.storeId) : null;
  if (parsedStoreId !== null) {
    const store = await prisma.store.findUnique({ where: { id: parsedStoreId } });
    if (!store) {
      const error: any = new Error(`Store ${parsedStoreId} was not found`);
      error.statusCode = 404;
      error.code = "STORE_NOT_FOUND";
      throw error;
    }
    if (isSandboxOrDemoStore(store)) {
      const error: any = new Error(`Store ${parsedStoreId} is excluded from production sync targets`);
      error.statusCode = 400;
      error.code = "SANDBOX_STORE_EXCLUDED";
      throw error;
    }
  }
  const where: any = {
    ...(requested.length ? { fb_account_id: { in: requested } } : { recentActivity90d: true }),
    ...(parsedStoreId !== null ? { storeId: parsedStoreId } : {}),
    OR: [{ storeId: null }, { store: { mode: { not: "sandbox" } } }]
  };
  const eligibleTargetCount = await prisma.adAccount.count({ where });
  const targets = await prisma.adAccount.findMany({
    where,
    include: { store: true },
    orderBy: { updatedAt: "desc" },
    ...(parsedLimit ? { take: parsedLimit } : {})
  });
  if (targets.length === 0) {
    const error: any = new Error(requested.length ? "未找到可同步的真实 Meta 广告账户。" : "没有符合安全同步范围的活跃广告账户。");
    error.statusCode = requested.length ? 404 : 400;
    error.code = requested.length ? "ACCOUNT_NOT_FOUND" : "NO_SYNC_TARGETS";
    throw error;
  }
  return {
    targets,
    eligibleTargetCount,
    selectedTargetCount: targets.length,
    truncatedByLimit: parsedLimit !== undefined && eligibleTargetCount > targets.length
  };
}

async function summarize(taskIds: string[]) {
  const logs = taskIds.length ? await prisma.syncLog.findMany({ where: { id: { in: taskIds } } }) : [];
  let recordsFetched = 0;
  let recordsSaved = 0;
  let recordsUpdated = 0;
  const failedAccounts: any[] = [];
  const failedSlices: any[] = [];
  let truncated = false;
  let coverageComplete = true;
  const dimensionsSynced = new Set<string>();

  for (const log of logs) {
    const metadata = metadataOf(log);
    recordsFetched += Number(log.recordsFetched || metadata.recordsFetched || 0);
    recordsSaved += Number(log.recordsSaved || metadata.recordsSaved || 0);
    recordsUpdated += Number(metadata.recordsUpdated || 0);
    if (Array.isArray(metadata.failedAccounts)) failedAccounts.push(...metadata.failedAccounts);
    if (Array.isArray(metadata.failedSlices)) failedSlices.push(...metadata.failedSlices);
    if (Array.isArray(metadata.dimensionsSynced)) metadata.dimensionsSynced.forEach((value: string) => dimensionsSynced.add(value));
    if (metadata.truncated === true) truncated = true;
    if (metadata.coverageComplete === false || log.status === "failed") coverageComplete = false;
  }
  const status = deriveCanonicalSyncStatus({ recordsFetched, recordsSaved, recordsUpdated, failedAccounts, failedSlices, truncated, coverageComplete });
  return { recordsFetched, recordsSaved, recordsUpdated, failedAccounts, failedSlices, truncated, coverageComplete: coverageComplete && status !== "FAILED", status, dimensionsSynced: Array.from(dimensionsSynced) };
}

export async function executeSyncViewTask(input: {
  taskType: CanonicalViewTask;
  startDate: string;
  endDate: string;
  days: number;
  accountId?: string | null;
  accountIds?: string[] | null;
  storeId?: string | number | null;
  limit?: number | string | null;
  chainId?: string;
  triggeredBy?: string;
}): Promise<ViewTaskExecutionReceipt> {
  const chainId = input.chainId || uuidv4();
  const targetResolution = await resolveTargets(input);
  const targets = targetResolution.targets;
  const normalizedAccountIds = targets.map(account => normalizeMetaAccountId(account.fb_account_id));
  const dimensionsRequested = ["country", "age", "gender", "publisher_platform"];
  const scopeKey = buildCoverageScopeKey({
    storeId: input.storeId || null,
    accountId: input.accountId || null,
    accountIds: input.accountId ? undefined : (input.accountIds?.length ? normalizedAccountIds : undefined),
    dimension: null
  });
  const childTaskIds: string[] = [];
  let childSummary: Awaited<ReturnType<typeof summarize>> | null = null;
  const runOptions = { parentChainId: chainId, parentViewTask: true, allowSameChainRunning: true };

  const parentTaskId = await SyncCenter.runTask(
    input.taskType,
    "meta",
    input.triggeredBy || "view_sync_executor",
    chainId,
    null,
    input.storeId || null,
    input.accountId || null,
    async () => {
      let previousTaskId: string | null = null;
      if (input.taskType === "sync_view_creatives") {
        const structureTaskId = await SyncCenter.syncMetaStructure(
          chainId,
          input.triggeredBy || "view_sync_executor",
          null,
          { accountId: input.accountId || undefined, accountIds: normalizedAccountIds, limit: input.limit ? Number(input.limit) : undefined },
          runOptions
        );
        childTaskIds.push(structureTaskId);
        previousTaskId = structureTaskId;
      }

      for (const account of targets) {
        const accountId = normalizeMetaAccountId(account.fb_account_id);
        const taskId = input.taskType === "sync_view_audience"
          ? await SyncCenter.syncMetaAudience(chainId, input.triggeredBy || "view_sync_executor", previousTaskId, input.days, accountId, input.startDate, input.endDate, { ...runOptions, scopeKey: `account:${accountId}` })
          : await SyncCenter.syncMetaInsights(chainId, input.triggeredBy || "view_sync_executor", previousTaskId, input.days, accountId, input.startDate, input.endDate, { ...runOptions, scopeKey: `account:${accountId}` });
        childTaskIds.push(taskId);
        previousTaskId = taskId;
      }

      childSummary = await summarize(childTaskIds);
      const finalTruncated = childSummary.truncated || targetResolution.truncatedByLimit;
      const finalCoverageComplete = childSummary.coverageComplete && !finalTruncated;
      const finalStatus = deriveCanonicalSyncStatus({
        recordsFetched: childSummary.recordsFetched,
        recordsSaved: childSummary.recordsSaved,
        recordsUpdated: childSummary.recordsUpdated,
        failedAccounts: childSummary.failedAccounts,
        failedSlices: childSummary.failedSlices,
        truncated: finalTruncated,
        coverageComplete: finalCoverageComplete
      });
      return {
        recordsFetched: childSummary.recordsFetched,
        recordsSaved: childSummary.recordsSaved,
        recordsUpdated: childSummary.recordsUpdated,
        failedAccounts: childSummary.failedAccounts,
        failedSlices: childSummary.failedSlices,
        truncated: finalTruncated,
        coverageComplete: finalCoverageComplete,
        metadata: {
          status: finalStatus,
          taskIds: childTaskIds,
          targetAccountsCount: targetResolution.selectedTargetCount,
          eligibleTargetCount: targetResolution.eligibleTargetCount,
          selectedTargetCount: targetResolution.selectedTargetCount,
          truncatedByLimit: targetResolution.truncatedByLimit,
          dimensionsRequested: input.taskType === "sync_view_audience" ? dimensionsRequested : undefined,
          dimensionsSynced: input.taskType === "sync_view_audience" ? childSummary.dimensionsSynced : undefined
        }
      };
    },
    { rangeStart: input.startDate, rangeEnd: input.endDate, scopeKey, coverageComplete: !targetResolution.truncatedByLimit }
  );

  const parentLog = await prisma.syncLog.findUnique({ where: { id: parentTaskId } });
  const parentMetadata = metadataOf(parentLog);
  const summary = childSummary || await summarize(childTaskIds);
  const status = String(parentMetadata.status || summary.status).toUpperCase() as CanonicalSyncStatus;
  return {
    success: status !== "FAILED",
    status,
    message: input.taskType === "sync_view_audience"
      ? "受众视图同步完成。"
      : "素材视图同步完成：已执行素材结构和 ad-level 成效事实链路。",
    chainId,
    taskType: input.taskType,
    taskIds: [parentTaskId, ...childTaskIds],
    recordsFetched: Number(parentMetadata.recordsFetched ?? summary.recordsFetched),
    recordsSaved: Number(parentMetadata.recordsSaved ?? summary.recordsSaved),
    recordsUpdated: Number(parentMetadata.recordsUpdated ?? summary.recordsUpdated),
    failedAccounts: parentMetadata.failedAccounts || summary.failedAccounts,
    failedSlices: parentMetadata.failedSlices || summary.failedSlices,
    truncated: Boolean(parentMetadata.truncated ?? summary.truncated),
    coverageComplete: parentMetadata.coverageComplete === true,
    targetAccountsCount: targetResolution.selectedTargetCount,
    eligibleTargetAccountsCount: targetResolution.eligibleTargetCount,
    startDate: input.startDate,
    endDate: input.endDate,
    ...(input.taskType === "sync_view_audience" ? {
      dimensionsRequested,
      dimensionsSynced: parentMetadata.dimensionsSynced || summary.dimensionsSynced
    } : {})
  };
}
