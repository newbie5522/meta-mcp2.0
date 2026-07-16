import axios from "axios";
import prisma from "../../db/index.js";
import { getMetaToken, getNumericAccountId, normalizeMetaAccountId } from "../utils.js";
import {
  deriveCanonicalSyncStatus,
  type CanonicalSyncStatus,
  type SyncExecutionResult
} from "../types/sync-tasks.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AudienceDimension = "country" | "age" | "gender" | "publisher_platform";

export interface FailedAudienceSlice {
  accountId?: string;
  dimension?: string;
  page?: number;
  message: string;
  code?: string | number;
  fbtraceId?: string;
  transient?: boolean;
  truncated?: boolean;
}

export interface AudienceEdgeReceipt {
  rows: any[];
  failedSlices: FailedAudienceSlice[];
  truncated: boolean;
  coverageComplete: boolean;
}

function errorDetail(error: any) {
  const apiError = error?.response?.data?.error || {};
  return {
    message: String(apiError.message || error?.message || "Unknown Meta API error"),
    code: apiError.code ?? error?.code,
    subcode: apiError.error_subcode,
    fbtraceId: apiError.fbtrace_id
  };
}

function isTransientError(detail: ReturnType<typeof errorDetail>) {
  const message = detail.message.toLowerCase();
  return detail.code === 1 || detail.subcode === 99 || message.includes("unknown error") ||
    message.includes("timeout") || message.includes("temporar");
}

export async function fetchAudienceBreakdownEdges(
  path: string,
  params: Record<string, any>,
  token: string,
  maxPages = 10
): Promise<AudienceEdgeReceipt> {
  const url = `https://graph.facebook.com/v19.0${path}`;
  const rows: any[] = [];
  const failedSlices: FailedAudienceSlice[] = [];
  const activeParams = { ...params };
  let after: string | undefined;
  let hasNextPage = false;

  for (let page = 0; page < maxPages; page++) {
    let response: any = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < 5 && !response; attempt++) {
      try {
        response = await axios.get(url, {
          params: { ...activeParams, access_token: token, after }
        });
      } catch (error: any) {
        lastError = error;
        const detail = errorDetail(error);
        const message = detail.message.toLowerCase();
        const shouldReduce = detail.code === 1 || message.includes("reduce the amount") || message.includes("too much data");
        if (shouldReduce) {
          activeParams.limit = Math.max(100, Math.floor(Number(activeParams.limit || 1000) / 4));
        }
        const rateLimited = [4, 17, 341].includes(Number(detail.code)) ||
          message.includes("rate limit") || message.includes("too many requests");
        if (attempt < 4) await delay(rateLimited ? 15000 : Math.min(5000, (attempt + 1) * 1000));
      }
    }

    if (!response) {
      const detail = errorDetail(lastError);
      if (!isTransientError(detail)) throw lastError;
      failedSlices.push({
        page: page + 1,
        message: detail.message,
        code: detail.code,
        fbtraceId: detail.fbtraceId,
        transient: true
      });
      return { rows, failedSlices, truncated: false, coverageComplete: false };
    }

    rows.push(...(response.data?.data || []));
    after = response.data?.paging?.cursors?.after;
    hasNextPage = Boolean(after && response.data?.paging?.next);
    if (!hasNextPage) {
      return { rows, failedSlices, truncated: false, coverageComplete: true };
    }
  }

  if (hasNextPage) {
    failedSlices.push({
      page: maxPages,
      message: `Pagination stopped at maxPages=${maxPages} while a next page remained.`,
      truncated: true
    });
  }
  return {
    rows,
    failedSlices,
    truncated: hasNextPage,
    coverageComplete: !hasNextPage
  };
}

export interface AudienceSyncResult extends SyncExecutionResult {
  success: boolean;
  status: CanonicalSyncStatus;
  reason: string | null;
  message: string;
  accountsSynced: number;
  targetAccountsCount: number;
  dimensionsRequested: string[];
  dimensionsSynced: string[];
  failedAccounts: Array<{
    accountId: string;
    dimension?: string;
    message: string;
    code?: string | number;
    fbtraceId?: string;
  }>;
  failedSlices: FailedAudienceSlice[];
}

