import crypto from "node:crypto";
import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getDataSourceCoverage } from "./data-coverage.service.js";
import type {
  CreativeAiConclusion,
  CreativeAnalysisReport,
  CreativeAnalysisRequest
} from "../../shared/creative-intelligence-contract.js";

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

function dateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueSorted(values: unknown[]) {
  return Array.from(new Set(values.map(value => String(value || "").trim()).filter(Boolean))).sort();
}

function fixed(value: number, digits = 4) {
  return Number(value.toFixed(digits));
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

function assetIdentity(creative: any, creativeId: string, adId: string): string {
  return String(
    creative?.imageHash ||
    creative?.videoHash ||
    creative?.metaAssetId ||
    creativeId ||
    adId
  );
}

function accountAssetGroupKey(input: { accountId: string; assetIdentity: string }): string {
  return `${normalizeMetaAccountId(input.accountId)}::${input.assetIdentity}`;
}

function scopedError(code: string, statusCode = 409) {
  const error: any = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function buildCreativeAnalysisScopeHash(input: {
  analysisEntityId: string;
  accountId: string;
  storeId: number | null;
  startDate: string;
  endDate: string;
  creativeIds: string[];
  adIds: string[];
  campaignIds: string[];
  adsetIds: string[];
  latestPerformanceDate: string | null;
  latestSyncedAt: string | null;
  factRows: number;
}) {
  return crypto.createHash("sha256").update(JSON.stringify({
    analysisEntityId: input.analysisEntityId,
    accountId: normalizeMetaAccountId(input.accountId),
    storeId: input.storeId,
    startDate: input.startDate,
    endDate: input.endDate,
    creativeIds: uniqueSorted(input.creativeIds),
    adIds: uniqueSorted(input.adIds),
    campaignIds: uniqueSorted(input.campaignIds),
    adsetIds: uniqueSorted(input.adsetIds),
    latestPerformanceDate: input.latestPerformanceDate,
    latestSyncedAt: input.latestSyncedAt,
    factRows: input.factRows
  })).digest("hex");
}

function normalizeRequest(request: CreativeAnalysisRequest): CreativeAnalysisRequest {
  const normalizedAccountId = normalizeMetaAccountId(request.accountId || "");
  const creativeIds = uniqueSorted(request.creativeIds || []);
  const adIds = uniqueSorted(request.adIds || []);
  const campaignIds = uniqueSorted(request.campaignIds || []);
  const adsetIds = uniqueSorted(request.adsetIds || []);
  const storeId = request.storeId === null || request.storeId === undefined
    ? null
    : Number(request.storeId);

  if (!request.analysisEntityId || !normalizedAccountId || (creativeIds.length === 0 && adIds.length === 0)) {
    const error: any = new Error("INVALID_CREATIVE_ANALYSIS_SCOPE");
    error.code = "INVALID_CREATIVE_ANALYSIS_SCOPE";
    error.statusCode = 400;
    throw error;
  }
  if (!dateOnly(request.startDate) || !dateOnly(request.endDate) || request.startDate > request.endDate) {
    const error: any = new Error("INVALID_DATE_RANGE");
    error.code = "INVALID_DATE_RANGE";
    error.statusCode = 400;
    throw error;
  }
  if (storeId !== null && (!Number.isInteger(storeId) || storeId <= 0)) {
    const error: any = new Error("INVALID_CREATIVE_ANALYSIS_SCOPE");
    error.code = "INVALID_CREATIVE_ANALYSIS_SCOPE";
    error.statusCode = 400;
    throw error;
  }

  return {
    ...request,
    accountId: normalizedAccountId,
    storeId,
    creativeIds,
    adIds,
    campaignIds,
    adsetIds
  };
}

function conclusionFor(metrics: {
  spend: number;
  impressions: number;
  purchases: number;
  roas: number | null;
}): CreativeAiConclusion {
  if (metrics.spend < 10 && metrics.impressions < 1000 && metrics.purchases === 0) return "INSUFFICIENT_DATA";
  if (metrics.spend >= 20 && metrics.purchases > 0 && metrics.roas !== null && metrics.roas >= 1.5) return "SCALE";
  if (metrics.spend >= 30 && metrics.purchases === 0) return "STOP";
  if (metrics.spend >= 20 && metrics.roas !== null && metrics.roas < 1) return "REDUCE";
  return "WATCH";
}

function actionsFor(conclusion: CreativeAiConclusion) {
  switch (conclusion) {
    case "SCALE":
      return ["继续保持", "复制到独立测试", "制作文案变体"];
    case "STOP":
      return ["暂停观察", "制作新开头", "制作新比例"];
    case "REDUCE":
      return ["降低预算", "继续观察", "制作文案变体"];
    case "INSUFFICIENT_DATA":
      return ["补充数据后判断", "继续观察"];
    default:
      return ["继续观察", "制作文案变体"];
  }
}

export async function analyzeCreativeScope(request: CreativeAnalysisRequest): Promise<CreativeAnalysisReport | { success: true; cached: false; report: null }> {
  const scope = normalizeRequest(request);
  const coverage = await getDataSourceCoverage({
    source: "META_CREATIVE",
    requestedStartDate: scope.startDate,
    requestedEndDate: scope.endDate,
    accountId: scope.accountId,
    storeId: scope.storeId,
    factLevel: "ad"
  });
  const coverageStatus = String(coverage.status || "").toUpperCase();
  if (coverageStatus === "NOT_SYNCED") {
    const error: any = new Error("CREATIVE_ANALYSIS_NOT_SYNCED");
    error.code = "CREATIVE_ANALYSIS_NOT_SYNCED";
    error.statusCode = 409;
    throw error;
  }
  if (coverageStatus === "SYNC_RUNNING") {
    const error: any = new Error("CREATIVE_ANALYSIS_SYNC_RUNNING");
    error.code = "CREATIVE_ANALYSIS_SYNC_RUNNING";
    error.statusCode = 409;
    throw error;
  }
  if (coverageStatus === "ERROR") {
    const error: any = new Error("CREATIVE_ANALYSIS_COVERAGE_ERROR");
    error.code = "CREATIVE_ANALYSIS_COVERAGE_ERROR";
    error.statusCode = 500;
    throw error;
  }

  const accountVariants = [scope.accountId, scope.accountId.replace(/^act_/, "")];
  if (scope.storeId !== null) {
    const store = await prisma.store.findFirst({
      where: { id: scope.storeId, ...productionStoreWhere }
    });
    if (!store) throw scopedError("CREATIVE_ANALYSIS_STORE_ACCOUNT_MISMATCH");
    const [boundAccounts, mappings] = await Promise.all([
      prisma.adAccount.findMany({
        where: { fb_account_id: { in: accountVariants } }
      }),
      prisma.accountMapping.findMany({
        where: { fbAccountId: { in: accountVariants } }
      })
    ]);
    const boundStoreIds = new Set<number>([
      ...boundAccounts.map((account: any) => account.storeId).filter((value: any) => value !== null && value !== undefined).map(Number),
      ...mappings.map((mapping: any) => mapping.storeId).filter((value: any) => value !== null && value !== undefined).map(Number)
    ]);
    if (!boundStoreIds.has(scope.storeId)) {
      throw scopedError("CREATIVE_ANALYSIS_STORE_ACCOUNT_MISMATCH");
    }
  }

  const candidateOr: any[] = [];
  if (scope.adIds.length > 0) candidateOr.push({ id: { in: scope.adIds } });
  if (scope.creativeIds.length > 0) candidateOr.push({ creativeId: { in: scope.creativeIds } });
  const canonicalAds = await prisma.ad.findMany({
    where: {
      accountId: { in: accountVariants },
      OR: candidateOr
    },
    include: { adSet: { include: { campaign: true } } }
  });
  const canonicalAdIds = uniqueSorted(canonicalAds.map((ad: any) => ad.id));
  const canonicalCreativeIds = uniqueSorted(canonicalAds.map((ad: any) => ad.creativeId));
  if (
    !scope.adIds.every(id => canonicalAdIds.includes(id)) ||
    !scope.creativeIds.every(id => canonicalCreativeIds.includes(id))
  ) {
    throw scopedError("CREATIVE_ANALYSIS_SCOPE_MISMATCH");
  }
  const canonicalCampaignIds = uniqueSorted(canonicalAds.map((ad: any) => ad.campaignId || ad.adSet?.campaignId || ad.adSet?.campaign?.id));
  const canonicalAdsetIds = uniqueSorted(canonicalAds.map((ad: any) => ad.adsetId || ad.adSet?.id));
  if (
    !scope.campaignIds.every(id => canonicalCampaignIds.includes(id)) ||
    !scope.adsetIds.every(id => canonicalAdsetIds.includes(id))
  ) {
    throw scopedError("CREATIVE_ANALYSIS_SCOPE_MISMATCH");
  }

  const canonicalCreatives = canonicalCreativeIds.length === 0
    ? []
    : await prisma.adCreative.findMany({ where: { creativeId: { in: canonicalCreativeIds } } });
  const creativeById = new Map(canonicalCreatives.map((creative: any) => [creative.creativeId, creative]));
  const canonicalAnalysisEntityIds = new Set<string>();
  for (const ad of canonicalAds as any[]) {
    const creative = creativeById.get(ad.creativeId);
    const creativeId = String(ad.creativeId || "");
    const assetKey = assetIdentity(creative, creativeId, String(ad.id || creativeId));
    canonicalAnalysisEntityIds.add(accountAssetGroupKey({ accountId: scope.accountId, assetIdentity: assetKey }));
  }
  if (canonicalAnalysisEntityIds.size !== 1 || !canonicalAnalysisEntityIds.has(scope.analysisEntityId)) {
    throw scopedError("CREATIVE_ANALYSIS_ASSET_MISMATCH");
  }

  const where: any = {
    level: "ad",
    date: { gte: scope.startDate, lte: scope.endDate },
    account_id: { in: accountVariants },
    OR: [
      { ad_id: { in: canonicalAdIds } },
      { entity_id: { in: canonicalAdIds } },
      { creative_id: { in: canonicalCreativeIds } }
    ]
  };
  if (scope.campaignIds.length) where.campaign_id = { in: scope.campaignIds };
  if (scope.adsetIds.length) where.adset_id = { in: scope.adsetIds };

  const facts = await prisma.factMetaPerformance.findMany({ where });
  if (facts.length === 0 || coverageStatus === "TRUE_EMPTY") {
    const error: any = new Error("NO_CANONICAL_CREATIVE_FACTS");
    error.code = "NO_CANONICAL_CREATIVE_FACTS";
    error.statusCode = 404;
    throw error;
  }

  const latestPerformanceDate = facts.reduce<string | null>((latest, row: any) => (
    row.date && (!latest || row.date > latest) ? row.date : latest
  ), null);
  const latestSyncedAt = facts.reduce<string | null>((latest, row: any) => {
    const value = row.synced_at ? new Date(row.synced_at).toISOString() : null;
    return value && (!latest || value > latest) ? value : latest;
  }, null);
  const scopeHash = buildCreativeAnalysisScopeHash({
    analysisEntityId: scope.analysisEntityId,
    accountId: scope.accountId,
    storeId: scope.storeId,
    startDate: scope.startDate,
    endDate: scope.endDate,
    creativeIds: canonicalCreativeIds,
    adIds: canonicalAdIds,
    campaignIds: scope.campaignIds.length ? scope.campaignIds : canonicalCampaignIds,
    adsetIds: scope.adsetIds.length ? scope.adsetIds : canonicalAdsetIds,
    latestPerformanceDate,
    latestSyncedAt,
    factRows: facts.length
  });
  const dateRangeKey = `${scope.startDate} 至 ${scope.endDate}`;
  const cached = await prisma.aiAnalysisReport.findFirst({
    where: {
      entityId: scope.analysisEntityId,
      entityType: "creative",
      dateRange: dateRangeKey,
      model: "creative-rule-v1"
    },
    orderBy: { createdAt: "desc" }
  });
  if (!scope.forceRefresh && cached && parseMetadata(cached.metadata).scopeHash === scopeHash) {
    return {
      ...parseMetadata(cached.metadata).report,
      cached: true
    };
  }
  if (scope.onlyCached) return { success: true, cached: false, report: null };

  const spend = facts.reduce((sum: number, item: any) => sum + finiteNumber(item.spend), 0);
  const impressions = facts.reduce((sum: number, item: any) => sum + finiteNumber(item.impressions), 0);
  const clicks = facts.reduce((sum: number, item: any) => sum + finiteNumber(item.clicks), 0);
  const purchases = facts.reduce((sum: number, item: any) => sum + finiteNumber(item.purchases), 0);
  const purchaseValue = facts.reduce((sum: number, item: any) => sum + finiteNumber(item.purchase_value), 0);
  const metrics = {
    spend: fixed(spend, 2),
    impressions,
    clicks,
    purchases,
    purchaseValue: fixed(purchaseValue, 2),
    ctr: impressions > 0 ? fixed((clicks / impressions) * 100) : null,
    cpc: clicks > 0 ? fixed(spend / clicks) : null,
    cpm: impressions > 0 ? fixed((spend / impressions) * 1000) : null,
    cpa: purchases > 0 ? fixed(spend / purchases) : null,
    roas: spend > 0 ? fixed(purchaseValue / spend) : null
  };
  const conclusionCategory = conclusionFor(metrics);
  const warnings = coverageStatus === "PARTIAL_COVERAGE" ? ["当前为部分覆盖，报告按已入库事实降级判断。"] : [];
  const report: CreativeAnalysisReport = {
    success: true,
    cached: false,
    mode: "rule_diagnostic_engine",
    analysisEntityId: scope.analysisEntityId,
    scopeHash,
    dateRange: { startDate: scope.startDate, endDate: scope.endDate },
    coverageStatus,
    confidence: coverageStatus === "PARTIAL_COVERAGE" ? "partial" : "full",
    conclusionCategory,
    conclusion: `${conclusionCategory}: creative-rule-v1 基于 ${facts.length} 条 ad-level facts 生成。`,
    metrics,
    facts: [
      `花费 ${metrics.spend}`,
      `展示 ${metrics.impressions}`,
      `点击 ${metrics.clicks}`,
      `购买 ${metrics.purchases}`,
      `转化价值 ${metrics.purchaseValue}`
    ],
    riskPoints: conclusionCategory === "STOP" || conclusionCategory === "REDUCE"
      ? ["当前事实触发降预算或暂停观察规则。"]
      : [],
    recommendedActions: actionsFor(conclusionCategory),
    warnings,
    dataBasis: {
      source: "FactMetaPerformance",
      factLevel: "ad",
      factRows: facts.length,
      accountId: scope.accountId,
      storeId: scope.storeId,
      creativeIds: canonicalCreativeIds,
      adIds: canonicalAdIds,
      campaignIds: scope.campaignIds.length ? scope.campaignIds : canonicalCampaignIds,
      adsetIds: scope.adsetIds.length ? scope.adsetIds : canonicalAdsetIds,
      latestPerformanceDate,
      latestSyncedAt
    }
  };

  await prisma.aiAnalysisReport.create({
    data: {
      type: "creative",
      entityType: "creative",
      entityId: scope.analysisEntityId,
      dateRange: dateRangeKey,
      conclusion: report.conclusion,
      dataBasis: report.facts.join("\n"),
      riskPoints: report.riskPoints.join("\n"),
      priority: conclusionCategory === "STOP" || conclusionCategory === "REDUCE" ? 1 : 3,
      model: "creative-rule-v1",
      metadata: JSON.stringify({ scopeHash, report })
    }
  });

  return report;
}
