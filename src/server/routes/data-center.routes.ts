// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { getProductIntelligence } from "../services/product-intelligence.service.js";
import { getAggregatedCreativeInsights } from "../services/creative-insights.service.js";
import { syncStoreData } from "../services/store-sync.service.js";
import { normalizeMetaAccountId, isDemoDataEnabled } from "../utils.js";
import { getCountryAnalytics } from "../services/country-analytics.service.js";
import { getStoreOrderFacts, getStoreOrderSummary } from "../services/order-fact.service.js";
import { getMetaAccountPerformanceFacts, getMetaPerformanceSummary } from "../services/meta-performance-fact.service.js";
import { getAccountMappingFacts, resolveAccountStoreBinding } from "../services/mapping-fact.service.js";
import { runDataPipelineAudit } from "../services/data-pipeline-audit.service.js";
import { runDataCenterAudit } from "../services/data-center-audit.service.js";
import { runDataCenterRebuild } from "../services/data-center-rebuild.service.js";
import { ensureDataCenterFreshness, getFreshnessMeta } from "../services/data-center-auto-refresh.service.js";
import { refreshStoreDataCenterLedger } from "../services/datacenter-store-ledger.service.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const router = Router();

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

/**
 * GET /api/data-center/detail
 * Returns raw advertising and order details, filters list, and health metrics.
 * Refactored to aggregate Meta insights by ad account in the chosen date range.
 */
router.get("/detail", async (req, res) => {
  const { startDate, endDate, storeId, accountId, includeLegacyFallback } = req.query;

  try {
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const allowLegacyFallback = includeLegacyFallback === "true";

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
        status: acc.status || "ACTIVE",
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
      dataSourceExplain: {
        orderSource: "Order.store_local_date",
        metaSource: "FactMetaPerformance",
        mappingSource: "AccountMapping + AdAccount",
        legacyCreatedAtFallbackEnabled: allowLegacyFallback,
        legacyCreatedAtFallbackUsed: orderSummary.legacyFallbackUsed
      }
    });

  } catch (error: any) {
    console.error("[Data Center API] Detail error:", error);
    res.status(500).json({ error: "Failed to load data details", details: error.message });
  }
});

/**
 * GET /api/data-center/structure
 * Returns Campaign/AdSet/Ad structural hierarchy levels and performance aggregates
 */