export async function syncMetaAudienceBreakdown(options: {
  startDate: string;
  endDate: string;
  storeId?: number | null;
  accountIds?: string[];
  dimensions?: AudienceDimension[];
  includeUnmapped?: boolean;
  maxPages?: number;
}): Promise<AudienceSyncResult> {
  const {
    startDate,
    endDate,
    storeId,
    accountIds,
    dimensions,
    includeUnmapped = true,
    maxPages = 10
  } = options;
  const activeDimensions: AudienceDimension[] = dimensions?.length
    ? dimensions
    : ["country", "age", "gender", "publisher_platform"];
  const token = await getMetaToken();
  if (!token) throw new Error("Missing Meta API OAuth token. Please configure token first.");

  let queryWhere: any = {};
  if (accountIds?.length) {
    queryWhere.fb_account_id = { in: accountIds.map(normalizeMetaAccountId) };
  } else if (storeId !== null && storeId !== undefined) {
    const targetStoreId = Number(storeId);
    const [mappings, directAccounts] = await Promise.all([
      prisma.accountMapping.findMany({ where: { storeId: targetStoreId } }),
      prisma.adAccount.findMany({ where: { storeId: targetStoreId } })
    ]);
    const targetIds = Array.from(new Set([
      ...mappings.map((mapping) => normalizeMetaAccountId(mapping.fbAccountId)),
      ...directAccounts.map((account) => normalizeMetaAccountId(account.fb_account_id))
    ].filter(Boolean)));
    queryWhere = includeUnmapped
      ? { OR: [{ fb_account_id: { in: targetIds } }, { storeId: targetStoreId }, { storeId: null }] }
      : { OR: [{ fb_account_id: { in: targetIds } }, { storeId: targetStoreId }] };
  } else if (!includeUnmapped) {
    queryWhere.storeId = { not: null };
  }

  const accounts = await prisma.adAccount.findMany({ where: queryWhere, include: { store: true } });
  let recordsFetched = 0;
  let recordsSaved = 0;
  let recordsUpdated = 0;
  let accountsSynced = 0;
  let truncated = false;
  const failedAccounts: AudienceSyncResult["failedAccounts"] = [];
  const failedSlices: FailedAudienceSlice[] = [];
  const dimensionsSynced = new Set<string>();

  for (const account of accounts) {
    const accountId = normalizeMetaAccountId(account.fb_account_id);
    const numericAccountId = getNumericAccountId(account.fb_account_id);
    let accountComplete = true;

    for (const dimension of activeDimensions) {
      try {
        const receipt = await fetchAudienceBreakdownEdges(`/act_${numericAccountId}/insights`, {
          level: "account",
          time_increment: 1,
          time_range: JSON.stringify({ since: startDate, until: endDate }),
          breakdowns: dimension,
          fields: "account_id,account_name,date_start,date_stop,spend,impressions,reach,clicks,cpc,cpm,ctr,actions,action_values",
          limit: 1000
        }, token, maxPages);
        recordsFetched += receipt.rows.length;
        truncated ||= receipt.truncated;
        if (!receipt.coverageComplete) accountComplete = false;
        failedSlices.push(...receipt.failedSlices.map((slice) => ({ ...slice, accountId, dimension })));
        if (receipt.coverageComplete) dimensionsSynced.add(dimension);

        for (const row of receipt.rows) {
          const date = row.date_start;
          const dimensionValue = String(row[dimension] || "");
          if (!date || !dimensionValue) continue;
          const purchases = Array.isArray(row.actions)
            ? Number(row.actions.find((action: any) => [
                "purchase",
                "offsite_conversion.fb_pixel_purchase",
                "onsite_conversion.purchase",
                "omni_purchase"
              ].includes(action.action_type))?.value || 0)
            : 0;
          const purchaseValue = Array.isArray(row.action_values)
            ? Number(row.action_values.find((action: any) => [
                "purchase",
                "offsite_conversion.fb_pixel_purchase",
                "onsite_conversion.purchase",
                "omni_purchase"
              ].includes(action.action_type))?.value || 0)
            : 0;
          const key = {
            date,
            level: "account",
            account_id: accountId,
            dimension_type: dimension,
            dimension_value: dimensionValue,
            dimension_value_secondary: "",
            campaign_id: "",
            adset_id: "",
            ad_id: ""
          };
          const existing = await prisma.factAudienceBreakdown.findUnique({
            where: { date_level_account_id_dimension_type_dimension_value_dimensi_key: key }
          });
          if (existing) recordsUpdated++;
          await prisma.factAudienceBreakdown.upsert({
            where: { date_level_account_id_dimension_type_dimension_value_dimensi_key: key },
            update: {
              ...key,
              spend: Number(row.spend || 0),
              impressions: Number(row.impressions || 0),
              clicks: Number(row.clicks || 0),
              purchases,
              purchase_value: purchaseValue,
              synced_at: new Date(),
              raw_payload: JSON.stringify(row)
            },
            create: {
              ...key,
              spend: Number(row.spend || 0),
              impressions: Number(row.impressions || 0),
              clicks: Number(row.clicks || 0),
              purchases,
              purchase_value: purchaseValue,
              synced_at: new Date(),
              raw_payload: JSON.stringify(row)
            }
          });
          recordsSaved++;
        }
      } catch (error: any) {
        accountComplete = false;
        const detail = errorDetail(error);
        failedAccounts.push({
          accountId,
          dimension,
          message: detail.message,
          code: detail.code,
          fbtraceId: detail.fbtraceId
        });
      }
    }
    if (accountComplete) accountsSynced++;
  }

  const status = deriveCanonicalSyncStatus({
    recordsFetched,
    recordsSaved,
    recordsUpdated,
    failedAccounts,
    failedSlices,
    truncated
  });
  const coverageComplete = accounts.length > 0 && status !== "FAILED" && status !== "PARTIAL_SUCCESS" && !truncated;
  const reason = status === "FAILED"
    ? "AUDIENCE_BREAKDOWN_SYNC_FAILED"
    : status === "PARTIAL_SUCCESS"
      ? "AUDIENCE_BREAKDOWN_PARTIAL"
      : status === "NO_NEW_DATA"
        ? accounts.length === 0 ? "NO_TARGET_ACCOUNTS" : "NO_AUDIENCE_BREAKDOWN_ROWS"
        : null;

  return {
    success: status !== "FAILED",
    status,
    reason,
    message: status === "FAILED"
      ? "Meta 受众 breakdown 同步失败。"
      : status === "PARTIAL_SUCCESS"
        ? "Meta 受众 breakdown 仅完成部分范围。"
        : status === "NO_NEW_DATA"
          ? "Meta API 当前日期范围未返回受众 breakdown 数据。"
          : "Meta 受众 breakdown 同步完成。",
    recordsFetched,
    recordsSaved,
    recordsUpdated,
    accountsSynced,
    targetAccountsCount: accounts.length,
    dimensionsRequested: activeDimensions,
    dimensionsSynced: Array.from(dimensionsSynced),
    failedAccounts,
    failedSlices,
    truncated,
    coverageComplete
  };
}
