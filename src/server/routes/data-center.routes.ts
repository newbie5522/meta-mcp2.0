// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { getProductIntelligence } from "../services/product-intelligence.service.js";
import { getAggregatedCreativeInsights } from "../services/creative-insights.service.js";
import { analyzeCreativeScope } from "../services/creative-analysis.service.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getCountryAnalytics } from "../services/country-analytics.service.js";
import { classifyOrderValidity, getStoreOrderFacts, getStoreOrderSummary } from "../services/order-fact.service.js";
import { getMetaAccountPerformanceFacts, getMetaPerformanceSummary } from "../services/meta-performance-fact.service.js";
import { getAccountMappingFacts, resolveAccountStoreBinding } from "../services/mapping-fact.service.js";
import { runDataPipelineAudit } from "../services/data-pipeline-audit.service.js";
import { runDataCenterAudit } from "../services/data-center-audit.service.js";
import { runDataCenterRebuild } from "../services/data-center-rebuild.service.js";
import { getFreshnessMeta } from "../services/data-center-auto-refresh.service.js";
import { getDataSourceCoverage, getCoverageMap } from "../services/data-coverage.service.js";
import { getCanonicalAdHierarchy } from "../services/ad-hierarchy.service.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const router = Router();
const DATA_CENTER_TIMEZONE = "America/Los_Angeles";

function isDemoDataEnabled(): boolean {
  return process.env.ENABLE_DEMO_DATA === "true";
}

function toStoreInventoryDto(store: any) {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform,
    domain: store.domain,
    timezone: store.timezone,
    mode: store.mode,
    hasShoplineToken: Boolean(store.shopline_token),
    hasShopifyToken: Boolean(store.shopify_token),
    hasShoplazzaToken: Boolean(store.shoplazza_token),
    createdAt: store.createdAt,
    updatedAt: store.updatedAt
  };
}

function toAccountInventoryDto(account: any) {
  return {
    id: account.id,
    accountId: normalizeMetaAccountId(account.fb_account_id),
    fb_account_id: normalizeMetaAccountId(account.fb_account_id),
    fb_account_name: account.fb_account_name,
    storeId: account.storeId || null,
    activityStatus: account.activityStatus,
    status: account.status,
    recentActivity90d: Boolean(account.recentActivity90d),
    currency: account.currency,
    timezone: account.timezone,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  return dayjs(value.trim(), "YYYY-MM-DD", true).isValid();
}

function getAppliedDateRange(query: any, fallbackDays = 30) {
  const fallbackEnd = dayjs().tz(DATA_CENTER_TIMEZONE).format("YYYY-MM-DD");
  const fallbackStart = dayjs().tz(DATA_CENTER_TIMEZONE).subtract(fallbackDays - 1, "day").format("YYYY-MM-DD");
  const startStr = isValidDateString(String(query.startDate || "")) ? String(query.startDate).trim() : fallbackStart;
  const endStr = isValidDateString(String(query.endDate || "")) ? String(query.endDate).trim() : fallbackEnd;

  return {
    startStr,
    endStr
  };
}

function buildAppliedFilters(input: {
  startStr: string;
  endStr: string;
  storeId?: any;
  accountId?: any;
  selectedAccount?: any;
  dimensionType?: any;
}) {
  return {
    startDate: input.startStr,
    endDate: input.endStr,
    timezone: DATA_CENTER_TIMEZONE,
    storeId: input.storeId && input.storeId !== "undefined" && input.storeId !== "null" ? input.storeId : "all",
    accountId: input.accountId || input.selectedAccount || "all",
    dimensionType: input.dimensionType || undefined
  };
}

function buildDateRange(startStr: string, endStr: string) {
  return {
    startDate: startStr,
    endDate: endStr,
    timezone: DATA_CENTER_TIMEZONE
  };
}

function normalizeStoreIdFilter(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function scopedStoreOrderKey(storeId: number, order: any) {
  const orderId = order?.orderId !== null && order?.orderId !== undefined && String(order.orderId).trim()
    ? String(order.orderId).trim()
    : String(order?.id || "").trim();
  return orderId ? `store:${Number(storeId)}:order:${orderId}` : "";
}

function scopedStoreOrderSnapshotKey(storeId: number, date: unknown, orderId: unknown) {
  const normalizedDate = String(date || "").trim();
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) return "";
  const scopedOrderId = normalizedOrderId.startsWith(`store:${Number(storeId)}:order:`)
    ? normalizedOrderId
    : `store:${Number(storeId)}:order:${normalizedOrderId}`;
  return normalizedDate ? `store:${Number(storeId)}:date:${normalizedDate}:order:${scopedOrderId}` : scopedOrderId;
}

function parseLedgerOrderIds(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return parsed.map(id => String(id)).filter(Boolean);
    if (Array.isArray(parsed?.orderIds)) return parsed.orderIds.map((id: unknown) => String(id)).filter(Boolean);
    if (Array.isArray(parsed?.orders)) {
      return parsed.orders
        .map((order: any) => order?.orderId || order?.id)
        .filter(Boolean)
        .map((id: unknown) => String(id));
    }
  } catch {
    return [];
  }
  return [];
}