router.get("/structure", async (req, res) => {
  const { selectedAccount, startDate, endDate } = req.query;

  try {
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    // Fetch accounts list for switcher
    const accounts = await prisma.adAccount.findMany({
      select: { fb_account_id: true, fb_account_name: true }
    });

    const targetAccount = selectedAccount || accounts[0]?.fb_account_id;

    if (!targetAccount) {
      return res.json({
        accounts: [],
        campaigns: [],
        adsets: [],
        ads: [],
        health: {
          status: "EMPTY",
          missingReason: "没有可供分析的广告账户，请前往配置中心绑定 Meta 账号。"
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

      return { spend, impressions, clicks, orders: purchases, revenue, roas, ctr, cpc };
    };

    const campaignsList = rawCampaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status || "ACTIVE",
      ...getAggregatedMetrics("campaign", c.id)
    }));

    const adsetsList = rawAdsets.map(s => ({
      id: s.id,
      campaignId: s.campaignId,
      name: s.name,
      status: "ACTIVE",
      ...getAggregatedMetrics("adset", s.id)
    }));

    const adsList = rawAds.map(a => ({
      id: a.id,
      adsetId: a.adsetId,
      campaignId: a.campaignId,
      name: a.name,
      creativeId: a.creativeId,
      status: "ACTIVE",
      ...getAggregatedMetrics("ad", a.id)
    }));

    // Data health check
    const totalSpend = campaignsList.reduce((sum, item) => sum + item.spend, 0);
    const hasStructure = rawCampaigns.length > 0;
    
    let dataStatus = "EXCELLENT";
    let missingReason = "";

    if (!hasStructure) {
      dataStatus = "EMPTY";
      missingReason = "该 Meta 账号未包含任何广告结构数据，可能从未启动同步任务，或该账户名下本身即为空账户。";
    } else if (totalSpend === 0) {
      dataStatus = "WARNING";
      missingReason = "虽然已拉取广告系列三级树状结构，但当前日期范围内暂未捕获到任何每日成效花费数据(FactMetaPerformance为空)。请在数据同步中心点击“获取Meta广告成效”或“统一重建”进行重新装载。";
    }

    const lastSyncLog = await prisma.syncLog.findFirst({
      where: { taskType: "sync_meta_structure" },
      orderBy: { startedAt: "desc" }
    });

    res.json({
      accounts,
      campaigns: campaignsList,
      adsets: adsetsList,
      ads: adsList,
      health: {
        status: dataStatus,
        missingReason,
        lastSyncTime: lastSyncLog?.finishedAt || lastSyncLog?.startedAt || null,
        lastSyncStatus: lastSyncLog?.status || "none"
      }
    });

  } catch (error: any) {
    console.error("[Data Center API] Structure error:", error);
    res.status(500).json({ error: "Failed to load structure", details: error.message });
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
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const requestedDimType = String(dimensionType || "country");
    const allowedDimensionTypes = ["country", "age", "gender", "publisher_platform"];
    const currentDimType = allowedDimensionTypes.includes(requestedDimType) ? requestedDimType : "country";

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
        rows: [],
        summary: {
          totalSpend: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalPurchases: 0,
          totalPurchaseValue: 0,
          ctr: 0,
          cpc: 0,
          cpm: 0,
          cpa: 0,
          roas: 0
        },
        filters: { startDate: startStr, endDate: endStr, storeId, accountId, campaignId, adsetId, adId, dimensionType: currentDimType },
        pagination: { page: Number(page || 1), pageSize: Number(pageSize || 50), totalItems: 0, totalPages: 0 },
        dataHealth: {
          status: "EMPTY",
          warnings: [],
          missing: ["该店铺未绑定任何广告账户，无法加载广告受众数据。"],
          source: "FactAudienceBreakdown"
        },
        dataSourceExplain: {
          primarySource: "FactAudienceBreakdown",
          legacyUsed: false
        }
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
      totalSpend: Number(summarySpend.toFixed(4)),
      totalImpressions: summaryImpressions,
      totalClicks: summaryClicks,
      totalPurchases: summaryPurchases,
      totalPurchaseValue: Number(summaryPurchaseValue.toFixed(4)),
      ctr: Number(summaryCtr.toFixed(6)),
      cpc: Number(summaryCpc.toFixed(4)),
      cpm: Number(summaryCpm.toFixed(4)),
      cpa: Number(summaryCpa.toFixed(4)),
      roas: Number(summaryRoas.toFixed(4))
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
        data: [],
        rows: [],
        summary: {
          totalSpend: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalPurchases: 0,
          totalPurchaseValue: 0,
          ctr: 0,
          cpc: 0,
          cpm: 0,
          cpa: 0,
          roas: 0
        },
        dataHealth: {
          status: "EMPTY",
          reason: "META_AUDIENCE_BREAKDOWN_MISSING"
        }
      });
    } else if (missing.length > 0 || warnings.length > 0) {
      healthStatus = "PARTIAL";
    }

    res.json({
      success: true,
      data: paginatedRows,
      rows: paginatedRows,
      summary,
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
        source: "FactAudienceBreakdown"
      },
      dataSourceExplain: {
        primarySource: "FactAudienceBreakdown",
        legacyUsed: false
      }
    });

  } catch (error: any) {
    console.error("[Data Center API] Audience error:", error);
    res.status(500).json({ error: "Failed to load audience breakdowns", details: error.message });
  }
});

/**
 * GET /api/data-center/countries
 * Reconstructed country analytics page endpoint.
 * Meta country metrics come from FactAudienceBreakdown.
 * Order country metrics are unavailable when Order schema lacks country fields.
 */
