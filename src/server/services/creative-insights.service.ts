import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { normalizeMetaAccountId } from "../utils.js";

type CreativeType = "IMAGE" | "VIDEO" | "CAROUSEL" | "UNKNOWN";

export interface AggregatedCreative {
  id: string;
  key: string;
  creativeId: string;
  creativeIds: string[];
  adIds: string[];
  campaignIds: string[];
  adsetIds: string[];
  accountIds: string[];
  accountId: string;
  accountName: string;
  accountNames: string[];
  fb_account_name: string;
  storeId: number | null;
  storeName: string;
  creativeName: string;
  title: string;
  body: string | null;
  link_url: string | null;
  previewUrl: string;
  imageUrl: string;
  type: CreativeType;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  revenue: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  meta_roas: number;
  roas: number;
  frequency: null;
  frequencyAvailable: false;
  reach: number | null;
  reachAvailable: boolean;
  addToCart: number | null;
  addToCartAvailable: boolean;
  productLink: string | null;
  productLinkAvailable: boolean;
  hookRate: null;
  hookRateAvailable: false;
  opsScore: number | null;
  opsBucket: string | null;
  opsBucketLabel: string;
  recommendedAction: string | null;
  diagnosisReason: string;
  fatigueScore: number | null;
  riskLevel: string;
  hasPerformanceFacts: boolean;
  campaignCount: number;
  adsetCount: number;
  adCount: number;
  campaignId: string;
  adsetId: string;
  adId: string;
  adName: string;
  performanceSyncedAt: string | null;
  latestPerformanceDate: string | null;
  syncedAt: string | null;
}

type MetricTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
};

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function parseCreativeType(value: string | null | undefined): CreativeType {
  const normalized = String(value || "").toUpperCase();
  if (normalized.includes("CAROUSEL")) return "CAROUSEL";
  if (normalized.includes("IMAGE")) return "IMAGE";
  if (normalized.includes("VIDEO")) return "VIDEO";
  return "UNKNOWN";
}

function creativeKey(creative: any, creativeId: string, adId: string): string {
  return creative?.imageHash || creative?.videoHash || creative?.metaAssetId || creativeId || adId;
}