function roundCurrency(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function isConfirmedPaidSalesOrder(row: any, platform: string | null | undefined) {
  return classifyOrderValidity({
    platform: platform || row?.storePlatform || row?.platform || null,
    paymentStatus: row?.paymentStatus,
    fulfillmentStatus: row?.fulfillmentStatus,
    cancelledAt: row?.cancelledAt,
    paidAt: row?.paidAt ?? row?.paid_at ?? row?.rawPaidAt ?? row?.created_at_utc
  }).valid;
}

function coverageMetric(coverage: any, value: number) {
  return ["READY", "PARTIAL_COVERAGE", "TRUE_EMPTY"].includes(String(coverage?.status || ""))
    ? value
    : null;
}

function parseJsonObject(value: unknown): any {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function storeMetric(coverage: any, value: number) {
  const status = String(coverage?.status || "").toUpperCase();
  if (["READY", "COVERED", "PARTIAL_COVERAGE", "PARTIAL_SUCCESS", "TRUE_EMPTY"].includes(status)) return value;
  if ((status === "SYNC_RUNNING" || status === "RUNNING") && coverage?.allowCurrentFactsWhileRunning === true) return value;
  return null;
}

export function buildStoreApiDisplayMetrics(input: {
  orderCount: number;
  revenue: number;
  adSpend: number;
  storeCoverage: any;
  metaCoverage: any;
}) {
  const visibleOrderCount = storeMetric(input.storeCoverage, input.orderCount);
  const visibleRevenue = storeMetric(input.storeCoverage, Number(input.revenue.toFixed(2)));
  const visibleAdSpend = storeMetric(input.metaCoverage, Number(input.adSpend.toFixed(2)));
  const visibleAov =
    visibleOrderCount === null || visibleRevenue === null
      ? null
      : visibleOrderCount > 0
        ? Number((visibleRevenue / visibleOrderCount).toFixed(2))
        : 0;
  const roas =
    visibleRevenue !== null && visibleAdSpend !== null && visibleAdSpend > 0
      ? Number((visibleRevenue / visibleAdSpend).toFixed(4))
      : null;

  return {
    visibleOrderCount,
    visibleRevenue,
    visibleAov,
    visibleAdSpend,
    roas,
    hasOrders: visibleOrderCount === null ? null : visibleOrderCount > 0
  };
}

export function buildStoreTimezoneDisplay(input: {
  store: any;
  storeRows: any[];
}) {
  const rows = Array.isArray(input.storeRows) ? input.storeRows : [];
  const latestRow = rows
    .slice()
    .sort((a, b) => new Date(b?.apiFetchedAt || 0).getTime() - new Date(a?.apiFetchedAt || 0).getTime())[0] || null;
  const diagnostics = parseJsonObject(latestRow?.diagnosticsJson);
  const timezone = diagnostics?.timezone || diagnostics?.diagnostics?.timezoneAfter || latestRow?.timezone || input.store?.timezone || null;
  const timezoneSource = diagnostics?.timezoneSource || diagnostics?.diagnostics?.timezoneSource || null;
  const temporaryTimezoneFallback =
    diagnostics?.temporaryTimezoneFallback === true ||
    diagnostics?.diagnostics?.temporaryTimezoneFallback === true ||
    timezoneSource === "system_default";

  return {
    timezone,
    timezoneSource,
    temporaryTimezoneFallback,
    timezoneNotice: temporaryTimezoneFallback
      ? "店铺未提供时区，当前按系统时区统计。"
      : null
  };
}

export function reconcileAudienceCoverageWithFactRows(coverage: any, dbRows: any[]) {
  const rows = Array.isArray(dbRows) ? dbRows : [];
  const rowDates = rows
    .map(row => String(row?.date || ""))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  const factRowCount = rows.length;
  const status = String(coverage?.status || "").toUpperCase();
  const earliestFromRows = rowDates[0] || coverage?.earliestAvailableDate || null;
  const latestFromRows = rowDates[rowDates.length - 1] || coverage?.latestAvailableDate || null;
  const base = {
    ...(coverage || {}),
    rangeRowCount: factRowCount,
    earliestAvailableDate: earliestFromRows,
    latestAvailableDate: latestFromRows
  };

  if (factRowCount <= 0 || status === "ERROR") {
    return {
      ...base,
      allowCurrentFactsWhileRunning: false
    };
  }

  if (status === "SYNC_RUNNING") {
    return {
      ...base,
      message: "Current audience sync is running; rendering current persisted facts.",
      allowCurrentFactsWhileRunning: true
    };
  }

  if (status === "READY" || status === "PARTIAL_COVERAGE") {
    return {
      ...base,
      allowCurrentFactsWhileRunning: false
    };
  }

  if (status === "NOT_SYNCED" || status === "TRUE_EMPTY") {
    return {
      ...base,
      status: "PARTIAL_COVERAGE",
      structureRowCount: Math.max(Number(coverage?.structureRowCount || 0), factRowCount),
      explicitRangeSyncSuccess: false,
      coverageComplete: false,
      coverageBasis: "FACT_ROWS_ONLY",
      message: "Audience facts exist for this request; coverage was reconciled to partial coverage.",
      allowCurrentFactsWhileRunning: false
    };
  }

  return {
    ...base,
    status: "PARTIAL_COVERAGE",
    structureRowCount: Math.max(Number(coverage?.structureRowCount || 0), factRowCount),
    explicitRangeSyncSuccess: false,
    coverageComplete: false,
    coverageBasis: "FACT_ROWS_ONLY",
    allowCurrentFactsWhileRunning: false
  };
}

export function reconcileCoverageWithVisibleRows(coverage: any, visibleRows: any[], options: {
  coverageBasis: string;
  message: string;
}) {
  const rows = Array.isArray(visibleRows) ? visibleRows : [];
  const status = String(coverage?.status || "").toUpperCase();
  const base = {
    ...(coverage || {}),
    rangeRowCount: rows.length
  };

  if (rows.length <= 0 || status === "ERROR") {
    return {
      ...base,
      allowCurrentFactsWhileRunning: false
    };
  }

  if (status === "NOT_SYNCED" || status === "TRUE_EMPTY" || !status) {
    return {
      ...base,
      status: "PARTIAL_COVERAGE",
      coverageComplete: false,
      coverageBasis: options.coverageBasis,
      message: options.message,
      allowCurrentFactsWhileRunning: false
    };
  }

  if (status === "SYNC_RUNNING" || status === "RUNNING") {
    return {
      ...base,
      message: coverage?.message || "Current facts are available while sync is running.",
      allowCurrentFactsWhileRunning: true
    };
  }

  return {
    ...base,
    allowCurrentFactsWhileRunning: false
  };
}

function audienceRowsRenderable(coverage: any, hasCurrentFacts: boolean) {
  const status = String(coverage?.status || "").toUpperCase();
  if (!hasCurrentFacts) return false;
  if (status === "READY" || status === "COVERED" || status === "PARTIAL_COVERAGE" || status === "PARTIAL_SUCCESS") return true;
  if (status === "SYNC_RUNNING" || status === "RUNNING") return coverage?.allowCurrentFactsWhileRunning === true;
  return false;
}

export function audienceMetaMetric(
  coverage: any,
  hasCurrentFacts: boolean,
  value: number | null,
  mode: "additive" | "ratio" = "additive"
) {
  const status = String(coverage?.status || "").toUpperCase();
  if (status === "TRUE_EMPTY") return mode === "additive" ? 0 : null;
  if (!hasCurrentFacts) return null;
  if (value === null || value === undefined) return null;
  if (status === "READY" || status === "COVERED" || status === "PARTIAL_COVERAGE" || status === "PARTIAL_SUCCESS") return value;
  if ((status === "SYNC_RUNNING" || status === "RUNNING") && coverage?.allowCurrentFactsWhileRunning === true) return value;
  return null;
}

export function buildAudienceMetaSummaryFromVisibleRows(
  visibleRows: any[],
  coverage: any,
  hasCurrentFacts: boolean
) {
  const rows = Array.isArray(visibleRows) ? visibleRows : [];
  const spend = Number(rows.reduce((sum, row) => sum + Number(row.spend || 0), 0).toFixed(4));
  const impressions = rows.reduce((sum, row) => sum + Number(row.impressions || 0), 0);
  const clicks = rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
  const purchases = rows.reduce((sum, row) => sum + Number(row.purchases || 0), 0);
  const purchaseValue = Number(rows.reduce((sum, row) => sum + Number(row.purchaseValue || 0), 0).toFixed(4));
  const ctr = impressions > 0 ? Number((clicks / impressions).toFixed(6)) : null;
  const cpc = clicks > 0 ? Number((spend / clicks).toFixed(4)) : null;
  const cpm = impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(4)) : null;
  const cpa = purchases > 0 ? Number((spend / purchases).toFixed(4)) : null;
  const roas = spend > 0 ? Number((purchaseValue / spend).toFixed(4)) : null;

  const meta = {
    spend: audienceMetaMetric(coverage, hasCurrentFacts, spend, "additive"),
    impressions: audienceMetaMetric(coverage, hasCurrentFacts, impressions, "additive"),
    clicks: audienceMetaMetric(coverage, hasCurrentFacts, clicks, "additive"),
    purchases: audienceMetaMetric(coverage, hasCurrentFacts, purchases, "additive"),
    purchaseValue: audienceMetaMetric(coverage, hasCurrentFacts, purchaseValue, "additive"),
    roas: audienceMetaMetric(coverage, hasCurrentFacts, roas, "ratio"),
    ctr: audienceMetaMetric(coverage, hasCurrentFacts, ctr, "ratio"),
    cpc: audienceMetaMetric(coverage, hasCurrentFacts, cpc, "ratio"),
    cpm: audienceMetaMetric(coverage, hasCurrentFacts, cpm, "ratio"),
    cpa: audienceMetaMetric(coverage, hasCurrentFacts, cpa, "ratio")
  };

  return {
    totalSpend: meta.spend,
    totalImpressions: meta.impressions,
    totalClicks: meta.clicks,
    totalPurchases: meta.purchases,
    totalPurchaseValue: meta.purchaseValue,
    ctr: meta.ctr,
    cpc: meta.cpc,
    cpm: meta.cpm,
    cpa: meta.cpa,
    roas: meta.roas,
    meta
  };
}

function countryMetaMetric(
  coverage: any,
  hasMetaFacts: boolean,
  value: number
) {
  const status = String(coverage?.status || "").toUpperCase();

  if (status === "TRUE_EMPTY") return 0;
  if (status === "READY") return hasMetaFacts ? value : 0;
  if (status === "PARTIAL_COVERAGE") return hasMetaFacts ? value : null;
  return null;
}

function queryFlag(value: unknown, fallback = false) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function isSpecificFilter(value: unknown) {
  return Boolean(value && value !== "all" && value !== "undefined" && value !== "null");
}

function resolveDataScope(input: {
  scope?: string;
  storeId?: unknown;
  accountId?: unknown;
  mappedOnly?: boolean;
}) {
  if (input.scope) return input.scope;
  if (isSpecificFilter(input.accountId)) return "current_account";
  if (isSpecificFilter(input.storeId)) return "current_store";
  if (input.mappedOnly) return "mapped_store_accounts";
  return "all_accounts";
}

function buildQueryDebug(input: {
  source: string;
  scope?: string;
  includeUnmapped?: boolean;
  includeZeroSpend?: boolean;
  mappedOnly?: boolean;
  storeId?: unknown;
  accountId?: unknown;
  factRows?: number;
  structureRows?: number;
}) {
  const mappedOnly = Boolean(input.mappedOnly);
  const includeUnmapped = input.includeUnmapped ?? !mappedOnly;
  return {
    source: input.source,
    scope: resolveDataScope({
      scope: input.scope,
      storeId: input.storeId,
      accountId: input.accountId,
      mappedOnly
    }),
    includeUnmapped,
    includeZeroSpend: Boolean(input.includeZeroSpend),
    mappedOnly,
    storeId: isSpecificFilter(input.storeId) ? input.storeId : "all",
    accountId: isSpecificFilter(input.accountId) ? normalizeMetaAccountId(String(input.accountId)) : "all",
    factRows: Number(input.factRows || 0),
    structureRows: Number(input.structureRows || 0)
  };
}

function buildDataScope(input: {
  page: string;
  primarySource: string;
  metaScope?: string;
  storeScope?: string;
  dateField?: string | Record<string, string>;
  includeUnmapped?: boolean;
  includeZeroSpend?: boolean;
  mappedOnly?: boolean;
  storeId?: unknown;
  accountId?: unknown;
  scope?: string;
}) {
  const mappedOnly = Boolean(input.mappedOnly);
  return {
    page: input.page,
    primarySource: input.primarySource,
    metaScope: input.metaScope || "",
    storeScope: input.storeScope || "",
    dateField: input.dateField || "date",
    timezone: DATA_CENTER_TIMEZONE,
    includeUnmapped: input.includeUnmapped ?? !mappedOnly,
    includeZeroSpend: Boolean(input.includeZeroSpend),
    mappedOnly,
    storeId: isSpecificFilter(input.storeId) ? input.storeId : "all",
    accountId: isSpecificFilter(input.accountId) ? normalizeMetaAccountId(String(input.accountId)) : "all",
    scope: resolveDataScope({
      scope: input.scope,
      storeId: input.storeId,
      accountId: input.accountId,
      mappedOnly
    })
  };
}

/**
 * GET /api/data-center/detail
 * Returns raw advertising and order details, filters list, and health metrics.
 * Refactored to aggregate Meta insights by ad account in the chosen date range.
 */
router.get("/detail", async (req, res) => {
  const { startDate, endDate, storeId, accountId, includeLegacyFallback } = req.query;

  try {
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const allowLegacyFallback = includeLegacyFallback === "true";
    const appliedFilters = buildAppliedFilters({ startStr, endStr, storeId, accountId });
    const detailCoverage = await getCoverageMap({
      metaCoverage: {
        source: "META_ACCOUNT",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: storeId as any,
        accountId: accountId ? String(accountId) : null
      },
      storeCoverage: {
        source: "STORE_ORDER",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: storeId as any
      }
    });

    // 1. Fetch available filters
    let [stores, adAccounts, accountMappings] = await Promise.all([
      prisma.store.findMany({ select: { id: true, name: true, platform: true, mode: true, domain: true } }),
      prisma.adAccount.findMany({ select: { fb_account_id: true, fb_account_name: true, storeId: true } }),
      prisma.accountMapping.findMany()
    ]);

    if (!isDemoDataEnabled()) {
      stores = stores.filter(store => 
        store.mode !== "sandbox" &&
        !["Shopline Fashion Store", "Shopify Electronics Hub", "Shoplazza Home Decor"].includes(store.name) &&
        !["fashion.shoplineapp.com", "electronics.myshopify.com", "decor.shoplazza.com"].includes(store.domain)
      );
      const productionStoreIds = new Set(stores.map(s => s.id));
      adAccounts = adAccounts.filter(acc => 
        !acc.storeId || productionStoreIds.has(acc.storeId)
      );
    }

    // 2. Fetch Sync Status / Health Indicators
    const lastSyncLog = await prisma.syncLog.findFirst({
      orderBy: { startedAt: "desc" }
    });

    const isSyncActive = await prisma.syncLog.count({
      where: { status: "running" }
    }) > 0;

    // 3. Query through MetaPerformanceFactService
    const rawPerf = await getMetaAccountPerformanceFacts({
      startDate: startStr,
      endDate: endStr,
      accountId: accountId ? String(accountId) : undefined,
    });

    const rawInsights = rawPerf.map(p => ({
      id: String(p.id),
      accountId: p.account_id,
      date: p.date,
      spend: p.spend,
      impressions: p.impressions,
      clicks: p.clicks,
      purchases: p.purchases,
      purchaseValue: p.purchase_value,
      ctr: p.ctr,
      cpc: p.cpc,
      cpm: p.cpm,
      roas: p.roas
    }));

    // 4. Query through OrderFactService
    const orderSummary = await getStoreOrderSummary({
      startDate: startStr,
      endDate: endStr,
      storeId: storeId ? String(storeId) : undefined,
      includeLegacyCreatedAtFallback: allowLegacyFallback,
    });
    const rawOrders = orderSummary.orders;

    // 5. Evaluate Data Health using facts
    let dataHealth = "EXCELLENT";
    let missingReason = "";

    if (stores.length === 0 && adAccounts.length === 0) {
      dataHealth = "EMPTY_CONFIG";
      missingReason = "No Store or AdAccount inventory has been configured.";
    } else if (rawInsights.length === 0 && rawOrders.length === 0) {
      dataHealth = "EMPTY_FACTS";
      missingReason = "数据库中暂未发现对应的 Meta Insights 或 店铺 Order 数据。请检查授权并触发一次同步中心同步。";
    } else if (rawInsights.length === 0) {
      dataHealth = "WARNING";
      missingReason = "店铺有订单流，但未拉取到对应的 Meta 广告成效，无法联合计算精准的每日总 ROAS。";
    } else if (rawOrders.length === 0) {
      dataHealth = "WARNING";
      missingReason = "已保存 Meta 广告展现开销，但未获取到关联店铺的销售流水。请在配置中心配置 Shopline / Shopify 授权。";
    }

    // 6. Aggregate insights by ad account for "账户表现" dashboard
    const accountsWithStore = await prisma.adAccount.findMany({
      include: { store: true }
    });

    const detailedAccounts = await Promise.all(accountsWithStore.map(async (acc) => {
      const normAccId = normalizeMetaAccountId(acc.fb_account_id);
      const matchedInsights = rawInsights.filter(ins => {
        return normalizeMetaAccountId(ins.accountId) === normAccId;
      });

      const spend = matchedInsights.reduce((s, item) => s + (item.spend || 0), 0);
      const impressions = matchedInsights.reduce((s, item) => s + (item.impressions || 0), 0);
      const reach = null;
      const clicks = matchedInsights.reduce((s, item) => s + (item.clicks || 0), 0);
      const addToCart = 0; // Removed from schema, keeping 0 for API contract
      const purchases = matchedInsights.reduce((s, item) => s + (item.purchases || 0), 0);
      const purchaseValue = matchedInsights.reduce((s, item) => s + (item.purchaseValue || 0), 0);

      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
      const cpa = purchases > 0 ? spend / purchases : 0;
      const roas = spend > 0 ? purchaseValue / spend : 0;

      return {
        id: acc.id,
        fb_account_id: acc.fb_account_id,
        fb_account_name: acc.fb_account_name || "未命名关联账户",
        storeName: acc.store?.name || "未绑定店铺",
        currency: acc.currency || "USD",
        timezone: acc.timezone || "America/Los_Angeles",
        status: acc.status || "UNKNOWN",
        recentActivity90d: acc.recentActivity90d,
        spend,
        impressions,
        reach,
        reachSource: "not_available",
        clicks,
        ctr,
        cpc,
        cpm,
        addToCart,
        purchases,
        cpa,
        roas,
        lastSyncTime: acc.updatedAt || null,
        healthStatus: matchedInsights.length > 0 ? "EXCELLENT" : "WARNING"
      };
    }));

    // Apply store filter on aggregated accounts if requested
    let filteredDetailedAccounts = detailedAccounts;
    if (storeId && storeId !== "all") {
      const sIdInt = Number(storeId);
      const targetStore = stores.find(s => s.id === sIdInt);
      const storeName = targetStore ? targetStore.name : "";
      filteredDetailedAccounts = detailedAccounts.filter(a => a.storeName === storeName);
    }

    const accountsInventoryCount = adAccounts.length;
    const accountsInventory = adAccounts.map(toAccountInventoryDto);
    const accountsWithFactsCount = new Set(rawInsights.map(ins => normalizeMetaAccountId(ins.accountId))).size;
    const accountsWithSpendCount = new Set(rawInsights.filter(ins => (ins.spend || 0) > 0).map(ins => normalizeMetaAccountId(ins.accountId))).size;
    const storesInventoryCount = stores.length;
    const storesInventory = stores.map(toStoreInventoryDto);
    const storesWithOrdersCount = new Set(rawOrders.map(order => order.storeId).filter(Boolean)).size;

    res.json({
      coverage: detailCoverage.metaCoverage,
      sourceCoverage: detailCoverage.metaCoverage,
      metaCoverage: detailCoverage.metaCoverage,
      storeCoverage: detailCoverage.storeCoverage,
      metaInsights: rawInsights,
      accounts: filteredDetailedAccounts,
      orders: rawOrders,
      accountsInventoryCount,
      accountsInventory,
      accountsWithFactsCount,
      accountsWithSpendCount,
      storesInventoryCount,
      storesInventory,
      storesWithOrdersCount,
      ordersCount: rawOrders.length,
      metaFactsCount: rawInsights.length,
      syncStatus: {
        isSyncActive,
        status: isSyncActive ? "running" : (lastSyncLog?.status || "none"),
        lastSyncTime: lastSyncLog?.finishedAt || lastSyncLog?.startedAt || null,
        lastSyncTaskType: lastSyncLog?.taskType || lastSyncLog?.type || null
      },
      lastSyncLog: lastSyncLog ? {
        id: lastSyncLog.id,
        taskType: lastSyncLog.taskType || lastSyncLog.type,
        status: lastSyncLog.status,
        startedAt: lastSyncLog.startedAt,
        finishedAt: lastSyncLog.finishedAt,
        recordsFetched: lastSyncLog.recordsFetched || 0,
        recordsSaved: lastSyncLog.recordsSaved || 0,
        errorMessage: lastSyncLog.errorMessage || lastSyncLog.error || null
      } : null,
      filters: {
        stores: storesInventory,
        adAccounts: accountsInventory,
        mappings: accountMappings
      },
      health: {
        status: dataHealth,
        missingReason,
        lastSyncTime: lastSyncLog?.finishedAt || lastSyncLog?.startedAt || null,
        lastSyncStatus: lastSyncLog?.status || "none",
        isSyncActive
      },
      dataHealth: {
        status: dataHealth,
        missingReason,
        source: "FactMetaPerformance + Order",
        factRows: rawInsights.length,
        structureRows: accountsInventoryCount,
        dateRange: buildDateRange(startStr, endStr),
        queryDebug: buildQueryDebug({
          source: "FactMetaPerformance + Order",
          storeId,
          accountId,
          includeUnmapped: true,
          includeZeroSpend: true,
          mappedOnly: false,
          factRows: rawInsights.length,
          structureRows: accountsInventoryCount
        })
      },
      dataScope: buildDataScope({
        page: "detail",
        primarySource: "FactMetaPerformance + Order",
        metaScope: "Meta account-level facts from FactMetaPerformance.",
        storeScope: "Store orders from Order.store_local_date; legacy createdAt fallback is opt-in only.",
        dateField: {
          meta: "FactMetaPerformance.date",
          store: "Order.store_local_date"
        },
        storeId,
        accountId,
        includeUnmapped: true,
        includeZeroSpend: true,
        mappedOnly: false
      }),
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "FactMetaPerformance + Order",
        noMockData: true,
        orderSource: "Order.store_local_date",
        metaSource: "FactMetaPerformance",
        mappingSource: "AccountMapping + AdAccount"
      },
      debug: process.env.NODE_ENV !== "production" ? {
        legacyCreatedAtFallbackEnabled: allowLegacyFallback,
        legacyCreatedAtFallbackUsed: orderSummary.legacyFallbackUsed
      } : undefined,
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr)
    });

  } catch (error: any) {
    console.error("[Data Center API] Detail error:", error);
    res.status(500).json({ success: false, status: "ERROR", error: "DETAIL_QUERY_FAILED", details: error.message });
  }
});

/**
 * GET /api/data-center/structure
 * Returns Campaign/AdSet/Ad structural hierarchy levels and performance aggregates
 */