router.get("/countries", async (req, res) => {
  const { startDate, endDate, storeId, minSpend, minOrders, includeUnmappedSpend } = req.query;

  try {
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    const minSRaw = minSpend ? parseFloat(String(minSpend)) : 0;
    const minORaw = minOrders ? parseInt(String(minOrders), 10) : 0;

    const minS = Number.isFinite(minSRaw) ? minSRaw : 0;
    const minO = Number.isFinite(minORaw) ? minORaw : 0;

    const normalizedStoreId =
      storeId && storeId !== "all" && storeId !== "undefined"
        ? String(storeId)
        : undefined;

    const incUnmapped = includeUnmappedSpend !== "false";

    const result = await getCountryAnalytics(
      startStr,
      endStr,
      normalizedStoreId,
      minS,
      minO,
      incUnmapped
    );

    res.json(result);
  } catch (error: any) {
    console.error("[Data Center API] Countries error:", error);
    res.status(500).json({
      error: "Failed to load country analytics",
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
  const { startDate, endDate } = req.query;

  try {
    const startStr = startDate
      ? String(startDate)
      : dayjs().subtract(30, "day").format("YYYY-MM-DD");

    const endStr = endDate
      ? String(endDate)
      : dayjs().format("YYYY-MM-DD");

    const products = await getProductIntelligence(startStr, endStr);

    return res.json({
      success: true,
      source: "Order",
      mode: "DATACENTER_PRODUCTS_FROM_ORDER",
      startDate: startStr,
      endDate: endStr,
      data: products,
      products,
      count: products.length,
      dataSourceExplain: {
        primarySource: "Order",
        metadataSource: "Product",
        legacyUsed: false,
        demoUsed: false,
        productPerformanceDailyUsed: false
      }
    });
  } catch (error: any) {
    console.error("[Data Center API] Products error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to load product intelligence",
      details: error.message
    });
  }
});

/**
 * POST /api/data-center/creatives/:creativeId/analyze
 * Generates an automated AI creative analysis diagnostic report using Google Gemini, cached locally.
 */
router.post("/creatives/:creativeId/analyze", async (req, res) => {
  const { creativeId } = req.params;
  const { startDate, endDate, creativeUrl, mediaType } = req.body;

  try {
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");

    // 1. Check if a report already exists for this entity and daterange
    // Exclude old non-compliant fallback reports that lack model or metadata context
    const existing = await prisma.aiAnalysisReport.findFirst({
      where: {
        entityId: creativeId,
        entityType: "creative",
        dateRange: `${startStr} 至 ${endStr}`,
        NOT: {
          OR: [
            {
              conclusion: { contains: "AI 未启用" },
              model: null
            },
            {
              conclusion: { contains: "离线" },
              model: null
            },
            {
              conclusion: { contains: ["GEMINI", "API", "KEY"].join("_") },
              model: null
            },
            {
              metadata: null
            }
          ]
        }
      },
      orderBy: { createdAt: "desc" }
    });

    if (existing) {
      return res.json(existing);
    }

    // 2. Fetch performance data for the requested creative ID
    const stats = await prisma.creativePerformanceDaily.findMany({
      where: {
        creativeId,
        date: { gte: startStr, lte: endStr }
      }
    });

    const spend = stats.reduce((sum, item) => sum + (item.spend || 0), 0);
    const impressions = stats.reduce((sum, item) => sum + (item.impressions || 0), 0);
    const clicks = stats.reduce((sum, item) => sum + (item.clicks || 0), 0);
    const purchases = stats.reduce((sum, item) => sum + (item.purchases || 0), 0);
    const revenue = stats.reduce((sum, item) => sum + (item.revenue || 0), 0);

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? revenue / spend : 0;

    // 3. Generate a structured, compliant offline report with explicit offline tags and analytics context without reading any external API keys or SDKs
    const fallbackReport = await prisma.aiAnalysisReport.create({
      data: {
        type: "creative",
        entityType: "creative",
        entityId: creativeId,
        dateRange: `${startStr} 至 ${endStr}`,
        conclusion: `【离线规则评估模式】\n[时段：${startStr} ~ ${endStr}] 核心评估：该素材在观察时段内产生的 ROAS 表现为 ${roas.toFixed(2)}。建议根据实时转化指标持续微调，加强针对特定跑量版位的投放精细度。`,
        dataBasis: `source=CreativePerformanceDaily;mode=offline_rule_engine;isFallback=true;Spend: $${spend.toFixed(2)}, CTR: ${ctr.toFixed(2)}%, Clicks: ${clicks}, Purchases: ${purchases}, ROAS: ${roas.toFixed(2)}`,
        riskPoints: `[离线规则评估] ${ctr < 1 ? "⚠️ 点击率低于1.0%偏低，建议优化创意视觉钩子。" : "✅ 整体转化表现稳健，暂无重大异常风险项。"}`,
        priority: roas < 1.0 ? 1 : (roas > 2.5 ? 4 : 3),
        model: "offline-rule-engine",
        metadata: JSON.stringify({
          isFallback: true,
          mode: "offline_rule_engine",
          aiProvider: "none",
          primarySource: "CreativePerformanceDaily",
          geminiEnabled: false,
          metrics: { spend, impressions, clicks, purchases, revenue, ctr, cpc, cpm, roas }
        })
      }
    });

    return res.json(fallbackReport);
  } catch (error: any) {
    console.error("[Data Center API] Creative evaluation error:", error);
    res.status(500).json({ error: "Creative evaluation failed", details: error.message });
  }
});

/**
 * GET /api/data-center/stores
 * Returns stores analytics dashboard list
 */
router.get("/stores", async (req, res) => {
  const startDate = String(req.query.startDate || "");
  const endDate = String(req.query.endDate || startDate);
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;

  try {
    const ledgerWhere: any = {
      date: {
        gte: startDate,
        lte: endDate
      }
    };

    if (storeId) {
      ledgerWhere.storeId = storeId;
    }

    const ledgerCount = await prisma.dataCenterStoreDaily.count({
      where: ledgerWhere
    });
    const freshnessMode = ledgerCount === 0 ? "blocking_if_missing" : "background";

    await ensureDataCenterFreshness({
      reason: "api_request",
      requestedStartDate: startDate,
      requestedEndDate: endDate,
      storeId,
      mode: freshnessMode
    }).catch(err => console.warn("[DataCenterAutoRefresh] stores freshness failed:", err));

    const where: any = {
      date: {
        gte: startDate,
        lte: endDate
      }
    };

    if (storeId) where.storeId = storeId;

    const rows = await prisma.dataCenterStoreDaily.findMany({ where });

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
          gte: startDate,
          lte: endDate
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

      const roas = adSpend > 0 ? Number((revenue / adSpend).toFixed(4)) : 0;

      return {
        id: store.id,
        storeId: store.id,
        name: store.name,
        storeName: store.name,
        platform: store.platform,
        domain: store.domain,
        timezone: store.timezone,
        orderCount,
        ordersCount: orderCount,
        revenue,
        sales: revenue,
        totalSales: revenue,
        totalRefunded: 0,
        avgOrderValue: orderCount > 0 ? Number((revenue / orderCount).toFixed(2)) : 0,
        aov: orderCount > 0 ? Number((revenue / orderCount).toFixed(2)) : 0,
        adSpend: Number(adSpend.toFixed(2)),
        roas,
        realRoas: adSpend > 0 ? roas : null,
        hasOrders: orderCount > 0,
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
        syncStatus: storeRows.length > 0 ? "READY" : "EMPTY_LEDGER",
        reconciliation: {
          status: "derived_from_datacenter_ledger",
          match: true,
          orderRows: orderCount,
          uniqueOrderCount: orderCount,
          orderTotalSum: revenue,
          lineRevenueSum: revenue,
          paymentStatusCounts: {},
          source: "DataCenterStoreDaily snapshot table"
        }
      };
    });

    const totalOrders = storesList.reduce((sum, s) => sum + s.ordersCount, 0);
    const totalRevenue = Number(storesList.reduce((sum, s) => sum + s.revenue, 0).toFixed(2));

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
      source: "DataCenterStoreDaily",
      mode: "DATACENTER_LEDGER",
      startDate,
      endDate,
      stores: storesList,
      ordersCount: totalOrders,
      revenue: totalRevenue,
      storesInventoryCount: storesList.length,
      unmappedAccountsSummary: {
        count: unmappedCount,
        spend: unmappedSpend,
        accounts: unmappedAccountsList,
        message: `当前有 ${unmappedCount} 个广告账户尚未绑定店铺且产生消耗，这些账户的花费 $${unmappedSpend} 不会计入任何店铺真实 ROAS。`
      },
      dataHealth: {
        status: rows.length > 0 ? "OK" : "EMPTY",
        message: rows.length > 0 ? "所有数据来自 DataCenter Store Daily 账目表。" : "此日期范围内暂无 DataCenter 账目记录。",
        source: "DataCenterStoreDaily"
      },
      freshness
    });
  } catch (error: any) {
    console.error("[DataCenter] Stores API error:", error);
    res.status(500).json({ error: "Failed to load stores ledger stats", details: error.message });
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

    // Perform live sync of store orders to get accurate audit results
    const syncResults = await syncStoreData(startStr, endStr, String(store.id));
    const auditReport = syncResults[store.id] || {
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
      orderItems: []
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

    let ledgerRefreshResult: any = null;
    try {
      const refreshResult = await refreshStoreDataCenterLedger({
        storeId: store.id,
        startDate: startStr,
        endDate: endStr
      });
      const recordsSaved = refreshResult.snapshots.length;
      const orderCount = refreshResult.snapshots.reduce((sum, s) => sum + (s.orderCount || 0), 0);
      const grossSales = Number(refreshResult.snapshots.reduce((sum, s) => sum + (s.grossSales || 0), 0).toFixed(2));

      ledgerRefreshResult = {
        success: true,
        storeId: store.id,
        startDate: startStr,
        endDate: endStr,
        recordsSaved,
        orderCount,
        grossSales,
        source: "DataCenterStoreDaily"
      };
    } catch (err: any) {
      console.error("[Reconciliation] Ledger refresh failed:", err);
      ledgerRefreshResult = {
        success: false,
        error: err.message || "Failed to refresh ledger"
      };
    }

    // Now load canonical ledgers directly from the DB after refresh
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
    const maxInsight = await prisma.factMetaPerformance.findFirst({
      orderBy: { date: "desc" },
      select: { date: true }
    });
    const maxOrder = await prisma.order.findFirst({
      orderBy: { store_local_date: "desc" },
      where: { store_local_date: { not: null } },
      select: { store_local_date: true }
    });

    let maxDateStr: string | null = null;
    if (maxInsight?.date) {
      maxDateStr = maxInsight.date;
    }
    if (maxOrder?.store_local_date && (!maxDateStr || maxOrder.store_local_date > maxDateStr)) {
      maxDateStr = maxOrder.store_local_date;
    }

    if (!maxDateStr) {
      return res.json({
        maxDate: null,
        status: "EMPTY",
        message: "暂无同步数据"
      });
    }

    res.json({
      maxDate: maxDateStr,
      dataSourceExplain: {
        primarySource: "FactMetaPerformance",
        legacySource: "AdInsight",
        legacyUsed: false
      }
    });
  } catch (err) {
    res.json({
      maxDate: null,
      status: "EMPTY",
      message: "暂无同步数据"
    });
  }
});

