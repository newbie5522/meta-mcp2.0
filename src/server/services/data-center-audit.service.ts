// @ts-nocheck
import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getAccountMappingFacts } from "./mapping-fact.service.js";

/**
 * Audit service to detect data mismatches, sync blocks, mapping issues, and missing fields.
 */
export async function runDataCenterAudit(params: {
  startDate: string;
  endDate: string;
  storeId?: string | number | null;
  accountId?: string | null;
}) {
  const startDate = params.startDate;
  const endDate = params.endDate;

  // Build model and table checking map
  const modelCheck = {
    DataCenterStoreDaily: { exists: typeof prisma.dataCenterStoreDaily !== "undefined", rows: 0, message: "OK" },
    DataCenterMetaAccountDaily: { exists: typeof prisma.dataCenterMetaAccountDaily !== "undefined", rows: 0, message: "OK" },
    DataCenterRefreshRun: { exists: typeof prisma.dataCenterRefreshRun !== "undefined", rows: 0, message: "OK" },
    FactMetaPerformance: { exists: typeof prisma.factMetaPerformance !== "undefined", rows: 0, message: "OK" },
    Order: { exists: typeof prisma.order !== "undefined", rows: 0, message: "OK" },
    FactAudienceBreakdown: { exists: typeof prisma.factAudienceBreakdown !== "undefined", rows: 0, message: "OK" },
    Store: { exists: typeof prisma.store !== "undefined", rows: 0, message: "OK" },
    AdAccount: { exists: typeof prisma.adAccount !== "undefined", rows: 0, message: "OK" },
    AccountMapping: { exists: typeof prisma.accountMapping !== "undefined", rows: 0, message: "OK" },
    SyncLog: { exists: typeof prisma.syncLog !== "undefined", rows: 0, message: "OK" },
  };

  // Safe counts
  for (const [modelName, check] of Object.entries(modelCheck)) {
    if (check.exists) {
      try {
        const dbName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
        check.rows = await prisma[dbName].count();
      } catch (err: any) {
        check.exists = false;
        check.rows = 0;
        check.message = err.message || "TABLE_NOT_FOUND";
      }
    } else {
      check.message = "MODEL_NOT_FOUND_IN_PRISMA_CLIENT";
    }
  }

  // Filter Store ID
  let storeId: number | null = null;
  if (params.storeId !== undefined && params.storeId !== null && params.storeId !== "all" && params.storeId !== "null" && params.storeId !== "undefined" && params.storeId !== "") {
    storeId = Number(params.storeId);
  }

  // Filter Account ID
  let accountId: string | null = null;
  if (params.accountId !== undefined && params.accountId !== null && params.accountId !== "all" && params.accountId !== "null" && params.accountId !== "undefined" && params.accountId !== "") {
    accountId = normalizeMetaAccountId(params.accountId);
  }

  // Load all Stores with accounts to map
  const stores = modelCheck.Store.exists ? await prisma.store.findMany({
    include: { accounts: true, accountMappings: true }
  }) : [];

  // Find associated Meta account IDs for specified store
  const storeAccountIds: string[] = [];
  if (storeId) {
    const storeEntity = stores.find(s => s.id === storeId);
    if (storeEntity) {
      storeEntity.accounts?.forEach(acc => storeAccountIds.push(normalizeMetaAccountId(acc.fb_account_id)));
      storeEntity.accountMappings?.forEach(m => {
        if (m.fbAccountId) storeAccountIds.push(normalizeMetaAccountId(m.fbAccountId));
      });
    }
  }
  const uniqueStoreAccountIds = Array.from(new Set(storeAccountIds.filter(Boolean)));
  const uniqueStoreAccountIdsCanonical = uniqueStoreAccountIds.map(id => normalizeMetaAccountId(id));
  const uniqueStoreAccountIdsNumeric = uniqueStoreAccountIdsCanonical.map(id => id.replace(/^act_/, ""));
  const uniqueStoreAccountIdsAll = Array.from(new Set([
    ...uniqueStoreAccountIdsCanonical,
    ...uniqueStoreAccountIdsNumeric
  ]));

  // Setup queries
  const factMetaPerformanceFilters: any = {
    date: { gte: startDate, lte: endDate }
  };
  if (accountId) {
    const canonicalAccountId = normalizeMetaAccountId(params.accountId);
    const numericAccountId = canonicalAccountId.replace(/^act_/, "");
    factMetaPerformanceFilters.account_id = {
      in: [canonicalAccountId, numericAccountId]
    };
  } else if (storeId) {
    factMetaPerformanceFilters.account_id = { in: uniqueStoreAccountIdsAll };
  }

  const dcMetaAccountDailyFilters: any = {
    date: { gte: startDate, lte: endDate }
  };
  if (accountId) {
    const canonicalAccountId = normalizeMetaAccountId(params.accountId);
    const numericAccountId = canonicalAccountId.replace(/^act_/, "");
    dcMetaAccountDailyFilters.accountId = { in: [canonicalAccountId, numericAccountId] };
  } else if (storeId) {
    dcMetaAccountDailyFilters.storeId = storeId;
  }

  const orderFilters: any = {
    store_local_date: { gte: startDate, lte: endDate }
  };
  if (storeId) {
    orderFilters.storeId = storeId;
  }

  const dcStoreDailyFilters: any = {
    date: { gte: startDate, lte: endDate }
  };
  if (storeId) {
    dcStoreDailyFilters.storeId = storeId;
  }

  const audienceFilters: any = {
    date: { gte: startDate, lte: endDate }
  };
  if (accountId) {
    const canonicalAccountId = normalizeMetaAccountId(params.accountId);
    const numericAccountId = canonicalAccountId.replace(/^act_/, "");
    audienceFilters.account_id = { in: [canonicalAccountId, numericAccountId] };
  } else if (storeId) {
    audienceFilters.account_id = { in: uniqueStoreAccountIdsAll };
  }

  // Query actual records safely
  const factMetaRows = modelCheck.FactMetaPerformance.exists ? await prisma.factMetaPerformance.findMany({
    where: factMetaPerformanceFilters
  }) : [];

  const dcMetaRows = modelCheck.DataCenterMetaAccountDaily.exists ? await prisma.dataCenterMetaAccountDaily.findMany({
    where: dcMetaAccountDailyFilters
  }) : [];

  const orderRows = modelCheck.Order.exists ? await prisma.order.findMany({
    where: orderFilters
  }) : [];

  const dcStoreRows = modelCheck.DataCenterStoreDaily.exists ? await prisma.dataCenterStoreDaily.findMany({
    where: dcStoreDailyFilters
  }) : [];

  const audienceRows = modelCheck.FactAudienceBreakdown.exists ? await prisma.factAudienceBreakdown.findMany({
    where: audienceFilters
  }) : [];

  // 1. Process Meta Performance Fact vs Daily Ledger
  const fAccountRows = factMetaRows.filter(r => r.level === "account");
  const fCampaignRows = factMetaRows.filter(r => r.level === "campaign");
  const fAdsetRows = factMetaRows.filter(r => r.level === "adset");
  const fAdRows = factMetaRows.filter(r => r.level === "ad");

  const fSpend = fAccountRows.reduce((s, r) => s + (r.spend || 0), 0);
  const fImpressions = fAccountRows.reduce((s, r) => s + (r.impressions || 0), 0);
  const fClicks = fAccountRows.reduce((s, r) => s + (r.clicks || 0), 0);
  const fPurchases = fAccountRows.reduce((s, r) => s + (r.purchases || 0), 0);
  const fPurchaseValue = fAccountRows.reduce((s, r) => s + (r.purchase_value || 0), 0);
  const fAccountsWithSpend = new Set(fAccountRows.filter(r => (r.spend || 0) > 0).map(r => r.account_id)).size;
  const fLatestDate = fAccountRows.map(r => r.date).sort().reverse()[0] || null;
  const fLatestSyncedAt = fAccountRows.map(r => r.synced_at).filter(Boolean).sort((a,b) => b.getTime() - a.getTime())[0] || null;

  const dcSpend = dcMetaRows.reduce((s, r) => s + (r.spend || 0), 0);
  const dcImpressions = dcMetaRows.reduce((s, r) => s + (r.impressions || 0), 0);
  const dcClicks = dcMetaRows.reduce((s, r) => s + (r.clicks || 0), 0);
  const dcPurchases = dcMetaRows.reduce((s, r) => s + (r.purchases || 0), 0);
  const dcPurchaseValue = dcMetaRows.reduce((s, r) => s + (r.purchaseValue || 0), 0);
  const dcAccountsWithSpend = new Set(dcMetaRows.filter(r => (r.spend || 0) > 0).map(r => r.accountId)).size;
  const dcLatestDate = dcMetaRows.map(r => r.date).sort().reverse()[0] || null;
  const dcLatestFetchedAt = dcMetaRows.map(r => r.apiFetchedAt).filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] || null;

  const spendDiff = Number((dcSpend - fSpend).toFixed(2));
  const spendDiffRate = fSpend > 0 ? Number(((dcSpend - fSpend) / fSpend).toFixed(4)) : (dcSpend > 0 ? 1 : 0);
  const purchaseDiff = dcPurchases - fPurchases;
  const purchaseValueDiff = Number((dcPurchaseValue - fPurchaseValue).toFixed(2));

  let metaReconStatus = "OK";
  if (fSpend === 0 && dcSpend === 0) {
    metaReconStatus = "EMPTY";
  } else if (Math.abs(spendDiffRate) > 0.05) {
    metaReconStatus = "DISCREPANCY_LIMIT_EXCEEDED";
  } else {
    metaReconStatus = "MATCHED";
  }

  // 2. Process Store Orders Fact vs Store Daily Ledger
  const uniqueOrderMap = new Map<string, {
    orderTotal: number;
    lineRevenue: number;
    rows: number;
  }>();

  for (const o of orderRows) {
    const orderKey = String(o.orderId || o.id);
    if (!uniqueOrderMap.has(orderKey)) {
      uniqueOrderMap.set(orderKey, {
        orderTotal: Number(o.orderTotal || 0),
        lineRevenue: 0,
        rows: 0
      });
    }

    const item = uniqueOrderMap.get(orderKey)!;
    item.rows += 1;
    item.lineRevenue += Number(o.revenue || 0);

    if ((!item.orderTotal || item.orderTotal <= 0) && o.orderTotal && Number(o.orderTotal) > 0) {
      item.orderTotal = Number(o.orderTotal);
    }
  }

  const uniqueOrders = uniqueOrderMap.size;
  const orderTotalRevenue = Number(
    Array.from(uniqueOrderMap.values())
      .reduce((s, o) => s + (o.orderTotal > 0 ? o.orderTotal : o.lineRevenue), 0)
      .toFixed(2)
  );

  const lineRevenue = Number(
    Array.from(uniqueOrderMap.values())
      .reduce((s, o) => s + o.lineRevenue, 0)
      .toFixed(2)
  );

  const ordersWithMultipleRowsCount = Array.from(uniqueOrderMap.values())
    .filter(o => o.rows > 1).length;

  const oRevenue = Number(orderRows.filter(o => !o.refunded).reduce((s, o) => s + (o.revenue || 0), 0).toFixed(2));

  const missingStoreLocalDateCount = modelCheck.Order.exists ? await prisma.order.count({
    where: {
      store_local_date: null,
      ...(storeId ? { storeId: storeId } : {})
    }
  }) : 0;

  const latestStoreLocalDate = orderRows.map(o => o.store_local_date).filter(Boolean).sort().reverse()[0] || null;
  const latestCreatedAt = orderRows.map(o => o.createdAt).filter(Boolean).sort((a,b) => b.getTime() - a.getTime())[0] || null;

  const dcOrderCount = dcStoreRows.reduce((s, r) => s + (r.orderCount || 0), 0);
  const dcGrossSales = Number(dcStoreRows.reduce((s, r) => s + (r.grossSales || 0), 0).toFixed(2));
  const dcNetSales = Number(dcStoreRows.reduce((s, r) => s + (r.netSales || 0), 0).toFixed(2));
  const dcStoreLatestDate = dcStoreRows.map(r => r.date).sort().reverse()[0] || null;
  const dcStoreLatestFetchedAt = dcStoreRows.map(r => r.apiFetchedAt).filter(Boolean).sort((a,b) => b.getTime() - a.getTime())[0] || null;

  const orderCountDiff = dcOrderCount - uniqueOrders;
  const revenueDiff = Number((dcGrossSales - orderTotalRevenue).toFixed(2));
  const revenueDiffRate = orderTotalRevenue > 0 ? Number(((dcGrossSales - orderTotalRevenue) / orderTotalRevenue).toFixed(4)) : (dcGrossSales > 0 ? 1 : 0);

  let storeReconStatus = "OK";
  if (uniqueOrders === 0 && dcOrderCount === 0) {
    storeReconStatus = "EMPTY";
  } else if (Math.abs(revenueDiffRate) > 0.03) {
    storeReconStatus = "DISCREPANCY_LIMIT_EXCEEDED";
  } else {
    storeReconStatus = "MATCHED";
  }

  // 3. Process Audience breakdown
  const audCountryRows = audienceRows.filter(r => r.dimension_type === "country");
  const audAgeRows = audienceRows.filter(r => r.dimension_type === "age");
  const audGenderRows = audienceRows.filter(r => r.dimension_type === "gender");
  const audPlatformRows = audienceRows.filter(r => r.dimension_type === "publisher_platform" || r.dimension_type === "platform");

  const canonicalAudRows = audCountryRows.length > 0 ? audCountryRows : (audAgeRows.length > 0 ? audAgeRows : audienceRows);
  const audSpend = canonicalAudRows.reduce((s, r) => s + (r.spend || 0), 0);
  const audPurchases = canonicalAudRows.reduce((s, r) => s + (r.purchases || 0), 0);
  const audPurchaseValue = canonicalAudRows.reduce((s, r) => s + (r.purchase_value || 0), 0);
  const audLatestDate = audienceRows.map(r => r.date).sort().reverse()[0] || null;

  // 4. Mapping stats
  const storesCount = stores.length;
  const productionStoresCount = stores.filter(s =>
    s.mode === "production" || s.mode === "生产"
  ).length;
  const storesWithTokenCount = stores.filter(s => !!(s.shopline_token || s.shopify_token || s.shoplazza_token)).length;

  const mappingFacts = await getAccountMappingFacts({
    startDate,
    endDate,
    storeId: storeId || "all"
  });

  const adAccountsCount = mappingFacts.adAccountsInventoryTotal;
  const mappedAccountsCount = mappingFacts.mappedAccountsCount;
  const unmappedAccountsCount = mappingFacts.unmappedAccountsCount;
  const unmappedSpendAccounts = mappingFacts.unmappedSpendAccountsInRange;
  const unmappedSpend = mappingFacts.unmappedSpendAmount;
  const accountMappingRows = modelCheck.AccountMapping.exists ? await prisma.accountMapping.count() : 0;

  // 5. Sync processes
  const lastSyncLog = modelCheck.SyncLog.exists ? await prisma.syncLog.findFirst({
    orderBy: { startedAt: "desc" }
  }) : null;

  const recentFailedLogs = modelCheck.SyncLog.exists ? await prisma.syncLog.findMany({
    where: { status: "failed" },
    orderBy: { startedAt: "desc" },
    take: 10
  }) : [];

  const runningTasks = modelCheck.SyncLog.exists ? await prisma.syncLog.groupBy({
    by: ["type"],
    where: { status: { in: ["running", "pending", "syncing"] } },
    _count: { id: true }
  }) : [];

  const lastMetaFactSync = modelCheck.SyncLog.exists ? await prisma.syncLog.findFirst({
    where: {
      OR: [
        { type: "sync_meta_insights" },
        { taskType: "sync_meta_insights" }
      ]
    },
    orderBy: { startedAt: "desc" }
  }) : null;

  const lastMetaLedgerRefresh = modelCheck.SyncLog.exists ? await prisma.syncLog.findFirst({
    where: {
      OR: [
        { type: { contains: "refresh-meta" } },
        { taskType: { contains: "refresh-meta" } }
      ]
    },
    orderBy: { startedAt: "desc" }
  }) : null;

  const lastStoreOrderSync = modelCheck.SyncLog.exists ? await prisma.syncLog.findFirst({
    where: {
      OR: [
        { type: { in: ["shopify_orders", "shopline_orders", "shoplazza_orders", "sync_store_orders"] } },
        { taskType: { in: ["shopify_orders", "shopline_orders", "shoplazza_orders", "sync_store_orders"] } }
      ]
    },
    orderBy: { startedAt: "desc" }
  }) : null;

  const lastStoreLedgerRefresh = modelCheck.SyncLog.exists ? await prisma.syncLog.findFirst({
    where: {
      OR: [
        { type: { contains: "refresh-store" } },
        { taskType: { contains: "refresh-store" } }
      ]
    },
    orderBy: { startedAt: "desc" }
  }) : null;

  // 6. Diagnostics, Warnings, Blockers
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];

  // Meta Diagnoses
  if (fSpend > 0 && dcSpend === 0) {
    blockers.push("Meta facts 已存在，但 DataCenterMetaAccountDaily 未刷新。请运行 /api/sync/data-center/refresh-meta。");
    nextActions.push("触发 刷新 /api/sync/data-center/refresh-meta 接口以构建 DataCenter Meta 记账中间快照层。");
  } else if (dcSpend > 0 && fSpend === 0) {
    warnings.push("账户表现快照存在，但广告层级事实表为空。广告层级页可能无数据。请运行 sync_meta_insights。");
    nextActions.push("执行 sync_meta_insights，完整拉取底层成效明细层数据。");
  } else if (fSpend > 0 && dcSpend > 0 && Math.abs(spendDiffRate) > 0.05) {
    warnings.push("Meta facts 与 DataCenter ledger 花费不一致，需要检查 action_type / accountId / date range 口径。");
  } else if (fSpend === 0 && dcSpend === 0) {
    blockers.push("当前日期范围内无 Meta facts 与 DataCenter Meta ledger，需检查 Token、账户权限、同步日志。");
  }

  // Store Diagnoses
  if (uniqueOrders > 0 && dcOrderCount === 0) {
    blockers.push("Order 已存在，但 DataCenterStoreDaily 未刷新。请运行 /api/sync/data-center/refresh-store。");
    nextActions.push("触发 刷新 /api/sync/data-center/refresh-store 接口以重构 DataCenter 店铺主链归档账目每日快照。");
  } else if (dcOrderCount > 0 && uniqueOrders === 0) {
    warnings.push("DataCenterStoreDaily 有快照但 Order 事实表为空，需要确认是否两套店铺同步链路分裂。");
  }
  if (missingStoreLocalDateCount > 0) {
    warnings.push(`存在缺失 store_local_date 的历史订单 (共 ${missingStoreLocalDateCount} 个订单)，按日期查询可能漏单，需要执行 backfill。`);
    nextActions.push("建议运行订单的 store_local_date 历史回填归档任务，确保本地时间索引正确。");
  }
  if (uniqueOrders > 0 && dcOrderCount > 0 && Math.abs(revenueDiffRate) > 0.03) {
    warnings.push("Order 与 DataCenterStoreDaily 收入口径不一致，需要统一 orderTotal / grossSales 口径。");
  }
  if (uniqueOrders === 0 && dcOrderCount === 0) {
    blockers.push("当前日期范围无店铺订单数据，需要检查店铺 token、店铺 mode、平台支持情况。");
  }

  // Mapping Diagnoses
  if (unmappedSpendAccounts > 0) {
    warnings.push(`存在未绑定但有消耗账户 (共 ${unmappedSpendAccounts} 个)，这部分花费 $${unmappedSpend.toFixed(2)} 不会计入任何店铺 ROAS。`);
    nextActions.push("请前往店铺账户映射关系管理界面，为这些产生消耗的广告账户绑定店铺。");
  }
  if (productionStoresCount > 0 && storesWithTokenCount === 0) {
    blockers.push("生产店铺存在但未配置 API token，无法同步订单。");
  }
  if (adAccountsCount > 0 && mappedAccountsCount === 0) {
    warnings.push("广告账户未建立店铺映射，店铺 ROAS 不完整。");
  }

  // Audience Diagnoses
  if (fSpend > 0 && audienceRows.length === 0) {
    warnings.push("Meta 主成效已同步，但受众 breakdown 未同步，国家/年龄/平台分析不可用。");
  }

  // Country Data Completeness & Consistency checks
  const ordersWithCountry = orderRows.filter(r => r.shippingCountryCode || r.billingCountryCode).length;
  const orderCountryCoverageRate = orderRows.length > 0 ? (ordersWithCountry / orderRows.length) : 0;
  if (orderRows.length > 0 && orderCountryCoverageRate < 1.0) {
    warnings.push(`订单国家覆盖不完整: 有 ${( (1.0 - orderCountryCoverageRate) * 100 ).toFixed(1)}% 的订单存在国家字段缺失。建议运行 backfill 历史国别回填任务。`);
  }
  if (orderRows.length > 0 && audienceRows.length === 0) {
    warnings.push("店铺订单国家数据（通过 shipping/billing 地址）已可读，但 Meta 国别受众 breakdown 暂未同步。建议触发 Meta 受众同步进行双向比对。");
  }

  warnings.push("已接通订单与 Meta 广告国家级细分链路，支持在 [受众 / 国家] 界面进行双向归属比对。");

  // Sync Log Diagnoses
  if (recentFailedLogs.length > 0) {
    const lf = recentFailedLogs[0];
    warnings.push(`最近有失败的任务 [${lf.type}]: ${lf.errorMessage || lf.error || "未知错误"}`);
  }
  const nowObj = new Date();
  const hoursSinceLastSyncMeta = lastSyncLog ? (nowObj.getTime() - lastSyncLog.startedAt.getTime()) / (1000 * 60 * 60) : 999;
  if (hoursSinceLastSyncMeta > 24) {
    warnings.push("数据滞后。最近一次成功同步时间已经超过 24 小时。");
  }

  let status = "HEALTHY";
  if (blockers.length > 0) {
    status = "BLOCKED";
  } else if (warnings.length > 0) {
    status = "WARNING";
  }

  return {
    success: true,
    startDate,
    endDate,
    filters: {
      storeId,
      accountId
    },
    meta: {
      factMetaPerformance: {
        rows: factMetaRows.length,
        accountRows: fAccountRows.length,
        campaignRows: fCampaignRows.length,
        adsetRows: fAdsetRows.length,
        adRows: fAdRows.length,
        spend: fSpend,
        impressions: fImpressions,
        clicks: fClicks,
        purchases: fPurchases,
        purchaseValue: fPurchaseValue,
        accountsWithSpend: fAccountsWithSpend,
        latestDate: fLatestDate,
        latestSyncedAt: fLatestSyncedAt
      },
      dataCenterMetaAccountDaily: {
        rows: dcMetaRows.length,
        spend: dcSpend,
        impressions: dcImpressions,
        clicks: dcClicks,
        purchases: dcPurchases,
        purchaseValue: dcPurchaseValue,
        accountsWithSpend: dcAccountsWithSpend,
        latestDate: dcLatestDate,
        latestFetchedAt: dcLatestFetchedAt
      },
      reconciliation: {
        spendDiff,
        spendDiffRate,
        purchaseDiff,
        purchaseValueDiff,
        status: metaReconStatus
      }
    },
    store: {
      order: {
        rows: orderRows.length,
        uniqueOrders,
        revenue: oRevenue,
        orderTotalRevenue,
        lineRevenue,
        ordersWithMultipleRowsCount,
        missingStoreLocalDateCount,
        latestStoreLocalDate,
        latestCreatedAt
      },
      dataCenterStoreDaily: {
        rows: dcStoreRows.length,
        orderCount: dcOrderCount,
        grossSales: dcGrossSales,
        netSales: dcNetSales,
        latestDate: dcStoreLatestDate,
        latestFetchedAt: dcStoreLatestFetchedAt
      },
      reconciliation: {
        orderCountDiff,
        revenueDiff,
        revenueDiffRate,
        status: storeReconStatus
      }
    },
    audience: {
      factAudienceBreakdown: {
        rows: audienceRows.length,
        countryRows: audCountryRows.length,
        ageRows: audAgeRows.length,
        genderRows: audGenderRows.length,
        platformRows: audPlatformRows.length,
        spend: audSpend,
        purchases: audPurchases,
        purchaseValue: audPurchaseValue,
        latestDate: audLatestDate
      }
    },
    mapping: {
      storesCount,
      productionStoresCount,
      storesWithTokenCount,
      adAccountsCount,
      mappedAccountsCount,
      unmappedAccountsCount,
      unmappedSpendAccounts,
      unmappedSpend,
      accountMappingRows
    },
    sync: {
      lastSyncLog,
      recentFailedLogs,
      runningTasks,
      lastMetaFactSync,
      lastMetaLedgerRefresh,
      lastStoreOrderSync,
      lastStoreLedgerRefresh
    },
    diagnosis: {
      status,
      blockers,
      warnings,
      nextActions
    },
    dataSourceExplain: {
      metaFactSource: "FactMetaPerformance",
      metaLedgerSource: "DataCenterMetaAccountDaily",
      orderSource: "Order.store_local_date",
      storeLedgerSource: "DataCenterStoreDaily",
      audienceSource: "FactAudienceBreakdown",
      mappingSource: "AccountMapping + AdAccount"
    },
    endpointReaders: {
      storesEndpointPrimarySource: "DataCenterStoreDaily",
      accountsPerformancePrimarySource: "DataCenterMetaAccountDaily",
      detailEndpointPrimarySource: "FactMetaPerformance + Order",
      maxDatePrimarySource: "FactMetaPerformance + Order"
    },
    modelChecks: modelCheck
  };
}