router.get("/structure", async (req, res) => {
  const { selectedAccount, accountId, startDate, endDate } = req.query;

  try {
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const targetAccountParam = selectedAccount || accountId;
    const appliedFilters = buildAppliedFilters({ startStr, endStr, selectedAccount: targetAccountParam });

    // Fetch accounts list for switcher
    const accounts = await prisma.adAccount.findMany({
      select: { fb_account_id: true, fb_account_name: true }
    });

    const targetAccount = targetAccountParam ? String(targetAccountParam) : null;
    let structureCoverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      accountId: targetAccount ? String(targetAccount) : null,
      structureRowCount: 0
    });

    if (!targetAccount) {
      return res.json({
        coverage: structureCoverage,
        sourceCoverage: structureCoverage,
        accounts,
        campaigns: [],
        adsets: [],
        ads: [],
        structureRowsCount: 0,
        factRowsCount: 0,
        dataHealth: {
          status: targetAccountParam ? "EMPTY_STRUCTURE" : "ACCOUNT_SELECTION_REQUIRED",
          source: "Campaign + AdSet + Ad + FactMetaPerformance",
          factRows: 0,
          structureRows: 0,
          dateRange: buildDateRange(startStr, endStr),
          queryDebug: buildQueryDebug({
            source: "Campaign + AdSet + Ad + FactMetaPerformance",
            scope: "current_account",
            accountId: targetAccount,
            includeUnmapped: true,
            includeZeroSpend: true,
            mappedOnly: false,
            factRows: 0,
            structureRows: 0
          })
        },
        dataScope: buildDataScope({
          page: "structure",
          primarySource: "Campaign + AdSet + Ad + FactMetaPerformance",
          metaScope: "Ad hierarchy structure plus hierarchy-level Meta facts.",
          storeScope: "Store mapping is filter context only; store orders are not mixed into hierarchy metrics.",
          dateField: "FactMetaPerformance.date",
          accountId: targetAccount,
          includeUnmapped: true,
          includeZeroSpend: true,
          mappedOnly: false,
          scope: "current_account"
        }),
        health: {
          status: targetAccountParam ? "EMPTY_STRUCTURE" : "ACCOUNT_SELECTION_REQUIRED",
          missingReason: targetAccountParam ? "当前账户没有广告结构数据，请先同步广告结构。" : "请选择账户后查看广告结构。"
        },
        appliedFilters,
        dateRange: buildDateRange(startStr, endStr),
        dataSourceExplain: {
          dateFilterApplied: true,
          primarySource: "Campaign + AdSet + Ad + FactMetaPerformance",
          noMockData: true
        }
      });
    }

    // 1. Fetch campaigns
    const rawCampaigns = await prisma.campaign.findMany({
      where: { accountId: targetAccount }
    });
    const campaignIds = rawCampaigns.map(c => c.id);

    // 2. Fetch adsets
    const rawAdsets = await prisma.adSet.findMany({
      where: { campaignId: { in: campaignIds } }
    });
    const adsetIds = rawAdsets.map(s => s.id);

    // 3. Fetch ads
    const rawAds = await prisma.ad.findMany({
      where: { adsetId: { in: adsetIds } }
    });

    // 4. Fetch daily performance rows for metric bindings
    const compPerformance = await prisma.factMetaPerformance.findMany({
      where: {
        level: { in: ["campaign", "adset", "ad"] },
        account_id: targetAccount,
        date: { gte: startStr, lte: endStr }
      }
    });

    // Helper: Aggregate performance from single source of truth FactMetaPerformance
    const getAggregatedMetrics = (scope: string, scopeId: string) => {
      const matched = compPerformance.filter(s => s.level === scope && s.entity_id === scopeId);
      const spend = matched.reduce((a, b) => a + (b.spend || 0), 0);
      const impressions = matched.reduce((a, b) => a + (b.impressions || 0), 0);
      const clicks = matched.reduce((a, b) => a + (b.clicks || 0), 0);
      const purchases = matched.reduce((a, b) => a + (b.purchases || 0), 0);
      const revenue = matched.reduce((a, b) => a + (b.purchase_value || 0), 0);

      const roas = spend > 0 ? revenue / spend : 0;
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
      const cpa = purchases > 0 ? spend / purchases : 0;

      return { spend, impressions, clicks, orders: purchases, purchases, purchaseValue: revenue, purchase_value: revenue, revenue, roas, ctr, cpc, cpm, cpa };
    };

    const campaignsList = rawCampaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status || "UNKNOWN",
      ...getAggregatedMetrics("campaign", c.id)
    }));

    const adsetsList = rawAdsets.map(s => ({
      id: s.id,
      campaignId: s.campaignId,
      name: s.name,
      status: "UNKNOWN",
      ...getAggregatedMetrics("adset", s.id)
    }));

    const adsList = rawAds.map(a => ({
      id: a.id,
      adsetId: a.adsetId,
      campaignId: a.campaignId,
      name: a.name,
      creativeId: a.creativeId,
      status: "UNKNOWN",
      ...getAggregatedMetrics("ad", a.id)
    }));

    const structureRowsCount = rawCampaigns.length + rawAdsets.length + rawAds.length;
    const factRowsCount = compPerformance.length;
    const hasStructure = structureRowsCount > 0;
    structureCoverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      accountId: String(targetAccount),
      structureRowCount: structureRowsCount
    });

    let dataStatus = "OK";
    let missingReason = "";

    if (!hasStructure) {
      dataStatus = "EMPTY_STRUCTURE";
      missingReason = "当前账户没有广告结构数据，请先同步广告结构。";
    } else if (factRowsCount === 0) {
      dataStatus = "STRUCTURE_WITHOUT_FACTS";
      missingReason = "结构已同步，但当前日期范围内没有成效事实数据。请同步广告成效数据，或扩大日期范围。";
    }

    const lastSyncLog = await prisma.syncLog.findFirst({
      where: { taskType: "sync_meta_structure" },
      orderBy: { startedAt: "desc" }
    });

    res.json({
      coverage: structureCoverage,
      sourceCoverage: structureCoverage,
      accounts,
      campaigns: campaignsList,
      adsets: adsetsList,
      ads: adsList,
      structureRowsCount,
      factRowsCount,
      health: {
        status: dataStatus,
        missingReason,
        lastSyncTime: lastSyncLog?.finishedAt || lastSyncLog?.startedAt || null,
        lastSyncStatus: lastSyncLog?.status || "none"
      },
      dataHealth: {
        status: dataStatus,
        source: "Campaign + AdSet + Ad + FactMetaPerformance",
        factRows: factRowsCount,
        structureRows: structureRowsCount,
        dateRange: buildDateRange(startStr, endStr),
        queryDebug: buildQueryDebug({
          source: "Campaign + AdSet + Ad + FactMetaPerformance",
          scope: "current_account",
          accountId: targetAccount,
          includeUnmapped: true,
          includeZeroSpend: true,
          mappedOnly: false,
          factRows: factRowsCount,
          structureRows: structureRowsCount
        })
      },
      dataScope: buildDataScope({
        page: "structure",
        primarySource: "Campaign + AdSet + Ad + FactMetaPerformance",
        metaScope: "Ad hierarchy structure plus hierarchy-level Meta facts.",
        storeScope: "Store mapping is filter context only; store orders are not mixed into hierarchy metrics.",
        dateField: "FactMetaPerformance.date",
        accountId: targetAccount,
        includeUnmapped: true,
        includeZeroSpend: true,
        mappedOnly: false,
        scope: "current_account"
      }),
      appliedFilters: buildAppliedFilters({ startStr, endStr, selectedAccount: targetAccount }),
      dateRange: buildDateRange(startStr, endStr),
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "Campaign + AdSet + Ad + FactMetaPerformance",
        noMockData: true
      }
    });

  } catch (error: any) {
    console.error("[Data Center API] Structure error:", error);
    res.status(500).json({ success: false, status: "ERROR", error: "STRUCTURE_QUERY_FAILED", details: error.message });
  }
});

/**
 * GET /api/data-center/audience
 * Returns real database-integrated breakdown demographic aggregates, filtered by storeId, accountId, campaignId, adsetId, and date range.
 */
router.get("/audience", async (req, res) => {
  const {
    storeId,
    accountId,
    campaignId,
    adsetId,
    adId,
    dimensionType,
    includeZeroSpend,
    minSpend,
    page,
    pageSize,
    sortBy,
    startDate,
    endDate
  } = req.query;

  try {
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const requestedDimType = String(dimensionType || "country");
    const allowedDimensionTypes = ["country", "age", "gender", "publisher_platform"];
    const currentDimType = allowedDimensionTypes.includes(requestedDimType) ? requestedDimType : "country";
    const appliedFilters = buildAppliedFilters({ startStr, endStr, storeId, accountId, dimensionType: currentDimType });
    const audienceCoverage = await getCoverageMap({
      metaCoverage: {
        source: "META_AUDIENCE",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: storeId as any,
        accountId: accountId ? String(accountId) : null,
        dimension: currentDimType
      },
      storeCoverage: {
        source: "STORE_ORDER",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: storeId as any
      }
    });
    const audienceDataScope = buildDataScope({
      page: "audience",
      primarySource: "FactAudienceBreakdown",
      metaScope: "Meta受众 breakdown，花费/展示/点击/购买来自 Meta API",
      storeScope: "店铺订单按收货国家统计，订单数/收入来自订单事实表",
      dateField: {
        meta: "FactAudienceBreakdown.date",
        store: "Order.store_local_date"
      },
      storeId,
      accountId,
      includeUnmapped: true,
      includeZeroSpend: queryFlag(includeZeroSpend),
      mappedOnly: false
    });
    const storeCountryAnalytics = await getCountryAnalytics(
      startStr,
      endStr,
      isSpecificFilter(storeId) ? String(storeId) : undefined,
      0,
      0,
      true
    );
    const buildStoreSummary = () => ({
      orderCount: coverageMetric(audienceCoverage.storeCoverage, Number(storeCountryAnalytics.summary.orderCount || 0)),
      revenue: coverageMetric(audienceCoverage.storeCoverage, Number((storeCountryAnalytics.summary.revenue || 0).toFixed(4))),
      averageOrderValue: coverageMetric(audienceCoverage.storeCoverage, Number((storeCountryAnalytics.summary.averageOrderValue || 0).toFixed(4))),
      countryCount: coverageMetric(audienceCoverage.storeCoverage, Number(storeCountryAnalytics.summary.countryCount || 0))
    });
    const noFactMetaCoverage = reconcileAudienceCoverageWithFactRows(audienceCoverage.metaCoverage, []);
    const emptyMetaSummary = {
      spend: audienceMetaMetric(noFactMetaCoverage, false, 0, "additive"),
      impressions: audienceMetaMetric(noFactMetaCoverage, false, 0, "additive"),
      clicks: audienceMetaMetric(noFactMetaCoverage, false, 0, "additive"),
      purchases: audienceMetaMetric(noFactMetaCoverage, false, 0, "additive"),
      purchaseValue: audienceMetaMetric(noFactMetaCoverage, false, 0, "additive"),
      roas: audienceMetaMetric(noFactMetaCoverage, false, 0, "ratio"),
      ctr: audienceMetaMetric(noFactMetaCoverage, false, 0, "ratio"),
      cpc: audienceMetaMetric(noFactMetaCoverage, false, 0, "ratio"),
      cpm: audienceMetaMetric(noFactMetaCoverage, false, 0, "ratio"),
      cpa: audienceMetaMetric(noFactMetaCoverage, false, 0, "ratio")
    };

    // 1. Store filtering: resolve store mapped accounts
    let filterAccountIds: string[] | null = null;
    if (storeId && storeId !== "all" && storeId !== "undefined") {
      const targetStoreId = Number(storeId);
      const mappings = await prisma.accountMapping.findMany({
        where: { storeId: targetStoreId }
      });
      const mappedFromMapping = mappings.map(m => m.fbAccountId);

      const directAccounts = await prisma.adAccount.findMany({
        where: { storeId: targetStoreId }
      });
      const mappedFromAdAccount = directAccounts.map(a => a.fb_account_id);

      const merged = Array.from(new Set([
        ...mappedFromMapping,
        ...mappedFromAdAccount
      ])).map(id => normalizeMetaAccountId(id));

      filterAccountIds = merged;
    }

    if (accountId && accountId !== "all" && accountId !== "undefined") {
      const normId = normalizeMetaAccountId(String(accountId));
      if (filterAccountIds !== null) {
        filterAccountIds = filterAccountIds.filter(id => id === normId);
      } else {
        filterAccountIds = [normId];
      }
    }

    // Short-circuit if Store filter specified but no accounts map to it
    if (filterAccountIds !== null && filterAccountIds.length === 0) {
      return res.json({
        coverage: noFactMetaCoverage,
        sourceCoverage: noFactMetaCoverage,
        metaCoverage: noFactMetaCoverage,
        storeCoverage: audienceCoverage.storeCoverage,
        rows: [],
        summary,
        dataScope: audienceDataScope,
        filters: { startDate: startStr, endDate: endStr, storeId, accountId, campaignId, adsetId, adId, dimensionType: currentDimType },
        pagination: { page: Number(page || 1), pageSize: Number(pageSize || 50), totalItems: 0, totalPages: 0 },
        dataHealth: {
          status: "MISSING_META_BREAKDOWN",
          warnings,
          missing: ["该店铺未绑定任何广告账户，无法加载广告受众数据。"],
          source: "FactAudienceBreakdown",
          factRows: 0,
          structureRows: 0,
          dateRange: buildDateRange(startStr, endStr),
          queryDebug: buildQueryDebug({
            source: "FactAudienceBreakdown",
            storeId,
            accountId,
            includeUnmapped: true,
            includeZeroSpend: queryFlag(includeZeroSpend),
            mappedOnly: false,
            factRows: 0,
            structureRows: 0
          })
        },
        dataSourceExplain: {
          dateFilterApplied: true,
          primarySource: "FactAudienceBreakdown",
          noMockData: true
        },
        appliedFilters,
        dateRange: buildDateRange(startStr, endStr)
      });
    }

    // 2. Build where clause for FactAudienceBreakdown
    const whereClause: any = {
      date: { gte: startStr, lte: endStr },
      dimension_type: currentDimType
    };

    if (filterAccountIds !== null) {
      whereClause.account_id = { in: filterAccountIds };
    }

    if (campaignId && campaignId !== "all" && campaignId !== "undefined") {
      whereClause.campaign_id = String(campaignId);
    }
    if (adsetId && adsetId !== "all" && adsetId !== "undefined") {
      whereClause.adset_id = String(adsetId);
    }
    if (adId && adId !== "all" && adId !== "undefined") {
      whereClause.ad_id = String(adId);
    }

    // 3. Query FactAudienceBreakdown database
    const dbRows = await prisma.factAudienceBreakdown.findMany({
      where: whereClause
    });
    const effectiveMetaCoverage = reconcileAudienceCoverageWithFactRows(
      audienceCoverage.metaCoverage,
      dbRows
    );
    const effectiveAudienceCoverage = {
      ...audienceCoverage,
      metaCoverage: effectiveMetaCoverage
    };
    const hasCurrentMetaFacts = dbRows.length > 0;

    // 4. Perform TypeScript/JavaScript based aggregate grouping by dimension_value
    const groups: Record<string, {
      dimensionType: string;
      dimensionValue: string;
      spend: number;
      impressions: number;
      clicks: number;
      purchases: number;
      purchaseValue: number;
      accountsSet: Set<string>;
      lastSyncedAt: Date;
    }> = {};

    for (const r of dbRows) {
      const val = r.dimension_value || "unknown";
      if (!groups[val]) {
        groups[val] = {
          dimensionType: r.dimension_type,
          dimensionValue: val,
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchaseValue: 0,
          accountsSet: new Set<string>(),
          lastSyncedAt: r.synced_at
        };
      }
      const g = groups[val];
      g.spend += r.spend || 0;
      g.impressions += r.impressions || 0;
      g.clicks += r.clicks || 0;
      g.purchases += r.purchases || 0;
      g.purchaseValue += r.purchase_value || 0;
      if (r.account_id) g.accountsSet.add(r.account_id);
      if (r.synced_at > g.lastSyncedAt) {
        g.lastSyncedAt = r.synced_at;
      }
    }

    // 5. Build rows list with full indicators
    const aggregatedRows = Object.values(groups).map(g => {
      const ctr = g.impressions > 0 ? (g.clicks / g.impressions) : 0;
      const cpc = g.clicks > 0 ? (g.spend / g.clicks) : 0;
      const cpm = g.impressions > 0 ? (g.spend / g.impressions) * 1000 : 0;
      const cpa = g.purchases > 0 ? (g.spend / g.purchases) : 0;
      const roas = g.spend > 0 ? (g.purchaseValue / g.spend) : 0;

      return {
        dimensionType: g.dimensionType,
        dimensionValue: g.dimensionValue,
        spend: Number(g.spend.toFixed(4)),
        impressions: g.impressions,
        clicks: g.clicks,
        purchases: g.purchases,
        purchaseValue: Number(g.purchaseValue.toFixed(4)),
        ctr: Number(ctr.toFixed(6)),
        cpc: Number(cpc.toFixed(4)),
        cpm: Number(cpm.toFixed(4)),
        cpa: Number(cpa.toFixed(4)),
        roas: Number(roas.toFixed(4)),
        accountsCount: g.accountsSet.size,
        lastSyncedAt: g.lastSyncedAt.toISOString()
      };
    });

    // 6. Applies filters
    let filteredRows = aggregatedRows;

    // Default: do not return zero spend records
    if (includeZeroSpend !== "true" && includeZeroSpend !== true) {
      filteredRows = filteredRows.filter(r => r.spend > 0);
    }

    // Apply minSpend if provided
    const minSpendNum = minSpend ? parseFloat(String(minSpend)) : null;
    if (minSpendNum !== null && !isNaN(minSpendNum)) {
      filteredRows = filteredRows.filter(r => r.spend >= minSpendNum);
    }

    // 7. Dynamic Sorting
    const sortByField = String(sortBy || "spend");
    filteredRows.sort((a: any, b: any) => {
      const valA = a[sortByField];
      const valB = b[sortByField];
      if (typeof valA === "number" && typeof valB === "number") {
        return valB - valA; // Descending order for performance metrics
      }
      return String(valB).localeCompare(String(valA));
    });

    // 8. Dynamic Pagination & default Top limits
    const pageNum = Number(page || 1);
    let pageSizeNum = Number(pageSize || 50);

    const rawTotalItems = filteredRows.length;
    const totalPages = Math.ceil(rawTotalItems / pageSizeNum);
    const paginatedRows = filteredRows.slice((pageNum - 1) * pageSizeNum, pageNum * pageSizeNum);
    const canReturnMetaRows = audienceRowsRenderable(effectiveMetaCoverage, hasCurrentMetaFacts);
    const responseRows = canReturnMetaRows ? paginatedRows : [];
    const totalItems = canReturnMetaRows ? rawTotalItems : 0;
    const responseTotalPages = canReturnMetaRows ? totalPages : 0;

    // 9. Aggregated overall Summary. KPI summary is derived only from the same rows returned to the client.
    const summary = {
      ...buildAudienceMetaSummaryFromVisibleRows(responseRows, effectiveMetaCoverage, hasCurrentMetaFacts && canReturnMetaRows),
      store: buildStoreSummary()
    };

    // 10. Data Health & Warning/Missing Messages
    const warnings: string[] = [];
    const missing: string[] = [];

    if (campaignId || adsetId || adId) {
      missing.push("当前受众 breakdown 仅同步账户层级，Campaign / AdSet / Ad 受众层级尚未同步。");
    }

    const coverageStatus = String(effectiveMetaCoverage.status || "").toUpperCase();
    if (coverageStatus === "PARTIAL_COVERAGE") {
      warnings.push(effectiveMetaCoverage.message || "Current audience coverage is partial.");
    }
    if (coverageStatus === "SYNC_RUNNING") {
      warnings.push(effectiveMetaCoverage.message || "Current audience sync is running.");
    }
    if (coverageStatus === "NOT_SYNCED") {
      missing.push("Current audience range has no proven sync result.");
    }
    if (coverageStatus === "TRUE_EMPTY") {
      missing.push("Current audience range was synced and confirmed empty.");
    }

    let healthStatus: any = effectiveMetaCoverage.status || "READY";
    if (healthStatus === "READY" && (missing.length > 0 || warnings.length > 0)) {
      healthStatus = "PARTIAL_COVERAGE";
    }

    if (responseRows.length === 0) {
      return res.json({
        success: true,
        coverage: effectiveMetaCoverage,
        sourceCoverage: effectiveMetaCoverage,
        metaCoverage: effectiveMetaCoverage,
        storeCoverage: effectiveAudienceCoverage.storeCoverage,
        data: [],
        rows: [],
        summary,
        dataScope: audienceDataScope,
        dataHealth: {
          status: effectiveMetaCoverage.status,
          reason: effectiveMetaCoverage.status,
          missing: ["当前日期范围没有 Meta 受众拆分数据。请在同步中心同步受众 breakdown。"],
          warnings: [],
          source: "FactAudienceBreakdown",
          factRows: dbRows.length,
          structureRows: 0,
          dateRange: buildDateRange(startStr, endStr),
          queryDebug: buildQueryDebug({
            source: "FactAudienceBreakdown",
            storeId,
            accountId,
            includeUnmapped: true,
            includeZeroSpend: queryFlag(includeZeroSpend),
            mappedOnly: false,
            factRows: dbRows.length,
            structureRows: 0
          })
        },
        appliedFilters,
        dateRange: buildDateRange(startStr, endStr),
        dataSourceExplain: {
          dateFilterApplied: true,
          primarySource: "FactAudienceBreakdown",
          noMockData: true
        }
      });
    }

    res.json({
      success: true,
      coverage: effectiveMetaCoverage,
      sourceCoverage: effectiveMetaCoverage,
      metaCoverage: effectiveMetaCoverage,
      storeCoverage: effectiveAudienceCoverage.storeCoverage,
      data: responseRows,
      rows: responseRows,
      summary,
      dataScope: audienceDataScope,
      filters: {
        startDate: startStr,
        endDate: endStr,
        storeId: storeId || "all",
        accountId: accountId || "all",
        campaignId: campaignId || "all",
        adsetId: adsetId || "all",
        adId: adId || "all",
        dimensionType: currentDimType,
        includeZeroSpend: includeZeroSpend === "true" || includeZeroSpend === true,
        minSpend: minSpendNum
      },
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        totalItems,
        totalPages: responseTotalPages
      },
      dataHealth: {
        status: healthStatus,
        warnings,
        missing,
        source: "FactAudienceBreakdown",
        factRows: dbRows.length,
        structureRows: responseRows.length,
        dateRange: buildDateRange(startStr, endStr),
        queryDebug: buildQueryDebug({
          source: "FactAudienceBreakdown",
          storeId,
          accountId,
          includeUnmapped: true,
          includeZeroSpend: queryFlag(includeZeroSpend),
          mappedOnly: false,
          factRows: dbRows.length,
          structureRows: responseRows.length
        })
      },
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "FactAudienceBreakdown",
        noMockData: true
      }
    });

  } catch (error: any) {
    console.error("[Data Center API] Audience error:", error);
    res.status(500).json({ success: false, status: "ERROR", error: "AUDIENCE_QUERY_FAILED", details: error.message });
  }
});

