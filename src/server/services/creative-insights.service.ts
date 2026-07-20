import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { normalizeMetaAccountId } from "../utils.js";
import type {
  CreativeAdsetOption,
  CreativeCampaignOption,
  CreativeAccountOption,
  CreativeFilterOptions,
  CreativeMediaType,
  CreativeStructureOnlyRow
} from "../../shared/creative-intelligence-contract.js";

type CreativeType = CreativeMediaType;

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

const productionStoreWhere = {
  NOT: [
    { mode: "sandbox" },
    { name: { in: DEMO_STORE_NAMES } },
    { domain: { in: DEMO_STORE_DOMAINS } }
  ]
};

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
  purchaseValue: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  meta_roas: number | null;
  roas: number | null;
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

function assetIdentity(creative: any, creativeId: string, adId: string): string {
  return String(
    creative?.imageHash ||
    creative?.videoHash ||
    creative?.metaAssetId ||
    creativeId ||
    adId
  );
}

function accountAssetGroupKey(input: {
  accountId: string;
  assetIdentity: string;
}): string {
  return `${normalizeMetaAccountId(input.accountId)}::${input.assetIdentity}`;
}

function firstSorted<T>(values: Iterable<T>): T | null {
  const sorted = Array.from(values).sort();
  return sorted.length > 0 ? sorted[0] : null;
}

function firstNonEmptyUrl(values: Iterable<unknown>): string | null {
  for (const value of Array.from(values).map(item => String(item || "").trim()).filter(Boolean).sort()) {
    return value;
  }
  return null;
}

function singleUniqueUrl(values: Iterable<unknown>): string | null {
  const urls = Array.from(new Set(Array.from(values).map(item => String(item || "").trim()).filter(Boolean))).sort();
  return urls.length === 1 ? urls[0] : null;
}

function adCampaignId(ad: any): string {
  return String(ad?.campaignId || ad?.adSet?.campaignId || ad?.adSet?.campaign?.id || "");
}

function adAdsetId(ad: any): string {
  return String(ad?.adsetId || ad?.adSet?.id || "");
}

function buildStructureGroups(input: { ads: any[]; creatives: any[] }) {
  const creativeById = new Map(input.creatives.map((creative: any) => [creative.creativeId, creative]));
  const groups = new Map<string, any>();

  for (const ad of input.ads) {
    const creativeId = String(ad?.creativeId || "");
    if (!creativeId) continue;
    const creative: any = creativeById.get(creativeId);
    const accountId = normalizeMetaAccountId(ad?.accountId || creative?.fbAccountId || "");
    const assetKey = assetIdentity(creative, creativeId, String(ad?.id || creativeId));
    const analysisEntityId = accountAssetGroupKey({ accountId, assetIdentity: assetKey });

    if (!groups.has(analysisEntityId)) {
      groups.set(analysisEntityId, {
        analysisEntityId,
        aggregationKey: assetKey,
        accountId,
        creativeIds: new Set<string>(),
        creativeNames: new Set<string>(),
        adIds: new Set<string>(),
        campaignIds: new Set<string>(),
        adsetIds: new Set<string>(),
        imageUrls: new Set<string>(),
        previewUrls: new Set<string>(),
        landingUrls: new Set<string>(),
        mediaTypes: new Set<CreativeMediaType>()
      });
    }

    const group = groups.get(analysisEntityId);
    group.creativeIds.add(creativeId);
    if (creative?.name) group.creativeNames.add(String(creative.name));
    if (ad?.id) group.adIds.add(String(ad.id));
    const campaignId = adCampaignId(ad);
    const adsetId = adAdsetId(ad);
    if (campaignId) group.campaignIds.add(campaignId);
    if (adsetId) group.adsetIds.add(adsetId);
    if (creative?.imageUrl) group.imageUrls.add(String(creative.imageUrl));
    if (creative?.previewUrl) group.previewUrls.add(String(creative.previewUrl));
    if (creative?.landingUrl) group.landingUrls.add(String(creative.landingUrl));
    group.mediaTypes.add(parseCreativeType(creative?.type || creative?.mediaType));
  }

  return Array.from(groups.values());
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
    ctr: totals.impressions > 0 ? fixed((totals.clicks / totals.impressions) * 100) : null,
    cpc: totals.clicks > 0 ? fixed(totals.spend / totals.clicks) : null,
    cpm: totals.impressions > 0 ? fixed((totals.spend / totals.impressions) * 1000) : null,
    cpa: totals.purchases > 0 ? fixed(totals.spend / totals.purchases) : null,
    roas: totals.spend > 0 ? fixed(totals.purchaseValue / totals.spend) : null
  };
}

