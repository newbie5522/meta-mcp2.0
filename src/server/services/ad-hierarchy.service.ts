import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getDataSourceCoverage } from "./data-coverage.service.js";

const DATA_CENTER_TIMEZONE = "America/Los_Angeles";

export type CanonicalAdHierarchyLevel = "campaign" | "adset" | "ad";

type CanonicalAdHierarchyInput = {
  level: CanonicalAdHierarchyLevel;
  accountId: string;
  startDate: string;
  endDate: string;
  campaignId?: string;
  adsetId?: string;
  includeZeroSpend?: boolean;
};

function emptyAgg() {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    purchases: 0,
    purchase_value: 0,
    creative_id: ""
  };
}

function addAgg(agg: any, row: any) {
  agg.spend += Number(row.spend || 0);
  agg.impressions += Number(row.impressions || 0);
  agg.clicks += Number(row.clicks || 0);
  agg.purchases += Number(row.purchases || 0);
  agg.purchase_value += Number(row.purchase_value || 0);
  if (row.creative_id) agg.creative_id = row.creative_id;
}

function metricFields(hasPerformanceFacts: boolean, agg: any) {
  const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
  const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
  const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
  const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : 0;
  const roas = agg.spend > 0 ? agg.purchase_value / agg.spend : 0;

  return {
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
    roas: hasPerformanceFacts ? roas : null
  };
}

function buildAppliedFilters(input: CanonicalAdHierarchyInput, normAccountId: string) {
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    timezone: DATA_CENTER_TIMEZONE,
    storeId: "all",
    accountId: normAccountId,
    campaignId: input.campaignId || "all",
    adsetId: input.adsetId || "all",
    includeZeroSpend: Boolean(input.includeZeroSpend)
  };
}

function buildQueryDebug(input: {
  level: CanonicalAdHierarchyLevel;
  source: string;
  accountId: string;
  campaignId?: string;
  adsetId?: string;
  includeZeroSpend?: boolean;
  factRows: number;
  structureRows: number;
}) {
  return {
    source: input.source,
    scope: "current_account",
    includeUnmapped: false,
    includeZeroSpend: Boolean(input.includeZeroSpend),
    mappedOnly: false,
    storeId: "all",
    accountId: input.accountId,
    factRows: input.factRows,
    structureRows: input.structureRows,
    level: input.level,
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    ...(input.adsetId ? { adsetId: input.adsetId } : {})
  };
}

function buildDataSourceExplain(level: CanonicalAdHierarchyLevel) {
  const structureName = level === "campaign" ? "Campaign" : level === "adset" ? "AdSet" : "Ad";
  return {
    dateFilterApplied: true,
    primarySource: `FactMetaPerformance level=${level} + ${structureName}`,
    noMockData: true
  };
}

function buildUnavailableActionInsight(input: {
  spend: number;
  impressions: number;
  clicks: number;
  revenue: number;
  orders: number;
}) {
  const ctr = input.impressions > 0 ? Number(((input.clicks / input.impressions) * 100).toFixed(2)) : 0;
  const cpc = input.clicks > 0 ? Number((input.spend / input.clicks).toFixed(2)) : 0;
  const cpm = input.impressions > 0 ? Number(((input.spend / input.impressions) * 1000).toFixed(2)) : 0;
  const cpa = input.orders > 0 ? Number((input.spend / input.orders).toFixed(2)) : null;

  return {
    spend: input.spend,
    impressions: input.impressions,
    reach: null,
    reachAvailable: false,
    clicks: input.clicks,
    inline_link_clicks: null,
    inlineLinkClicksAvailable: false,
    inline_link_click_ctr: null,
    cost_per_inline_link_click: null,
    ctr,
    cpc,
    cpm,
    cpa,
    frequency: null,
    frequencyAvailable: false,
    addToCart: null,
    addToCartAvailable: false,
    initiateCheckout: null,
    initiateCheckoutAvailable: false,
    budgetAvailable: false,
    actions: [{ action_type: "purchase", value: String(input.orders) }],
    action_values: [{ action_type: "purchase", value: String(input.revenue) }]
  };
}