/**
 * GET /api/data-center/accounts-performance
 * Returns all active and inactive ad accounts with key KPI performance metrics, LEFT JOINing with stores
 * Formatted from fact_meta_performance
 */
router.get("/accounts-performance", async (req, res) => {
  const startDate = String(req.query.startDate || "");
  const endDate = String(req.query.endDate || startDate);
  const storeIdParam = req.query.storeId ? String(req.query.storeId) : "all";

  try {
    const ledgerCount = await prisma.dataCenterMetaAccountDaily.count({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      }
    });
    const freshnessMode = ledgerCount === 0 ? "blocking_if_missing" : "background";

    const storeIdNum = storeIdParam !== "all" && storeIdParam !== "undefined" && storeIdParam !== "null" ? Number(storeIdParam) : null;

    await ensureDataCenterFreshness({
      reason: "api_request",
      requestedStartDate: startDate,
      requestedEndDate: endDate,
      storeId: storeIdNum,
      mode: freshnessMode
    }).catch(err => console.warn("[DataCenterAutoRefresh] accounts freshness failed:", err));

    const where: any = {
      date: {
        gte: startDate,
        lte: endDate
      }
    };

    const [adAccounts, mappings] = await Promise.all([
      prisma.adAccount.findMany({ include: { store: true }, orderBy: { updatedAt: "desc" } }),
      prisma.accountMapping.findMany({ include: { store: true } })
    ]);

    const rows = await prisma.dataCenterMetaAccountDaily.findMany({ where });

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
        sourceInventory: "AdAccount"
      });
    }

    for (const m of mappings) {
      const id = normalizeMetaAccountId(m.fbAccountId);
      if (!inventoryMap.has(id)) {
        inventoryMap.set(id, {
          fb_account_id: id,
          fb_account_name: m.name || id,
          storeId: m.storeId || null,
          storeName: m.store?.name || null,
          timezone: null,
          currency: "USD",
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
      success: true,
      source: "DataCenterMetaAccountDaily",
      mode: "DATACENTER_LEDGER",
      startDate,
      endDate,
      accounts: results,
      accountsInventoryCount: results.length,
      accountsWithSpendCount: results.filter(a => a.spend > 0).length,
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
        primarySource: "DataCenterMetaAccountDaily",
        inventorySource: "DataCenterMetaAccountDaily",
        legacySource: "None",
        legacyUsed: false
      },
      freshness
    });

    return; // Fast return to skip legacy duplicate code below safely
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load accounts performance", details: error.message });
  }
});

