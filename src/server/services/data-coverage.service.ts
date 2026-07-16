import prisma from "../../db/index.js";
import {
  resolveDataCoverageStatus,
  type DataCoverageSource,
  type DataSourceCoverage,
  type SyncCoverageEvidence
} from "../../shared/data-coverage-contract.js";
import { normalizeMetaAccountId } from "../utils.js";

const STALE_RUNNING_MS = 30 * 60 * 1000;
const IMPOSSIBLE_ACCOUNT_ID = "__NO_MAPPED_META_ACCOUNT__";

const SOURCE_TASK_TYPES: Record<DataCoverageSource, string[]> = {
  META_ACCOUNT: ["refresh_meta_datacenter_ledger", "sync_view_account_data"],
  META_AUDIENCE: ["sync_meta_audience", "sync_view_audience"],
  META_CREATIVE: ["sync_meta_insights", "sync_meta_creatives", "sync_view_creatives"],
  STORE_ORDER: ["sync_store_orders", "sync_view_store_data", "sync_view_products"],
  STORE_LEDGER: ["refresh_store_datacenter_ledger", "sync_view_store_data", "sync_view_products"],
  PRODUCT_ORDER: ["sync_store_orders", "sync_view_products"]
};

export interface DataCoverageQuery {
  source: DataCoverageSource;
  requestedStartDate: string;
  requestedEndDate: string;
  scopeKey?: string;
  storeId?: number | string | null;
  accountId?: string | null;
  accountIds?: string[];
  dimension?: string | null;
  factLevel?: "account" | "campaign" | "adset" | "ad" | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  structureRowCount?: number;
}

function normalizeScopeValue(value: unknown) {
  return value === null || value === undefined || value === "" ? "all" : String(value);
}

export function buildCoverageScopeKey(input: Omit<DataCoverageQuery, "source" | "requestedStartDate" | "requestedEndDate">) {
  if (input.scopeKey) return input.scopeKey;
  const accountIds = input.accountIds?.map(normalizeMetaAccountId).sort().join(",") || normalizeScopeValue(input.accountId);
  return [
    `store:${normalizeScopeValue(input.storeId)}`,
    `account:${accountIds}`,
    `dimension:${normalizeScopeValue(input.dimension)}`,
    `campaign:${normalizeScopeValue(input.campaignId)}`,
    `adset:${normalizeScopeValue(input.adsetId)}`,
    `ad:${normalizeScopeValue(input.adId)}`
  ].join("|");
}