export function mapCanonicalHierarchyToAccountDetails(level: CanonicalAdHierarchyLevel, rows: any[]) {
  return rows.map((row) => {
    const insight = buildUnavailableActionInsight({
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      revenue: Number(row.purchase_value || row.purchaseValue || 0),
      orders: Number(row.purchases || 0)
    });

    if (level === "campaign") {
      return {
        id: row.id,
        name: row.name,
        status: row.status || "UNKNOWN",
        daily_budget: row.budget ?? null,
        budgetAvailable: false,
        hasPerformanceFacts: row.hasPerformanceFacts,
        insights: { data: [insight] }
      };
    }

    if (level === "adset") {
      return {
        id: row.id,
        campaign_id: row.campaignId,
        name: row.name,
        status: row.status || "UNKNOWN",
        daily_budget: null,
        budgetAvailable: false,
        hasPerformanceFacts: row.hasPerformanceFacts,
        insights: { data: [insight] }
      };
    }

    return {
      id: row.id,
      campaign_id: row.campaignId,
      adset_id: row.adsetId,
      name: row.name,
      creative_id: row.creativeId,
      status: row.status || "UNKNOWN",
      hasPerformanceFacts: row.hasPerformanceFacts,
      insights: { data: [insight] }
    };
  });
}

export async function getCanonicalAdHierarchy(input: CanonicalAdHierarchyInput) {
  const normAccountId = normalizeMetaAccountId(String(input.accountId));
  const numericAccountId = normAccountId.replace(/^act_/, "");
  const showAll = Boolean(input.includeZeroSpend);
  const structureName = input.level === "campaign" ? "Campaign" : input.level === "adset" ? "AdSet" : "Ad";
  const source = `FactMetaPerformance level=${input.level} + ${structureName}`;

  const coverageArgs: any = {
    source: "META_CREATIVE",
    requestedStartDate: input.startDate,
    requestedEndDate: input.endDate,
    accountId: normAccountId,
    factLevel: input.level
  };
  if (input.campaignId) coverageArgs.campaignId = input.campaignId;
  if (input.adsetId) coverageArgs.adsetId = input.adsetId;

  const hierarchyCoverage = await getDataSourceCoverage(coverageArgs);

  const baseWhere: any = {
    level: input.level,
    account_id: { in: [normAccountId, numericAccountId] },
    date: { gte: input.startDate, lte: input.endDate }
  };
  if (input.level === "adset" && input.campaignId) baseWhere.campaign_id = input.campaignId;
  if (input.level === "ad" && input.adsetId) baseWhere.adset_id = input.adsetId;

  const performanceRows = await prisma.factMetaPerformance.findMany({ where: baseWhere });

  let structures: any[] = [];
  let parent: any = null;
  if (input.level === "campaign") {
    structures = await prisma.campaign.findMany({ where: { accountId: normAccountId } });
  } else if (input.level === "adset") {
    if (input.campaignId) {
      structures = await prisma.adSet.findMany({
        where: { campaignId: String(input.campaignId) },
        include: { campaign: true }
      });
      parent = await prisma.campaign.findUnique({ where: { id: String(input.campaignId) } });
    } else {
      const campaigns = await prisma.campaign.findMany({
        where: { accountId: normAccountId },
        select: { id: true }
      });
      structures = await prisma.adSet.findMany({
        where: { campaignId: { in: campaigns.map((campaign) => campaign.id) } },
        include: { campaign: true }
      });
    }
  } else {
    if (input.adsetId) {
      structures = await prisma.ad.findMany({
        where: { adsetId: String(input.adsetId) },
        include: { adSet: { include: { campaign: true } } }
      });
      parent = await prisma.adSet.findUnique({
        where: { id: String(input.adsetId) },
        include: { campaign: true }
      });
    } else {
      const campaigns = await prisma.campaign.findMany({
        where: { accountId: normAccountId },
        select: { id: true }
      });
      const adsets = await prisma.adSet.findMany({
        where: { campaignId: { in: campaigns.map((campaign) => campaign.id) } },
        select: { id: true }
      });
      structures = await prisma.ad.findMany({
        where: { adsetId: { in: adsets.map((adset) => adset.id) } },
        include: { adSet: { include: { campaign: true } } }
      });
    }
  }

  const perfMap = new Map<string, any>();
  for (const row of performanceRows) {
    const id = input.level === "campaign"
      ? row.campaign_id || row.entity_id
      : input.level === "adset"
        ? row.adset_id || row.entity_id
        : row.ad_id || row.entity_id;
    if (!id) continue;
    if (!perfMap.has(id)) perfMap.set(id, emptyAgg());
    addAgg(perfMap.get(id), row);
  }

  const structMap = new Map<string, any>();
  structures.forEach((row) => structMap.set(row.id, row));
  const allIds = new Set<string>([...perfMap.keys(), ...structMap.keys()]);

  let results: any[] = [];
  for (const id of allIds) {
    const hasPerformanceFacts = perfMap.has(id);
    const agg = perfMap.get(id) || emptyAgg();
    const struct = structMap.get(id);
    const unsynced = !struct;
    const commonMetrics = metricFields(hasPerformanceFacts, agg);

    if (input.level === "campaign") {
      results.push({
        id,
        name: struct?.name || `${id} (结构未同步)`,
        status: struct?.status || "UNKNOWN",
        objective: null,
        budget: null,
        ...commonMetrics,
        unsynced
      });
    } else if (input.level === "adset") {
      results.push({
        id,
        name: struct?.name || `${id} (结构未同步)`,
        status: "UNKNOWN",
        campaignId: input.campaignId || struct?.campaignId || struct?.campaign?.id,
        campaignName: parent?.name || struct?.campaign?.name || "未知广告系列",
        ...commonMetrics,
        unsynced
      });
    } else {
      results.push({
        id,
        name: struct?.name || `${id} (结构未同步)`,
        status: "UNKNOWN",
        campaignId: struct?.campaignId || struct?.adSet?.campaign?.id || parent?.campaignId || parent?.campaign?.id,
        adsetId: input.adsetId || struct?.adsetId,
        adsetName: parent?.name || struct?.adSet?.name || "未知广告组",
        campaignName: parent?.campaign?.name || struct?.adSet?.campaign?.name || "未知广告系列",
        creativeId: struct?.creativeId || agg.creative_id || "N/A",
        ...commonMetrics,
        unsynced
      });
    }
  }

  if (!showAll) {
    results = results.filter((row) => Number(row.spend || 0) > 0);
  }
  results.sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));

  let reason = "OK";
  if (results.length === 0) {
    if (!input.accountId || String(input.accountId) === "undefined") {
      reason = "ACCOUNT_ID_FORMAT_MISMATCH";
    } else if (input.level === "adset" && input.campaignId && !parent) {
      reason = "CAMPAIGN_ID_MISMATCH";
    } else if (input.level === "ad" && input.adsetId && !parent) {
      reason = "ADSET_ID_MISMATCH";
    } else if (structures.length === 0) {
      reason = "NO_STRUCTURE_ROWS";
    } else if (performanceRows.length === 0) {
      reason = "NO_FACT_LEVEL_ROWS";
    } else if (!showAll) {
      reason = "FILTER_ZERO_SPEND_HIDDEN";
    } else {
      reason = "NO_FACT_LEVEL_ROWS";
    }
  }

  return {
    success: true,
    coverage: hierarchyCoverage,
    sourceCoverage: hierarchyCoverage,
    data: results,
    dataHealth: {
      status: hierarchyCoverage.status,
      level: input.level,
      reason,
      factRows: performanceRows.length,
      structureRows: structures.length,
      dateRange: {
        startDate: input.startDate,
        endDate: input.endDate,
        timezone: DATA_CENTER_TIMEZONE
      },
      accountId: normAccountId,
      queryDebug: buildQueryDebug({
        level: input.level,
        source,
        accountId: normAccountId,
        campaignId: input.campaignId,
        adsetId: input.adsetId,
        includeZeroSpend: showAll,
        factRows: performanceRows.length,
        structureRows: structures.length
      })
    },
    appliedFilters: buildAppliedFilters(input, normAccountId),
    dateRange: {
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: DATA_CENTER_TIMEZONE
    },
    dataSourceExplain: buildDataSourceExplain(input.level)
  };
}