function parseRawPayload(raw: string | null | undefined): any | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractReach(payload: any): number | null {
  const value = payload?.reach;
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractAddToCart(payload: any): number | null {
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  let found = false;
  let total = 0;
  for (const action of actions) {
    const type = String(action?.action_type || action?.type || "").toLowerCase();
    if (type === "add_to_cart" || type.endsWith(".add_to_cart") || type.includes("add_to_cart")) {
      found = true;
      total += finiteNumber(action?.value);
    }
  }
  return found ? total : null;
}

function summarize(rows: AggregatedCreative[]) {
  const totals = rows.reduce<MetricTotals>((sum, row) => ({
    spend: sum.spend + row.spend,
    impressions: sum.impressions + row.impressions,
    clicks: sum.clicks + row.clicks,
    purchases: sum.purchases + row.purchases,
    purchaseValue: sum.purchaseValue + row.purchase_value
  }), { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0 });

  return {
    performanceCount: rows.length,
    spend: fixed(totals.spend, 2),
    impressions: totals.impressions,
    clicks: totals.clicks,
    purchases: totals.purchases,
    purchaseValue: fixed(totals.purchaseValue, 2),
    ctr: totals.impressions > 0 ? fixed((totals.clicks / totals.impressions) * 100) : 0,
    cpc: totals.clicks > 0 ? fixed(totals.spend / totals.clicks) : 0,
    cpm: totals.impressions > 0 ? fixed((totals.spend / totals.impressions) * 1000) : 0,
    cpa: totals.purchases > 0 ? fixed(totals.spend / totals.purchases) : 0,
    roas: totals.spend > 0 ? fixed(totals.purchaseValue / totals.spend) : 0
  };
}

function classifyCreative(item: {
  hasPerformanceFacts: boolean;
  spend: number;
  purchases: number;
  roas: number;
  ctr: number;
}) {
  if (!item.hasPerformanceFacts) {
    return {
      opsBucket: null,
      opsBucketLabel: "数据不足",
      opsScore: null,
      recommendedAction: null,
      diagnosisReason: "当前筛选周期无素材成效事实",
      fatigueScore: null,
      riskLevel: "数据不足"
    };
  }

  let opsBucket = "watching";
  let opsBucketLabel = "观察中";
  let recommendedAction = "继续观察当前周期的真实成效";
  let diagnosisReason = "当前事实尚未达到扩量或止损阈值";
  let riskLevel = "观察中";

  if (item.spend >= 20 && item.purchases > 0 && item.roas >= 1.5) {
    opsBucket = "scale_candidate";
    opsBucketLabel = "扩量候选";
    recommendedAction = "评估提高预算或复制同类素材";
    diagnosisReason = "已有购买且 Meta ROAS 达到扩量观察线";
    riskLevel = "较低";
  } else if (item.ctr >= 1.5 && item.spend < 30 && item.purchases === 0) {
    opsBucket = "high_ctr_test";
    opsBucketLabel = "高点击测试";
    recommendedAction = "继续小预算验证落地页承接";
    diagnosisReason = "点击率较高但购买尚未验证";
    riskLevel = "观察中";
  } else if (item.spend >= 30 && item.purchases === 0) {
    opsBucket = "inefficient_stop";
    opsBucketLabel = "低效止损";
    recommendedAction = "评估暂停或重做素材角度";
    diagnosisReason = "花费达到观察线但没有购买";
    riskLevel = "较高";
  } else if (item.spend >= 20 && item.roas < 1) {
    opsBucket = "fatigue_warning";
    opsBucketLabel = "疲劳预警";
    recommendedAction = "准备替换素材或降低预算";
    diagnosisReason = "当前 Meta ROAS 低于观察线";
    riskLevel = "较高";
  }

  const opsScore = fixed(Math.max(0, Math.min(100,
    Math.min(50, item.roas * 20) + Math.min(30, item.ctr * 6) + Math.min(20, item.purchases * 4)
  )), 1);

  return {
    opsBucket,
    opsBucketLabel,
    opsScore,
    recommendedAction,
    diagnosisReason,
    fatigueScore: null,
    riskLevel
  };
}

export async function getAggregatedCreativeInsights(params: {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  storeId?: string;
  campaignId?: string;
  adsetId?: string;
  creativeType?: string;
  opsBucket?: string;
  search?: string;
  minSpend?: string | number;
  includeZeroSpend?: boolean | string;
  page?: string | number;
  pageSize?: string | number;
  sortBy?: string;
  export?: boolean | string;
}) {
  const startStr = params.startDate || dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const endStr = params.endDate || dayjs().format("YYYY-MM-DD");
  const filterAccountId = params.accountId && params.accountId !== "all" ? normalizeMetaAccountId(params.accountId) : null;
  const filterStoreId = params.storeId && params.storeId !== "all" ? Number(params.storeId) : null;
  const filterCampaignId = params.campaignId && params.campaignId !== "all" ? params.campaignId : null;
  const filterAdsetId = params.adsetId && params.adsetId !== "all" ? params.adsetId : null;
  const filterType = params.creativeType && params.creativeType !== "ALL" ? String(params.creativeType).toUpperCase() : null;
  const filterBucket = params.opsBucket && params.opsBucket !== "ALL" ? String(params.opsBucket) : null;
  const search = String(params.search || "").trim().toLowerCase();
  const minSpend = Math.max(0, finiteNumber(params.minSpend));
  const includeZero = params.includeZeroSpend === true || params.includeZeroSpend === "true";
  const exportRequested = params.export === true || params.export === "true";
  const page = Math.max(1, Math.floor(finiteNumber(params.page) || 1));
  const pageSize = Math.max(1, Math.min(500, Math.floor(finiteNumber(params.pageSize) || 50)));
  const exportLimit = 5000;

  const [totalAdPerfCount, ads, creatives, stores, mappings, adAccounts] = await Promise.all([
    prisma.factMetaPerformance.count({ where: { level: "ad" } }),
    prisma.ad.findMany({ include: { adSet: { include: { campaign: true } } } }),
    prisma.adCreative.findMany(),
    prisma.store.findMany(),
    prisma.accountMapping.findMany(),
    prisma.adAccount.findMany()
  ]);

  const adMap = new Map(ads.map((ad: any) => [ad.id, ad]));
  const creativeMap = new Map(creatives.map((creative: any) => [creative.creativeId, creative]));
  const storeMap = new Map(stores.map((store: any) => [store.id, store.name]));
  const accountNameMap = new Map<string, string>();
  const accountToStoreMap = new Map<string, number>();
  for (const mapping of mappings as any[]) {
    if (mapping.storeId) accountToStoreMap.set(normalizeMetaAccountId(mapping.fbAccountId), mapping.storeId);
  }
  for (const account of adAccounts as any[]) {
    const accountId = normalizeMetaAccountId(account.fb_account_id);
    accountNameMap.set(accountId, account.fb_account_name || "");
    if (account.storeId) accountToStoreMap.set(accountId, account.storeId);
  }

  const storeAccountIds = filterStoreId === null
    ? null
    : new Set(Array.from(accountToStoreMap.entries()).filter(([, storeId]) => storeId === filterStoreId).map(([accountId]) => accountId));

  if (filterAccountId && storeAccountIds && !storeAccountIds.has(filterAccountId)) {
    return emptyResponse({ page, pageSize, startStr, endStr, totalAdPerfCount, ads, creatives, includeZero, exportRequested });
  }

  const performanceWhere: any = { level: "ad", date: { gte: startStr, lte: endStr } };
  if (filterAccountId) performanceWhere.account_id = filterAccountId;
  else if (storeAccountIds) performanceWhere.account_id = { in: Array.from(storeAccountIds) };
  if (filterCampaignId) performanceWhere.campaign_id = filterCampaignId;
  if (filterAdsetId) performanceWhere.adset_id = filterAdsetId;

  const factRows = await prisma.factMetaPerformance.findMany({ where: performanceWhere });
  const grouped = new Map<string, any>();
  const keysWithFacts = new Set<string>();
  const singleDay = startStr === endStr;

  for (const row of factRows as any[]) {
    const adId = row.ad_id || row.entity_id;
    const ad: any = adMap.get(adId);
    const creativeId = row.creative_id || ad?.creativeId || "";
    const creative: any = creativeMap.get(creativeId);
    const key = creativeKey(creative, creativeId, adId);
    keysWithFacts.add(key);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        creativeId: creativeId || adId,
        creativeIds: new Set<string>(), adIds: new Set<string>(), campaignIds: new Set<string>(),
        adsetIds: new Set<string>(), accountIds: new Set<string>(), accountNames: new Set<string>(),
        storeId: creative?.storeId || accountToStoreMap.get(normalizeMetaAccountId(row.account_id)) || null,
        creative,
        spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0,
        reach: 0, reachSeen: false, addToCart: 0, addToCartSeen: false,
        maxSyncedAt: null as Date | null, latestPerformanceDate: null as string | null
      });
    }
    const item = grouped.get(key);
    if (creativeId) item.creativeIds.add(creativeId);
    if (adId) item.adIds.add(adId);
    const campaignId = row.campaign_id || ad?.campaignId || ad?.adSet?.campaignId || "";
    const adsetId = row.adset_id || ad?.adsetId || "";
    const accountId = normalizeMetaAccountId(row.account_id);
    if (campaignId) item.campaignIds.add(campaignId);
    if (adsetId) item.adsetIds.add(adsetId);
    if (accountId) item.accountIds.add(accountId);
    const accountName = accountNameMap.get(accountId);
    if (accountName) item.accountNames.add(accountName);
    item.spend += finiteNumber(row.spend);
    item.impressions += finiteNumber(row.impressions);
    item.clicks += finiteNumber(row.clicks);
    item.purchases += finiteNumber(row.purchases);
    item.purchaseValue += finiteNumber(row.purchase_value);
    const payload = parseRawPayload(row.raw_payload);
    const rawReach = singleDay ? extractReach(payload) : null;
    if (rawReach !== null) { item.reach += rawReach; item.reachSeen = true; }
    const rawAddToCart = extractAddToCart(payload);
    if (rawAddToCart !== null) { item.addToCart += rawAddToCart; item.addToCartSeen = true; }
    if (row.synced_at && (!item.maxSyncedAt || row.synced_at > item.maxSyncedAt)) item.maxSyncedAt = row.synced_at;
    if (row.date && (!item.latestPerformanceDate || row.date > item.latestPerformanceDate)) item.latestPerformanceDate = row.date;
  }

  let performanceRows: AggregatedCreative[] = Array.from(grouped.values()).map((item: any) => {
    const creative = item.creative;
    const creativeIds = Array.from(item.creativeIds) as string[];
    const adIds = Array.from(item.adIds) as string[];
    const campaignIds = Array.from(item.campaignIds) as string[];
    const adsetIds = Array.from(item.adsetIds) as string[];
    const accountIds = Array.from(item.accountIds) as string[];
    const accountNames = Array.from(item.accountNames) as string[];
    const hasPerformanceFacts = item.spend > 0 || item.impressions > 0 || item.clicks > 0 || item.purchases > 0 || item.purchaseValue > 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;
    const cpm = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0;
    const cpa = item.purchases > 0 ? item.spend / item.purchases : 0;
    const roas = item.spend > 0 ? item.purchaseValue / item.spend : 0;
    const classification = classifyCreative({ hasPerformanceFacts, spend: item.spend, purchases: item.purchases, roas, ctr });
    const landingUrl = String(creative?.landingUrl || "").trim() || null;
    const storeId = item.storeId;
    const creativeName = creative?.name || `Creative ${item.creativeId}`;
    return {
      id: item.creativeId, key: item.key, creativeId: item.creativeId, creativeIds, adIds, campaignIds, adsetIds,
      accountIds, accountId: accountIds[0] || "", accountName: accountNames[0] || "", accountNames,
      fb_account_name: accountNames[0] || "", storeId, storeName: storeId ? (storeMap.get(storeId) || "关联店铺") : "未关联店铺",
      creativeName, title: creativeName, body: null, link_url: landingUrl, previewUrl: creative?.previewUrl || "",
      imageUrl: creative?.imageUrl || "", type: parseCreativeType(creative?.type || creative?.mediaType),
      spend: fixed(item.spend, 2), impressions: item.impressions, clicks: item.clicks, purchases: item.purchases,
      purchase_value: fixed(item.purchaseValue, 2), revenue: fixed(item.purchaseValue, 2), ctr: fixed(ctr), cpc: fixed(cpc),
      cpm: fixed(cpm), cpa: fixed(cpa), meta_roas: fixed(roas), roas: fixed(roas),
      frequency: null, frequencyAvailable: false as const,
      reach: singleDay && item.reachSeen ? item.reach : null, reachAvailable: singleDay && item.reachSeen,
      addToCart: item.addToCartSeen ? item.addToCart : null, addToCartAvailable: item.addToCartSeen,
      productLink: landingUrl, productLinkAvailable: landingUrl !== null,
      hookRate: null, hookRateAvailable: false as const,
      ...classification, hasPerformanceFacts,
      campaignCount: campaignIds.length, adsetCount: adsetIds.length, adCount: adIds.length,
      campaignId: campaignIds[0] || "", adsetId: adsetIds[0] || "", adId: adIds[0] || "",
      adName: (adMap.get(adIds[0]) as any)?.name || "",
      performanceSyncedAt: item.maxSyncedAt ? dayjs(item.maxSyncedAt).toISOString() : null,
      latestPerformanceDate: item.latestPerformanceDate,
      syncedAt: item.maxSyncedAt ? dayjs(item.maxSyncedAt).toISOString() : null
    };
  });

  const structuralRows = (creatives as any[]).map((creative: any) => {
    const associatedAds = (ads as any[]).filter((ad: any) => ad.creativeId === creative.creativeId);
    const accountId = normalizeMetaAccountId(creative.fbAccountId || associatedAds[0]?.accountId || "");
    const storeId = creative.storeId || accountToStoreMap.get(accountId) || null;
    const key = creativeKey(creative, creative.creativeId, associatedAds[0]?.id || creative.creativeId);
    return {
      key, creativeId: creative.creativeId, creativeName: creative.name || `Creative ${creative.creativeId}`,
      type: parseCreativeType(creative.type || creative.mediaType), accountId, accountName: accountNameMap.get(accountId) || "",
      storeId, storeName: storeId ? (storeMap.get(storeId) || "关联店铺") : "未关联店铺",
      adIds: associatedAds.map((ad: any) => ad.id),
      campaignIds: Array.from(new Set(associatedAds.map((ad: any) => ad.campaignId || ad.adSet?.campaignId).filter(Boolean))),
      adsetIds: Array.from(new Set(associatedAds.map((ad: any) => ad.adsetId).filter(Boolean))),
      imageUrl: creative.imageUrl || "", previewUrl: creative.previewUrl || "", productLink: creative.landingUrl || null,
      hasPerformanceFacts: false, opsBucket: null, opsBucketLabel: "数据不足", opsScore: null,
      recommendedAction: null, diagnosisReason: "当前筛选周期无素材成效事实", fatigueScore: null, riskLevel: "数据不足",
      frequency: null, frequencyAvailable: false, reach: null, reachAvailable: false,
      addToCart: null, addToCartAvailable: false, hookRate: null, hookRateAvailable: false,
      performanceSyncedAt: null, latestPerformanceDate: null
    };
  }).filter((row: any) => {
    if (filterAccountId && row.accountId !== filterAccountId) return false;
    if (filterStoreId !== null && row.storeId !== filterStoreId) return false;
    if (filterCampaignId && !row.campaignIds.includes(filterCampaignId)) return false;
    if (filterAdsetId && !row.adsetIds.includes(filterAdsetId)) return false;
    if (filterType && row.type !== filterType) return false;
    if (search && !`${row.creativeName} ${row.creativeId} ${row.accountName}`.toLowerCase().includes(search)) return false;
    return true;
  });

  const structureOnlyRows = structuralRows.filter((row: any) => !keysWithFacts.has(row.key));
  performanceRows = performanceRows.filter((row) => {
    if (!includeZero && row.spend <= 0) return false;
    if (row.spend < minSpend) return false;
    if (filterType && row.type !== filterType) return false;
    if (filterBucket && row.opsBucket !== filterBucket) return false;
    if (search && !`${row.creativeName} ${row.creativeId} ${row.adName} ${row.accountName}`.toLowerCase().includes(search)) return false;
    return true;
  });

  const [sortKey, sortDirection] = String(params.sortBy || "spend DESC").trim().split(/\s+/);
  const ascending = String(sortDirection || "DESC").toUpperCase() === "ASC";
  performanceRows.sort((left: any, right: any) => {
    const a = left[sortKey]; const b = right[sortKey];
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === "string") return ascending ? a.localeCompare(b) : b.localeCompare(a);
    return ascending ? a - b : b - a;
  });

  const summary = summarize(performanceRows);
  const bucketSummary = performanceRows.reduce<Record<string, number>>((result, row) => {
    if (row.opsBucket) result[row.opsBucket] = (result[row.opsBucket] || 0) + 1;
    return result;
  }, {});
  const truncated = exportRequested && performanceRows.length > exportLimit;
  const visibleRows = exportRequested
    ? performanceRows.slice(0, exportLimit)
    : performanceRows.slice((page - 1) * pageSize, page * pageSize);

  return {
    success: true,
    data: visibleRows,
    performanceRows: visibleRows,
    structureOnlyRows,
    summary,
    structureSummary: { totalStructureCount: structuralRows.length, structureOnlyCount: structureOnlyRows.length },
    bucketSummary,
    pagination: { page, pageSize, total: performanceRows.length, totalPages: Math.ceil(performanceRows.length / pageSize) },
    total: performanceRows.length,
    page,
    pageSize,
    filteredTotalCount: performanceRows.length,
    pageRowCount: visibleRows.length,
    export: { requested: exportRequested, truncated, limit: exportLimit },
    dataScope: {
      page: "creative-insights", primarySource: "Meta 素材成效", dateField: "FactMetaPerformance.date",
      timezone: "America/Los_Angeles", accountId: params.accountId || "all", storeId: params.storeId || "all",
      includeZeroSpend: includeZero
    },
    diagnostics: {
      hasAdLevelInsights: totalAdPerfCount > 0,
      hasAdCreativeLinks: ads.some((ad: any) => Boolean(ad.creativeId)),
      hasCreativeStaticInfo: creatives.length > 0,
      performanceRows: factRows.length,
      structureRows: ads.length,
      noAdLevelInsightsWarning: totalAdPerfCount === 0,
      adCreativeNotLinkedWarning: !ads.some((ad: any) => Boolean(ad.creativeId)),
      creativeStaticMissingWarning: creatives.length === 0
    },
    dataSourceExplain: {
      performanceSource: "Meta 素材成效", creativeMetadataSource: "Meta 素材结构",
      adStructureSource: "Meta 广告结构", legacySourcesUsed: []
    }
  };
}

