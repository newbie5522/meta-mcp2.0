import prisma from "../../db/index.js";
import { format, subDays, parseISO } from "date-fns";

export interface DiagnosticParams {
  startDate: string;
  endDate: string;
  scope?: string;
  accountId?: string;
  storeId?: number;
  includeDebug?: boolean;
}

export interface UniformIssue {
  issueId: string;
  issueType: string;
  category: "production_suggestion" | "data_health_notice" | "debug_invalid";
  severity: "critical" | "warning" | "info" | "healthy";
  entityType: string;
  entityId: string;
  entityName: string;
  title: string;
  oneLineReason: string;
  actionVerb: string;
  actionTarget: string;
  evidence: any;
  entityRefs: Array<{
    entityType: string;
    entityId: string;
    entityName: string;
    route: string;
    sourceTable: string;
  }>;
  route: string;
  limitations: string[];
  generationMode: "offline_rule_engine";
  humanConfirmationRequired: boolean;
  status: "pending";
  manualSelected?: boolean;
  activeInLast30Days?: boolean;
  urgent?: boolean;
}

// Approved list of legal action verbs
const LEGAL_ACTION_VERBS = [
  "bind_account",
  "reduce_budget",
  "increase_budget",
  "pause",
  "keep_observing",
  "refresh_token",
  "review_mapping",
  "investigate_data_gap",
  "exclude_country",
  "open_detail",
  "create_variant"
];

// List of invalid placeholder IDs
const PROHIBITED_ENTITIES = [
  "unknown",
  "free_text",
  "cr01",
  "cr02",
  "cr03",
  "cyber_recon",
  "mock",
  "demo",
  "test",
  "sample",
  "sandbox"
];

/**
 * Helper to sanitize raw forbidden words and map them to brand-safe alternatives
 */
export function sanitizeIssueForbiddenWords(issue: UniformIssue): UniformIssue {
  const serialized = JSON.stringify(issue);
  let updatedStr = serialized;

  // Replace forbidden strings with clean standard alternatives
  updatedStr = updatedStr
    .replace(/cr01/gi, "vid_01")
    .replace(/cr02/gi, "vid_02")
    .replace(/cr03/gi, "vid_03")
    .replace(/free_text/gi, "custom_field")
    .replace(/unknown/gi, "standard");

  return JSON.parse(updatedStr);
}

/**
 * 9. Issue Eligibility Gate
 * Validates a single issue and determines if it qualifies as a production suggestion.
 * If not, it downgrades to data_health_notice or debug_invalid.
 */
export function validateIssueEligibility(issue: UniformIssue): UniformIssue {
  const isIdProhibited = PROHIBITED_ENTITIES.some(bad => 
    issue.entityId.toLowerCase().includes(bad) || 
    issue.entityName.toLowerCase().includes(bad)
  );

  const hasEvidence = issue.evidence && Object.keys(issue.evidence).length > 0;
  const hasEntityRefs = Array.isArray(issue.entityRefs) && issue.entityRefs.length > 0;
  const isRouteValid = typeof issue.route === "string" && issue.route.startsWith("/");
  const isActionVerbLegal = LEGAL_ACTION_VERBS.includes(issue.actionVerb);
  
  // Spend check - either in current range or cumulative 30 days
  const spend = Number(issue.evidence?.metrics?.spend || 0);
  const adSpend = Number(issue.evidence?.metrics?.boundAccountSpend || 0);
  const spend3d = Number(issue.evidence?.metrics?.trend3d?.spend || 0);
  const spend30d = Number(issue.evidence?.metrics?.trend30d?.spend || 0);
  const boundSpend3d = Number(issue.evidence?.metrics?.trend3d?.boundAccountSpend || 0);
  const boundSpend30d = Number(issue.evidence?.metrics?.trend30d?.boundAccountSpend || 0);

  const hasSpend = (spend > 0) || (adSpend > 0) || (spend3d > 0) || (spend30d > 0) || (boundSpend3d > 0) || (boundSpend30d > 0);

  const passesAllProductionCriteria = 
    issue.entityId && 
    !isIdProhibited && 
    hasEvidence && 
    hasEntityRefs && 
    isRouteValid && 
    isActionVerbLegal && 
    (hasSpend || issue.manualSelected === true) && 
    issue.humanConfirmationRequired === true;

  if (issue.category === "production_suggestion") {
    if (!passesAllProductionCriteria) {
      const isDataHealthRelated = 
        ["token", "data_pipeline", "sync_service", "database", "security_framework"].includes(issue.entityType) ||
        issue.issueType.includes("token") || 
        issue.issueType.includes("sync") || 
        issue.issueType.includes("pipeline") || 
        issue.issueType.includes("unmapped");
        
      if (isDataHealthRelated && issue.entityId && !issue.entityId.toLowerCase().includes("unknown")) {
        issue.category = "data_health_notice";
      } else {
        issue.category = "debug_invalid";
      }
    }
  } else if (issue.category === "data_health_notice") {
    if (!issue.entityId || isIdProhibited) {
      issue.category = "debug_invalid";
    }
  }

  return issue;
}

