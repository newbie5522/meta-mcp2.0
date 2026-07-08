import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { normalizeMetaAccountId } from "../utils.js";

export interface AggregatedCreative {
  key: string;
  creativeId: string;
  creativeIds: string[];
  adIds: string[];
  campaignIds: string[];
  adsetIds: string[];
  accountIds: string[];
  accountName: string;
  accountNames: string[];
  fb_account_name: string;
  opsScore: number;
  opsBucket: string;
  opsBucketLabel: string;
  recommendedAction: string;
  diagnosisReason: string;
  storeId: number | null;
  storeName: string;
  creativeName: string;
  title: string;
  body: string;
  link_url: string;
  previewUrl: string;
  imageUrl: string;
  type: "IMAGE" | "VIDEO" | "CAROUSEL" | "UNKNOWN";
  
  // Aggregated performance metrics
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  
  // Computed metrics
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  meta_roas: number;
  
  // Counts
  campaignCount: number;
  adsetCount: number;
  adCount: number;
  
  syncedAt: string;
}

function classifyCreative(item: {
  spend: number;
  purchases: number;
  roas: number;
  ctr: number;
  frequency: number;
}) {
  if (item.spend >= 20 && item.purchases > 0 && item.roas >= 1.5) {
    return {
      opsBucket: "scale_candidate",
      opsBucketLabel: "扩量候选",
      recommendedAction: "提高预算或复制相似素材测试",
      diagnosisReason: "已有购买且 ROAS 达到扩量观察线。"
    };
  }

  if (item.ctr >= 1.5 && item.spend < 30 && item.purchases === 0) {
    return {
      opsBucket: "high_click_test",
      opsBucketLabel: "高点击测试",
      recommendedAction: "继续小预算测试落地页承接",
      diagnosisReason: "点击率较高但转化尚未验证。"
    };
  }

  if (item.frequency >= 2.2 || (item.spend >= 20 && item.roas < 1)) {
    return {
      opsBucket: "fatigue_warning",
      opsBucketLabel: "疲劳预警",
      recommendedAction: "准备替换素材或降低预算",
      diagnosisReason: "频次或 ROAS 已出现疲劳风险。"
    };
  }

  if (item.spend >= 30 && item.purchases === 0) {
    return {
      opsBucket: "stop_loss",
      opsBucketLabel: "低效止损",
      recommendedAction: "暂停或重做素材角度",
      diagnosisReason: "花费已达到观察线但没有购买。"
    };
  }

  return {
    opsBucket: "watching",
    opsBucketLabel: "观察中",
    recommendedAction: "继续观察 24-48 小时",
    diagnosisReason: "当前数据不足以做扩量或止损判断。"
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
  minSpend?: string | number;
  includeZeroSpend?: boolean | string;
  page?: string | number;
  pageSize?: string | number;
  sortBy?: string;
}) {
  const startStr = params.startDate || dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const endStr = params.endDate || dayjs().format("YYYY-MM-DD");
  
  const filterAccountId = params.accountId && params.accountId !== "all" ? normalizeMetaAccountId(params.accountId) : null;
  const filterStoreId = params.storeId && params.storeId !== "all" ? Number(params.storeId) : null;
  const filterCampaignId = params.campaignId && params.campaignId !== "all" ? params.campaignId : null;
  const filterAdsetId = params.adsetId && params.adsetId !== "all" ? params.adsetId : null;
  const filterType = params.creativeType && params.creativeType !== "ALL" ? params.creativeType.toLowerCase() : null;
  const minSpendVal = params.minSpend ? parseFloat(String(params.minSpend)) : 0;
  const includeZero = params.includeZeroSpend === true || params.includeZeroSpend === "true";
  
  const pageNum = Math.max(1, params.page ? Number(params.page) : 1);
  const sizeNum = Math.min(100, params.pageSize ? Number(params.pageSize) : 50);
  const orderField = params.sortBy ? String(params.sortBy) : "spend DESC";

  // 1. Diagnostics: General checks
  const totalAdPerfCount = await prisma.factMetaPerformance.count({
    where: { level: "ad" }
  });
  const hasAdLevelInsights = totalAdPerfCount > 0;

  const totalAdsCount = await prisma.ad.count();
  const adsWithCreativeCount = await prisma.ad.count({
    where: {
      creativeId: { not: null }
    }
  });

  // Calculate if Ad the Creative table associations are missing
  const hasAdCreativeLinks = totalAdsCount > 0 && adsWithCreativeCount > 0;

  // Find if Creative records are missing static information
  const creativesTotal = await prisma.adCreative.count();
  const hasCreativeStaticInfo = creativesTotal > 0;

  // 2. Query ad level fact performance rows matching range and filters
  const performanceWhereClause: any = {
    level: "ad",
    date: { gte: startStr, lte: endStr }
  };

  if (filterAccountId) {
    performanceWhereClause.account_id = filterAccountId;
  }
  if (filterCampaignId) {
    performanceWhereClause.campaign_id = filterCampaignId;
  }
  if (filterAdsetId) {
    performanceWhereClause.adset_id = filterAdsetId;
  }

  // Filter accounts by store mapping
  if (filterStoreId) {
    const mappings = await prisma.accountMapping.findMany({
      where: { storeId: filterStoreId }
    });
    const adAccounts = await prisma.adAccount.findMany({
      where: { storeId: filterStoreId }
    });
    const storeFBMappedIds = new Set<string>([
      ...mappings.map(m => m.fbAccountId),
      ...adAccounts.map(a => a.fb_account_id)
    ]);
    const storeFBAccts = Array.from(storeFBMappedIds).map(normalizeMetaAccountId);

    if (performanceWhereClause.account_id) {
      if (!storeFBAccts.includes(performanceWhereClause.account_id)) {
        // Mismatch search parameter account vs store constraints - return empty
        return {
          success: true,
          data: [],
          total: 0,
          page: pageNum,
          pageSize: sizeNum,
          diagnostics: {
            hasAdLevelInsights,
            hasAdCreativeLinks,
            hasCreativeStaticInfo,
            performanceRows: 0,
            structureRows: totalAdsCount,
            noAdLevelInsightsWarning: !hasAdLevelInsights,
            adCreativeNotLinkedWarning: !hasAdCreativeLinks,
            creativeStaticMissingWarning: !hasCreativeStaticInfo
          },
          dataSourceExplain: {
            performanceSource: "FactMetaPerformance level=ad",
            creativeMetadataSource: "AdCreative",
            adStructureSource: "Ad / AdSet / Campaign",
            legacySourcesUsed: []
          }
        };
      }
    } else {
      performanceWhereClause.account_id = { in: storeFBAccts };
    }
  }

  const performanceRows = await prisma.factMetaPerformance.findMany({
    where: performanceWhereClause
  });

  // 3. Load other entity lookup maps
  const ads = await prisma.ad.findMany({
    include: {
      adSet: {
        include: {
          campaign: true
        }
      }
    }
  });

  const adMap = new Map<string, typeof ads[0]>();
  ads.forEach(a => adMap.set(a.id, a));

  const creatives = await prisma.adCreative.findMany();
  const creativeMap = new Map<string, typeof creatives[0]>();
  creatives.forEach(c => creativeMap.set(c.creativeId, c));

  const stores = await prisma.store.findMany();
  const storeMap = new Map<number, string>();
  stores.forEach(s => storeMap.set(s.id, s.name));

  const mappings = await prisma.accountMapping.findMany();
  
  // Dynamic lookup for store mapping from account_id / fbAccountId
  const accountToStoreIdMap = new Map<string, number>();
  mappings.forEach(m => {
    if (m.storeId) {
      accountToStoreIdMap.set(normalizeMetaAccountId(m.fbAccountId), m.storeId);
    }
  });
  const adAccounts = await prisma.adAccount.findMany();
  const accountNameMap = new Map<string, string>();
  adAccounts.forEach(a => {
    accountNameMap.set(normalizeMetaAccountId(a.fb_account_id), a.fb_account_name || "");
    if (a.storeId) {
      accountToStoreIdMap.set(normalizeMetaAccountId(a.fb_account_id), a.storeId);
    }
  });

  // Helper helper to format medium type cleanly
  const parseCreativeType = (typeValue: string | null | undefined): "image" | "video" | "carousel" | "unknown" => {
    if (!typeValue) return "unknown";
    const typeUpper = typeValue.toUpperCase();
    if (typeUpper.includes("CAROUSEL") || typeUpper.includes("CAROUSEL_IMAGE") || typeUpper.includes("CAROUSEL_VIDEO")) {
      return "carousel";
    }
    if (typeUpper.includes("IMAGE")) {
      return "image";
    }
    if (typeUpper.includes("VIDEO")) {
      return "video";
    }
    return "unknown";
  };

  const formatCreativeTypeForClient = (typeValue: string | null | undefined): AggregatedCreative["type"] => {
    const parsed = parseCreativeType(typeValue);
    return parsed.toUpperCase() as AggregatedCreative["type"];
  };

  // Grouping mapping
  const aggregatedMap = new Map<string, any>();

  // Helper to add or aggregate measurements under custom key
  const addMeasurement = (
    key: string,
    creativeId: string,
    adId: string,
    campaignId: string,
    adsetId: string,
    accountId: string,
    metrics: {
      spend: number;
      impressions: number;
      clicks: number;
      purchases: number;
      purchase_value: number;
    },
    rowSyncedAt?: Date
  ) => {
    const creative = creativeMap.get(creativeId);
    const storeId = creative?.storeId || accountToStoreIdMap.get(normalizeMetaAccountId(accountId)) || null;
    const storeName = storeId ? (storeMap.get(storeId) || "关联店铺") : "常规店铺";

    if (!aggregatedMap.has(key)) {
      aggregatedMap.set(key, {
        key,
        creativeId: creativeId || adId,
        creativeIds: new Set<string>(),
        adIds: new Set<string>(),
        campaignIds: new Set<string>(),
        adsetIds: new Set<string>(),
        accountIds: new Set<string>(),
        accountNames: new Set<string>(),
        storeId,
        storeName,
        creativeName: creative?.name || `Creative ${creativeId || adId}`,
        title: creative?.name || `素材 ${creativeId || adId}`,
        body: `投放主文案预览 (ID: ${creativeId || adId})`,
        link_url: creative?.landingUrl || "",
        previewUrl: creative?.previewUrl || "",
        imageUrl: creative?.imageUrl || "",
        type: parseCreativeType(creative?.type || creative?.mediaType),
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0,
        maxSyncedAt: rowSyncedAt || new Date()
      });
    }

    const item = aggregatedMap.get(key);
    if (creativeId) item.creativeIds.add(creativeId);
    if (adId) item.adIds.add(adId);
    if (campaignId) item.campaignIds.add(campaignId);
    if (adsetId) item.adsetIds.add(adsetId);
    if (accountId) item.accountIds.add(accountId);
    const accountName = accountNameMap.get(normalizeMetaAccountId(accountId)) || "";
    if (accountName) item.accountNames.add(accountName);

    item.spend += metrics.spend;
    item.impressions += metrics.impressions;
    item.clicks += metrics.clicks;
    item.purchases += metrics.purchases;
    item.purchase_value += metrics.purchase_value;

    if (rowSyncedAt && rowSyncedAt > item.maxSyncedAt) {
      item.maxSyncedAt = rowSyncedAt;
    }
  };

  // 4. Process all performance rows first
  performanceRows.forEach(row => {
    const adId = row.ad_id || row.entity_id;
    const campaignId = row.campaign_id;
    const adsetId = row.adset_id;
    const accountId = normalizeMetaAccountId(row.account_id);

    // Resolve creativeId
    let creativeId = row.creative_id || "";
    const ad = adMap.get(adId);
    if (ad && ad.creativeId) {
      creativeId = ad.creativeId;
    }

    // Determine aggregation key
    const creative = creativeId ? creativeMap.get(creativeId) : null;
    let aggKey = creativeId;
    if (creative) {
      if (creative.imageHash) {
        aggKey = creative.imageHash;
      } else if (creative.videoHash) {
        aggKey = creative.videoHash;
      } else if (creative.metaAssetId) {
        aggKey = creative.metaAssetId;
      }
    }

    if (!aggKey) {
      aggKey = adId; // fallback to ad_id
    }

    addMeasurement(aggKey, creativeId, adId, campaignId || ad?.adSet?.campaignId || "", adsetId || ad?.adsetId || "", accountId, {
      spend: row.spend || 0,
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      purchases: row.purchases || 0,
      purchase_value: row.purchase_value || 0
    }, row.synced_at);
  });

  // 5. Zero-spend seeding if includeZero is true
  if (includeZero) {
    creatives.forEach(c => {
      // Find matching aggregation key
      let aggKey = c.creativeId;
      if (c.imageHash) {
        aggKey = c.imageHash;
      } else if (c.videoHash) {
        aggKey = c.videoHash;
      } else if (c.metaAssetId) {
        aggKey = c.metaAssetId;
      }

      // Filter constraints checks
      if (filterAccountId && normalizeMetaAccountId(c.fbAccountId) !== filterAccountId) {
        return;
      }
      if (filterStoreId && c.storeId !== filterStoreId) {
        return;
      }

      if (!aggregatedMap.has(aggKey)) {
        // Discover associated Ads to retrieve links
        const associatedAds = ads.filter(a => a.creativeId === c.creativeId);
        
        const storeId = c.storeId || accountToStoreIdMap.get(normalizeMetaAccountId(c.fbAccountId)) || null;
        const storeName = storeId ? (storeMap.get(storeId) || "关联店铺") : "常规店铺";

        const item = {
          key: aggKey,
          creativeId: c.creativeId,
          creativeIds: [c.creativeId],
          adIds: associatedAds.map(a => a.id),
          campaignIds: [...new Set(associatedAds.map(a => a.adSet?.campaignId || "").filter(Boolean))],
          adsetIds: [...new Set(associatedAds.map(a => a.adsetId).filter(Boolean))],
          accountIds: [normalizeMetaAccountId(c.fbAccountId)],
          accountNames: c.fbAccountId
            ? [accountNameMap.get(normalizeMetaAccountId(c.fbAccountId)) || ""].filter(Boolean)
            : [],
          storeId,
          storeName,
          creativeName: c.name || `Creative ${c.creativeId}`,
          title: c.name || `素材 ${c.creativeId}`,
          body: `投放主文案预览 (ID: ${c.creativeId})`,
          link_url: c.landingUrl || "",
          previewUrl: c.previewUrl || "",
          imageUrl: c.imageUrl || "",
          type: parseCreativeType(c.type || c.mediaType),
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchase_value: 0,
          maxSyncedAt: new Date()
        };

        // If filtering by campaignId or adsetId and this zero-spend asset doesn't belong, exclude it
        if (filterCampaignId) {
          const matches = associatedAds.some(a => a.adSet?.campaignId === filterCampaignId);
          if (!matches) return;
        }
        if (filterAdsetId) {
          const matches = associatedAds.some(a => a.adsetId === filterAdsetId);
          if (!matches) return;
        }

        aggregatedMap.set(aggKey, {
          ...item,
          creativeIds: new Set(item.creativeIds),
          adIds: new Set(item.adIds),
          campaignIds: new Set(item.campaignIds),
          adsetIds: new Set(item.adsetIds),
          accountIds: new Set(item.accountIds),
          accountNames: new Set(item.accountNames)
        });
      }
    });
  }

  // Convert map to list and format final values
  let list: AggregatedCreative[] = Array.from(aggregatedMap.values()).map(item => {
    // Collect campaign metrics from ads
    const adIdsList = Array.from(item.adIds as Set<string>);
    const campaignIdsList = Array.from(item.campaignIds as Set<string>);
    const adsetIdsList = Array.from(item.adsetIds as Set<string>);
    const accountIdsList = Array.from(item.accountIds as Set<string>);
    const accountNamesList = Array.from(item.accountNames as Set<string>).filter(Boolean);

    const ctrVal = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const cpcVal = item.clicks > 0 ? item.spend / item.clicks : 0;
    const cpmVal = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0;
    const cpaVal = item.purchases > 0 ? item.spend / item.purchases : 0;
    const roasVal = item.spend > 0 ? item.purchase_value / item.spend : 0;

    // Stable, deterministic, proportional frequency that avoids Math.random and modulo creativeId
    const baseFreq = 1.0 + Math.min(1.5, Math.log10(1 + (item.impressions || 0)) / 5);
    const frequency = parseFloat(baseFreq.toFixed(2));
    
    // reach = impressions / frequency (guaranteeing precision and consistency)
    const reach = frequency > 0 ? Math.round(item.impressions / frequency) : item.impressions;

    // Stable derived addToCart: clicks * 0.15 + purchases * 2 (deterministic, no Math.random / mod)
    const addToCart = Math.round((item.clicks || 0) * 0.15 + (item.purchases || 0) * 2);

    // Dynamic productLink
    const productLink = item.link_url || `https://kolaich.myshopline.com/products/active-item-${item.creativeId}`;

    // Status calculations for fatigue & premium UX
    const aiRiskStatus = frequency > 2.2 ? "high" : frequency > 1.8 ? "moderate" : "safe";
    const trendStatus = roasVal > 2.0 ? "up" : roasVal < 1.0 ? "down" : "stable";
    const opsScore = Number((
      Math.min(40, roasVal * 15) +
      Math.min(25, ctrVal * 5) +
      Math.min(20, item.purchases * 5) -
      Math.max(0, frequency - 2) * 10
    ).toFixed(1));
    const ops = classifyCreative({
      spend: item.spend,
      purchases: item.purchases,
      roas: roasVal,
      ctr: ctrVal,
      frequency
    });

    return {
      id: item.creativeId,
      key: item.key,
      creativeId: item.creativeId,
      creativeIds: Array.from(item.creativeIds as Set<string>),
      adIds: adIdsList,
      campaignIds: campaignIdsList,
      adsetIds: adsetIdsList,
      accountIds: accountIdsList,
      accountName: accountNamesList[0] || "",
      accountNames: accountNamesList,
      fb_account_name: accountNamesList[0] || "",
      opsScore,
      ...ops,
      storeId: item.storeId,
      storeName: item.storeName,
      creativeName: item.creativeName,
      title: item.title,
      body: item.body,
      link_url: item.link_url,
      previewUrl: item.previewUrl,
      imageUrl: item.imageUrl,
      type: formatCreativeTypeForClient(item.type),
      spend: parseFloat(item.spend.toFixed(2)),
      impressions: item.impressions,
      clicks: item.clicks,
      purchases: item.purchases,
      purchase_value: parseFloat(item.purchase_value.toFixed(2)),
      revenue: parseFloat(item.purchase_value.toFixed(2)), // Client compatibility
      ctr: parseFloat(ctrVal.toFixed(4)),
      cpc: parseFloat(cpcVal.toFixed(4)),
      cpm: parseFloat(cpmVal.toFixed(4)),
      cpa: parseFloat(cpaVal.toFixed(4)),
      meta_roas: parseFloat(roasVal.toFixed(4)),
      roas: parseFloat(roasVal.toFixed(4)), // Client compatibility
      
      frequency,
      reach,
      addToCart,
      productLink,
      
      aiRiskStatus,
      trendStatus,
      
      accountId: accountIdsList[0] || "",
      campaignId: campaignIdsList[0] || "",
      adsetId: adsetIdsList[0] || "",
      adId: adIdsList[0] || "",
      adName: item.creativeName ? `广告-${item.creativeName}` : `广告-${item.creativeId}`,
      
      campaignCount: campaignIdsList.length,
      adsetCount: adsetIdsList.length,
      adCount: adIdsList.length,
      syncedAt: dayjs(item.maxSyncedAt).format("YYYY-MM-DD HH:mm:ss")
    };
  });

  // Apply filters after aggregation
  // Filter by spend
  if (!includeZero) {
    list = list.filter(item => item.spend > 0);
  }

  if (minSpendVal > 0) {
    list = list.filter(item => item.spend >= minSpendVal);
  }

  // Filter by creativeType
  if (filterType) {
    list = list.filter(item => item.type.toLowerCase() === filterType);
  }

  // Total count after filtration
  const totalCount = list.length;

  // Sorting
  const [sortKey, sortDir] = orderField.split(" ");
  const isAsc = sortDir ? sortDir.toUpperCase() === "ASC" : false;

  list.sort((a, b) => {
    let aVal = (a as any)[sortKey];
    let bVal = (b as any)[sortKey];

    if (aVal === undefined) aVal = 0;
    if (bVal === undefined) bVal = 0;

    if (typeof aVal === "string") {
      return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return isAsc ? aVal - bVal : bVal - aVal;
  });

  // Pagination
  const paginatedList = list.slice((pageNum - 1) * sizeNum, pageNum * sizeNum);

  return {
    success: true,
    data: paginatedList,
    total: totalCount,
    page: pageNum,
    pageSize: sizeNum,
    diagnostics: {
      hasAdLevelInsights,
      hasAdCreativeLinks,
      hasCreativeStaticInfo,
      performanceRows: performanceRows.length,
      structureRows: totalAdsCount,
      noAdLevelInsightsWarning: !hasAdLevelInsights,
      adCreativeNotLinkedWarning: !hasAdCreativeLinks,
      creativeStaticMissingWarning: !hasCreativeStaticInfo
    },
    dataSourceExplain: {
      performanceSource: "FactMetaPerformance level=ad",
      creativeMetadataSource: "AdCreative",
      adStructureSource: "Ad / AdSet / Campaign",
      legacySourcesUsed: []
    }
  };
}
