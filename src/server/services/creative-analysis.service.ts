import crypto from "node:crypto";
import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getDataSourceCoverage } from "./data-coverage.service.js";
import type {
  CreativeAiConclusion,
  CreativeAnalysisReport,
  CreativeAnalysisRequest
} from "../../shared/creative-intelligence-contract.js";

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

  const where: any = {
    level: "ad",
    date: { gte: scope.startDate, lte: scope.endDate },
    account_id: { in: [scope.accountId, scope.accountId.replace(/^act_/, "")] }
  };
  if (scope.adIds.length) where.OR = [{ ad_id: { in: scope.adIds } }, { entity_id: { in: scope.adIds } }];
  if (scope.creativeIds.length) {
    where.OR = [...(where.OR || []), { creative_id: { in: scope.creativeIds } }];
  }
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
    creativeIds: scope.creativeIds,
    adIds: scope.adIds,
    campaignIds: scope.campaignIds,
    adsetIds: scope.adsetIds,
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
      creativeIds: scope.creativeIds,
      adIds: scope.adIds,
      campaignIds: scope.campaignIds,
      adsetIds: scope.adsetIds,
      latestPerformanceDate
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