/**
 * GET /api/data-center/countries
 * Reconstructed country analytics page endpoint.
 * Meta country metrics come from FactAudienceBreakdown.
 * Order country metrics are unavailable when Order schema lacks country fields.
 */
router.get("/countries", async (req, res) => {
  const { storeId, minOrders, includeUnmappedSpend } = req.query;

  try {
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const appliedFilters = buildAppliedFilters({ startStr, endStr, storeId });

    const minORaw = minOrders ? parseInt(String(minOrders), 10) : 0;

    const minO = Number.isFinite(minORaw) ? minORaw : 0;

    const normalizedStoreId =
      storeId && storeId !== "all" && storeId !== "undefined"
        ? String(storeId)
        : undefined;

    const incUnmapped = includeUnmappedSpend !== "false";
    const countryCoverage = await getCoverageMap({
      storeCoverage: {
        source: "STORE_ORDER",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: normalizedStoreId
      },
      metaCoverage: {
        source: "META_AUDIENCE",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: normalizedStoreId,
        dimension: "country"
      }
    });

    const result = await getCountryAnalytics(
      startStr,
      endStr,
      normalizedStoreId,
      0,
      minO,
      incUnmapped
    );
    const currentCountryRows = Array.isArray(result.rows) ? result.rows : [];
    const orderFactRows = currentCountryRows.filter((row: any) =>
      Number(row?.orderCount || row?.totalOrderCount || row?.orders || 0) > 0 ||
      Number(row?.revenue || row?.orderRevenue || row?.totalOrderRevenue || 0) > 0
    );
    const metaFactRows = currentCountryRows.filter((row: any) => row?.hasMetaFacts === true);
    const effectiveStoreCoverage = reconcileCoverageWithVisibleRows(countryCoverage.storeCoverage, orderFactRows, {
      coverageBasis: "ORDER_COUNTRY_ROWS_ONLY",
      message: "Store country order facts exist for this request; coverage was reconciled to partial coverage."
    });
    const effectiveCountryMetaCoverage = reconcileCoverageWithVisibleRows(countryCoverage.metaCoverage, metaFactRows, {
      coverageBasis: "META_COUNTRY_ROWS_ONLY",
      message: "Meta country facts exist for this request; coverage was reconciled to partial coverage."
    });

    const visibleCountryRows = currentCountryRows.map((row: any) => ({
      ...row,
      metaSpend: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.metaSpend),
      metaImpressions: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.metaImpressions),
      metaClicks: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.metaClicks),
      metaPurchases: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.metaPurchases),
      metaPurchaseValue: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.metaPurchaseValue),
      metaRoas: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.metaRoas),
      ctr: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.ctr),
      cpc: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.cpc),
      cpm: countryMetaMetric(effectiveCountryMetaCoverage, row.hasMetaFacts, row.cpm)
    }));
    const rawCountrySummary: any = result.summary || {};
    const visibleCountrySummary = {
      ...rawCountrySummary,
      countriesCount: coverageMetric(effectiveStoreCoverage, rawCountrySummary.countriesCount),
      countryCount: coverageMetric(effectiveStoreCoverage, rawCountrySummary.countryCount),
      orderCountriesCount: coverageMetric(effectiveStoreCoverage, rawCountrySummary.orderCountriesCount),
      orderCount: coverageMetric(effectiveStoreCoverage, rawCountrySummary.orderCount),
      revenue: coverageMetric(effectiveStoreCoverage, rawCountrySummary.revenue),
      averageOrderValue: coverageMetric(effectiveStoreCoverage, rawCountrySummary.averageOrderValue),
      totalOrderRevenue: coverageMetric(effectiveStoreCoverage, rawCountrySummary.totalOrderRevenue),
      totalOrderCount: coverageMetric(effectiveStoreCoverage, rawCountrySummary.totalOrderCount),
      orderProfit: coverageMetric(effectiveStoreCoverage, rawCountrySummary.orderProfit),
      metaCountriesCount: coverageMetric(effectiveCountryMetaCoverage, rawCountrySummary.metaCountriesCount),
      totalMetaSpend: coverageMetric(effectiveCountryMetaCoverage, rawCountrySummary.totalMetaSpend),
      totalMetaPurchases: coverageMetric(effectiveCountryMetaCoverage, rawCountrySummary.totalMetaPurchases),
      totalMetaPurchaseValue: coverageMetric(effectiveCountryMetaCoverage, rawCountrySummary.totalMetaPurchaseValue),
      unmappedMetaSpend: coverageMetric(effectiveCountryMetaCoverage, rawCountrySummary.unmappedMetaSpend),
      unmappedMetaSpendRate: coverageMetric(effectiveCountryMetaCoverage, rawCountrySummary.unmappedMetaSpendRate)
    };

    res.json({
      ...result,
      coverage: effectiveStoreCoverage,
      sourceCoverage: effectiveStoreCoverage,
      storeCoverage: effectiveStoreCoverage,
      metaCoverage: effectiveCountryMetaCoverage,
      rows: visibleCountryRows,
      summary: visibleCountrySummary,
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataScope: buildDataScope({
        page: "countries",
        primarySource: "Store orders",
        metaScope: "仅在有店铺订单国家上展示匹配到的 Meta 国家指标；Meta-only 国家请看受众页 country tab",
        storeScope: "店铺订单按 Order.store_local_date 和收货/账单国家统计",
        dateField: "store_local_date",
        storeId: normalizedStoreId || "all",
        includeUnmapped: incUnmapped,
        includeZeroSpend: true,
        mappedOnly: !incUnmapped
      }),
      dataHealth: {
        ...(result.dataHealth || {}),
        status: effectiveStoreCoverage.status,
        source: "FactAudienceBreakdown + Order",
        factRows: visibleCountryRows.length,
        structureRows: 0,
        dateRange: buildDateRange(startStr, endStr),
        queryDebug: buildQueryDebug({
          source: "FactAudienceBreakdown + Order",
          storeId: normalizedStoreId || "all",
          includeUnmapped: incUnmapped,
          includeZeroSpend: true,
          mappedOnly: !incUnmapped,
          factRows: visibleCountryRows.length,
          structureRows: 0
        })
      },
      dataSourceExplain: {
        ...(result.dataSourceExplain || {}),
        dateFilterApplied: true,
        primarySource: result.dataSourceExplain?.primarySource || "FactAudienceBreakdown + Order",
        noMockData: true
      }
    });
  } catch (error: any) {
    console.error("[Data Center API] Countries error:", error);
    res.status(500).json({
      success: false,
      status: "ERROR",
      error: "COUNTRIES_QUERY_FAILED",
      details: error.message
    });
  }
});

/**
 * GET /api/data-center/products
 * Product intelligence must read from Data Center route only.
 * Source: Order + Product metadata.
 */
router.get("/products", async (req, res) => {
  try {
    const { storeId } = req.query;
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const normalizedStoreId = storeId && storeId !== "undefined" ? String(storeId) : "all";
    if (
      normalizedStoreId !== "all" &&
      (!/^\d+$/.test(normalizedStoreId) || Number(normalizedStoreId) <= 0)
    ) {
      return res.status(400).json({
        success: false,
        error: "INVALID_STORE_FILTER"
      });
    }
    if (normalizedStoreId !== "all") {
      const storeExists = await prisma.store.findUnique({
        where: { id: Number(normalizedStoreId) },
        select: { id: true }
      });

      if (!storeExists) {
        return res.status(404).json({
          success: false,
          error: "STORE_FILTER_UNRESOLVED"
        });
      }
    }
    const appliedFilters = buildAppliedFilters({ startStr, endStr, storeId: normalizedStoreId });

    const products = await getProductIntelligence(startStr, endStr, normalizedStoreId);
    const productCoverage = await getCoverageMap({
      productCoverage: {
        source: "PRODUCT_ORDER",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: normalizedStoreId,
        scopeKey: normalizedStoreId === "all" ? "store:all" : `store:${normalizedStoreId}`
      },
      storeCoverage: {
        source: "STORE_LEDGER",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: normalizedStoreId,
        scopeKey: normalizedStoreId === "all" ? "store:all" : `store:${normalizedStoreId}`
      }
    });
    const revenueComplete = products.every(product => product.revenue !== null);
    const totalProductLineRevenue = revenueComplete
      ? products.reduce((sum, product) => sum + Number(product.revenue), 0)
      : null;
    const totalOrders = products.reduce((sum, product) => sum + product.orders, 0);
    const refundedOrders = products.reduce((sum, product) => sum + product.refundedOrders, 0);
    const refundRate = totalOrders > 0 ? refundedOrders / totalOrders : null;
    const summary = {
      productsCount: coverageMetric(productCoverage.productCoverage, products.length),
      productOrderAssociations: coverageMetric(productCoverage.productCoverage, totalOrders),
      totalOrders: coverageMetric(productCoverage.productCoverage, totalOrders),
      totalOrdersLegacyAlias: true,
      refundedOrders: coverageMetric(productCoverage.productCoverage, refundedOrders),
      refundRate: coverageMetric(productCoverage.productCoverage, refundRate),
      totalProductLineRevenue: coverageMetric(productCoverage.productCoverage, totalProductLineRevenue),
      revenueComplete,
      profitAvailable: false
    };

    return res.json({
      success: true,
      coverage: productCoverage.productCoverage,
      sourceCoverage: productCoverage.productCoverage,
      productCoverage: productCoverage.productCoverage,
      storeCoverage: productCoverage.storeCoverage,
      source: "Order",
      mode: "DATACENTER_PRODUCTS_FROM_ORDER",
      startDate: startStr,
      endDate: endStr,
      data: products,
      products,
      summary,
      count: products.length,
      filteredTotalCount: products.length,
      pageRowCount: products.length,
      dataScope: buildDataScope({
        page: "products",
        primarySource: "Order",
        metaScope: "商品页不直接使用 Meta 购买口径；若展示广告花费必须明确标为 Meta",
        storeScope: "商品销售额和商品订单数来自订单事实，按 store_local_date 统计",
        dateField: "Order.store_local_date",
        includeUnmapped: false,
        includeZeroSpend: true,
        mappedOnly: false,
        storeId: normalizedStoreId,
        scope: normalizedStoreId === "all" ? "all_stores" : `store:${normalizedStoreId}`
      }),
      dataHealth: {
        status: productCoverage.productCoverage.status,
        factRows: products.length,
        structureRows: products.length,
        dateRange: buildDateRange(startStr, endStr),
        source: "Order",
        revenueComplete,
        profitAvailable: false,
        queryDebug: buildQueryDebug({
          source: "Order",
          storeId: normalizedStoreId,
          scope: normalizedStoreId === "all" ? "all_stores" : `store:${normalizedStoreId}`,
          includeUnmapped: false,
          includeZeroSpend: true,
          mappedOnly: false,
          factRows: products.length,
          structureRows: products.length
        })
      },
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataSourceExplain: {
        primarySource: "Order",
        metadataSource: "Product",
        revenueSource: "Order.revenue product line values",
        profitAvailable: false,
        dateFilterApplied: true,
        noMockData: true
      }
    });
  } catch (error: any) {
    console.error("[Data Center API] Products error:", error);
    return res.status(500).json({
      success: false,
      status: "ERROR",
      error: "PRODUCTS_QUERY_FAILED",
      details: error.message
    });
  }
});

