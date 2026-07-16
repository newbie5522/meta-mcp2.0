// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { getProductIntelligence } from "../services/product-intelligence.service.js";
import { getAggregatedCreativeInsights } from "../services/creative-insights.service.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getCountryAnalytics } from "../services/country-analytics.service.js";
import { getStoreOrderFacts, getStoreOrderSummary } from "../services/order-fact.service.js";
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

function coverageMetric(coverage: any, value: number) {
  return ["READY", "PARTIAL_COVERAGE", "TRUE_EMPTY"].includes(String(coverage?.status || ""))
    ? value
    : null;
}

export function resolveCampaignStructureFields(struct: any) {
  return {
    status: struct?.status || "UNKNOWN",
    objective: null,
    budget: null
  };
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
    const emptyMetaSummary = {
      spend: coverageMetric(audienceCoverage.metaCoverage, 0),
      impressions: coverageMetric(audienceCoverage.metaCoverage, 0),
      clicks: coverageMetric(audienceCoverage.metaCoverage, 0),
      purchases: coverageMetric(audienceCoverage.metaCoverage, 0),
      purchaseValue: coverageMetric(audienceCoverage.metaCoverage, 0),
      roas: coverageMetric(audienceCoverage.metaCoverage, 0),
      ctr: coverageMetric(audienceCoverage.metaCoverage, 0),
      cpc: coverageMetric(audienceCoverage.metaCoverage, 0),
      cpm: coverageMetric(audienceCoverage.metaCoverage, 0),
      cpa: coverageMetric(audienceCoverage.metaCoverage, 0)
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
        coverage: audienceCoverage.metaCoverage,
        sourceCoverage: audienceCoverage.metaCoverage,
        metaCoverage: audienceCoverage.metaCoverage,
        storeCoverage: audienceCoverage.storeCoverage,
        rows: [],
        summary: {
          totalSpend: emptyMetaSummary.spend,
          totalImpressions: emptyMetaSummary.impressions,
          totalClicks: emptyMetaSummary.clicks,
          totalPurchases: emptyMetaSummary.purchases,
          totalPurchaseValue: emptyMetaSummary.purchaseValue,
          ctr: emptyMetaSummary.ctr,
          cpc: emptyMetaSummary.cpc,
          cpm: emptyMetaSummary.cpm,
          cpa: emptyMetaSummary.cpa,
          roas: emptyMetaSummary.roas,
          meta: emptyMetaSummary,
          store: buildStoreSummary()
        },
        dataScope: audienceDataScope,
        filters: { startDate: startStr, endDate: endStr, storeId, accountId, campaignId, adsetId, adId, dimensionType: currentDimType },
        pagination: { page: Number(page || 1), pageSize: Number(pageSize || 50), totalItems: 0, totalPages: 0 },
        dataHealth: {
          status: "MISSING_META_BREAKDOWN",
          warnings: [],
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

    const totalItems = filteredRows.length;
    const totalPages = Math.ceil(totalItems / pageSizeNum);
    const paginatedRows = filteredRows.slice((pageNum - 1) * pageSizeNum, pageNum * pageSizeNum);

    // 9. Aggregated overall Summary
    const summarySpend = filteredRows.reduce((s, r) => s + r.spend, 0);
    const summaryImpressions = filteredRows.reduce((s, r) => s + r.impressions, 0);
    const summaryClicks = filteredRows.reduce((s, r) => s + r.clicks, 0);
    const summaryPurchases = filteredRows.reduce((s, r) => s + r.purchases, 0);
    const summaryPurchaseValue = filteredRows.reduce((s, r) => s + r.purchaseValue, 0);

    const summaryCtr = summaryImpressions > 0 ? (summaryClicks / summaryImpressions) : 0;
    const summaryCpc = summaryClicks > 0 ? (summarySpend / summaryClicks) : 0;
    const summaryCpm = summaryImpressions > 0 ? (summarySpend / summaryImpressions) * 1000 : 0;
    const summaryCpa = summaryPurchases > 0 ? (summarySpend / summaryPurchases) : 0;
    const summaryRoas = summarySpend > 0 ? (summaryPurchaseValue / summarySpend) : 0;

    const summary = {
      totalSpend: coverageMetric(audienceCoverage.metaCoverage, Number(summarySpend.toFixed(4))),
      totalImpressions: coverageMetric(audienceCoverage.metaCoverage, summaryImpressions),
      totalClicks: coverageMetric(audienceCoverage.metaCoverage, summaryClicks),
      totalPurchases: coverageMetric(audienceCoverage.metaCoverage, summaryPurchases),
      totalPurchaseValue: coverageMetric(audienceCoverage.metaCoverage, Number(summaryPurchaseValue.toFixed(4))),
      ctr: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCtr.toFixed(6))),
      cpc: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCpc.toFixed(4))),
      cpm: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCpm.toFixed(4))),
      cpa: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCpa.toFixed(4))),
      roas: coverageMetric(audienceCoverage.metaCoverage, Number(summaryRoas.toFixed(4))),
      meta: {
        spend: coverageMetric(audienceCoverage.metaCoverage, Number(summarySpend.toFixed(4))),
        impressions: coverageMetric(audienceCoverage.metaCoverage, summaryImpressions),
        clicks: coverageMetric(audienceCoverage.metaCoverage, summaryClicks),
        purchases: coverageMetric(audienceCoverage.metaCoverage, summaryPurchases),
        purchaseValue: coverageMetric(audienceCoverage.metaCoverage, Number(summaryPurchaseValue.toFixed(4))),
        roas: coverageMetric(audienceCoverage.metaCoverage, Number(summaryRoas.toFixed(4))),
        ctr: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCtr.toFixed(6))),
        cpc: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCpc.toFixed(4))),
        cpm: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCpm.toFixed(4))),
        cpa: coverageMetric(audienceCoverage.metaCoverage, Number(summaryCpa.toFixed(4)))
      },
      store: buildStoreSummary()
    };

    // 10. Data Health & Warning/Missing Messages
    const warnings: string[] = [];
    const missing: string[] = [];

    if (campaignId || adsetId || adId) {
      missing.push("当前受众 breakdown 仅同步账户层级，Campaign / AdSet / Ad 受众层级尚未同步。");
    }

    let healthStatus: "READY" | "PARTIAL" | "EMPTY" | "FAILED" = "READY";
    if (paginatedRows.length === 0) {
      return res.json({
        success: true,
        coverage: audienceCoverage.metaCoverage,
        sourceCoverage: audienceCoverage.metaCoverage,
        metaCoverage: audienceCoverage.metaCoverage,
        storeCoverage: audienceCoverage.storeCoverage,
        data: [],
        rows: [],
        summary: {
          totalSpend: emptyMetaSummary.spend,
          totalImpressions: emptyMetaSummary.impressions,
          totalClicks: emptyMetaSummary.clicks,
          totalPurchases: emptyMetaSummary.purchases,
          totalPurchaseValue: emptyMetaSummary.purchaseValue,
          ctr: emptyMetaSummary.ctr,
          cpc: emptyMetaSummary.cpc,
          cpm: emptyMetaSummary.cpm,
          cpa: emptyMetaSummary.cpa,
          roas: emptyMetaSummary.roas,
          meta: emptyMetaSummary,
          store: buildStoreSummary()
        },
        dataScope: audienceDataScope,
        dataHealth: {
          status: audienceCoverage.metaCoverage.status,
          reason: audienceCoverage.metaCoverage.status,
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
    } else if (missing.length > 0 || warnings.length > 0) {
      healthStatus = "PARTIAL";
    }

    res.json({
      success: true,
      coverage: audienceCoverage.metaCoverage,
      sourceCoverage: audienceCoverage.metaCoverage,
      metaCoverage: audienceCoverage.metaCoverage,
      storeCoverage: audienceCoverage.storeCoverage,
      data: paginatedRows,
      rows: paginatedRows,
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
        totalPages
      },
      dataHealth: {
        status: healthStatus,
        warnings,
        missing,
        source: "FactAudienceBreakdown",
        factRows: dbRows.length,
        structureRows: paginatedRows.length,
        dateRange: buildDateRange(startStr, endStr),
        queryDebug: buildQueryDebug({
          source: "FactAudienceBreakdown",
          storeId,
          accountId,
          includeUnmapped: true,
          includeZeroSpend: queryFlag(includeZeroSpend),
          mappedOnly: false,
          factRows: dbRows.length,
          structureRows: paginatedRows.length
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
    const visibleCountryRows = (Array.isArray(result.rows) ? result.rows : []).map((row: any) => ({
      ...row,
      metaSpend: coverageMetric(countryCoverage.metaCoverage, row.metaSpend),
      metaImpressions: coverageMetric(countryCoverage.metaCoverage, row.metaImpressions),
      metaClicks: coverageMetric(countryCoverage.metaCoverage, row.metaClicks),
      metaPurchases: coverageMetric(countryCoverage.metaCoverage, row.metaPurchases),
      metaPurchaseValue: coverageMetric(countryCoverage.metaCoverage, row.metaPurchaseValue),
      metaRoas: coverageMetric(countryCoverage.metaCoverage, row.metaRoas),
      cpc: coverageMetric(countryCoverage.metaCoverage, row.cpc),
      cpm: coverageMetric(countryCoverage.metaCoverage, row.cpm)
    }));
    const rawCountrySummary: any = result.summary || {};
    const visibleCountrySummary = {
      ...rawCountrySummary,
      countriesCount: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.countriesCount),
      countryCount: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.countryCount),
      orderCountriesCount: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.orderCountriesCount),
      orderCount: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.orderCount),
      revenue: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.revenue),
      averageOrderValue: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.averageOrderValue),
      totalOrderRevenue: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.totalOrderRevenue),
      totalOrderCount: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.totalOrderCount),
      orderProfit: coverageMetric(countryCoverage.storeCoverage, rawCountrySummary.orderProfit),
      metaCountriesCount: coverageMetric(countryCoverage.metaCoverage, rawCountrySummary.metaCountriesCount),
      totalMetaSpend: coverageMetric(countryCoverage.metaCoverage, rawCountrySummary.totalMetaSpend),
      totalMetaPurchases: coverageMetric(countryCoverage.metaCoverage, rawCountrySummary.totalMetaPurchases),
      totalMetaPurchaseValue: coverageMetric(countryCoverage.metaCoverage, rawCountrySummary.totalMetaPurchaseValue),
      unmappedMetaSpend: coverageMetric(countryCoverage.metaCoverage, rawCountrySummary.unmappedMetaSpend),
      unmappedMetaSpendRate: coverageMetric(countryCoverage.metaCoverage, rawCountrySummary.unmappedMetaSpendRate)
    };

    res.json({
      ...result,
      coverage: countryCoverage.storeCoverage,
      sourceCoverage: countryCoverage.storeCoverage,
      storeCoverage: countryCoverage.storeCoverage,
      metaCoverage: countryCoverage.metaCoverage,
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
        status: countryCoverage.storeCoverage.status,
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
router.post("/creatives/:creativeId/analyze", async (req, res) => {
  const { creativeId } = req.params;
  const { startDate, endDate, onlyCached } = req.body;

  try {
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const dateRange = `${startStr} 至 ${endStr}`;

    const existing = await prisma.aiAnalysisReport.findFirst({
      where: {
        entityId: creativeId,
        entityType: "creative",
        dateRange,
        model: "rule-diagnostic-engine"
      },
      orderBy: { createdAt: "desc" }
    });

    if (existing) {
      return res.json(existing);
    }

    if (onlyCached) {
      return res.json({ cached: false });
    }

    const relatedAds = await prisma.ad.findMany({
      where: { creativeId },
      select: { id: true }
    });

    const relatedAdIds = relatedAds.map(ad => ad.id).filter(Boolean);

    const orFilters: any[] = [
      { creative_id: creativeId }
    ];

    if (relatedAdIds.length > 0) {
      orFilters.push(
        { ad_id: { in: relatedAdIds } },
        { entity_id: { in: relatedAdIds } }
      );
    }

    const stats = await prisma.factMetaPerformance.findMany({
      where: {
        level: "ad",
        date: { gte: startStr, lte: endStr },
        OR: orFilters
      }
    });

    if (stats.length === 0) {
      return res.status(404).json({
        error: "NO_CANONICAL_CREATIVE_FACTS",
        message: "当前日期范围内没有找到该素材对应的 FactMetaPerformance 广告级成效数据。请先同步 Meta ad level insights 与素材结构。",
        creativeId,
        startDate: startStr,
        endDate: endStr,
        source: "FactMetaPerformance"
      });
    }

    const spend = stats.reduce((sum, item) => sum + (item.spend || 0), 0);
    const impressions = stats.reduce((sum, item) => sum + (item.impressions || 0), 0);
    const clicks = stats.reduce((sum, item) => sum + (item.clicks || 0), 0);
    const purchases = stats.reduce((sum, item) => sum + (item.purchases || 0), 0);
    const purchaseValue = stats.reduce((sum, item) => sum + (item.purchase_value || 0), 0);

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;

    const riskItems: string[] = [];
    if (spend > 100 && roas < 1.0) {
      riskItems.push(`高消耗低回收：花费 $${spend.toFixed(2)}，ROAS ${roas.toFixed(2)}x。`);
    }
    if (ctr > 0 && ctr < 1.0) {
      riskItems.push(`点击率偏低：CTR ${ctr.toFixed(2)}%，素材前置钩子可能不足。`);
    }
    if (purchases === 0 && spend > 50) {
      riskItems.push(`已有消耗但没有购买转化：建议检查落地页承接和素材受众匹配。`);
    }

    const report = await prisma.aiAnalysisReport.create({
      data: {
        type: "creative",
        entityType: "creative",
        entityId: creativeId,
        dateRange,
        conclusion: `【规则诊断模式】\n[时段：${startStr} ~ ${endStr}] 该素材基于 FactMetaPerformance 广告级真实数据计算：花费 $${spend.toFixed(2)}，CTR ${ctr.toFixed(2)}%，购买 ${purchases}，ROAS ${roas.toFixed(2)}x。`,
        dataBasis: `source=FactMetaPerformance;mode=rule_diagnostic_engine;Spend=$${spend.toFixed(2)};Impressions=${impressions};Clicks=${clicks};Purchases=${purchases};PurchaseValue=$${purchaseValue.toFixed(2)};CTR=${ctr.toFixed(2)}%;CPC=$${cpc.toFixed(2)};CPM=$${cpm.toFixed(2)};ROAS=${roas.toFixed(2)}`,
        riskPoints: riskItems.length > 0 ? riskItems.join("\n") : "✅ 当前素材在该周期内未触发明显高风险规则。",
        priority: roas < 1.0 && spend > 100 ? 1 : (ctr < 1.0 && spend > 50 ? 2 : 3),
        model: "rule-diagnostic-engine",
        metadata: JSON.stringify({
          mode: "rule_diagnostic_engine",
          primarySource: "FactMetaPerformance",
          creativeId,
          relatedAdIds,
          factRows: stats.length,
          metrics: {
            spend,
            impressions,
            clicks,
            purchases,
            purchaseValue,
            ctr,
            cpc,
            cpm,
            roas
          }
        })
      }
    });

    return res.json(report);
  } catch (error: any) {
    console.error("[Data Center API] Creative rule diagnosis error:", error);
    res.status(500).json({
      error: "Creative rule diagnosis failed",
      details: error.message
    });
  }
});

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

      const roasAvailable =
        ["READY", "PARTIAL_COVERAGE", "TRUE_EMPTY"].includes(storePageCoverage.storeCoverage.status) &&
        ["READY", "PARTIAL_COVERAGE", "TRUE_EMPTY"].includes(storePageCoverage.metaCoverage.status) &&
        adSpend > 0;
      const roas = roasAvailable ? Number((revenue / adSpend).toFixed(4)) : null;
      const visibleOrderCount = coverageMetric(storePageCoverage.storeCoverage, orderCount);
      const visibleRevenue = coverageMetric(storePageCoverage.storeCoverage, revenue);
      const visibleAov = coverageMetric(storePageCoverage.storeCoverage, orderCount > 0 ? Number((revenue / orderCount).toFixed(2)) : 0);
      const visibleAdSpend = coverageMetric(storePageCoverage.metaCoverage, Number(adSpend.toFixed(2)));

      return {
        id: store.id,
        storeId: store.id,
        name: store.name,
        storeName: store.name,
        platform: store.platform,
        domain: store.domain,
        timezone: store.timezone,
        orderCount: visibleOrderCount,
        ordersCount: visibleOrderCount,
        revenue: visibleRevenue,
        sales: visibleRevenue,
        totalSales: visibleRevenue,
        totalRefunded: null,
        avgOrderValue: visibleAov,
        aov: visibleAov,
        adSpend: visibleAdSpend,
        roas,
        realRoas: roas,
        hasOrders: visibleOrderCount === null ? null : visibleOrderCount > 0,
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
      // Exclude unpaid, pending, cancelled, or waiting orders from registered system totals
      const paymentStatus = o.paymentStatus ? String(o.paymentStatus).toLowerCase() : "";
      if (paymentStatus && ["waiting", "unpaid", "pending", "cancelled", "voided"].includes(paymentStatus)) {
        return;
      }
      const oId = o.orderId || o.id;
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
      const oId = String(o.orderId || o.id);
      const paymentStatus = o.paymentStatus ? String(o.paymentStatus).toLowerCase() : "";
      let includedByOrderFactRule = true;
      let excludeReason: string | null = null;
      if (paymentStatus && ["waiting", "unpaid", "pending", "cancelled", "voided"].includes(paymentStatus)) {
        includedByOrderFactRule = false;
        excludeReason = `Excluded by payment status: ${paymentStatus}`;
      }

      const orderTotal = o.orderTotal != null && o.orderTotal > 0 ? o.orderTotal : (o.revenue || 0);

      if (!orderFactMap.has(oId)) {
        orderFactMap.set(oId, {
          orderId: oId,
          orderNumber: o.orderId || oId,
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

    // C. DataCenterStoreDaily Ledger items
    const ledgerOrderMap = new Map<string, {
      orderId: string;
      amount: number;
      source: string;
      rawTime: string;
      status: string;
      includedByLedgerRule: boolean;
    }>();

    ledgers.forEach(l => {
      let digestObj: any = { orders: [] };
      try {
        if (l.rawDigestJson) {
          digestObj = JSON.parse(l.rawDigestJson);
        }
      } catch (e) {
        console.error("Failed to parse rawDigestJson in ledger row:", e);
      }

      const orders = digestObj.orders || [];
      orders.forEach((o: any) => {
        const oId = String(o.orderId || o.id || "");
        if (oId) {
          ledgerOrderMap.set(oId, {
            orderId: oId,
            amount: Number(o.amount || 0),
            source: o.source || "",
            rawTime: o.rawTime || "",
            status: o.status || "",
            includedByLedgerRule: true
          });
        }
      });
    });

    const ledgerOrdersList = Array.from(ledgerOrderMap.values());
    const ledgerOrderCount = ledgerOrdersList.length;
    const ledgerGrossSales = Number(ledgerOrdersList.reduce((sum, o) => sum + o.amount, 0).toFixed(2));
    const ledgerOrderIds = ledgerOrdersList.map(o => o.orderId);

    // Helper to build diff items
    const buildDiffItem = (oId: string, reasonOverride?: string) => {
      const fact = orderFactMap.get(oId);
      const ledg = ledgerOrderMap.get(oId);
      const api = apiOrderMap.get(oId);

      let reason = reasonOverride || "UNKNOWN";
      if (!reasonOverride) {
        if (fact) {
          const timezone = store.timezone || "America/Los_Angeles";
          const rawTime = fact.createdAtUtc || fact.items[0]?.createdAt?.toISOString() || "";
          const convertedLocalDate = rawTime ? dayjs(rawTime).tz(timezone).format("YYYY-MM-DD") : "";
          if (convertedLocalDate && (convertedLocalDate !== fact.storeLocalDate || convertedLocalDate < startStr || convertedLocalDate > endStr)) {
            reason = "TIMEZONE_BOUNDARY_MISMATCH";
          } else if (fact.paymentStatus && ["waiting", "unpaid", "pending", "cancelled", "voided"].includes(fact.paymentStatus.toLowerCase())) {
            reason = "PAYMENT_STATUS_EXCLUDED_BY_LEDGER";
          } else {
            reason = "STALE_ORDER_FACT_ROW";
          }
        } else if (api) {
          reason = "API_ONLY_UNSAVED";
        }
      }

      return {
        orderId: oId,
        orderNumber: fact?.orderNumber || api?.order_number || oId,
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
      if (fact && fact.includedByOrderFactRule && Math.abs(fact.orderTotal - ledg.amount) > 0.01) {
        amountMismatch.push(buildDiffItem(oId, "AMOUNT_FIELD_MISMATCH"));
      }
    }
    const reconciliationMatch =
      ledgerOrderCount === orderFactUniqueCount &&
      Math.abs(ledgerGrossSales - orderFactTotalSum) <= 0.01 &&
      orderFactNotInLedger.length === 0 &&
      ledgerNotInOrderFact.length === 0 &&
      amountMismatch.length === 0;

    res.json({
      startDate: startStr,
      endDate: endStr,
      storeName: store.name,
      platform: store.platform,
      timezone: store.timezone,
      canonicalSource: "DataCenterStoreDaily",
      systemOrdersCount: ledgerOrderCount,
      systemSalesAmount: ledgerGrossSales,
      legacyOrderFactOrdersCount: orderFactUniqueCount,
      legacyOrderFactSalesAmount: orderFactTotalSum,
      canonicalLedger: {
        orderCount: ledgerOrderCount,
        grossSales: ledgerGrossSales,
        orderIds: ledgerOrderIds
      },
      reconciliation: {
        readOnly: true,
        match: reconciliationMatch,
        comparedFields: ["orderCount", "grossSales", "orderIds", "amountMismatch"]
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
      platformMessage: "自动直连平台 API 已完成深度对账审计，上面表格为原始详细订单链路状态。",
      ledgerRefresh: ledgerRefreshResult
    });

  } catch (error: any) {
    console.error("[Reconciliation API] Error:", error);
    res.status(500).json({ error: "Failed to calculate reconciliation stats", details: error.message });
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

    const activeRowAccountIds = new Set(
      rows
        .filter(row =>
          Number(row.spend || 0) > 0 ||
          Number(row.impressions || 0) > 0 ||
          Number(row.clicks || 0) > 0 ||
          Number(row.purchases || 0) > 0 ||
          Number(row.purchaseValue || 0) > 0
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

      const spend = Number(accountRows.reduce((s, r) => s + Number(r.spend || 0), 0).toFixed(2));
      const impressions = accountRows.reduce((s, r) => s + Number(r.impressions || 0), 0);
      const reach = accountRows.reduce((s, r) => s + Number(r.reach || 0), 0);
      const clicks = accountRows.reduce((s, r) => s + Number(r.clicks || 0), 0);
      const purchases = accountRows.reduce((s, r) => s + Number(r.purchases || 0), 0);
      const purchaseValue = Number(accountRows.reduce((s, r) => s + Number(r.purchaseValue || 0), 0).toFixed(2));

      const latestFetchedAt = accountRows
        .map(r => r.apiFetchedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;

      return {
        ...acc,
        id: acc.fb_account_id,
        accountId: acc.fb_account_id,
        accountName: acc.fb_account_name,
        spend,
        impressions,
        reach,
        clicks,
        purchases,
        purchase_value: purchaseValue,
        purchaseValue,
        ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(4)) : 0,
        cpc: clicks > 0 ? Number((spend / clicks).toFixed(4)) : 0,
        cpm: impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(4)) : 0,
        roas: spend > 0 ? Number((purchaseValue / spend).toFixed(4)) : 0,
        latestFetchedAt,
        source: "DataCenterMetaAccountDaily",
        mode: "DATACENTER_LEDGER",
        snapshotRows: accountRows.length,
        hasSnapshot: accountRows.length > 0,
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

    results.sort((a, b) => b.spend - a.spend);

    const latestFetched = rows
      .map(r => r.apiFetchedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;

    const totalSpend = Number(results.reduce((sum, a) => sum + a.spend, 0).toFixed(2));
    const boundAccounts = results.filter(r => r.isBound).length;
    const unboundAccounts = results.filter(r => !r.isBound).length;

    const unboundSpend = Number(results.filter(r => !r.isBound).reduce((sum, r) => sum + r.spend, 0).toFixed(2));
    const unboundSpendAccounts = results.filter(r => !r.isBound && r.spend > 0).length;
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
      accountsWithSpendCount: results.filter(a => a.spend > 0).length,
      inventoryAccountCount: results.length,
      performanceAccountCount: results.filter(a => a.spend > 0 || a.impressions > 0 || a.clicks > 0 || a.purchases > 0).length,
      structureOnlyAccountCount: results.filter(a => a.spend === 0 && a.impressions === 0 && a.clicks === 0 && a.purchases === 0).length,
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
        status: rows.length > 0 ? "READY" : "EMPTY_FACTS",
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
        activeAccounts: results.filter(a => a.spend > 0).length,
        spendAccounts: results.filter(a => a.spend > 0).length,
        zeroSpendAccounts: results.filter(a => a.spend === 0).length,
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

/**
 * GET /api/data-center/ad-hierarchy/campaigns
 * Returns campaign level hierarchy aggregated from fact_meta_performance level='campaign'
 */
router.get("/ad-hierarchy/campaigns", async (req, res) => {
  const { accountId, includeZeroSpend } = req.query;
  try {
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId parameter" });
    }
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const appliedFilters = buildAppliedFilters({ startStr, endStr, accountId });
    const showAll = includeZeroSpend === "true";
    const canonicalHierarchy = await getCanonicalAdHierarchy({
      level: "campaign",
      accountId: String(accountId),
      startDate: startStr,
      endDate: endStr,
      includeZeroSpend: showAll
    });
    return res.json(canonicalHierarchy);
    const normAccountId = normalizeMetaAccountId(String(accountId));
    const numericAccountId = normAccountId.replace(/^act_/, "");
    const hierarchyCoverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      accountId: normAccountId,
      factLevel: "campaign"
    });

    // 1. Fetch performance rows
    const performanceRows = await prisma.factMetaPerformance.findMany({
      where: {
        level: "campaign",
        account_id: { in: [normAccountId, numericAccountId] },
        date: { gte: startStr, lte: endStr }
      }
    });

    // 2. Fetch structural Campaigns
    const structuralCamps = await prisma.campaign.findMany({
      where: { accountId: normAccountId }
    });

    const structMap = new Map<string, any>();
    structuralCamps.forEach(c => structMap.set(c.id, c));

    // 3. Aggregate daily performance
    const perfMap = new Map<string, any>();
    for (const row of performanceRows) {
      const campId = row.campaign_id || row.entity_id;
      if (!campId) continue;
      if (!perfMap.has(campId)) {
        perfMap.set(campId, {
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchase_value: 0
        });
      }
      const agg = perfMap.get(campId);
      agg.spend += row.spend || 0;
      agg.impressions += row.impressions || 0;
      agg.clicks += row.clicks || 0;
      agg.purchases += row.purchases || 0;
      agg.purchase_value += row.purchase_value || 0;
    }

    // 4. Build union keys of Campaigns
    const allCampIds = new Set<string>([
      ...perfMap.keys(),
      ...structMap.keys()
    ]);

    let results: any[] = [];
    for (const id of allCampIds) {
      const hasPerformanceFacts = perfMap.has(id);
      const agg = perfMap.get(id) || {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0
      };

      const struct = structMap.get(id);

      let name = struct?.name || id;
      let unsynced = !struct;
      if (unsynced) {
        name = `${id} (结构未同步)`;
      }

      // Campaign objective and budget are not persisted by the current schema.
      // Keep them unavailable instead of repurposing region or inventing zero.
      const { status, objective, budget } = resolveCampaignStructureFields(struct);

      const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
      const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
      const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
      const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : 0;
      const roas = agg.spend > 0 ? agg.purchase_value / agg.spend : 0;

      results.push({
        id,
        name,
        status,
        objective,
        budget,
        hasPerformanceFacts,
        spend: hasPerformanceFacts ? agg.spend : null,
        impressions: hasPerformanceFacts ? agg.impressions : null,
        clicks: hasPerformanceFacts ? agg.clicks : null,
        purchases: hasPerformanceFacts ? agg.purchases : null,
        purchaseValue: hasPerformanceFacts ? agg.purchase_value : null,
        purchase_value: hasPerformanceFacts ? agg.purchase_value : null,
        ctr: hasPerformanceFacts ? ctr : null,
        cpc: hasPerformanceFacts ? cpc : null,
        cpm: hasPerformanceFacts ? cpm : null,
        cpa: hasPerformanceFacts ? cpa : null,
        roas: hasPerformanceFacts ? roas : null,
        unsynced
      });
    }

    if (!showAll) {
      results = results.filter(r => r.spend > 0);
    }

    results.sort((a, b) => b.spend - a.spend);

    let reason = "OK";
    if (results.length === 0) {
      if (!accountId || String(accountId) === "undefined") {
        reason = "ACCOUNT_ID_FORMAT_MISMATCH";
      } else if (structuralCamps.length === 0) {
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
        level: "campaign",
        reason,
        factRows: performanceRows.length,
        structureRows: structuralCamps.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr,
          timezone: DATA_CENTER_TIMEZONE
        },
        accountId: normAccountId,
        queryDebug: {
          ...buildQueryDebug({
            source: "FactMetaPerformance level=campaign + Campaign",
            scope: "current_account",
            accountId: normAccountId,
            includeUnmapped: false,
            includeZeroSpend: showAll,
            mappedOnly: false,
            factRows: performanceRows.length,
            structureRows: structuralCamps.length
          }),
          level: "campaign"
        }
      },
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "FactMetaPerformance level=campaign + Campaign",
        noMockData: true
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, status: "ERROR", error: "HIERARCHY_CAMPAIGNS_QUERY_FAILED", details: error.message });
  }
});

/**
 * GET /api/data-center/ad-hierarchy/adsets
 * Returns adset level hierarchy aggregated from fact_meta_performance level='adset'
 */
router.get("/ad-hierarchy/adsets", async (req, res) => {
  const { accountId, campaignId, includeZeroSpend } = req.query;
  try {
    if (!accountId || !campaignId) {
      return res.status(400).json({ error: "Missing accountId or campaignId parameter" });
    }
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const appliedFilters = buildAppliedFilters({ startStr, endStr, accountId });
    const showAll = includeZeroSpend === "true";
    const canonicalHierarchy = await getCanonicalAdHierarchy({
      level: "adset",
      accountId: String(accountId),
      campaignId: String(campaignId),
      startDate: startStr,
      endDate: endStr,
      includeZeroSpend: showAll
    });
    return res.json(canonicalHierarchy);
    const normAccountId = normalizeMetaAccountId(String(accountId));
    const numericAccountId = normAccountId.replace(/^act_/, "");
    const hierarchyCoverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      accountId: normAccountId,
      factLevel: "adset",
      campaignId: String(campaignId)
    });

    // 1. Fetch performance rows
    const performanceRows = await prisma.factMetaPerformance.findMany({
      where: {
        level: "adset",
        account_id: { in: [normAccountId, numericAccountId] },
        campaign_id: String(campaignId),
        date: { gte: startStr, lte: endStr }
      }
    });

    // 2. Fetch structural AdSets
    const structuralAdsets = await prisma.adSet.findMany({
      where: { campaignId: String(campaignId) }
    });

    const structMap = new Map<string, any>();
    structuralAdsets.forEach(s => structMap.set(s.id, s));

    const campaign = await prisma.campaign.findUnique({
      where: { id: String(campaignId) }
    });
    const campaignName = campaign?.name || "未知广告系列";

    // 3. Aggregate daily performance
    const perfMap = new Map<string, any>();
    for (const row of performanceRows) {
      const adsetId = row.adset_id || row.entity_id;
      if (!adsetId) continue;
      if (!perfMap.has(adsetId)) {
        perfMap.set(adsetId, {
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchase_value: 0
        });
      }
      const agg = perfMap.get(adsetId);
      agg.spend += row.spend || 0;
      agg.impressions += row.impressions || 0;
      agg.clicks += row.clicks || 0;
      agg.purchases += row.purchases || 0;
      agg.purchase_value += row.purchase_value || 0;
    }

    // 4. Build union keys of AdSets
    const allAdsetIds = new Set<string>([
      ...perfMap.keys(),
      ...structMap.keys()
    ]);

    let results: any[] = [];
    for (const id of allAdsetIds) {
      const hasPerformanceFacts = perfMap.has(id);
      const agg = perfMap.get(id) || {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0
      };

      const struct = structMap.get(id);

      let name = struct?.name || id;
      let unsynced = !struct;
      if (unsynced) {
        name = `${id} (结构未同步)`;
      }

      const status = "UNKNOWN";

      const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
      const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
      const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
      const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : 0;
      const roas = agg.spend > 0 ? agg.purchase_value / agg.spend : 0;

      results.push({
        id,
        name,
        status,
        campaignName,
        hasPerformanceFacts,
        spend: hasPerformanceFacts ? agg.spend : null,
        impressions: hasPerformanceFacts ? agg.impressions : null,
        clicks: hasPerformanceFacts ? agg.clicks : null,
        purchases: hasPerformanceFacts ? agg.purchases : null,
        purchaseValue: hasPerformanceFacts ? agg.purchase_value : null,
        purchase_value: hasPerformanceFacts ? agg.purchase_value : null,
        ctr: hasPerformanceFacts ? ctr : null,
        cpc: hasPerformanceFacts ? cpc : null,
        cpm: hasPerformanceFacts ? cpm : null,
        cpa: hasPerformanceFacts ? cpa : null,
        roas: hasPerformanceFacts ? roas : null,
        unsynced
      });
    }

    if (!showAll) {
      results = results.filter(r => r.spend > 0);
    }

    results.sort((a, b) => b.spend - a.spend);

    let reason = "OK";
    if (results.length === 0) {
      if (!accountId || String(accountId) === "undefined") {
        reason = "ACCOUNT_ID_FORMAT_MISMATCH";
      } else if (!campaign) {
        reason = "CAMPAIGN_ID_MISMATCH";
      } else if (structuralAdsets.length === 0) {
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
        level: "adset",
        reason,
        factRows: performanceRows.length,
        structureRows: structuralAdsets.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr,
          timezone: DATA_CENTER_TIMEZONE
        },
        accountId: normAccountId,
        queryDebug: {
          ...buildQueryDebug({
            source: "FactMetaPerformance level=adset + AdSet",
            scope: "current_account",
            accountId: normAccountId,
            includeUnmapped: false,
            includeZeroSpend: showAll,
            mappedOnly: false,
            factRows: performanceRows.length,
            structureRows: structuralAdsets.length
          }),
          level: "adset",
          campaignId: String(campaignId)
        }
      },
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "FactMetaPerformance level=adset + AdSet",
        noMockData: true
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, status: "ERROR", error: "HIERARCHY_ADSETS_QUERY_FAILED", details: error.message });
  }
});

/**
 * GET /api/data-center/ad-hierarchy/ads
 * Returns ad level hierarchy aggregated from fact_meta_performance level='ad'
 */
router.get("/ad-hierarchy/ads", async (req, res) => {
  const { accountId, adsetId, includeZeroSpend } = req.query;
  try {
    if (!accountId || !adsetId) {
      return res.status(400).json({ error: "Missing accountId or adsetId parameter" });
    }
    const { startStr, endStr } = getAppliedDateRange(req.query);
    const appliedFilters = buildAppliedFilters({ startStr, endStr, accountId });
    const showAll = includeZeroSpend === "true";
    const canonicalHierarchy = await getCanonicalAdHierarchy({
      level: "ad",
      accountId: String(accountId),
      adsetId: String(adsetId),
      startDate: startStr,
      endDate: endStr,
      includeZeroSpend: showAll
    });
    return res.json(canonicalHierarchy);
    const normAccountId = normalizeMetaAccountId(String(accountId));
    const numericAccountId = normAccountId.replace(/^act_/, "");
    const hierarchyCoverage = await getDataSourceCoverage({
      source: "META_CREATIVE",
      requestedStartDate: startStr,
      requestedEndDate: endStr,
      accountId: normAccountId,
      factLevel: "ad",
      adsetId: String(adsetId)
    });

    // 1. Fetch performance rows
    const performanceRows = await prisma.factMetaPerformance.findMany({
      where: {
        level: "ad",
        account_id: { in: [normAccountId, numericAccountId] },
        adset_id: String(adsetId),
        date: { gte: startStr, lte: endStr }
      }
    });

    // 2. Fetch structural Ads
    const structuralAds = await prisma.ad.findMany({
      where: { adsetId: String(adsetId) },
      include: { adSet: { include: { campaign: true } } }
    });

    const structMap = new Map<string, any>();
    structuralAds.forEach(a => structMap.set(a.id, a));

    const adset = await prisma.adSet.findUnique({
      where: { id: String(adsetId) },
      include: { campaign: true }
    });
    const adsetName = adset?.name || "未知广告组";
    const campaignName = adset?.campaign?.name || "未知广告系列";

    // 3. Aggregate daily performance
    const perfMap = new Map<string, any>();
    for (const row of performanceRows) {
      const adId = row.ad_id || row.entity_id;
      if (!adId) continue;
      if (!perfMap.has(adId)) {
        perfMap.set(adId, {
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchase_value: 0,
          creative_id: row.creative_id
        });
      }
      const agg = perfMap.get(adId);
      agg.spend += row.spend || 0;
      agg.impressions += row.impressions || 0;
      agg.clicks += row.clicks || 0;
      agg.purchases += row.purchases || 0;
      agg.purchase_value += row.purchase_value || 0;
      if (row.creative_id) agg.creative_id = row.creative_id;
    }

    // 4. Build union keys of Ads
    const allAdIds = new Set<string>([
      ...perfMap.keys(),
      ...structMap.keys()
    ]);

    let results: any[] = [];
    for (const id of allAdIds) {
      const hasPerformanceFacts = perfMap.has(id);
      const agg = perfMap.get(id) || {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0,
        creative_id: ""
      };

      const struct = structMap.get(id);

      let name = struct?.name || id;
      let unsynced = !struct;
      if (unsynced) {
        name = `${id} (结构未同步)`;
      }

      const status = "UNKNOWN";
      const creativeId = struct?.creativeId || agg.creative_id || "N/A";

      const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
      const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
      const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
      const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : 0;
      const roas = agg.spend > 0 ? agg.purchase_value / agg.spend : 0;

      results.push({
        id,
        name,
        status,
        adsetName,
        campaignName,
        creativeId,
        hasPerformanceFacts,
        spend: hasPerformanceFacts ? agg.spend : null,
        impressions: hasPerformanceFacts ? agg.impressions : null,
        clicks: hasPerformanceFacts ? agg.clicks : null,
        purchases: hasPerformanceFacts ? agg.purchases : null,
        purchaseValue: hasPerformanceFacts ? agg.purchase_value : null,
        purchase_value: hasPerformanceFacts ? agg.purchase_value : null,
        ctr: hasPerformanceFacts ? ctr : null,
        cpc: hasPerformanceFacts ? cpc : null,
        cpm: hasPerformanceFacts ? cpm : null,
        cpa: hasPerformanceFacts ? cpa : null,
        roas: hasPerformanceFacts ? roas : null,
        unsynced
      });
    }

    if (!showAll) {
      results = results.filter(r => r.spend > 0);
    }

    results.sort((a, b) => b.spend - a.spend);

    let reason = "OK";
    if (results.length === 0) {
      if (!accountId || String(accountId) === "undefined") {
        reason = "ACCOUNT_ID_FORMAT_MISMATCH";
      } else if (!adset) {
        reason = "ADSET_ID_MISMATCH";
      } else if (structuralAds.length === 0) {
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
        level: "ad",
        reason,
        factRows: performanceRows.length,
        structureRows: structuralAds.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr,
          timezone: DATA_CENTER_TIMEZONE
        },
        accountId: normAccountId,
        queryDebug: {
          ...buildQueryDebug({
            source: "FactMetaPerformance level=ad + Ad",
            scope: "current_account",
            accountId: normAccountId,
            includeUnmapped: false,
            includeZeroSpend: showAll,
            mappedOnly: false,
            factRows: performanceRows.length,
            structureRows: structuralAds.length
          }),
          level: "ad",
          adsetId: String(adsetId)
        }
      },
      appliedFilters,
      dateRange: buildDateRange(startStr, endStr),
      dataSourceExplain: {
        dateFilterApplied: true,
        primarySource: "FactMetaPerformance level=ad + Ad",
        noMockData: true
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, status: "ERROR", error: "HIERARCHY_ADS_QUERY_FAILED", details: error.message });
  }
});

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
      accountId: isSpecificFilter(accountId) ? String(accountId) : undefined
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
    res.status(500).json({ success: false, status: "ERROR", error: "CREATIVE_INSIGHTS_QUERY_FAILED", details: error.message });
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

    let whereClause: any = {
      store_local_date: { gte: startStr, lte: endStr }
    };
    if (storeId && storeId !== "all") {
      whereClause.storeId = Number(storeId);
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: { store: true },
      orderBy: { createdAt: "desc" }
    });

    res.json({
      count: orders.length,
      orders: orders.map(o => ({
        id: o.id,
        orderId: o.orderId,
        customerName: o.contactEmail || o.contactPhone || "Anonymous Customer",
        createdAt: o.createdAt,
        storeLocalDate: o.store_local_date,
        total: o.orderTotal != null && o.orderTotal > 0 ? o.orderTotal : (o.revenue || 0),
        currency: o.currency || "USD",
        paymentStatus: o.paymentStatus || "paid",
        fulfillmentStatus: o.fulfillmentStatus || "unfulfilled",
        storeName: o.store?.name || "常规店铺"
      }))
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