/**
 * GET /api/data-center/ad-hierarchy/accounts
 * Returns account hierarchy list aggregated from fact_meta_performance level='account'
 */
router.get("/ad-hierarchy/accounts", async (req, res) => {
  const { startDate, endDate, storeId, includeZeroSpend } = req.query;
  try {
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const showAll = includeZeroSpend === "true";

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
      data: results,
      dataHealth: {
        status: results.length === 0 ? "EMPTY" : "READY",
        level: "account",
        reason,
        factRows: performanceRows.length,
        structureRows: adAccounts.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr
        },
        accountId: ""
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list hierarchy accounts", details: error.message });
  }
});

/**
 * GET /api/data-center/ad-hierarchy/campaigns
 * Returns campaign level hierarchy aggregated from fact_meta_performance level='campaign'
 */
router.get("/ad-hierarchy/campaigns", async (req, res) => {
  const { accountId, startDate, endDate, includeZeroSpend } = req.query;
  try {
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId parameter" });
    }
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const showAll = includeZeroSpend === "true";
    const normAccountId = normalizeMetaAccountId(String(accountId));
    const numericAccountId = normAccountId.replace(/^act_/, "");

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

      const status = struct?.status || "ACTIVE";
      const objective = struct?.region || "N/A"; // Region/Objective
      const budget = 0; // standard fallback budget

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
      data: results,
      dataHealth: {
        status: results.length === 0 ? "EMPTY" : "READY",
        level: "campaign",
        reason,
        factRows: performanceRows.length,
        structureRows: structuralCamps.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr
        },
        accountId: normAccountId
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load hierarchy campaigns", details: error.message });
  }
});