/**
 * POST /api/data-center/creatives/:creativeId/analyze
 * Generates deterministic rule diagnostics from canonical FactMetaPerformance ad-level facts.
 */
export function createCreativeAnalyzeHandler(deps = { analyzeCreativeScope }) {
  return async (req: any, res: any) => {
    const { creativeId } = req.params;
    const { startDate, endDate, onlyCached } = req.body || {};

    try {
      const body = req.body || {};
      const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
      const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
      const result = await deps.analyzeCreativeScope({
        analysisEntityId: String(body.analysisEntityId || creativeId),
        creativeId,
        creativeIds: Array.isArray(body.creativeIds) ? body.creativeIds : [creativeId],
        adIds: Array.isArray(body.adIds) ? body.adIds : [],
        campaignIds: Array.isArray(body.campaignIds) ? body.campaignIds : [],
        adsetIds: Array.isArray(body.adsetIds) ? body.adsetIds : [],
        accountId: String(body.accountId || ""),
        storeId: body.storeId === null || body.storeId === undefined || body.storeId === "all" ? null : Number(body.storeId),
        startDate: startStr,
        endDate: endStr,
        onlyCached: onlyCached === true || onlyCached === "true",
        forceRefresh: body.forceRefresh === true || body.forceRefresh === "true"
      });
      return res.json(result);
    } catch (error: any) {
      console.error("[Data Center API] Creative rule diagnosis error:", error);
      return res.status(error?.statusCode || 500).json({
        error: error?.code || "Creative rule diagnosis failed",
        details: error.message
      });
    }
  };
}

router.post("/creatives/:creativeId/analyze", createCreativeAnalyzeHandler());

/**
 * GET /api/data-center/stores
 * Returns stores analytics dashboard list
 */
router.get("/stores", async (req, res) => {
  const { startStr, endStr } = getAppliedDateRange(req.query);
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  const appliedFilters = buildAppliedFilters({ startStr, endStr, storeId: req.query.storeId || "all" });

  try {
    const ledgerWhere: any = {
      date: {
        gte: startStr,
        lte: endStr
      }
    };

    if (storeId) {
      ledgerWhere.storeId = storeId;
    }

    const where: any = {
      date: {
        gte: startStr,
        lte: endStr
      }
    };

    if (storeId) where.storeId = storeId;

    const rows = await prisma.dataCenterStoreDaily.findMany({ where });
    const storePageCoverage = await getCoverageMap({
      storeCoverage: {
        source: "STORE_LEDGER",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: storeId || null,
        scopeKey: storeId ? `store:${storeId}` : "store:all"
      },
      metaCoverage: {
        source: "META_ACCOUNT",
        requestedStartDate: startStr,
        requestedEndDate: endStr,
        storeId: storeId || null
      }
    });

    // 1. Get all stores and their account mappings to calculate spend and ROAS
    let storesInventory = await prisma.store.findMany({
      include: { accounts: true, accountMappings: true },
      orderBy: { id: "asc" }
    });

    if (storeId) {
      storesInventory = storesInventory.filter(s => s.id === storeId);
    }

    // 2. Load meta ledger rows in that range to compute mapped spend
    const metaRows = await prisma.dataCenterMetaAccountDaily.findMany({
      where: {
        date: {
          gte: startStr,
          lte: endStr
        }
      }
    });

    const rowsByStore = new Map<number, any[]>();
    for (const row of rows) {
      if (!rowsByStore.has(row.storeId)) rowsByStore.set(row.storeId, []);
      rowsByStore.get(row.storeId)!.push(row);
    }

    const storesList = storesInventory.map(store => {
      const storeRows = rowsByStore.get(store.id) || [];

      const orderCount = storeRows.reduce((s, r) => s + Number(r.orderCount || 0), 0);
      const revenue = Number(storeRows.reduce((s, r) => s + Number(r.grossSales || 0), 0).toFixed(2));
      const latestFetchedAt = storeRows
        .map(r => r.apiFetchedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;

      const mappedFbAccountIds = new Set<string>();
      store.accounts?.forEach(acc => mappedFbAccountIds.add(normalizeMetaAccountId(acc.fb_account_id)));
      store.accountMappings?.forEach(m => {
        if (m.fbAccountId) mappedFbAccountIds.add(normalizeMetaAccountId(m.fbAccountId));
      });
      const uniqueMappedIds = Array.from(mappedFbAccountIds);

      const adSpend = metaRows
        .filter(r => uniqueMappedIds.includes(normalizeMetaAccountId(r.accountId)))
        .reduce((sum, r) => sum + r.spend, 0);

      const {
        visibleOrderCount,
        visibleRevenue,
        visibleAov,
        visibleAdSpend,
        roas,
        hasOrders
      } = buildStoreApiDisplayMetrics({
        orderCount,
        revenue,
        adSpend,
        storeCoverage: storePageCoverage.storeCoverage,
        metaCoverage: storePageCoverage.metaCoverage
      });
      const timezoneDisplay = buildStoreTimezoneDisplay({ store, storeRows });

      return {
        id: store.id,
        storeId: store.id,
        name: store.name,
        storeName: store.name,
        platform: store.platform,
        domain: store.domain,
        timezone: timezoneDisplay.timezone,
        timezoneSource: timezoneDisplay.timezoneSource,
        temporaryTimezoneFallback: timezoneDisplay.temporaryTimezoneFallback,
        timezoneNotice: timezoneDisplay.timezoneNotice,
        orderCount: visibleOrderCount,
        ordersCount: visibleOrderCount,
        revenue: visibleRevenue,
        grossSales: visibleRevenue,
        sales: visibleRevenue,
        totalSales: visibleRevenue,
        totalRefunded: null,
        avgOrderValue: visibleAov,
        aov: visibleAov,
        adSpend: visibleAdSpend,
        mappedAdSpend: visibleAdSpend,
        roas,
        realRoas: roas,
        hasOrders,
        currency: storeRows[0]?.currency || "USD",
        latestFetchedAt,
        source: "DataCenterStoreDaily",
        mode: "DATACENTER_LEDGER",
        snapshotRows: storeRows.length,
        hasSnapshot: storeRows.length > 0,
        mappedAccountCount: uniqueMappedIds.length,
        accountsCount: uniqueMappedIds.length,
        hasMappedAccounts: uniqueMappedIds.length > 0,
        needsRefresh: storeRows.length === 0,
        syncStatus: storePageCoverage.storeCoverage.status,
        dataCoverage: storePageCoverage.storeCoverage,
        reconciliation: {
          status: "derived_from_datacenter_ledger",
          match: null,
          orderRows: visibleOrderCount,
          uniqueOrderCount: visibleOrderCount,
          orderTotalSum: visibleRevenue,
          lineRevenueSum: visibleRevenue,
          paymentStatusCounts: {},
          source: "DataCenterStoreDaily snapshot table"
        }
      };
    });

    const totalOrders = coverageMetric(storePageCoverage.storeCoverage, storesList.reduce((sum, s) => sum + Number(s.ordersCount || 0), 0));
    const totalRevenue = coverageMetric(storePageCoverage.storeCoverage, Number(storesList.reduce((sum, s) => sum + Number(s.revenue || 0), 0).toFixed(2)));

    // Calculate unmapped accounts summary
    const allMappedFbAccountIds = new Set<string>();
    storesInventory.forEach(s => {
      s.accounts?.forEach(acc => allMappedFbAccountIds.add(normalizeMetaAccountId(acc.fb_account_id)));
      s.accountMappings?.forEach(m => {
        if (m.fbAccountId) allMappedFbAccountIds.add(normalizeMetaAccountId(m.fbAccountId));
      });
    });

    const adAccounts = await prisma.adAccount.findMany({
      select: {
        fb_account_id: true,
        fb_account_name: true
      }
    });

    const adAccountNames = new Map<string, string>();
    adAccounts.forEach(a => {
      adAccountNames.set(normalizeMetaAccountId(a.fb_account_id), a.fb_account_name);
    });

    const unmappedMetaRows = metaRows.filter(r => !allMappedFbAccountIds.has(normalizeMetaAccountId(r.accountId)));
    const unmappedSpend = Number(unmappedMetaRows.reduce((sum, r) => sum + r.spend, 0).toFixed(2));
    const unmappedCount = new Set(unmappedMetaRows.map(r => r.accountId)).size;

    const unmappedAccountsSpendsMap = new Map<string, number>();
    unmappedMetaRows.forEach(row => {
      const id = normalizeMetaAccountId(row.accountId);
      unmappedAccountsSpendsMap.set(id, (unmappedAccountsSpendsMap.get(id) || 0) + row.spend);
    });

    const unmappedAccountsList = Array.from(unmappedAccountsSpendsMap.entries()).map(([accountId, spend]) => ({
      accountId,
      name: adAccountNames.get(accountId) || `未知账户 (${accountId})`,
      spend: Number(spend.toFixed(2))
    })).sort((a, b) => b.spend - a.spend);

    const freshness = await getFreshnessMeta();

    return res.json({
      coverage: storePageCoverage.storeCoverage,
      sourceCoverage: storePageCoverage.storeCoverage,
      storeCoverage: storePageCoverage.storeCoverage,
      metaCoverage: storePageCoverage.metaCoverage,
      source: "DataCenterStoreDaily",
      mode: "DATACENTER_LEDGER",
      startDate: startStr,
      endDate: endStr,
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataScope: buildDataScope({
        page: "stores",
        primarySource: "DataCenterStoreDaily",
        metaScope: "映射广告花费来自 DataCenterMetaAccountDaily，仅用于店铺 ROAS 分母",
        storeScope: "店铺订单数、销售额、AOV 来自 DataCenterStoreDaily，按 store_local_date 统计",
        dateField: {
          meta: "DataCenterMetaAccountDaily.date",
          store: "DataCenterStoreDaily.date"
        },
        storeId,
        includeUnmapped: true,
        includeZeroSpend: true,
        mappedOnly: false,
        scope: storeId ? "current_store" : "all_stores"
      }),
      stores: storesList,
      ordersCount: totalOrders,
      revenue: totalRevenue,
      storesInventoryCount: storesList.length,
      unmappedAccountsSummary: {
        count: coverageMetric(storePageCoverage.metaCoverage, unmappedCount),
        spend: coverageMetric(storePageCoverage.metaCoverage, unmappedSpend),
        accounts: unmappedAccountsList,
        message: `当前有 ${unmappedCount} 个广告账户尚未绑定店铺且产生消耗，这些账户的花费 $${unmappedSpend} 不会计入任何店铺真实 ROAS。`
      },
      dataHealth: {
        status: storePageCoverage.storeCoverage.status,
        message: rows.length > 0 ? "所有数据来自 DataCenter Store Daily 账目表。" : "当前日期范围暂无店铺订单数据。",
        source: "DataCenterStoreDaily",
        factRows: rows.length,
        structureRows: storesList.length,
        queryDebug: buildQueryDebug({
          source: "DataCenterStoreDaily",
          scope: storeId ? "current_store" : "all_stores",
          storeId: req.query.storeId || "all",
          includeUnmapped: false,
          includeZeroSpend: true,
          mappedOnly: true,
          factRows: rows.length,
          structureRows: storesList.length
        })
      },
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "DataCenterStoreDaily",
        noMockData: true
      },
      freshness
    });
  } catch (error: any) {
    console.error("[DataCenter] Stores API error:", error);
    res.status(500).json({ success: false, status: "ERROR", error: "STORES_QUERY_FAILED", details: error.message });
  }
});

/**
 * GET /api/data-center/stores/:storeId/reconciliation
 * Returns order reconciliation comparison results with live sync audit trails
 */