function classifyCreative(item: {
  hasPerformanceFacts: boolean;
  spend: number;
  purchases: number;
  roas: number | null;
  ctr: number | null;
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

  if (item.spend >= 20 && item.purchases > 0 && item.roas !== null && item.roas >= 1.5) {
    opsBucket = "scale_candidate";
    opsBucketLabel = "扩量候选";
    recommendedAction = "评估提高预算或复制同类素材";
    diagnosisReason = "已有购买且 Meta ROAS 达到扩量观察线";
    riskLevel = "较低";
  } else if (item.ctr !== null && item.ctr >= 1.5 && item.spend < 30 && item.purchases === 0) {
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
  } else if (item.spend >= 20 && item.roas !== null && item.roas < 1) {
    opsBucket = "fatigue_warning";
    opsBucketLabel = "低回报风险";
    recommendedAction = "准备替换素材或降低预算";
    diagnosisReason = "当前 Meta ROAS 低于观察线";
    riskLevel = "较高";
  }

  const opsScore = fixed(Math.max(0, Math.min(100,
    Math.min(50, (item.roas ?? 0) * 20) + Math.min(30, (item.ctr ?? 0) * 6) + Math.min(20, item.purchases * 4)
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
  const normalizedFilterAccountId =
    params.accountId && params.accountId !== "all"
      ? normalizeMetaAccountId(params.accountId)
      : null;
  const numericFilterAccountId =
    normalizedFilterAccountId
      ? normalizedFilterAccountId.replace(/^act_/, "")
      : null;
  if (
    params.storeId &&
    params.storeId !== "all" &&
    (!/^\d+$/.test(String(params.storeId)) || Number(params.storeId) <= 0)
  ) {
    const error: any = new Error("INVALID_STORE_FILTER");
    error.code = "INVALID_STORE_FILTER";
    error.statusCode = 400;
    throw error;
  }
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

  const [totalAdPerfCount, stores, mappings, adAccounts] = await Promise.all([
    prisma.factMetaPerformance.count({ where: { level: "ad" } }),
    prisma.store.findMany({ where: productionStoreWhere, orderBy: { id: "asc" } }),
    prisma.accountMapping.findMany(),
    prisma.adAccount.findMany()
  ]);
  if (filterStoreId !== null && !stores.some((store: any) => Number(store.id) === filterStoreId)) {
    const error: any = new Error("STORE_FILTER_UNRESOLVED");
    error.code = "STORE_FILTER_UNRESOLVED";
    error.statusCode = 404;
    throw error;
  }

  const storeMap = new Map(stores.map((store: any) => [Number(store.id), store.name]));
  const storeOptions = stores.map((store: any) => ({
    storeId: Number(store.id),
    storeName: String(store.name || `Store ${store.id}`)
  }));
  const productionStoreIds = new Set(stores.map((store: any) => Number(store.id)));
  const accountNameMap = new Map<string, string>();
  const accountToStoreMap = new Map<string, number>();
  const allowedDefaultAccountIds = new Set<string>();
  for (const mapping of mappings as any[]) {
    if (mapping.storeId && productionStoreIds.has(Number(mapping.storeId))) {
      const accountId = normalizeMetaAccountId(mapping.fbAccountId);
      accountToStoreMap.set(accountId, Number(mapping.storeId));
      allowedDefaultAccountIds.add(accountId);
    }
  }
  for (const account of adAccounts as any[]) {
    const accountId = normalizeMetaAccountId(account.fb_account_id);
    accountNameMap.set(accountId, account.fb_account_name || "");
    if (account.storeId && productionStoreIds.has(Number(account.storeId))) {
      accountToStoreMap.set(accountId, Number(account.storeId));
      allowedDefaultAccountIds.add(accountId);
    } else if (!account.storeId) {
      allowedDefaultAccountIds.add(accountId);
    }
  }

  const storeAccountIds = filterStoreId === null
    ? null
    : new Set(Array.from(accountToStoreMap.entries()).filter(([, storeId]) => storeId === filterStoreId).map(([accountId]) => accountId));

  if (normalizedFilterAccountId && storeAccountIds && !storeAccountIds.has(normalizedFilterAccountId)) {
    return emptyResponse({ page, pageSize, startStr, endStr, totalAdPerfCount, ads: [], creatives: [], includeZero, exportRequested, storeOptions });
  }
  if (normalizedFilterAccountId && allowedDefaultAccountIds.size > 0 && !allowedDefaultAccountIds.has(normalizedFilterAccountId)) {
    return emptyResponse({ page, pageSize, startStr, endStr, totalAdPerfCount, ads: [], creatives: [], includeZero, exportRequested, storeOptions });
  }

  const storeScopedAccountIds = storeAccountIds
    ? Array.from(storeAccountIds)
    : Array.from(allowedDefaultAccountIds);
  const scopeAdWhere: any = {};
  if (storeScopedAccountIds.length) {
    scopeAdWhere.accountId = {
      in: Array.from(new Set(storeScopedAccountIds.flatMap(accountId => [accountId, accountId.replace(/^act_/, "")])))
    };
  }

  const scopeAds = await prisma.ad.findMany({
    where: scopeAdWhere,
    include: { adSet: { include: { campaign: true } } }
  });
  const scopeCreativeIds = Array.from(new Set((scopeAds as any[]).map((ad: any) => ad.creativeId).filter(Boolean)));
  const creatives = scopeCreativeIds.length === 0
    ? []
    : await prisma.adCreative.findMany({ where: { creativeId: { in: scopeCreativeIds } } });

  const selectedAds = (scopeAds as any[]).filter((ad: any) => {
    const accountId = normalizeMetaAccountId(ad.accountId || "");
    if (normalizedFilterAccountId && accountId !== normalizedFilterAccountId) return false;
    if (filterCampaignId && adCampaignId(ad) !== filterCampaignId) return false;
    if (filterAdsetId && adAdsetId(ad) !== filterAdsetId) return false;
    return true;
  });
  const adMap = new Map(selectedAds.map((ad: any) => [ad.id, ad]));
  const creativeMap = new Map((creatives as any[]).map((creative: any) => [creative.creativeId, creative]));

  const selectedAdIds = selectedAds.map((ad: any) => String(ad.id || "")).filter(Boolean);
  const selectedAccountIds = normalizedFilterAccountId
    ? [normalizedFilterAccountId]
    : storeScopedAccountIds;
  const performanceWhere: any = { level: "ad", date: { gte: startStr, lte: endStr } };
  if (selectedAccountIds.length > 0) {
    performanceWhere.account_id = {
      in: Array.from(new Set(selectedAccountIds.flatMap(accountId => [accountId, accountId.replace(/^act_/, "")])))
    };
  }
  if (filterCampaignId) performanceWhere.campaign_id = filterCampaignId;
  if (filterAdsetId) performanceWhere.adset_id = filterAdsetId;
  if (selectedAdIds.length > 0) {
    performanceWhere.OR = [
      { ad_id: { in: selectedAdIds } },
      { entity_id: { in: selectedAdIds } }
    ];
  }

  const factRows = selectedAdIds.length === 0
    ? []
    : await prisma.factMetaPerformance.findMany({ where: performanceWhere });
  const grouped = new Map<string, any>();
  const keysWithFacts = new Set<string>();
  const singleDay = startStr === endStr;

  for (const row of factRows as any[]) {
    const adId = row.ad_id || row.entity_id;
    const ad: any = adMap.get(adId);
    const creativeId = row.creative_id || ad?.creativeId || "";
    const creative: any = creativeMap.get(creativeId);
    const accountId = normalizeMetaAccountId(row.account_id || ad?.accountId || "");
    const key = accountAssetGroupKey({
      accountId,
      assetIdentity: assetIdentity(creative, creativeId, adId)
    });
    keysWithFacts.add(key);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        analysisEntityId: key,
        aggregationKey: assetIdentity(creative, creativeId, adId),
        creativeId: creativeId || adId,
        creativeIds: new Set<string>(), adIds: new Set<string>(), campaignIds: new Set<string>(),
        adsetIds: new Set<string>(), accountIds: new Set<string>(), accountNames: new Set<string>(),
        creativeNames: new Set<string>(), imageUrls: new Set<string>(), previewUrls: new Set<string>(),
        landingUrls: new Set<string>(), mediaTypes: new Set<CreativeType>(),
        storeId: creative?.storeId || accountToStoreMap.get(normalizeMetaAccountId(row.account_id)) || null,
        creative,
        spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, factRowCount: 0,
        reach: 0, reachSeen: false, addToCart: 0, addToCartObservedRowCount: 0,
        maxSyncedAt: null as Date | null, latestPerformanceDate: null as string | null
      });
    }
    const item = grouped.get(key);
    item.factRowCount += 1;
    if (creativeId) item.creativeIds.add(creativeId);
    if (adId) item.adIds.add(adId);
    const campaignId = row.campaign_id || ad?.campaignId || ad?.adSet?.campaignId || "";
    const adsetId = row.adset_id || ad?.adsetId || "";
    if (campaignId) item.campaignIds.add(campaignId);
    if (adsetId) item.adsetIds.add(adsetId);
    if (accountId) item.accountIds.add(accountId);
    const accountName = accountNameMap.get(accountId);
    if (accountName) item.accountNames.add(accountName);
    if (creative?.name) item.creativeNames.add(creative.name);
    if (creative?.imageUrl) item.imageUrls.add(creative.imageUrl);
    if (creative?.previewUrl) item.previewUrls.add(creative.previewUrl);
    if (creative?.landingUrl) item.landingUrls.add(creative.landingUrl);
    item.mediaTypes.add(parseCreativeType(creative?.type || creative?.mediaType));
    item.spend += finiteNumber(row.spend);
    item.impressions += finiteNumber(row.impressions);
    item.clicks += finiteNumber(row.clicks);
    item.purchases += finiteNumber(row.purchases);
    item.purchaseValue += finiteNumber(row.purchase_value);
    const payload = parseRawPayload(row.raw_payload);
    const rawReach = singleDay ? extractReach(payload) : null;
    if (rawReach !== null) { item.reach += rawReach; item.reachSeen = true; }
    const rawAddToCart = extractAddToCart(payload);
    if (rawAddToCart !== null) { item.addToCart += rawAddToCart; item.addToCartObservedRowCount += 1; }
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
    const creativeNames = Array.from(item.creativeNames).sort() as string[];
    const mediaTypes = Array.from(item.mediaTypes).filter(Boolean).sort() as CreativeType[];
    const hasPerformanceFacts = item.factRowCount > 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : null;
    const cpc = item.clicks > 0 ? item.spend / item.clicks : null;
    const cpm = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : null;
    const cpa = item.purchases > 0 ? item.spend / item.purchases : null;
    const roas = item.spend > 0 ? item.purchaseValue / item.spend : null;
    const classification = classifyCreative({ hasPerformanceFacts, spend: item.spend, purchases: item.purchases, roas, ctr });
    const landingUrl = singleUniqueUrl(item.landingUrls);
    const storeId = item.storeId === null || item.storeId === undefined ? null : Number(item.storeId);
    const creativeName = creativeNames.length === 0
      ? null
      : creativeNames.length === 1
        ? creativeNames[0]
        : `${creativeNames[0]} 等 ${creativeNames.length} 个版本`;
    const representativeCreativeId = firstSorted(creativeIds) || item.creativeId;
    const representativeAdId = firstSorted(adIds) || "";
    const mediaType = mediaTypes.length > 1 ? "MIXED" : (mediaTypes[0] || parseCreativeType(creative?.type || creative?.mediaType));
    const imageUrl = firstNonEmptyUrl(item.imageUrls);
    const previewUrl = firstNonEmptyUrl(item.previewUrls);
    const addToCartAvailable = item.factRowCount > 0 && item.addToCartObservedRowCount === item.factRowCount;
    return {
      id: item.analysisEntityId, analysisEntityId: item.analysisEntityId, aggregationKey: item.aggregationKey,
      aggregationScope: "ACCOUNT_ASSET" as const,
      key: item.key, creativeId: representativeCreativeId, creativeIds, creativeCount: creativeIds.length,
      adIds, campaignIds, adsetIds,
      accountIds, accountId: accountIds[0] || "", accountName: accountNames[0] || "", accountNames,
      fb_account_name: accountNames[0] || "", storeId, storeName: storeId ? (storeMap.get(storeId) || "关联店铺") : "未关联店铺",
      creativeName, creativeNames, title: creativeName || representativeCreativeId, body: null, link_url: landingUrl, previewUrl,
      imageUrl, type: mediaType,
      spend: fixed(item.spend, 2), impressions: item.impressions, clicks: item.clicks, purchases: item.purchases,
      purchase_value: fixed(item.purchaseValue, 2), purchaseValue: fixed(item.purchaseValue, 2), revenue: fixed(item.purchaseValue, 2),
      ctr: ctr === null ? null : fixed(ctr), cpc: cpc === null ? null : fixed(cpc),
      cpm: cpm === null ? null : fixed(cpm), cpa: cpa === null ? null : fixed(cpa),
      meta_roas: roas === null ? null : fixed(roas), roas: roas === null ? null : fixed(roas),
      frequency: null, frequencyAvailable: false as const,
      reach: singleDay && item.reachSeen && adIds.length === 1 ? item.reach : null,
      reachAvailable: singleDay && item.reachSeen && adIds.length === 1,
      addToCart: addToCartAvailable ? item.addToCart : null, addToCartAvailable,
      productLink: landingUrl, productLinkAvailable: landingUrl !== null,
      availability: {
        frequency: false,
        reach: singleDay && item.reachSeen && adIds.length === 1,
        addToCart: addToCartAvailable,
        hookRate: false,
        productLink: landingUrl !== null
      },
      hookRate: null, hookRateAvailable: false as const,
      ...classification, hasPerformanceFacts, factRowCount: item.factRowCount,
      campaignCount: campaignIds.length, adsetCount: adsetIds.length, adCount: adIds.length,
      campaignId: firstSorted(campaignIds) || "", adsetId: firstSorted(adsetIds) || "", adId: representativeAdId,
      adName: (adMap.get(representativeAdId) as any)?.name || "",
      performanceSyncedAt: item.maxSyncedAt ? dayjs(item.maxSyncedAt).toISOString() : null,
      latestPerformanceDate: item.latestPerformanceDate,
      syncedAt: item.maxSyncedAt ? dayjs(item.maxSyncedAt).toISOString() : null
    };
  });

  const toStructureOnlyRow = (group: any): CreativeStructureOnlyRow & { key: string; availability: any } => {
    const creativeIds = Array.from(group.creativeIds).sort() as string[];
    const adIds = Array.from(group.adIds).sort() as string[];
    const campaignIds = Array.from(group.campaignIds).sort() as string[];
    const adsetIds = Array.from(group.adsetIds).sort() as string[];
    const creativeNames = Array.from(group.creativeNames).sort() as string[];
    const mediaTypes = Array.from(group.mediaTypes).sort() as CreativeMediaType[];
    const storeId = accountToStoreMap.get(group.accountId) || null;
    const type = mediaTypes.length > 1 ? "MIXED" : mediaTypes[0] || "UNKNOWN";
    const creativeName = creativeNames.length === 0
      ? null
      : creativeNames.length === 1
        ? creativeNames[0]
        : `${creativeNames[0]} 等 ${creativeNames.length} 个版本`;
    const productLink = singleUniqueUrl(group.landingUrls);

    return {
      id: group.analysisEntityId,
      key: group.analysisEntityId,
      analysisEntityId: group.analysisEntityId,
      aggregationKey: group.aggregationKey,
      aggregationScope: "ACCOUNT_ASSET",
      creativeId: creativeIds[0] || "",
      creativeIds,
      creativeCount: creativeIds.length,
      adId: adIds[0] || "",
      adIds,
      adCount: adIds.length,
      campaignId: campaignIds[0] || "",
      campaignIds,
      campaignCount: campaignIds.length,
      adsetId: adsetIds[0] || "",
      adsetIds,
      adsetCount: adsetIds.length,
      accountId: group.accountId,
      accountName: accountNameMap.get(group.accountId) || null,
      storeId,
      storeName: storeId ? storeMap.get(storeId) || null : null,
      creativeName,
      creativeNames,
      type,
      imageUrl: firstNonEmptyUrl(group.imageUrls),
      previewUrl: firstNonEmptyUrl(group.previewUrls),
      productLink,
      hasPerformanceFacts: false,
      factRowCount: 0,
      spend: null,
      impressions: null,
      clicks: null,
      purchases: null,
      purchaseValue: null,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      roas: null,
      reach: null,
      addToCart: null,
      frequency: null,
      hookRate: null,
      availability: {
        frequency: false,
        reach: false,
        addToCart: false,
        hookRate: false,
        productLink: productLink !== null
      },
      opsScore: null,
      opsBucket: null,
      opsBucketLabel: "数据不足",
      recommendedAction: null,
      diagnosisReason: "当前筛选周期无素材成效事实",
      fatigueScore: null,
      riskLevel: "数据不足",
      latestPerformanceDate: null,
      performanceSyncedAt: null
    };
  };

  const selectedStructuralRows = buildStructureGroups({ ads: selectedAds, creatives: creatives as any[] })
    .map(toStructureOnlyRow)
    .filter((row: any) => {
      if (filterType && row.type !== filterType) return false;
      if (search && !`${row.creativeName} ${row.creativeId} ${row.accountName || ""}`.toLowerCase().includes(search)) return false;
      return true;
    });

  const allStructureOnlyRows = selectedStructuralRows.filter((row: any) => !keysWithFacts.has(row.analysisEntityId));
  const structureOnlyRows = allStructureOnlyRows.slice(0, 200);
  const structureOnlyTotalCount = allStructureOnlyRows.length;
  const structureOnlyTruncated = structureOnlyTotalCount > structureOnlyRows.length;
  const businessFilteredRows = performanceRows.filter((row) => {
    if (!includeZero && row.spend <= 0) return false;
    if (row.spend < minSpend) return false;
    if (filterType && row.type !== filterType) return false;
    if (search && !`${row.creativeName} ${row.creativeId} ${row.adName} ${row.accountName}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const bucketFilteredRows = filterBucket
    ? businessFilteredRows.filter((row) => row.opsBucket === filterBucket)
    : businessFilteredRows;

  const [sortKey, sortDirection] = String(params.sortBy || "spend DESC").trim().split(/\s+/);
  const ascending = String(sortDirection || "DESC").toUpperCase() === "ASC";
  const sortedRows = [...bucketFilteredRows].sort((left: any, right: any) => {
    const a = left[sortKey]; const b = right[sortKey];
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === "string") return ascending ? a.localeCompare(b) : b.localeCompare(a);
    return ascending ? a - b : b - a;
  });

  const summary = summarize(bucketFilteredRows);
  const bucketSummary = businessFilteredRows.reduce<Record<string, number>>((result, row) => {
    if (row.opsBucket) result[row.opsBucket] = (result[row.opsBucket] || 0) + 1;
    return result;
  }, {});
  const accountOptionMap = new Map<string, CreativeAccountOption>();
  for (const ad of scopeAds as any[]) {
    const accountId = normalizeMetaAccountId(ad.accountId || "");
    if (!accountId) continue;
    accountOptionMap.set(accountId, {
      accountId,
      accountName: accountNameMap.get(accountId) || "账户名称未同步",
      storeId: accountToStoreMap.get(accountId) || null
    });
  }

  const campaignOptionMap = new Map<string, CreativeCampaignOption>();
  for (const ad of scopeAds as any[]) {
    const accountId = normalizeMetaAccountId(ad.accountId || "");
    if (normalizedFilterAccountId && accountId !== normalizedFilterAccountId) continue;
    const campaignId = adCampaignId(ad);
    if (!campaignId) continue;
    campaignOptionMap.set(campaignId, {
      campaignId,
      campaignName: ad.adSet?.campaign?.name || null,
      accountId
    });
  }

  const adsetOptionMap = new Map<string, CreativeAdsetOption>();
  for (const ad of scopeAds as any[]) {
    const accountId = normalizeMetaAccountId(ad.accountId || "");
    const campaignId = adCampaignId(ad);
    const adsetId = adAdsetId(ad);
    if (normalizedFilterAccountId && accountId !== normalizedFilterAccountId) continue;
    if (filterCampaignId && campaignId !== filterCampaignId) continue;
    if (!adsetId) continue;
    adsetOptionMap.set(adsetId, {
      adsetId,
      adsetName: ad.adSet?.name || null,
      campaignId,
      accountId
    });
  }

  const typeGroups = buildStructureGroups({
    ads: (scopeAds as any[]).filter((ad: any) => {
      const accountId = normalizeMetaAccountId(ad.accountId || "");
      if (normalizedFilterAccountId && accountId !== normalizedFilterAccountId) return false;
      if (filterCampaignId && adCampaignId(ad) !== filterCampaignId) return false;
      if (filterAdsetId && adAdsetId(ad) !== filterAdsetId) return false;
      return true;
    }),
    creatives: creatives as any[]
  });
  const filterOptions: CreativeFilterOptions = {
    storeOptions,
    accountOptions: Array.from(accountOptionMap.values()).sort((a, b) => a.accountId.localeCompare(b.accountId)),
    campaignOptions: Array.from(campaignOptionMap.values()).sort((a, b) => a.campaignId.localeCompare(b.campaignId)),
    adsetOptions: Array.from(adsetOptionMap.values()).sort((a, b) => a.adsetId.localeCompare(b.adsetId)),
    creativeTypeOptions: Array.from(new Set(typeGroups.flatMap((group: any) => Array.from(group.mediaTypes)))).filter(Boolean).sort().map((type: any) => ({ type }))
  };
  const truncated = exportRequested && sortedRows.length > exportLimit;
  const totalPages = Math.ceil(bucketFilteredRows.length / pageSize);
  const resolvedPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const visibleRows = exportRequested
    ? sortedRows.slice(0, exportLimit)
    : sortedRows.slice((resolvedPage - 1) * pageSize, resolvedPage * pageSize);

  return {
    success: true,
    data: visibleRows,
    performanceRows: visibleRows,
    structureOnlyRows,
    summary,
    structureSummary: {
      totalStructureCount: selectedStructuralRows.length,
      structureOnlyCount: structureOnlyTotalCount,
      structureOnlyVisibleCount: structureOnlyRows.length,
      structureOnlyTotalCount,
      structureOnlyTruncated
    },
    structureOnlyTotalCount,
    structureOnlyTruncated,
    bucketSummary,
    pagination: {
      page: resolvedPage,
      pageSize,
      total: bucketFilteredRows.length,
      totalPages,
      pageRowCount: visibleRows.length,
      filteredTotalCount: bucketFilteredRows.length
    },
    total: bucketFilteredRows.length,
    page: resolvedPage,
    pageSize,
    filteredTotalCount: bucketFilteredRows.length,
    pageRowCount: visibleRows.length,
    filterOptions,
    export: {
      requested: exportRequested,
      truncated,
      limit: exportLimit,
      totalMatched: bucketFilteredRows.length,
      exportedRowCount: visibleRows.length,
      message: truncated ? `共匹配 ${bucketFilteredRows.length} 条，本次导出前 ${exportLimit} 条。` : null
    },
    dataScope: {
      page: "creative-insights", primarySource: "Meta 素材成效", dateField: "FactMetaPerformance.date",
      timezone: "America/Los_Angeles", accountId: params.accountId || "all", storeId: params.storeId || "all",
      includeZeroSpend: includeZero
    },
    diagnostics: {
      hasAdLevelInsights: totalAdPerfCount > 0,
      hasAdCreativeLinks: (scopeAds as any[]).some((ad: any) => Boolean(ad.creativeId)),
      hasCreativeStaticInfo: creatives.length > 0,
      performanceRows: factRows.length,
      structureRows: (scopeAds as any[]).length,
      noAdLevelInsightsWarning: totalAdPerfCount === 0,
      adCreativeNotLinkedWarning: !(scopeAds as any[]).some((ad: any) => Boolean(ad.creativeId)),
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
  storeOptions?: Array<{ storeId: number; storeName: string }>;
}) {
  return {
    success: true, data: [], performanceRows: [], structureOnlyRows: [], summary: summarize([]),
    structureSummary: { totalStructureCount: 0, structureOnlyCount: 0, structureOnlyVisibleCount: 0, structureOnlyTotalCount: 0, structureOnlyTruncated: false },
    structureOnlyTotalCount: 0,
    structureOnlyTruncated: false,
    bucketSummary: {},
    pagination: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0, pageRowCount: 0, filteredTotalCount: 0 },
    total: 0, page: input.page, pageSize: input.pageSize, filteredTotalCount: 0, pageRowCount: 0,
    filterOptions: { storeOptions: input.storeOptions || [], accountOptions: [], campaignOptions: [], adsetOptions: [], creativeTypeOptions: [] },
    export: { requested: input.exportRequested, truncated: false, limit: 5000, totalMatched: 0, exportedRowCount: 0, message: null },
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