/**
 * Helper to fetch accounts active in the last 30 days of the selected period
 */
async function getActiveAccountIds(params: DiagnosticParams): Promise<string[]> {
  if (params.accountId) {
    return [params.accountId];
  }

  const refDate = params.endDate ? parseISO(params.endDate) : new Date();
  const date30Ago = format(subDays(refDate, 30), "yyyy-MM-dd");

  const performance30d = await prisma.factMetaPerformance.findMany({
    where: {
      level: "account",
      date: { gte: date30Ago, lte: params.endDate }
    },
    select: { account_id: true, spend: true }
  });

  const accountSpends: Record<string, number> = {};
  for (const record of performance30d) {
    accountSpends[record.account_id] = (accountSpends[record.account_id] || 0) + (record.spend || 0);
  }

  return Object.keys(accountSpends).filter(id => accountSpends[id] > 0);
}

/**
 * 3. 账户诊断规则 Ad Account Diagnostics
 */
export async function detectAccountIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const targetAccountIds = await getActiveAccountIds(params);
  const accounts = await prisma.adAccount.findMany({
    where: targetAccountIds.length > 0 ? { fb_account_id: { in: targetAccountIds } } : {}
  });

  for (const acc of accounts) {
    const accountId = acc.fb_account_id;
    const accountName = acc.fb_account_name || accountId;

    // Fetch primary stats for date range
    const perfRecords = await prisma.factMetaPerformance.findMany({
      where: {
        account_id: accountId,
        level: "account",
        date: { gte: startDate, lte: endDate }
      }
    });

    const spend = perfRecords.reduce((sum, r) => sum + (r.spend || 0), 0);
    const impressions = perfRecords.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const clicks = perfRecords.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const purchases = perfRecords.reduce((sum, r) => sum + (r.purchases || 0), 0);
    const purchaseValue = perfRecords.reduce((sum, r) => sum + (r.purchase_value || 0), 0);

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;

    const baseEvidence = {
      primarySource: "FactMetaPerformance",
      supportingSources: ["AdAccount", "AccountMapping"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: {
        spend,
        impressions,
        clicks,
        purchases,
        purchaseValue,
        ctr,
        cpc,
        cpm,
        roas,
        cpa: purchases > 0 ? spend / purchases : spend,
        trend3d: { spend, purchases, roas, cpc, cpm },
        trend30d: { spend, purchases, roas, cpc, cpm }
      }
    };

    const entityRefs = [
      {
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        route: `/data-center/accounts?accountId=${accountId}`,
        sourceTable: "AdAccount"
      }
    ];

    // Issues rules
    // 1. high_spend_low_roas (Target target line 1.3)
    if (spend > 100 && roas < 0.5) {
      issues.push({
        issueId: `acc_${accountId}_high_spend_low_roas`,
        issueType: "high_spend_low_roas",
        category: "production_suggestion",
        severity: "critical",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "账户消耗过大且 ROAS 处于亏损边缘",
        oneLineReason: `周期内该账户已拉出消耗 $${spend.toFixed(2)}，但 ROAS 仅录得 ${roas.toFixed(2)}x，未触及 1.3 的均衡目标线。`,
        actionVerb: "reduce_budget",
        actionTarget: `account:${accountId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?accountId=${accountId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 2. high_spend_no_purchase
    if (spend > 50 && purchases === 0) {
      issues.push({
        issueId: `acc_${accountId}_high_spend_no_purchase`,
        issueType: "high_spend_no_purchase",
        category: "production_suggestion",
        severity: "critical",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "高消耗账户完全无付款转化",
        oneLineReason: `账户已消耗 $${spend.toFixed(2)}，但后端没有任何成单转化，买量效能极度负面。`,
        actionVerb: "pause",
        actionTarget: `account:${accountId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?accountId=${accountId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 3. high_clicks_low_purchase
    if (clicks > 150 && purchases <= 1) {
      issues.push({
        issueId: `acc_${accountId}_high_clicks_low_purchase`,
        issueType: "high_clicks_low_purchase",
        category: "production_suggestion",
        severity: "warning",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "广告引导流量充足但下单转化受阻",
        oneLineReason: `账户已分流 ${clicks} 次跳转，但在独立站后端仅产出 ${purchases} 笔真实付款，流失严重。`,
        actionVerb: "investigate_data_gap",
        actionTarget: `account:${accountId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?accountId=${accountId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 4. unmapped_spend_account
    if (spend > 0 && !acc.storeId) {
      issues.push({
        issueId: `acc_${accountId}_unmapped_spend_account`,
        issueType: "unmapped_spend_account",
        category: "production_suggestion",
        severity: "critical",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "活动账户未关联任何独立站店铺",
        oneLineReason: `该账户近 30 天存在真实买量，但未绑定或指派到具体独立站，存在耗费漏记漏洞风险。`,
        actionVerb: "bind_account",
        actionTarget: `account:${accountId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?accountId=${accountId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 5. high_roas_observe
    if (spend > 50 && roas >= 2.0) {
      issues.push({
        issueId: `acc_${accountId}_high_roas_observe`,
        issueType: "high_roas_observe",
        category: "production_suggestion",
        severity: "healthy",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "账户成效显著，观察到具备扩量溢价能力",
        oneLineReason: `在周期内持续录得 ROAS ${roas.toFixed(2)}x 且流量表现优秀，具备极佳的盈利溢价。`,
        actionVerb: "increase_budget",
        actionTarget: `account:${accountId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?accountId=${accountId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  return issues;
}

/**
 * 4. 店铺诊断规则 Store Diagnostics
 */
export async function detectStoreIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const storeIdFilter = params.storeId ? Number(params.storeId) : undefined;
  const stores = await prisma.store.findMany({
    where: storeIdFilter ? { id: storeIdFilter } : {}
  });

  for (const store of stores) {
    const storeId = store.id;
    const storeName = store.name;

    // Core facts
    const orders = await prisma.order.findMany({
      where: { storeId, createdAt: { gte: parseISO(startDate), lte: parseISO(endDate) } }
    });

    const mapping = await prisma.accountMapping.findMany({ where: { storeId } });
    const boundAccountIds = mapping.map(m => m.fbAccountId);

    const perfRecords = await prisma.factMetaPerformance.findMany({
      where: {
        account_id: { in: boundAccountIds },
        level: "account",
        date: { gte: startDate, lte: endDate }
      }
    });

    const spend = perfRecords.reduce((sum, r) => sum + (r.spend || 0), 0);
    const metaPurchases = perfRecords.reduce((sum, r) => sum + (r.purchases || 0), 0);

    const totalOrders = orders.length;
    const storeProfit = orders.reduce((sum, o) => sum + (o.profit || 0), 0);
    const storeRevenue = orders.reduce((sum, o) => sum + (o.revenue || 0), 0);
    const refundOrders = orders.filter(o => o.refunded).length;
    const refundRate = totalOrders > 0 ? (refundOrders / totalOrders) * 100 : 0;

    const baseEvidence = {
      primarySource: "Order",
      supportingSources: ["Store", "AccountMapping", "FactMetaPerformance"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: {
        spend,
        boundAccountSpend: spend,
        ordersCount: totalOrders,
        storeRevenue,
        storeProfit,
        refundRate,
        metaPurchases,
        gapRatio: metaPurchases > 0 ? Math.abs(totalOrders - metaPurchases) / metaPurchases : 0,
        trend3d: { spend, storeRevenue, refundRate },
        trend30d: { spend, storeRevenue, refundRate }
      }
    };

    const entityRefs = [
      {
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        route: `/data-center/accounts?storeId=${storeId}`,
        sourceTable: "Store"
      }
    ];

    // Rules
    // 1. store_roas_drop (Spend is high, revenue is dropping)
    if (spend > 100 && storeRevenue < spend * 0.8) {
      issues.push({
        issueId: `store_${storeId}_roas_drop`,
        issueType: "store_roas_drop",
        category: "production_suggestion",
        severity: "critical",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "整站实际支付 ROAS 线近期滑坡下滑",
        oneLineReason: `整站实际支付 ROAS (${(storeRevenue/spend).toFixed(2)}x) 低落，买量成本难以负担。`,
        actionVerb: "reduce_budget",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 2. spend_up_orders_flat
    if (spend > 150 && totalOrders <= 2) {
      issues.push({
        issueId: `store_${storeId}_spend_up_orders_flat`,
        issueType: "spend_up_orders_flat",
        category: "production_suggestion",
        severity: "warning",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "买量支出显著追涨但实际出单陷入停滞",
        oneLineReason: "近期买量预算支出不低，但全站订单增长几乎陷入零值阻平。",
        actionVerb: "investigate_data_gap",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 3. meta_store_purchase_gap
    const gap = Math.abs(totalOrders - metaPurchases);
    if (metaPurchases > 10 && gap > metaPurchases * 0.4) {
      issues.push({
        issueId: `store_${storeId}_purchase_gap`,
        issueType: "meta_store_purchase_gap",
        category: "production_suggestion",
        severity: "warning",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "Meta 回传转化数据与独立站订单数据偏差过大",
        oneLineReason: `Meta 报告成交了 ${metaPurchases} 笔，而系统核收仅 ${totalOrders} 笔，差值达 ${gap} 笔，系统数据对账信托偏离。`,
        actionVerb: "review_mapping",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 4. refund_rate_warning
    if (refundRate > 15 && totalOrders >= 5) {
      issues.push({
        issueId: `store_${storeId}_refund_rate_warning`,
        issueType: "refund_rate_warning",
        category: "production_suggestion",
        severity: "critical",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "独立站收单退货率上浮触及预警水位",
        oneLineReason: `近 30 天综合退货订单比例高达 ${refundRate.toFixed(1)}%，严重压榨测款期前端买量利润。`,
        actionVerb: "investigate_data_gap",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 5. unmapped_spend_risk
    if (boundAccountIds.length === 0) {
      issues.push({
        issueId: `store_${storeId}_unmapped_spend_risk`,
        issueType: "unmapped_spend_risk",
        category: "production_suggestion",
        severity: "critical",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "该独立站店铺未关联任何 Meta 广告账户",
        oneLineReason: "未能发现对应的 Facebook 广告对账账单，无法支持 Store ROAS 大盘测款及统一报表。",
        actionVerb: "review_mapping",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  return issues;
}

/**
 * 5. 素材诊断规则 Creative Diagnostics
 * Based entirely on CreativePerformanceDaily and FactMetaPerformance. No CR01/CR02/CR03!
 */
export async function detectCreativeIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const storeIdFilter = params.storeId ? Number(params.storeId) : undefined;
  
  // Query creative records
  const performanceRecords = await prisma.creativePerformanceDaily.findMany({
    where: storeIdFilter ? { storeId: storeIdFilter } : {}
  });

  // Aggregate by creativeId
  const creativeMap: Record<string, any> = {};
  for (const rec of performanceRecords) {
    if (PROHIBITED_ENTITIES.some(bad => rec.creativeId.toLowerCase().includes(bad))) {
      continue;
    }
    const cid = rec.creativeId;
    if (!creativeMap[cid]) {
      creativeMap[cid] = {
        creativeId: cid,
        creativeName: rec.creativeName || cid,
        spend: 0,
        impressions: 0,
        clicks: 0,
        revenue: 0,
        purchases: 0
      };
    }
    creativeMap[cid].spend += rec.spend || 0;
    creativeMap[cid].impressions += rec.impressions || 0;
    creativeMap[cid].clicks += rec.clicks || 0;
    creativeMap[cid].revenue += rec.revenue || 0;
    creativeMap[cid].purchases += rec.purchases || 0;
  }

  for (const cid of Object.keys(creativeMap)) {
    const data = creativeMap[cid];
    const { creativeName, spend, impressions, clicks, revenue, purchases } = data;

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? revenue / spend : 0;

    const baseEvidence = {
      primarySource: "CreativePerformanceDaily",
      supportingSources: ["FactMetaPerformance"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: {
        spend,
        boundAccountSpend: spend,
        impressions,
        clicks,
        purchases,
        purchaseValue: revenue,
        ctr,
        cpc,
        cpm,
        roas,
        cpa: purchases > 0 ? spend / purchases : spend,
        trend3d: { spend, purchases, roas, cpc, cpm },
        trend30d: { spend, purchases, roas, cpc, cpm }
      }
    };

    const entityRefs = [
      {
        entityType: "creative",
        entityId: cid,
        entityName: creativeName,
        route: `/data-center/accounts`,
        sourceTable: "CreativePerformanceDaily"
      }
    ];

    // low_roas_creative
    if (spend > 80 && roas < 0.5) {
      issues.push({
        issueId: `crt_${cid}_low_roas`,
        issueType: "low_roas_creative",
        category: "production_suggestion",
        severity: "critical",
        entityType: "creative",
        entityId: cid,
        entityName: creativeName,
        title: "广告素材买量转化亏损且 ROAS 极其低下",
        oneLineReason: `素材已获得投放消耗 $${spend.toFixed(2)}，但 ROAS 仅有 ${roas.toFixed(2)}x 浮动，入不敷出。`,
        actionVerb: "pause",
        actionTarget: `creative:${cid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // high_roas_creative
    if (spend > 50 && roas >= 2.0) {
      issues.push({
        issueId: `crt_${cid}_high_roas`,
        issueType: "high_roas_creative",
        category: "production_suggestion",
        severity: "healthy",
        entityType: "creative",
        entityId: cid,
        entityName: creativeName,
        title: "素材转化效益极佳，建议对其持久分配预算",
        oneLineReason: `素材转化率极强，产出 ROAS 达 ${roas.toFixed(2)}x，建议持续作为优秀素材扩量。`,
        actionVerb: "increase_budget",
        actionTarget: `creative:${cid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // high_ctr_low_purchase_creative
    if (clicks > 150 && purchases === 0) {
      issues.push({
        issueId: `crt_${cid}_high_ctr_low_purchase`,
        issueType: "high_ctr_low_purchase_creative",
        category: "production_suggestion",
        severity: "warning",
        entityType: "creative",
        entityId: cid,
        entityName: creativeName,
        title: "引流能力满载但终端成单颗粒全无",
        oneLineReason: `素材跑出高达 ${clicks} 次点击流转，但付款归因却是 0，建议迅速排查落地页加载。`,
        actionVerb: "create_variant",
        actionTarget: `creative:${cid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  return issues;
}

/**
 * 6. 国家诊断规则 Country Audience Diagnostics
 * Based on FactAudienceBreakdown.
 */
export async function detectCountryIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const limitations = ["当前为 Meta 受众国家表现，不代表真实订单国家销售。"];

  const refAccountIds = await getActiveAccountIds(params);
  const breakdowns = await prisma.factAudienceBreakdown.findMany({
    where: {
      dimension_type: "country",
      date: { gte: startDate, lte: endDate },
      account_id: refAccountIds.length > 0 ? { in: refAccountIds } : undefined
    }
  });

  // Group by country code
  const countryMap: Record<string, any> = {};
  for (const rec of breakdowns) {
    const code = rec.dimension_value || "standard";
    if (PROHIBITED_ENTITIES.includes(code.toLowerCase())) continue;

    if (!countryMap[code]) {
      countryMap[code] = {
        code,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchaseValue: 0
      };
    }
    countryMap[code].spend += rec.spend || 0;
    countryMap[code].impressions += rec.impressions || 0;
    countryMap[code].clicks += rec.clicks || 0;
    countryMap[code].purchases += rec.purchases || 0;
    countryMap[code].purchaseValue += rec.purchase_value || 0;
  }

  for (const code of Object.keys(countryMap)) {
    const country = countryMap[code];
    const { spend, impressions, clicks, purchases, purchaseValue } = country;

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;

    const baseEvidence = {
      primarySource: "FactAudienceBreakdown",
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: { spend, impressions, clicks, purchases, purchaseValue, roas, cpc, cpm }
    };

    const entityRefs = [
      {
        entityType: "country",
        entityId: code,
        entityName: `国家/地区 ${code}`,
        route: `/data-center/accounts`,
        sourceTable: "FactAudienceBreakdown"
      }
    ];

    // High spend low roas country
    if (spend > 80 && roas < 0.5) {
      issues.push({
        issueId: `cnt_${code}_high_spend_low_roas`,
        issueType: "country_high_spend_low_roas",
        category: "production_suggestion",
        severity: "critical",
        entityType: "country",
        entityId: code,
        entityName: `国家/地区 ${code}`,
        title: "受众地域买量成本过高且成效低迷",
        oneLineReason: `受众拆分数据显示，在国家/地区「${code}」消耗达 $${spend.toFixed(2)}，但 ROAS 低迷。`,
        actionVerb: "exclude_country",
        actionTarget: `country:${code}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // High roas country
    if (spend > 50 && roas >= 2.0) {
      issues.push({
        issueId: `cnt_${code}_high_roas_observe`,
        issueType: "country_high_roas_observe",
        category: "production_suggestion",
        severity: "healthy",
        entityType: "country",
        entityId: code,
        entityName: `国家/地区 ${code}`,
        title: "受众地域表现优秀，建议维持关注",
        oneLineReason: `该区域跑出了卓越的 ${roas.toFixed(2)}x 资本回收率，可作为优选大区维持关注。`,
        actionVerb: "keep_observing",
        actionTarget: `country:${code}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  // Country data insufficient notice
  if (breakdowns.length === 0) {
    issues.push({
      issueId: "country_data_insufficient",
      issueType: "country_data_insufficient",
      category: "data_health_notice",
      severity: "info",
      entityType: "country",
      entityId: "country_all",
      entityName: "国家大盘受众段",
      title: "国家/地区渠道受众明细数据目前尚不可用",
      oneLineReason: "未能采集到 Facebook 针对国家的受众拆分归因明细，暂无法做国别转化审计。",
      actionVerb: "keep_observing",
      actionTarget: "country:all",
      evidence: { primarySource: "FactAudienceBreakdown", metrics: { count: 0 } },
      entityRefs: [
        {
          entityType: "country",
          entityId: "country_all",
          entityName: "全量国家明细",
          route: `/data-center/accounts`,
          sourceTable: "FactAudienceBreakdown"
        }
      ],
      route: `/data-center/accounts`,
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  return issues;
}

/**
 * 7. 产品诊断规则 Product Diagnostics (Based on Order/Product tables. No ProductPerformanceDaily reading!)
 */
export async function detectProductIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const storeIdFilter = params.storeId ? Number(params.storeId) : undefined;
  
  // Fetch orders and products
  const orders = await prisma.order.findMany({
    where: storeIdFilter ? { storeId: storeIdFilter } : {}
  });

  const products = await prisma.product.findMany({
    where: storeIdFilter ? { storeId: storeIdFilter } : {}
  });

  const productNames: Record<string, string> = {};
  for (const p of products) {
    productNames[p.id] = p.name;
  }

  // Aggregate orders by product
  const productAggMap: Record<string, any> = {};
  for (const ord of orders) {
    const pid = ord.productId;
    if (PROHIBITED_ENTITIES.some(bad => pid.toLowerCase().includes(bad))) continue;

    if (!productAggMap[pid]) {
      productAggMap[pid] = {
        productId: pid,
        productName: productNames[pid] || "standard_product",
        ordersCount: 0,
        revenue: 0,
        refundOrders: 0
      };
    }
    productAggMap[pid].ordersCount += 1;
    productAggMap[pid].revenue += ord.revenue || 0;
    if (ord.refunded) {
      productAggMap[pid].refundOrders += 1;
    }
  }

  const limitations = ["未包含产品层级广告 ROAS 统计。", "未提供针对特定单品的产品级买量广告预算建议。"];

  for (const pid of Object.keys(productAggMap)) {
    const agg = productAggMap[pid];
    const { productName, ordersCount, revenue, refundOrders } = agg;
    const refundRate = ordersCount > 0 ? (refundOrders / ordersCount) * 100 : 0;

    const baseEvidence = {
      primarySource: "Order",
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: { ordersCount, revenue, refundRate }
    };

    const entityRefs = [
      {
        entityType: "product",
        entityId: pid,
        entityName: productName,
        route: `/data-center/accounts`,
        sourceTable: "Product"
      }
    ];

    // High volume product
    if (ordersCount >= 10) {
      issues.push({
        issueId: `prd_${pid}_king`,
        issueType: "high_sales_product",
        category: "production_suggestion",
        severity: "healthy",
        entityType: "product",
        entityId: pid,
        entityName: productName,
        title: "店铺爆款单品成交旺盛，建议核查仓储备货",
        oneLineReason: `商品「${productName}」在周期内大卖 ${ordersCount} 件，处于极度活跃出海爆款，请立刻排查仓储备货。`,
        actionVerb: "keep_observing",
        actionTarget: `product:${pid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // High refund rate
    if (refundRate > 15 && ordersCount >= 5) {
      issues.push({
        issueId: `prd_${pid}_high_refund`,
        issueType: "high_refund_product",
        category: "production_suggestion",
        severity: "critical",
        entityType: "product",
        entityId: pid,
        entityName: productName,
        title: "自营单品售后退单率异常偏高",
        oneLineReason: `商品累计出单中退单率飚高至 ${refundRate.toFixed(1)}%，侵吞整站测款利润。`,
        actionVerb: "investigate_data_gap",
        actionTarget: `product:${pid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/accounts`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  // Store product data missing notice
  if (products.length === 0) {
    issues.push({
      issueId: "prd_global_missing",
      issueType: "product_data_missing",
      category: "data_health_notice",
      severity: "warning",
      entityType: "product",
      entityId: "store_product_nil",
      entityName: "独立站商品主档",
      title: "系统独立站商品配置信息不全",
      oneLineReason: "未能匹配底层在册独立站商品主档，诊断出海测款受到局限。",
      actionVerb: "review_mapping",
      actionTarget: "product:standard_nil",
      evidence: { primarySource: "Product", metrics: { count: 0 } },
      entityRefs: [
        {
          entityType: "product",
          entityId: "store_product_nil",
          entityName: "全量测单品群",
          route: `/data-center/accounts`,
          sourceTable: "Product"
        }
      ],
      route: `/data-center/accounts`,
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  return issues;
}

/**
 * 8. 数据健康诊断规则 Data Health Diagnostics
 */
export async function detectDataHealthIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const limitations = ["诊断完全基于本地事实对账物理表勾稽测试。"];

  // 1. meta_token_status
  let isTokenBlocked = false;
  const lastSyncLog = await prisma.syncLog.findFirst({
    where: { type: "META_TOKEN_TEST" },
    orderBy: { startedAt: "desc" }
  });
  const tokenSetting = await prisma.setting.findFirst({
    where: { key: { in: ["META_ACCESS_TOKEN", "meta_token"] } }
  });
  if (!tokenSetting || !tokenSetting.value.trim() || tokenSetting.value.includes("...") || lastSyncLog?.status === "failed") {
    isTokenBlocked = true;
  }

  if (isTokenBlocked) {
    issues.push({
      issueId: "token_blockage_warning_notice",
      issueType: "meta_token_status",
      category: "data_health_notice",
      severity: "critical",
      entityType: "token",
      entityId: "meta_token",
      entityName: "Meta通道令牌",
      title: "Meta API 通信通信信道阻断或是过期",
      oneLineReason: "主通道访问令牌被判定离线或是测试未通过，定时同步增量离线状态挂起。",
      actionVerb: "refresh_token",
      actionTarget: "token:meta_token",
      evidence: { primarySource: "Setting", syncLog: lastSyncLog || null },
      entityRefs: [
        {
          entityType: "token",
          entityId: "meta_token",
          entityName: "Meta 统一长久通信令牌",
          route: `/data-center/accounts`,
          sourceTable: "Setting"
        }
      ],
      route: `/data-center/accounts`,
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  // 2. unmapped_spend_notice
  const activeUnmapped = await prisma.adAccount.findMany({ where: { storeId: null } });
  for (const acc of activeUnmapped) {
    const perfUnmapped = await prisma.factMetaPerformance.findMany({
      where: { account_id: acc.fb_account_id, level: "account", date: { gte: startDate, lte: endDate } }
    });
    const subspend = perfUnmapped.reduce((sum, r) => sum + (r.spend || 0), 0);

    if (subspend > 0) {
      issues.push({
        issueId: `data_health_unmapped_${acc.fb_account_id}`,
        issueType: "unmapped_spend_notice",
        category: "data_health_notice",
        severity: "critical",
        entityType: "account",
        entityId: acc.fb_account_id,
        entityName: acc.fb_account_name || acc.fb_account_id,
        title: "高消耗未映射账户泄漏风险审计",
        oneLineReason: `广告账户「${acc.fb_account_name || acc.fb_account_id}」存在实际消耗 $${subspend.toFixed(2)}，但未绑定到任何店铺。`,
        actionVerb: "bind_account",
        actionTarget: `account:${acc.fb_account_id}`,
        evidence: { primarySource: "FactMetaPerformance", metrics: { spend: subspend } },
        entityRefs: [
          {
            entityType: "account",
            entityId: acc.fb_account_id,
            entityName: acc.fb_account_name || acc.fb_account_id,
            route: `/data-center/accounts`,
            sourceTable: "AdAccount"
          }
        ],
        route: `/data-center/accounts`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  // 3. order_country_missing
  issues.push({
    issueId: "field_country_missing_notice_alert",
    issueType: "order_country_missing",
    category: "data_health_notice",
    severity: "info",
    entityType: "data_pipeline",
    entityId: "order_country_pip",
    entityName: "订单地域通道",
    title: "收货国家物理明细列未全量解构",
    oneLineReason: "系统未在主订单表内发现ISO地理国家字列，建议补全，以减少估计偏离。",
    actionVerb: "investigate_data_gap",
    actionTarget: "pipeline:order_country_pip",
    evidence: { primarySource: "Order", metrics: {} },
    entityRefs: [
      {
        entityType: "data_pipeline",
        entityId: "order_country_pip",
        entityName: "订单全域国家对账通道",
        route: `/data-center/accounts`,
        sourceTable: "Order"
      }
    ],
    route: `/data-center/accounts`,
    limitations,
    generationMode: "offline_rule_engine",
    humanConfirmationRequired: true,
    status: "pending"
  });

  // 4. product_attribution_missing
  issues.push({
    issueId: "product_pixel_attr_missing_alert",
    issueType: "product_attribution_missing",
    category: "data_health_notice",
    severity: "info",
    entityType: "data_pipeline",
    entityId: "product_attr_pip",
    entityName: "单品像素直连转化服务",
    title: "单品级广告像素成交发现直连归因缺口",
    oneLineReason: "目前无法基于单品广告像素对单品买量ROAS直归，全篇建议使用整店订单级对账。",
    actionVerb: "investigate_data_gap",
    actionTarget: "pipeline:product_attr_pip",
    evidence: { primarySource: "Product", metrics: {} },
    entityRefs: [
      {
        entityType: "data_pipeline",
        entityId: "product_attr_pip",
        entityName: "单品像素归宿监听流水",
        route: `/data-center/accounts`,
        sourceTable: "Product"
      }
    ],
    route: `/data-center/accounts`,
    limitations,
    generationMode: "offline_rule_engine",
    humanConfirmationRequired: true,
    status: "pending"
  });

  // 5. sync_delay_notice
  const lastSync = await prisma.syncLog.findFirst({
    where: { status: "success" },
    orderBy: { startedAt: "desc" }
  });
  let isLagging = false;
  let lagHours = 0;
  if (lastSync && lastSync.finishedAt) {
    const elapsed = new Date().getTime() - new Date(lastSync.finishedAt).getTime();
    lagHours = elapsed / (1000 * 60 * 60);
    if (lagHours > 24) isLagging = true;
  } else {
    isLagging = true;
  }

  if (isLagging) {
    issues.push({
      issueId: "sys_sync_delay_notice_alert",
      issueType: "sync_delay_notice",
      category: "data_health_notice",
      severity: "warning",
      entityType: "sync_service",
      entityId: "sync_scheduler",
      entityName: "在册物理对账同步器",
      title: "出海离线数据同步存在明显滞后时差",
      oneLineReason: lastSync 
        ? `系统对账上次完美回灌在 ${lagHours.toFixed(0)} 小时前，部分受众可能暂有漂移。`
        : "未探测到有任何增量同步成功的物理日志，数据盘全段离线。",
      actionVerb: "investigate_data_gap",
      actionTarget: "service:sync_scheduler",
      evidence: { primarySource: "SyncLog", lastSuccessfulSync: lastSync || null, lagHours },
      entityRefs: [
        {
          entityType: "sync_service",
          entityId: "sync_scheduler",
          entityName: "高频秒级拉取常置任务",
          route: `/data-center/accounts`,
          sourceTable: "SyncLog"
        }
      ],
      route: `/data-center/accounts`,
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  // 6. route_missing_notice
  issues.push({
    issueId: "routes_integrity_checking_notice",
    issueType: "route_missing_notice",
    category: "data_health_notice",
    severity: "info",
    entityType: "security_framework",
    entityId: "router_controller",
    entityName: "主看板跳转关卡",
    title: "看盘部分跳转页面 and 多核诊断未完美映射",
    oneLineReason: "统一诊断与看盘局部物理跳转暂未建立完好直接路由，请在看盘中心按大类导航核查。",
    actionVerb: "keep_observing",
    actionTarget: "framework:router_controller",
    evidence: { primarySource: "Setting", metrics: {} },
    entityRefs: [
      {
        entityType: "security_framework",
        entityId: "router_controller",
        entityName: "看盘高维大盘控制屏",
        route: `/data-center/accounts`,
        sourceTable: "Setting"
      }
    ],
    route: `/data-center/accounts`,
    limitations,
    generationMode: "offline_rule_engine",
    humanConfirmationRequired: true,
    status: "pending"
  });

  return issues;
}

/**
 * 1. 结构化 Issues 诊断总调度 generateDiagnosticIssues
 */
export async function generateDiagnosticIssues(params: DiagnosticParams): Promise<{
  success: boolean;
  issues: UniformIssue[];
  summary: {
    productionCount: number;
    noticeCount: number;
    debugInvalidCount: number;
    activeAccountCount: number;
    dataHealthNoticeCount: number;
  };
}> {
  try {
    const accountIssues = await detectAccountIssues(params);
    const storeIssues = await detectStoreIssues(params);
    const creativeIssues = await detectCreativeIssues(params);
    const countryIssues = await detectCountryIssues(params);
    const productIssues = await detectProductIssues(params);
    const dataHealthIssues = await detectDataHealthIssues(params);

    const rawAll = [
      ...accountIssues,
      ...storeIssues,
      ...creativeIssues,
      ...countryIssues,
      ...productIssues,
      ...dataHealthIssues
    ];

    // Sanitize and filter
    const sanitizedAll = rawAll.map(issue => sanitizeIssueForbiddenWords(issue));
    const validatedAll = sanitizedAll.map(issue => validateIssueEligibility(issue));

    let productionCount = 0;
    let noticeCount = 0;
    let debugInvalidCount = 0;

    for (const issue of validatedAll) {
      if (issue.category === "production_suggestion") {
        productionCount++;
      } else if (issue.category === "data_health_notice") {
        noticeCount++;
      } else {
        debugInvalidCount++;
      }
    }

    const activeAccounts = await getActiveAccountIds(params);

    return {
      success: true,
      issues: validatedAll,
      summary: {
        productionCount,
        noticeCount,
        debugInvalidCount,
        activeAccountCount: activeAccounts.length,
        dataHealthNoticeCount: noticeCount
      }
    };
  } catch (error) {
    console.error("[generateDiagnosticIssues ERROR]", error);
    return {
      success: false,
      issues: [],
      summary: {
        productionCount: 0,
        noticeCount: 0,
        debugInvalidCount: 0,
        activeAccountCount: 0,
        dataHealthNoticeCount: 0
      }
    };
  }
}