router.get("/stores/:storeId/reconciliation", async (req, res) => {
  const { storeId } = req.params;
  const { startDate, endDate } = req.query;

  try {
    const store = await prisma.store.findUnique({
      where: { id: parseInt(storeId, 10) }
    });

    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    const startStr = startDate ? String(startDate) : dayjs().subtract(7, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    const auditReport = {
      storeId: store.id,
      storeName: store.name,
      platform: store.platform || "unknown",
      timezone: store.timezone || "GMT+8",
      localStartDate: startStr,
      localEndDate: endStr,
      utcStartDate: "",
      utcEndDate: "",
      requestUrlSanitized: "",
      pageCount: 0,
      recordsFetched: 0,
      recordsSaved: 0,
      recordsSkipped: 0,
      skippedReasons: [],
      duplicateCount: 0,
      failedCount: 0,
      orderItems: [],
      readOnly: true,
      message: "GET reconciliation is read-only. Use POST /api/sync/trigger to sync fresh store orders or refresh ledger."
    };

    // Calculate database totals (after syncing)
    const ordersInDb = await prisma.order.findMany({
      where: {
        storeId: store.id,
        store_local_date: {
          gte: startStr,
          lte: endStr
        }
      }
    });

    const uniqueOrdersMap = new Map<string, { orderTotal: number, items: any[] }>();
    ordersInDb.forEach(o => {
      if (!isConfirmedPaidSalesOrder(o, store.platform)) {
        return;
      }
      const oId = scopedStoreOrderKey(store.id, o);
      if (!uniqueOrdersMap.has(oId)) {
        uniqueOrdersMap.set(oId, {
          orderTotal: o.orderTotal != null && o.orderTotal > 0 ? o.orderTotal : (o.revenue || 0),
          items: [o]
        });
      } else {
        const existing = uniqueOrdersMap.get(oId)!;
        if ((existing.orderTotal === 0 || existing.orderTotal === (existing.items[0]?.revenue || 0)) && o.orderTotal != null && o.orderTotal > 0) {
          existing.orderTotal = o.orderTotal;
        }
        existing.items.push(o);
      }
    });

    const systemOrdersCount = uniqueOrdersMap.size;
    let systemSalesAmount = 0;
    uniqueOrdersMap.forEach(uo => {
      systemSalesAmount += uo.orderTotal;
    });

    const ledgerRefreshResult = {
      success: true,
      readOnly: true,
      storeId: store.id,
      startDate: startStr,
      endDate: endStr,
      source: "DataCenterStoreDaily",
      message: "Ledger refresh is not executed by this GET endpoint."
    };

    // Load canonical ledgers directly from the DB without refreshing.
    const ledgers = await prisma.dataCenterStoreDaily.findMany({
      where: {
        storeId: store.id,
        date: { gte: startStr, lte: endStr }
      }
    });

    // Parse the three groups of order collections
    // A. API items (auditReport.orderItems)
    const apiOrderMap = new Map<string, any>();
    (auditReport.orderItems || []).forEach((item: any) => {
      const oId = String(item.id || item.orderId || "");
      if (oId) {
        apiOrderMap.set(oId, item);
      }
    });

    // B. Order Table rows grouped by unique ID
    const orderFactMap = new Map<string, {
      orderId: string;
      orderNumber: string;
      orderTotal: number;
      lineRevenueSum: number;
      storeLocalDate: string;
      createdAtUtc: string;
      paymentStatus: string;
      fulfillmentStatus: string;
      includedByOrderFactRule: boolean;
      excludeReason: string | null;
      items: any[];
    }>();

    ordersInDb.forEach(o => {
      const displayOrderId = scopedStoreOrderKey(store.id, o);
      const oId = scopedStoreOrderSnapshotKey(store.id, o.store_local_date, displayOrderId);
      if (!oId || !displayOrderId) return;
      const paymentStatus = o.paymentStatus ? String(o.paymentStatus).toLowerCase() : "";
      let includedByOrderFactRule = true;
      let excludeReason: string | null = null;
      if (!isConfirmedPaidSalesOrder(o, store.platform)) {
        includedByOrderFactRule = false;
        excludeReason = `Excluded by payment status: ${paymentStatus}`;
      }

      const orderTotal = o.orderTotal != null && o.orderTotal > 0 ? o.orderTotal : (o.revenue || 0);

      if (!orderFactMap.has(oId)) {
        orderFactMap.set(oId, {
          orderId: displayOrderId,
          orderNumber: o.orderId || displayOrderId,
          orderTotal,
          lineRevenueSum: o.revenue || 0,
          storeLocalDate: o.store_local_date || "",
          createdAtUtc: o.created_at_utc ? o.created_at_utc.toISOString() : (o.createdAt ? o.createdAt.toISOString() : ""),
          paymentStatus: o.paymentStatus || "",
          fulfillmentStatus: o.fulfillmentStatus || "",
          includedByOrderFactRule,
          excludeReason,
          items: [o]
        });
      } else {
        const existing = orderFactMap.get(oId)!;
        existing.lineRevenueSum += (o.revenue || 0);
        if (existing.orderTotal === 0 && orderTotal > 0) {
          existing.orderTotal = orderTotal;
        }
        if (!includedByOrderFactRule) {
          existing.includedByOrderFactRule = false;
          existing.excludeReason = excludeReason;
        }
        existing.items.push(o);
      }
    });

    const orderFactUniqueList = Array.from(orderFactMap.values());
    const orderFactUniqueCount = orderFactUniqueList.filter(o => o.includedByOrderFactRule).length;
    const orderFactTotalSum = Number(orderFactUniqueList.reduce((sum, o) => sum + (o.includedByOrderFactRule ? o.orderTotal : 0), 0).toFixed(2));
    const orderFactOrderIds = orderFactUniqueList.filter(o => o.includedByOrderFactRule).map(o => o.orderId);

    // C. DataCenterStoreDaily Ledger totals and order ids
    const canonicalLedgerRowCount = ledgers.length;
    const canonicalLedgerOrderCount = ledgers.reduce((sum, row) => sum + Number(row.orderCount || 0), 0);
    const canonicalLedgerGrossSales = roundCurrency(
      ledgers.reduce((sum, row) => sum + Number(row.grossSales || 0), 0)
    );
    const ledgerOrderMap = new Map<string, {
      orderId: string;
      amount: number;
      source: string;
      rawTime: string;
      status: string;
      includedByLedgerRule: boolean;
    }>();

    ledgers.forEach(row => {
      parseLedgerOrderIds(row.orderIdsJson).forEach(rawOrderId => {
        const oId = scopedStoreOrderSnapshotKey(store.id, row.date, rawOrderId);
        if (!oId) return;
        const displayOrderId = String(rawOrderId || "");
        ledgerOrderMap.set(oId, {
          orderId: displayOrderId,
          amount: 0,
          source: "DataCenterStoreDaily.orderIdsJson",
          rawTime: "",
          status: "",
          includedByLedgerRule: true
        });
      });
    });
    if (ledgerOrderMap.size === 0) {
      ledgers.forEach(l => {
        parseLedgerOrderIds(l.rawDigestJson).forEach(rawOrderId => {
          const oId = scopedStoreOrderSnapshotKey(store.id, l.date, rawOrderId);
          if (!oId) return;
          ledgerOrderMap.set(oId, {
            orderId: String(rawOrderId || ""),
            amount: 0,
            source: "DataCenterStoreDaily.rawDigestJson",
            rawTime: "",
            status: "",
            includedByLedgerRule: true
          });
        });
      });
    }

    const ledgerOrdersList = Array.from(ledgerOrderMap.values());
    const ledgerOrderCount = canonicalLedgerOrderCount;
    const ledgerGrossSales = canonicalLedgerGrossSales;
    const ledgerOrderIds = ledgerOrdersList.map(o => o.orderId);

    // Helper to build diff items
    const buildDiffItem = (oId: string, reasonOverride?: string) => {
      const fact = orderFactMap.get(oId);
      const ledg = ledgerOrderMap.get(oId);
      const displayOrderId = fact?.orderId || ledg?.orderId || oId;
      const api = apiOrderMap.get(displayOrderId) || apiOrderMap.get(oId);

      let reason = reasonOverride || "UNKNOWN";
      if (!reasonOverride) {
        if (fact) {
          const timezone = store.timezone || "America/Los_Angeles";
          const rawTime = fact.createdAtUtc || fact.items[0]?.createdAt?.toISOString() || "";
          const convertedLocalDate = rawTime ? dayjs(rawTime).tz(timezone).format("YYYY-MM-DD") : "";
          if (convertedLocalDate && (convertedLocalDate !== fact.storeLocalDate || convertedLocalDate < startStr || convertedLocalDate > endStr)) {
            reason = "TIMEZONE_BOUNDARY_MISMATCH";
          } else if (!isConfirmedPaidSalesOrder(fact.items?.[0] || fact, store.platform)) {
            reason = "PAYMENT_STATUS_EXCLUDED_BY_LEDGER";
          } else {
            reason = "STALE_ORDER_FACT_ROW";
          }
        } else if (api) {
          reason = "API_ONLY_UNSAVED";
        }
      }

      return {
        orderId: displayOrderId,
        orderNumber: fact?.orderNumber || api?.order_number || displayOrderId,
        orderFactAmount: fact ? fact.orderTotal : null,
        ledgerAmount: ledg ? ledg.amount : null,
        apiAmount: api ? api.totalAmount : null,
        orderFactLocalDate: fact ? fact.storeLocalDate : null,
        ledgerRawTime: ledg ? ledg.rawTime : null,
        apiCreatedAtRaw: api ? api.createdAtRaw : null,
        paymentStatus: fact?.paymentStatus || ledg?.status || api?.paymentStatus || null,
        fulfillmentStatus: fact?.fulfillmentStatus || api?.fulfillmentStatus || null,
        reason
      };
    };

    // Calculate diff outputs
    const orderFactNotInLedger = [];
    for (const [oId, fact] of orderFactMap.entries()) {
      if (fact.includedByOrderFactRule && !ledgerOrderMap.has(oId)) {
        orderFactNotInLedger.push(buildDiffItem(oId));
      }
    }

    const ledgerNotInOrderFact = [];
    for (const [oId, ledg] of ledgerOrderMap.entries()) {
      const fact = orderFactMap.get(oId);
      if (!fact || !fact.includedByOrderFactRule) {
        ledgerNotInOrderFact.push(buildDiffItem(oId));
      }
    }

    const apiSavedNotInLedger = [];
    for (const [oId, api] of apiOrderMap.entries()) {
      if (api.isSaved !== false && !ledgerOrderMap.has(oId)) {
        apiSavedNotInLedger.push(buildDiffItem(oId));
      }
    }

    const excludedByPaymentStatus = [];
    for (const [oId, fact] of orderFactMap.entries()) {
      if (!fact.includedByOrderFactRule && fact.excludeReason?.includes("payment status")) {
        excludedByPaymentStatus.push(buildDiffItem(oId, "PAYMENT_STATUS_EXCLUDED_BY_LEDGER"));
      }
    }

    const excludedByLocalDate = [];
    for (const [oId, api] of apiOrderMap.entries()) {
      if (api.skipReason?.includes("local date") || api.storeLocalDate < startStr || api.storeLocalDate > endStr) {
        excludedByLocalDate.push(buildDiffItem(oId, "TIMEZONE_BOUNDARY_MISMATCH"));
      }
    }

    const amountMismatch = [];
    for (const [oId, ledg] of ledgerOrderMap.entries()) {
      const fact = orderFactMap.get(oId);
      if (fact && fact.includedByOrderFactRule && ledg.amount > 0 && Math.abs(fact.orderTotal - ledg.amount) > 0.01) {
        amountMismatch.push(buildDiffItem(oId, "AMOUNT_FIELD_MISMATCH"));
      }
    }
    const reconciliationMatch =
      ledgerOrderCount === orderFactUniqueCount &&
      Math.abs(ledgerGrossSales - orderFactTotalSum) <= 0.01 &&
      orderFactNotInLedger.length === 0 &&
      ledgerNotInOrderFact.length === 0 &&
      amountMismatch.length === 0;
    const countDifference = ledgerOrderCount - orderFactUniqueCount;
    const salesDifference = roundCurrency(ledgerGrossSales - orderFactTotalSum);
    const countMatches = countDifference === 0;
    const salesMatches = Math.abs(salesDifference) <= 0.01;
    const reconciliationStatus =
      ledgerOrderCount === 0 && orderFactUniqueCount === 0 && ledgerGrossSales === 0 && orderFactTotalSum === 0
        ? "TRUE_EMPTY"
        : countMatches && salesMatches && orderFactNotInLedger.length === 0 && ledgerNotInOrderFact.length === 0 && amountMismatch.length === 0
          ? "MATCHED"
          : !countMatches && !salesMatches
            ? "COUNT_AND_SALES_MISMATCH"
            : !countMatches
              ? "COUNT_MISMATCH"
              : "SALES_MISMATCH";

    res.json({
      startDate: startStr,
      endDate: endStr,
      storeId: store.id,
      appliedFilters: buildAppliedFilters({ startStr, endStr, storeId: store.id }),
      dateRange: buildDateRange(startStr, endStr),
      storeName: store.name,
      platform: store.platform,
      timezone: store.timezone,
      canonicalSource: "DataCenterStoreDaily",
      systemOrdersCount: ledgerOrderCount,
      systemSalesAmount: ledgerGrossSales,
      legacyOrderFactOrdersCount: orderFactUniqueCount,
      legacyOrderFactSalesAmount: orderFactTotalSum,
      status: reconciliationStatus,
      canonicalLedger: {
        rowCount: canonicalLedgerRowCount,
        orderCount: ledgerOrderCount,
        grossSales: ledgerGrossSales,
        orderIds: ledgerOrderIds
      },
      reconciliation: {
        readOnly: true,
        match: reconciliationMatch,
        status: reconciliationStatus,
        comparedFields: ["orderCount", "grossSales", "orderIds", "amountMismatch"]
      },
      difference: {
        orderCount: countDifference,
        grossSales: salesDifference
      },
      orderFact: {
        uniqueOrderCount: orderFactUniqueCount,
        orderTotalSum: orderFactTotalSum,
        orderIds: orderFactOrderIds
      },
      apiAudit: {
        recordsFetched: auditReport.recordsFetched,
        orderItemsCount: auditReport.orderItems?.length || 0,
        savedLikeCount: (auditReport.orderItems || []).filter((o: any) => o.isSaved !== false).length
      },
      diff: {
        orderFactNotInLedger,
        ledgerNotInOrderFact,
        apiSavedNotInLedger,
        excludedByPaymentStatus,
        excludedByLocalDate,
        amountMismatch
      },
      fetchedOrdersCount: auditReport.recordsFetched,
      savedOrdersCount: auditReport.recordsSaved,
      skippedCount: auditReport.recordsSkipped,
      skippedReasons: auditReport.skippedReasons,
      duplicateCount: auditReport.duplicateCount,
      failedCount: auditReport.failedCount,
      orderItems: auditReport.orderItems,
      requestUrlSanitized: auditReport.requestUrlSanitized,
      utcStartDate: auditReport.utcStartDate,
      utcEndDate: auditReport.utcEndDate,
      platformUnsupported: false,
      platformMessage: "Read-only platform API reconciliation completed; order items show source order chain status.",
      ledgerRefresh: ledgerRefreshResult
    });

  } catch (error: any) {
    console.error("[Reconciliation API] Error:", error);
    res.status(500).json({ status: "ERROR", error: "Failed to calculate reconciliation stats", details: error.message });
  }
});

/**
 * GET /api/data-center/max-date
 * Dynamically computes the maximum synchronized data date in the DB
 */
router.get("/max-date", async (req, res) => {
  try {
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const storeId = req.query.storeId as any;
    const accountId = req.query.accountId ? String(req.query.accountId) : null;
    const sources = await getCoverageMap({
      metaAccount: { source: "META_ACCOUNT", requestedStartDate: startStr, requestedEndDate: endStr, storeId, accountId },
      metaAudience: { source: "META_AUDIENCE", requestedStartDate: startStr, requestedEndDate: endStr, storeId, accountId },
      metaCreative: { source: "META_CREATIVE", requestedStartDate: startStr, requestedEndDate: endStr, storeId, accountId },
      storeOrder: { source: "STORE_ORDER", requestedStartDate: startStr, requestedEndDate: endStr, storeId },
      storeLedger: { source: "STORE_LEDGER", requestedStartDate: startStr, requestedEndDate: endStr, storeId },
      productOrder: { source: "PRODUCT_ORDER", requestedStartDate: startStr, requestedEndDate: endStr, storeId }
    });
    const overallMaxDate = Object.values(sources)
      .map((coverage: any) => coverage.latestAvailableDate)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

    res.json({
      maxDate: overallMaxDate,
      overallMaxDate,
      sources,
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      dataSourceExplain: {
        metaDateSources: ["DataCenterMetaAccountDaily.date", "FactAudienceBreakdown.date", "FactMetaPerformance.date"],
        storeDateSources: ["Order.store_local_date", "DataCenterStoreDaily.date"]
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      status: "ERROR",
      error: "SOURCE_FRESHNESS_QUERY_FAILED",
      details: error.message
    });
  }
});

/**
 * GET /api/data-center/accounts-performance
 * Returns all active and inactive ad accounts with key KPI performance metrics, LEFT JOINing with stores
 * Formatted from fact_meta_performance
 */
router.get("/accounts-performance", async (req, res) => {
  const { startStr, endStr } = getAppliedDateRange(req.query);
  const storeIdParam = req.query.storeId ? String(req.query.storeId) : "all";
  const includeHistoricalAccounts = req.query.includeHistoricalAccounts === "true";
  const appliedFilters = buildAppliedFilters({ startStr, endStr, storeId: storeIdParam });

  try {
    const storeIdNum = storeIdParam !== "all" && storeIdParam !== "undefined" && storeIdParam !== "null" ? Number(storeIdParam) : null;
    const accountCoverage = await getDataSourceCoverage({
      source: "META_ACCOUNT",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      storeId: storeIdNum
    });

    const where: any = {
      date: {
        gte: startStr,
        lte: endStr
      }
    };

    const rows = await prisma.dataCenterMetaAccountDaily.findMany({ where });
    const hasPositiveMetric = (value: unknown) => {
      if (value === null || value === undefined || value === "") return false;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    };

    const activeRowAccountIds = new Set(
      rows
        .filter(row =>
          hasPositiveMetric(row.spend) ||
          hasPositiveMetric(row.impressions) ||
          hasPositiveMetric(row.clicks) ||
          hasPositiveMetric(row.purchases) ||
          hasPositiveMetric(row.purchaseValue)
        )
        .map(row => normalizeMetaAccountId(row.accountId))
    );

    const activeRowAccountIdsList = Array.from(activeRowAccountIds);

    const [adAccounts, mappings, totalAdAccountsInventoryCount] = await Promise.all([
      prisma.adAccount.findMany(
        includeHistoricalAccounts
          ? {
              include: { store: true },
              orderBy: { updatedAt: "desc" }
            }
          : {
              where: {
                OR: [
                  { recentActivity90d: true },
                  ...(activeRowAccountIdsList.length > 0
                    ? [{ fb_account_id: { in: activeRowAccountIdsList } }]
                    : [])
                ]
              },
              include: { store: true },
              orderBy: { updatedAt: "desc" }
            }
      ),
      prisma.accountMapping.findMany({ include: { store: true } }),
      prisma.adAccount.count()
    ]);

    const rowsByAccount = new Map<string, any[]>();
    for (const row of rows) {
      const id = normalizeMetaAccountId(row.accountId);
      if (!rowsByAccount.has(id)) rowsByAccount.set(id, []);
      rowsByAccount.get(id)!.push(row);
    }

    const inventoryMap = new Map<string, any>();

    for (const acc of adAccounts) {
      const id = normalizeMetaAccountId(acc.fb_account_id);
      inventoryMap.set(id, {
        fb_account_id: id,
        fb_account_name: acc.fb_account_name,
        storeId: acc.storeId || null,
        storeName: acc.store?.name || null,
        timezone: acc.timezone,
        currency: acc.currency || "USD",
        recentActivity90d: Boolean(acc.recentActivity90d),
        sourceInventory: "AdAccount"
      });
    }

    for (const m of mappings) {
      const id = normalizeMetaAccountId(m.fbAccountId);

      if (
        !includeHistoricalAccounts &&
        !inventoryMap.has(id) &&
        !activeRowAccountIds.has(id)
      ) {
        continue;
      }

      if (!inventoryMap.has(id)) {
        inventoryMap.set(id, {
          fb_account_id: id,
          fb_account_name: m.name || id,
          storeId: m.storeId || null,
          storeName: m.store?.name || null,
          timezone: null,
          currency: "USD",
          recentActivity90d: false,
          sourceInventory: "AccountMapping"
        });
      } else {
        const item = inventoryMap.get(id);
        if (!item.storeId && m.storeId) {
          item.storeId = m.storeId;
          item.storeName = m.store?.name || item.storeName;
        }
      }
    }

    let results = Array.from(inventoryMap.values()).map(acc => {
      const accountRows = rowsByAccount.get(normalizeMetaAccountId(acc.fb_account_id)) || [];
      const hasPerformanceFacts = accountRows.length > 0;

      const spend = hasPerformanceFacts
        ? Number(accountRows.reduce((s, r) => s + Number(r.spend || 0), 0).toFixed(2))
        : null;
      const impressions = hasPerformanceFacts
        ? accountRows.reduce((s, r) => s + Number(r.impressions || 0), 0)
        : null;
      const reach = null;
      const reachAvailable = false;
      const clicks = hasPerformanceFacts
        ? accountRows.reduce((s, r) => s + Number(r.clicks || 0), 0)
        : null;
      const purchases = hasPerformanceFacts
        ? accountRows.reduce((s, r) => s + Number(r.purchases || 0), 0)
        : null;
      const purchaseValue = hasPerformanceFacts
        ? Number(accountRows.reduce((s, r) => s + Number(r.purchaseValue || 0), 0).toFixed(2))
        : null;

      const latestFetchedAt = accountRows
        .map(r => r.apiFetchedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;

      return {
        ...acc,
        id: acc.fb_account_id,
        accountId: acc.fb_account_id,
        accountName: acc.fb_account_name,
        hasPerformanceFacts,
        spend,
        impressions,
        reach,
        reachAvailable,
        clicks,
        purchases,
        purchase_value: purchaseValue,
        purchaseValue,
        ctr: !hasPerformanceFacts
          ? null
          : impressions > 0
            ? Number(((clicks / impressions) * 100).toFixed(4))
            : 0,
        cpc: !hasPerformanceFacts
          ? null
          : clicks > 0
            ? Number((spend / clicks).toFixed(4))
            : 0,
        cpm: !hasPerformanceFacts
          ? null
          : impressions > 0
            ? Number(((spend / impressions) * 1000).toFixed(4))
            : 0,
        cpa: !hasPerformanceFacts
          ? null
          : purchases > 0
            ? Number((spend / purchases).toFixed(4))
            : null,
        roas: !hasPerformanceFacts
          ? null
          : spend > 0
            ? Number((purchaseValue / spend).toFixed(4))
            : 0,
        latestFetchedAt,
        source: "DataCenterMetaAccountDaily",
        mode: "DATACENTER_LEDGER",
        snapshotRows: accountRows.length,
        hasSnapshot: hasPerformanceFacts,
        isBound: !!acc.storeId,
        mappingStatus: acc.storeId ? "BOUND" : "UNBOUND",
        needsRefresh: accountRows.length === 0
      };
    });

    if (storeIdParam !== "all" && storeIdParam !== "undefined" && storeIdParam !== "null") {
      results = results.filter(a => Number(a.storeId) === Number(storeIdParam));
    }

    if (!includeHistoricalAccounts) {
      results = results.filter(a =>
        Boolean(a.recentActivity90d) ||
        Boolean(a.hasSnapshot) ||
        Number(a.spend || 0) > 0 ||
        Number(a.impressions || 0) > 0 ||
        Number(a.clicks || 0) > 0 ||
        Number(a.purchases || 0) > 0 ||
        Number(a.purchaseValue || 0) > 0
      );
    }

    results.sort((a, b) => Number(b.spend ?? -1) - Number(a.spend ?? -1));

    const latestFetched = rows
      .map(r => r.apiFetchedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;

    const performanceResults = results.filter(row => row.hasPerformanceFacts === true);
    const totalSpend = Number(performanceResults.reduce((sum, a) => sum + Number(a.spend ?? 0), 0).toFixed(2));
    const boundAccounts = results.filter(r => r.isBound).length;
    const unboundAccounts = results.filter(r => !r.isBound).length;

    const unboundSpend = Number(performanceResults.filter(r => !r.isBound).reduce((sum, r) => sum + Number(r.spend ?? 0), 0).toFixed(2));
    const unboundSpendAccounts = performanceResults.filter(r => !r.isBound && Number(r.spend ?? 0) > 0).length;
    const unboundSpendRate = totalSpend > 0 ? unboundSpend / totalSpend : 0;

    const freshness = await getFreshnessMeta();

    return res.json({
      coverage: accountCoverage,
      sourceCoverage: accountCoverage,
      success: true,
      source: "DataCenterMetaAccountDaily",
      mode: "DATACENTER_LEDGER",
      startDate: startStr,
      endDate: endStr,
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataScope: buildDataScope({
        page: "accounts-performance",
        primarySource: "DataCenterMetaAccountDaily",
        metaScope: "账户数据页按 Meta account-level 成效账目聚合花费、展示、点击、购买和转化价值",
        storeScope: "店铺字段仅用于账户映射筛选，不参与账户级 Meta 指标计算",
        dateField: "DataCenterMetaAccountDaily.date",
        storeId: storeIdParam,
        includeUnmapped: storeIdParam === "all",
        includeZeroSpend: true,
        mappedOnly: storeIdParam !== "all"
      }),
      accounts: results,
      accountsInventoryCount: results.length,
      totalAdAccountsInventoryCount,
      hiddenHistoricalAccountsCount: includeHistoricalAccounts
        ? 0
        : Math.max(0, totalAdAccountsInventoryCount - results.length),
      accountsWithSpendCount: performanceResults.filter(a => Number(a.spend ?? 0) > 0).length,
      inventoryAccountCount: results.length,
      performanceAccountCount: performanceResults.length,
      structureOnlyAccountCount: results.filter(row => !row.hasPerformanceFacts).length,
      accountDisplayScope: includeHistoricalAccounts ? "historical_all" : "active_only",
      totalSpend,
      metaReconciliation: {
        accountLevelRows: rows.length,
        legacyNumericFactRows: 0,
        canonicalFactRows: rows.length,
        totalSpendFromCanonicalRows: totalSpend,
        dateSource: "Meta API date_start",
        accountIdPolicy: "act_xxx only"
      },
      metaFreshness: {
        latestSyncedAt: latestFetched ? latestFetched.toISOString() : null,
        latestFactDate: rows.length > 0 ? rows.map(r => r.date).sort().slice(-1)[0] : null,
        realtimeEligible: true,
        source: "DataCenterMetaAccountDaily"
      },
      health: {
        status: accountCoverage.status,
        missingReason: rows.length > 0 ? "所有数据来自 DataCenter Meta Account Daily 账目表。" : "此日期范围内暂无 DataCenter 账目记录。",
        warnings: [],
        lastSyncTime: latestFetched,
        lastSyncTimeStr: latestFetched ? dayjs(latestFetched).format("YYYY-MM-DD HH:mm:ss") : "无记录",
        isSyncActive: false
      },
      dataHealth: {
        status: accountCoverage.status,
        reason: rows.length > 0 ? "OK" : "NO_ACCOUNT_LEDGER_ROWS",
        message: rows.length > 0 ? "账号表现账目已按当前日期范围返回。" : "当前日期范围内暂无账号表现账目。",
        level: "account",
        factRows: rows.length,
        structureRows: results.length,
        dateRange: buildDateRange(startStr, endStr),
        queryDebug: {
          ...buildQueryDebug({
            source: "DataCenterMetaAccountDaily",
            storeId: storeIdParam || "all",
            includeUnmapped: storeIdParam === "all",
            includeZeroSpend: true,
            mappedOnly: storeIdParam !== "all",
            factRows: rows.length,
            structureRows: results.length
          }),
          includeHistoricalAccounts
        }
      },
      summary: {
        totalAccounts: results.length,
        activeAccounts: performanceResults.filter(a => Number(a.spend ?? 0) > 0).length,
        spendAccounts: performanceResults.filter(a => Number(a.spend ?? 0) > 0).length,
        zeroSpendAccounts: performanceResults.filter(a => Number(a.spend ?? 0) === 0).length,
        boundAccounts,
        unboundAccounts,
        unboundSpendAccounts,
        totalSpend,
        unmappedSpend: unboundSpend,
        unboundSpend,
        unboundSpendRate
      },
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "DataCenterMetaAccountDaily",
        noMockData: true,
        inventorySource: includeHistoricalAccounts
          ? "AdAccount + AccountMapping + DataCenterMetaAccountDaily"
          : "recentActivity90d AdAccount + active DataCenterMetaAccountDaily",
        accountDisplayScope: includeHistoricalAccounts ? "historical_all" : "active_only"
      },
      freshness
    });

    return; // Fast return to skip legacy duplicate code below safely
  } catch (error: any) {
    res.status(500).json({ success: false, status: "ERROR", error: "ACCOUNTS_PERFORMANCE_QUERY_FAILED", details: error.message });
  }
});

/**
 * GET /api/data-center/ad-hierarchy/accounts
 * Returns account hierarchy list aggregated from fact_meta_performance level='account'
 */
router.get("/ad-hierarchy/accounts", async (req, res) => {
  const { storeId, includeZeroSpend } = req.query;
  try {
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const appliedFilters = buildAppliedFilters({ startStr, endStr, storeId });
    const showAll = includeZeroSpend === "true";
    const hierarchyCoverage = await getDataSourceCoverage({
      source: "META_ACCOUNT",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      storeId: storeId as any
    });

    // 1. Fetch performance rows from fact_meta_performance
    const performanceRows = await prisma.factMetaPerformance.findMany({
      where: {
        level: "account",
        date: { gte: startStr, lte: endStr }
      }
    });

    // 2. Fetch structural adAccounts, maps, and stores
    const [adAccounts, accountMappings] = await Promise.all([
      prisma.adAccount.findMany({ include: { store: true } }),
      prisma.accountMapping.findMany({ include: { store: true } })
    ]);

    // 3. Structural counts
    const [campaignGroup, adsetGroup, adGroup] = await Promise.all([
      prisma.campaign.groupBy({
        by: ['accountId'],
        _count: { id: true }
      }),
      prisma.adSet.groupBy({
        by: ['accountId'],
        _count: { id: true }
      }),
      prisma.ad.groupBy({
        by: ['accountId'],
        _count: { id: true }
      })
    ]);

    const campaignCounts = new Map<string, number>();
    campaignGroup.forEach(g => campaignCounts.set(normalizeMetaAccountId(g.accountId), g._count.id));

    const adsetCounts = new Map<string, number>();
    adsetGroup.forEach(g => adsetCounts.set(normalizeMetaAccountId(g.accountId), g._count.id));

    const adCounts = new Map<string, number>();
    adGroup.forEach(g => adCounts.set(normalizeMetaAccountId(g.accountId), g._count.id));

    const adAccountsMap = new Map<string, any>();
    adAccounts.forEach(a => adAccountsMap.set(normalizeMetaAccountId(a.fb_account_id), a));

    const mappingsMap = new Map<string, any>();
    accountMappings.forEach(m => mappingsMap.set(normalizeMetaAccountId(m.fbAccountId), m));

    // 4. Group and aggregate daily performance
    const performanceMap = new Map<string, any>();
    for (const row of performanceRows) {
      const normId = normalizeMetaAccountId(row.account_id);
      if (!performanceMap.has(normId)) {
        performanceMap.set(normId, {
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchase_value: 0
        });
      }
      const agg = performanceMap.get(normId);
      agg.spend += row.spend || 0;
      agg.impressions += row.impressions || 0;
      agg.clicks += row.clicks || 0;
      agg.purchases += row.purchases || 0;
      agg.purchase_value += row.purchase_value || 0;
    }

    // 5. Build union of all possible accounts
    const allAccountIds = new Set<string>([
      ...performanceMap.keys(),
      ...adAccountsMap.keys(),
      ...mappingsMap.keys()
    ]);

    let results: any[] = [];
    for (const rawId of allAccountIds) {
      const normId = normalizeMetaAccountId(rawId);
      const agg = performanceMap.get(normId) || {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0
      };

      const adAcc = adAccountsMap.get(normId);
      const mapping = mappingsMap.get(normId);

      // Determine bound store info
      let storeIdVal: number | null = null;
      let storeName = "未关联店铺";
      let isBound = false;

      if (adAcc && adAcc.storeId) {
        storeIdVal = adAcc.storeId;
        storeName = adAcc.store?.name || "未关联店铺";
        isBound = true;
      } else if (mapping && mapping.storeId) {
        storeIdVal = mapping.storeId;
        storeName = mapping.store?.name || "未关联店铺";
        isBound = true;
      }

      // Filter by storeId if specified
      if (storeId && storeId !== "all" && storeId !== "undefined") {
        if (storeIdVal !== Number(storeId)) {
          continue; // Skip this account
        }
      }

      const name = adAcc?.fb_account_name || mapping?.name || `Meta Account ${normId}`;
      const currency = adAcc?.currency || "USD";
      const timezone = adAcc?.timezone || "America/Los_Angeles";

      const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
      const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
      const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
      const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : 0;
      const roas = agg.spend > 0 ? agg.purchase_value / agg.spend : 0;

      results.push({
        id: normId,
        fb_account_id: normId,
        fb_account_name: name,
        currency,
        timezone,
        isBound,
        storeName,
        spend: agg.spend,
        impressions: agg.impressions,
        clicks: agg.clicks,
        purchases: agg.purchases,
        purchaseValue: agg.purchase_value,
        purchase_value: agg.purchase_value,
        ctr,
        cpc,
        cpm,
        cpa,
        roas,
        campaignCount: campaignCounts.get(normId) || 0,
        adsetCount: adsetCounts.get(normId) || 0,
        adCount: adCounts.get(normId) || 0
      });
    }

    if (!showAll) {
      results = results.filter(r => r.spend > 0);
    }

    results.sort((a, b) => b.spend - a.spend);

    let reason = "OK";
    if (results.length === 0) {
      if (adAccounts.length === 0) {
        reason = "NO_STRUCTURE_ROWS";
      } else if (performanceRows.length === 0) {
        reason = "NO_FACT_LEVEL_ROWS";
      } else if (!showAll) {
        reason = "FILTER_ZERO_SPEND_HIDDEN";
      } else {
        reason = "NO_FACT_LEVEL_ROWS";
      }
    }

    res.json({
      success: true,
      coverage: hierarchyCoverage,
      sourceCoverage: hierarchyCoverage,
      data: results,
      dataHealth: {
        status: hierarchyCoverage.status,
        level: "account",
        reason,
        factRows: performanceRows.length,
        structureRows: adAccounts.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr,
          timezone: DATA_CENTER_TIMEZONE
        },
        accountId: "",
        queryDebug: {
          ...buildQueryDebug({
            source: "FactMetaPerformance + AdAccount + AccountMapping",
            scope: "all_accounts",
            storeId,
            accountId: null,
            includeUnmapped: true,
            includeZeroSpend: showAll,
            mappedOnly: false,
            factRows: performanceRows.length,
            structureRows: adAccounts.length
          }),
          level: "account"
        }
      },
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataScope: buildDataScope({
        page: "ad-hierarchy-accounts",
        primarySource: "FactMetaPerformance + AdAccount + AccountMapping",
        metaScope: "Ad hierarchy account rows use hierarchy-level Meta facts and structural inventory.",
        storeScope: "Store mapping is filter context only; store orders are not mixed into hierarchy metrics.",
        dateField: "FactMetaPerformance.date",
        storeId,
        includeUnmapped: true,
        includeZeroSpend: showAll,
        mappedOnly: false,
        scope: "all_accounts"
      }),
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "FactMetaPerformance + AdAccount + AccountMapping",
        noMockData: true
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, status: "ERROR", error: "HIERARCHY_ACCOUNTS_QUERY_FAILED", details: error.message });
  }
});

export function createDataCenterHierarchyHandler(level: "campaign" | "adset" | "ad", deps = { getCanonicalAdHierarchy }) {
  return async (req: any, res: any) => {
    const { accountId, campaignId, adsetId, includeZeroSpend } = req.query;
    try {
      if (!accountId) {
        return res.status(400).json({ error: "Missing accountId parameter" });
      }
      if (level === "adset" && !campaignId) {
        return res.status(400).json({ error: "Missing accountId or campaignId parameter" });
      }
      if (level === "ad" && !adsetId) {
        return res.status(400).json({ error: "Missing accountId or adsetId parameter" });
      }

      const { startStr, endStr } = getAppliedDateRange(req.query);
      const canonicalHierarchy = await deps.getCanonicalAdHierarchy({
        level,
        accountId: String(accountId),
        scope: accountId === "all" || accountId === "all_active" ? "all_accounts" : "current_account",
        campaignId: campaignId ? String(campaignId) : undefined,
        adsetId: adsetId ? String(adsetId) : undefined,
        startDate: startStr,
        endDate: endStr,
        includeZeroSpend: includeZeroSpend === "true" || includeZeroSpend === true
      });
      return res.json(canonicalHierarchy);
    } catch (error: any) {
      const errorCode = level === "campaign"
        ? "HIERARCHY_CAMPAIGNS_QUERY_FAILED"
        : level === "adset"
          ? "HIERARCHY_ADSETS_QUERY_FAILED"
          : "HIERARCHY_ADS_QUERY_FAILED";
      return res.status(500).json({ success: false, status: "ERROR", error: errorCode, details: error.message });
    }
  };
}

router.get("/ad-hierarchy/campaigns", createDataCenterHierarchyHandler("campaign"));
router.get("/ad-hierarchy/adsets", createDataCenterHierarchyHandler("adset"));
router.get("/ad-hierarchy/ads", createDataCenterHierarchyHandler("ad"));

/**
 * GET /api/data-center/audience-insights
 * Real database-integrated breakdown demographics
 */
router.get("/audience-insights", async (req, res) => {
  try {
    const { startDate, endDate, accountId, breakdown } = req.query;
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    const mappedDimType = breakdown === "gender_age" ? "gender" : String(breakdown || "country");

    const whereClause: any = {
      date: { gte: startStr, lte: endStr },
      dimension_type: mappedDimType
    };

    if (accountId && accountId !== "all" && accountId !== "all_active" && accountId !== "undefined") {
      whereClause.account_id = normalizeMetaAccountId(String(accountId));
    }

    const dbRows = await prisma.factAudienceBreakdown.findMany({
      where: whereClause
    });

    const groups: Record<string, any> = {};
    for (const r of dbRows) {
      const val = r.dimension_value || "unknown";
      if (!groups[val]) {
        groups[val] = {
          dimensionType: r.dimension_type,
          dimensionValue: val,
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchaseValue: 0
        };
      }
      groups[val].spend += r.spend || 0;
      groups[val].impressions += r.impressions || 0;
      groups[val].clicks += r.clicks || 0;
      groups[val].purchases += r.purchases || 0;
      groups[val].purchaseValue += r.purchase_value || 0;
    }

    const rows = Object.values(groups).map(g => {
      const ctr = g.impressions > 0 ? (g.clicks / g.impressions) : 0;
      const cpc = g.clicks > 0 ? (g.spend / g.clicks) : 0;
      return {
        ...g,
        ctr,
        cpc
      };
    });

    res.json({
      rows,
      dataSourceExplain: {
        primarySource: "FactAudienceBreakdown"
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load audience insights", details: error.message });
  }
});

/**
 * GET /api/data-center/creative-insights
 * Returns actual performance metrics across ad creatives/cards
 */
router.get("/creative-insights", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      accountId,
      storeId,
      storeFilter,
      campaignId,
      adsetId,
      creativeType,
      opsBucket,
      search,
      minSpend,
      includeZeroSpend,
      page,
      pageSize,
      sortBy,
      export: exportRows
    } = req.query;
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const appliedFilters = buildAppliedFilters({
      startStr,
      endStr,
      storeId: storeId || storeFilter || "all",
      accountId: accountId || "all"
    });

    const result = await getAggregatedCreativeInsights({
      startDate: startStr,
      endDate: endStr,
      accountId: accountId as string,
      storeId: (storeId || storeFilter) as string,
      campaignId: campaignId as string,
      adsetId: adsetId as string,
      creativeType: creativeType as string,
      opsBucket: opsBucket as string,
      search: search as string,
      minSpend: minSpend as string,
      includeZeroSpend: includeZeroSpend as string,
      page: page as string,
      pageSize: pageSize as string,
      sortBy: sortBy as string,
      export: exportRows as string
    });

    const rows = Array.isArray(result.data) ? result.data : [];
    const creativeCoverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      storeId: isSpecificFilter(storeId || storeFilter) ? Number(storeId || storeFilter) : undefined,
      accountId: isSpecificFilter(accountId) ? String(accountId) : undefined,
      factLevel: "ad"
    });
    const responseSummary = Object.fromEntries(
      Object.entries(result.summary || {}).map(([key, value]) => [key, coverageMetric(creativeCoverage, value)])
    );
    const creativeQueryDebug = buildQueryDebug({
      source: "FactMetaPerformance level=ad + AdCreative + Ad",
      storeId: storeId || storeFilter || "all",
      accountId: accountId || "all",
      includeUnmapped: !isSpecificFilter(storeId || storeFilter),
      includeZeroSpend: queryFlag(includeZeroSpend),
      mappedOnly: isSpecificFilter(storeId || storeFilter),
      factRows: Number(result.diagnostics?.performanceRows || rows.length || 0),
      structureRows: Number(result.diagnostics?.structureRows || 0)
    });
    const creativeHealth = {
      status: creativeCoverage.status,
      message: creativeCoverage.status === "NOT_SYNCED"
        ? `当前周期素材成效尚未同步，数据最新至 ${creativeCoverage.latestAvailableDate || "未知"}`
        : creativeCoverage.status === "PARTIAL_COVERAGE"
          ? `请求截止 ${endStr}，当前事实只覆盖至 ${creativeCoverage.latestAvailableDate || "未知"}`
          : creativeCoverage.status === "TRUE_EMPTY"
            ? "当前周期已完整同步，素材成效为空。"
            : creativeCoverage.status === "ERROR"
              ? "素材成效查询失败。"
              : "素材成效覆盖状态已更新。",
      factRows: Number(result.diagnostics?.performanceRows || rows.length || 0),
      structureRows: Number(result.diagnostics?.structureRows || 0),
      source: "Meta 素材成效",
      coverage: creativeCoverage,
      dateRange: buildDateRange(startStr, endStr),
      queryDebug: creativeQueryDebug
    };

    res.json({
      ...result,
      summary: responseSummary,
      coverage: creativeCoverage,
      sourceCoverage: creativeCoverage,
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataScope: result.dataScope || buildDataScope({
        page: "creative-insights",
        primarySource: "FactMetaPerformance + AdCreative",
        metaScope: "素材页按 Ad / Creative 维度聚合 Meta 花费、展示、点击、购买和转化价值",
        storeScope: "不直接统计店铺订单；店铺订单请看店铺数据或商品数据页面",
        dateField: "FactMetaPerformance.date",
        storeId: storeId || storeFilter || "all",
        accountId: accountId || "all",
        includeZeroSpend: queryFlag(includeZeroSpend),
        mappedOnly: isSpecificFilter(storeId || storeFilter)
      }),
      dataHealth: creativeHealth,
      dataSourceExplain: {
        ...(result.dataSourceExplain || {}),
        dateFilterApplied: true,
        primarySource: "FactMetaPerformance level=ad + AdCreative + Ad",
        noMockData: true
      }
    });
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({
      success: false,
      status: "ERROR",
      error: error?.code || "CREATIVE_INSIGHTS_QUERY_FAILED",
      details: error.message
    });
  }
});