function emptyResponse(input: {
  page: number; pageSize: number; startStr: string; endStr: string; totalAdPerfCount: number;
  ads: any[]; creatives: any[]; includeZero: boolean; exportRequested: boolean;
}) {
  return {
    success: true, data: [], performanceRows: [], structureOnlyRows: [], summary: summarize([]),
    structureSummary: { totalStructureCount: 0, structureOnlyCount: 0 }, bucketSummary: {},
    pagination: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0 },
    total: 0, page: input.page, pageSize: input.pageSize, filteredTotalCount: 0, pageRowCount: 0,
    export: { requested: input.exportRequested, truncated: false, limit: 5000 },
    dataScope: { page: "creative-insights", primarySource: "Meta 素材成效", dateField: "FactMetaPerformance.date", timezone: "America/Los_Angeles", includeZeroSpend: input.includeZero },
    diagnostics: {
      hasAdLevelInsights: input.totalAdPerfCount > 0, hasAdCreativeLinks: input.ads.some(ad => Boolean(ad.creativeId)),
      hasCreativeStaticInfo: input.creatives.length > 0, performanceRows: 0, structureRows: input.ads.length,
      noAdLevelInsightsWarning: input.totalAdPerfCount === 0,
      adCreativeNotLinkedWarning: !input.ads.some(ad => Boolean(ad.creativeId)), creativeStaticMissingWarning: input.creatives.length === 0
    },
    dataSourceExplain: { performanceSource: "Meta 素材成效", creativeMetadataSource: "Meta 素材结构", adStructureSource: "Meta 广告结构", legacySourcesUsed: [] }
  };
}