function parseMetadata(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, any>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function formatBusinessAsOf(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function matchesScope(log: any, metadata: Record<string, any>, query: DataCoverageQuery, scopeKey: string) {
  if (metadata.scopeKey === scopeKey) return true;
  if (typeof metadata.scopeKey === "string" && metadata.scopeKey.includes("|")) {
    const logged = Object.fromEntries(metadata.scopeKey.split("|").map((part: string) => {
      const separator = part.indexOf(":");
      return separator > 0 ? [part.slice(0, separator), part.slice(separator + 1)] : [part, ""];
    }));
    const requested = Object.fromEntries(scopeKey.split("|").map((part: string) => {
      const separator = part.indexOf(":");
      return separator > 0 ? [part.slice(0, separator), part.slice(separator + 1)] : [part, ""];
    }));
    for (const key of ["store", "account", "campaign", "adset", "ad"]) {
      if (logged[key] && logged[key] !== "all" && logged[key] !== requested[key]) return false;
    }
    const dimensionCovered = !query.dimension || logged.dimension === "all" || logged.dimension === query.dimension ||
      (Array.isArray(metadata.dimensionsRequested) && metadata.dimensionsRequested.includes(query.dimension));
    if (dimensionCovered) return true;
  }
  const requestedStore = query.storeId === null || query.storeId === undefined || query.storeId === "all"
    ? null
    : Number(query.storeId);
  if (requestedStore !== null && Number(log.storeId) !== requestedStore) return false;
  const requestedAccount = query.accountId ? normalizeMetaAccountId(query.accountId) : null;
  if (requestedAccount && normalizeMetaAccountId(log.adAccountId || "") !== requestedAccount) return false;
  return requestedStore !== null || requestedAccount !== null;
}

function readLogRange(log: any, metadata: Record<string, any>) {
  return {
    start: dateOnly(log.rangeStart || metadata.rangeStart || metadata.startDate),
    end: dateOnly(log.rangeEnd || metadata.rangeEnd || metadata.endDate)
  };
}

async function resolveSyncReceipt(query: DataCoverageQuery, scopeKey: string) {
  const logs = await prisma.syncLog.findMany({
    where: { taskType: { in: SOURCE_TASK_TYPES[query.source] } },
    orderBy: { startedAt: "desc" },
    take: 100
  });
  let running = false;
  let evidence: SyncCoverageEvidence | null = null;
  let evidenceCoverageComplete = false;
  let evidenceTruncated = false;
  let asOfTime: string | null = null;

  for (const log of logs) {
    const metadata = parseMetadata(log.metadata);
    if (!matchesScope(log, metadata, query, scopeKey)) continue;
    const range = readLogRange(log, metadata);
    const exactRange = range.start === query.requestedStartDate && range.end === query.requestedEndDate;
    if (!exactRange) continue;

    if (log.status === "running") {
      const startedAt = log.startedAt instanceof Date ? log.startedAt : new Date(log.startedAt);
      if (!Number.isNaN(startedAt.getTime()) && Date.now() - startedAt.getTime() <= STALE_RUNNING_MS) {
        running = true;
      }
      continue;
    }
    if (evidence) continue;

    const failedCount =
      (Array.isArray(metadata.failedAccounts) ? metadata.failedAccounts.length : 0) +
      (Array.isArray(metadata.failedSlices) ? metadata.failedSlices.length : 0);
    const status = String(metadata.status || (log.status === "failed" ? "FAILED" : "SUCCESS")).toUpperCase();
    evidence = {
      taskType: log.taskType || null,
      taskId: log.id || null,
      status,
      rangeStart: range.start,
      rangeEnd: range.end,
      recordsFetched: Number(log.recordsFetched ?? metadata.recordsFetched ?? 0),
      recordsSaved: Number(log.recordsSaved ?? metadata.recordsSaved ?? 0),
      failedCount
    };
    evidenceCoverageComplete = metadata.coverageComplete === true;
    evidenceTruncated = metadata.truncated === true;
    asOfTime = formatBusinessAsOf(log.finishedAt);
  }

  return { running, evidence, evidenceCoverageComplete, evidenceTruncated, asOfTime };
}

async function resolveAccountIds(query: DataCoverageQuery) {
  if (query.accountIds?.length) return query.accountIds.map(normalizeMetaAccountId);
  if (query.accountId) return [normalizeMetaAccountId(query.accountId)];
  if (query.storeId === null || query.storeId === undefined || query.storeId === "all") return [];
  const storeId = Number(query.storeId);
  const [mappings, accounts] = await Promise.all([
    prisma.accountMapping.findMany({ where: { storeId }, select: { fbAccountId: true } }),
    prisma.adAccount.findMany({ where: { storeId }, select: { fb_account_id: true } })
  ]);
  return Array.from(new Set([
    ...mappings.map((item) => normalizeMetaAccountId(item.fbAccountId)),
    ...accounts.map((item) => normalizeMetaAccountId(item.fb_account_id))
  ]));
}

async function queryFactRange(query: DataCoverageQuery) {
  const requestedRange = { gte: query.requestedStartDate, lte: query.requestedEndDate };
  const storeId = query.storeId === null || query.storeId === undefined || query.storeId === "all"
    ? null
    : Number(query.storeId);
  const accountIds = await resolveAccountIds(query);
  const requestedStoreHasNoMappedAccounts = storeId !== null && !query.accountId && !query.accountIds?.length && accountIds.length === 0;
  const scopedAccountIds = requestedStoreHasNoMappedAccounts ? [IMPOSSIBLE_ACCOUNT_ID] : accountIds;
  let delegate: any;
  let where: any;
  let dateField = "date";
  let syncedAtField: string | null = null;

  switch (query.source) {
    case "META_ACCOUNT":
      delegate = prisma.dataCenterMetaAccountDaily;
      where = {
        ...(storeId !== null ? { storeId } : {}),
        ...(scopedAccountIds.length ? { accountId: { in: scopedAccountIds } } : {})
      };
      syncedAtField = "apiFetchedAt";
      break;
    case "META_AUDIENCE":
      delegate = prisma.factAudienceBreakdown;
      where = {
        ...(scopedAccountIds.length ? { account_id: { in: scopedAccountIds } } : {}),
        ...(query.dimension ? { dimension_type: query.dimension } : {})
      };
      syncedAtField = "synced_at";
      break;
    case "META_CREATIVE":
      delegate = prisma.factMetaPerformance;
      where = {
        level: query.factLevel || (query.adId ? "ad" : query.adsetId ? "adset" : query.campaignId ? "campaign" : "ad"),
        ...(scopedAccountIds.length ? { account_id: { in: scopedAccountIds } } : {}),
        ...(query.campaignId ? { campaign_id: query.campaignId } : {}),
        ...(query.adsetId ? { adset_id: query.adsetId } : {}),
        ...(query.adId ? { ad_id: query.adId } : {})
      };
      syncedAtField = "synced_at";
      break;
    case "STORE_LEDGER":
      delegate = prisma.dataCenterStoreDaily;
      where = storeId !== null ? { storeId } : {};
      syncedAtField = "apiFetchedAt";
      break;
    case "STORE_ORDER":
    case "PRODUCT_ORDER":
      delegate = prisma.order;
      where = storeId !== null ? { storeId } : {};
      dateField = "store_local_date";
      syncedAtField = "createdAt";
      break;
  }

  const [rangeRowCount, earliest, latest, newest] = await Promise.all([
    delegate.count({ where: { ...where, [dateField]: requestedRange } }),
    delegate.findFirst({ where, orderBy: { [dateField]: "asc" }, select: { [dateField]: true } }),
    delegate.findFirst({ where, orderBy: { [dateField]: "desc" }, select: { [dateField]: true } }),
    syncedAtField
      ? delegate.findFirst({ where, orderBy: { [syncedAtField]: "desc" }, select: { [syncedAtField]: true } })
      : Promise.resolve(null)
  ]);

  return {
    rangeRowCount,
    earliestAvailableDate: dateOnly(earliest?.[dateField]),
    latestAvailableDate: dateOnly(latest?.[dateField]),
    asOfTime: formatBusinessAsOf(newest?.[syncedAtField || ""])
  };
}

export async function getDataSourceCoverage(query: DataCoverageQuery): Promise<DataSourceCoverage> {
  const scopeKey = buildCoverageScopeKey(query);
  const [facts, sync] = await Promise.all([
    queryFactRange(query),
    resolveSyncReceipt(query, scopeKey)
  ]);
  return resolveDataCoverageStatus({
    source: query.source,
    scopeKey,
    requestedStartDate: query.requestedStartDate,
    requestedEndDate: query.requestedEndDate,
    earliestAvailableDate: facts.earliestAvailableDate,
    latestAvailableDate: facts.latestAvailableDate,
    rangeRowCount: facts.rangeRowCount,
    structureRowCount: query.structureRowCount || 0,
    syncEvidence: sync.evidence,
    syncRunning: sync.running,
    truncated: sync.evidenceTruncated,
    coverageComplete: sync.evidence ? sync.evidenceCoverageComplete : undefined,
    asOfTime: facts.asOfTime || sync.asOfTime
  });
}

export async function getCoverageMap(
  queries: Record<string, DataCoverageQuery>
): Promise<Record<string, DataSourceCoverage>> {
  const entries = await Promise.all(
    Object.entries(queries).map(async ([key, query]) => [key, await getDataSourceCoverage(query)] as const)
  );
  return Object.fromEntries(entries);
}