/**
 * GET /api/data-center/store-orders
 * Returns a robust list of Raw synchronized Shopify/Shopline orders
 */
router.get("/store-orders", async (req, res) => {
  const { startDate, endDate, storeId } = req.query;
  try {
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const normalizedStoreId = normalizeStoreIdFilter(storeId);

    let whereClause: any = {
      store_local_date: { gte: startStr, lte: endStr }
    };
    if (normalizedStoreId) {
      whereClause.storeId = normalizedStoreId;
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: [
        { store_local_date: "desc" },
        { id: "desc" }
      ]
    });
    const storeIds = Array.from(new Set(
      orders
        .map(order => Number(order.storeId))
        .filter(Number.isFinite)
    ));
    const stores = storeIds.length > 0
      ? await prisma.store.findMany({
          where: { id: { in: storeIds } },
          select: {
            id: true,
            name: true,
            platform: true,
            timezone: true
          }
        })
      : [];
    const storeMap = new Map(stores.map(store => [store.id, store]));
    const uniqueOrders = new Map<string, any>();
    for (const order of orders) {
      const store = storeMap.get(Number(order.storeId));
      if (!isConfirmedPaidSalesOrder(order, store?.platform)) continue;
      const key = scopedStoreOrderKey(order.storeId, order);
      if (key && !uniqueOrders.has(key)) uniqueOrders.set(key, order);
    }
    const storeOrderRows = orders.map(o => ({
      id: o.id,
      orderId: o.orderId,
      storeId: o.storeId,
      storeName: storeMap.get(Number(o.storeId))?.name || `Store ${o.storeId}`,
      platform: storeMap.get(Number(o.storeId))?.platform || null,
      timezone: o.store_timezone || storeMap.get(Number(o.storeId))?.timezone || null,
      createdAt: o.createdAt,
      createdAtUtc: o.created_at_utc,
      storeLocalDate: o.store_local_date,
      storeLocalDatetime: o.store_local_datetime,
      total: o.orderTotal != null && o.orderTotal > 0 ? o.orderTotal : (o.revenue || 0),
      lineRevenue: o.revenue || 0,
      profit: o.profit || 0,
      refunded: Boolean(o.refunded),
      currency: "USD",
      paymentStatus: o.paymentStatus || "paid",
      fulfillmentStatus: o.fulfillmentStatus || "unfulfilled",
      shippingCountryCode: o.shippingCountryCode || null,
      billingCountryCode: o.billingCountryCode || null,
      countrySource: o.countrySource || null
    }));
    const storeOrderSummary = {
      startDate: startStr,
      endDate: endStr,
      storeId: normalizedStoreId || "all",
      rowCount: storeOrderRows.length,
      orderCount: uniqueOrders.size,
      grossSales: roundCurrency(
        Array.from(uniqueOrders.values()).reduce((sum, order) => {
          return sum + Number(order.orderTotal != null && order.orderTotal > 0 ? order.orderTotal : (order.revenue || 0));
        }, 0)
      ),
      lineRevenue: roundCurrency(storeOrderRows.reduce((sum, row) => sum + Number(row.lineRevenue || 0), 0))
    };

    res.json({
      count: storeOrderRows.length,
      rows: storeOrderRows,
      summary: storeOrderSummary,
      pagination: {
        total: storeOrderRows.length,
        page: 1,
        pageSize: storeOrderRows.length
      },
      appliedFilters: buildAppliedFilters({ startStr, endStr, storeId: normalizedStoreId || "all" }),
      dateRange: buildDateRange(startStr, endStr),
      orders: storeOrderRows
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load store orders", details: error.message });
  }
});

// 6. Pipeline audit endpoint returning diagnostic facts and metrics
router.get("/pipeline-audit", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    const auditResult = await runDataPipelineAudit({
      startDate: startStr,
      endDate: endStr
    });

    res.json(auditResult);
  } catch (err: any) {
    res.status(500).json({ error: "Pipeline audit failed", details: err.message });
  }
});