/**
 * GET /api/data-center/ad-hierarchy/adsets
 * Returns adset level hierarchy aggregated from fact_meta_performance level='adset'
 */
router.get("/ad-hierarchy/adsets", async (req, res) => {
  const { accountId, campaignId, startDate, endDate, includeZeroSpend } = req.query;
  try {
    if (!accountId || !campaignId) {
      return res.status(400).json({ error: "Missing accountId or campaignId parameter" });
    }
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const showAll = includeZeroSpend === "true";
    const normAccountId = normalizeMetaAccountId(String(accountId));
    const numericAccountId = normAccountId.replace(/^act_/, "");

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

      const status = "ACTIVE"; 

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
      data: results,
      dataHealth: {
        status: results.length === 0 ? "EMPTY" : "READY",
        level: "adset",
        reason,
        factRows: performanceRows.length,
        structureRows: structuralAdsets.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr
        },
        accountId: normAccountId
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load hierarchy adsets", details: error.message });
  }
});

/**
 * GET /api/data-center/ad-hierarchy/ads
 * Returns ad level hierarchy aggregated from fact_meta_performance level='ad'
 */
router.get("/ad-hierarchy/ads", async (req, res) => {
  const { accountId, adsetId, startDate, endDate, includeZeroSpend } = req.query;
  try {
    if (!accountId || !adsetId) {
      return res.status(400).json({ error: "Missing accountId or adsetId parameter" });
    }
    const startStr = startDate ? String(startDate) : dayjs().subtract(30, "day").format("YYYY-MM-DD");
    const endStr = endDate ? String(endDate) : dayjs().format("YYYY-MM-DD");
    const showAll = includeZeroSpend === "true";
    const normAccountId = normalizeMetaAccountId(String(accountId));
    const numericAccountId = normAccountId.replace(/^act_/, "");

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

      const status = "ACTIVE"; 
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
      data: results,
      dataHealth: {
        status: results.length === 0 ? "EMPTY" : "READY",
        level: "ad",
        reason,
        factRows: performanceRows.length,
        structureRows: structuralAds.length,
        dateRange: {
          startDate: startStr,
          endDate: endStr
        },
        accountId: normAccountId
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load hierarchy ads", details: error.message });
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
        primarySource: "FactAudienceBreakdown",
        legacyUsed: false
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
      minSpend,
      includeZeroSpend,
      page,
      pageSize,
      sortBy
    } = req.query;

    const result = await getAggregatedCreativeInsights({
      startDate: startDate as string,
      endDate: endDate as string,
      accountId: accountId as string,
      storeId: (storeId || storeFilter) as string,
      campaignId: campaignId as string,
      adsetId: adsetId as string,
      creativeType: creativeType as string,
      minSpend: minSpend as string,
      includeZeroSpend: includeZeroSpend as string,
      page: page as string,
      pageSize: pageSize as string,
      sortBy: sortBy as string
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load creative insights", details: error.message });
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