// 7. Data Center Audit diagnostic endpoint matching SPEC
router.get("/audit", async (req, res) => {
  try {
    const { startDate, endDate, storeId, accountId } = req.query;
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    const auditResult = await runDataCenterAudit({
      startDate: startStr,
      endDate: endStr,
      storeId: storeId ? String(storeId) : undefined,
      accountId: accountId ? String(accountId) : undefined
    });

    const freshness = await getFreshnessMeta();

    res.json({
      ...auditResult,
      freshness
    });
  } catch (err: any) {
    res.status(500).json({ error: "Data Center Audit failed", details: err.message });
  }
});

// 8. Data Center Rebuild endpoint
router.post("/rebuild", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      storeId,
      accountId,
      includeMetaAccounts = true,
      includeMetaStructure = true,
      includeMetaRawFacts = true,
      includeMetaLedger = true,
      includeAudience = true,
      includeStoreOrders = true,
      includeStoreLedger = true,
      rebuildStoreOrders = false
    } = req.body;

    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    const result = await runDataCenterRebuild({
      startDate: startStr,
      endDate: endStr,
      storeId: storeId ? String(storeId) : undefined,
      accountId: accountId ? String(accountId) : undefined,
      includeMetaAccounts: includeMetaAccounts !== false,
      includeMetaStructure: includeMetaStructure !== false,
      includeMetaRawFacts: includeMetaRawFacts !== false,
      includeMetaLedger: includeMetaLedger !== false,
      includeAudience: includeAudience !== false,
      includeStoreOrders: includeStoreOrders !== false,
      includeStoreLedger: includeStoreLedger !== false,
      rebuildStoreOrders: !!rebuildStoreOrders
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Data Center Rebuild failed", details: err.message });
  }
});

export default router;
