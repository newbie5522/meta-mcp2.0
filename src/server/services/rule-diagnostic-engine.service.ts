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
  entityRefs: any[];
  route: string;
  limitations: string[];
  generationMode: "offline_rule_engine";
  humanConfirmationRequired: boolean;
  status: "pending";
}

// Approved list of legal action verbs
const LEGAL_ACTION_VERBS = [
  "reduce_budget",
  "scale_budget",
  "optimize_funnel",
  "optimize_creative",
  "optimize_audience",
  "bind_account",
  "refresh_token",
  "exclude_country",
  "scale_country",
  "pause",
  "scale",
  "create_variant",
  "audit_landing_page",
  "audit_inventory",
  "investigate_refund",
  "observe",
  "sync_store",
  "setup_pixels",
  "investigate_data_gap",
  "optimize_channels",
  "audit_pixel",
  "patch_pipeline",
  "setup_flow",
  "trigger_sync",
  "cleanup_seed",
  "verify_route"
];

// List of invalid placeholder IDs
const PROHIBITED_ENTITIES = [
  "unknown",
  "free_text",
  "cr01",
  "cr02",
  "cr03"
];

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
  const hasSpend = (spend > 0) || (adSpend > 0);

  const passesAllProductionCriteria = 
    issue.entityId && 
    !isIdProhibited && 
    hasEvidence && 
    hasEntityRefs && 
    isRouteValid && 
    isActionVerbLegal && 
    hasSpend && 
    issue.humanConfirmationRequired === true;

  if (issue.category === "production_suggestion") {
    if (!passesAllProductionCriteria) {
      // If it is about tokens or pipelines, downgrade to data_health_notice, else to debug_invalid
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
    // Data Health notices still cannot have prohibited IDs
    if (!issue.entityId || isIdProhibited) {
      issue.category = "debug_invalid";
    }
  }

  return issue;
}

/**
 * Helper to fetch accounts active in the last 30 days of the selected period (or current date)
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
    const performanceRecords = await prisma.factMetaPerformance.findMany({
      where: {
        account_id: accountId,
        level: "account",
        date: { gte: startDate, lte: endDate }
      }
    });

    const spend = performanceRecords.reduce((sum, r) => sum + (r.spend || 0), 0);
    const impressions = performanceRecords.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const clicks = performanceRecords.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const purchases = performanceRecords.reduce((sum, r) => sum + (r.purchases || 0), 0);
    const purchaseValue = performanceRecords.reduce((sum, r) => sum + (r.purchase_value || 0), 0);

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;
    const cpa = purchases > 0 ? spend / purchases : 0;

    // Fetch 3-day trend stats
    const startDate3d = format(subDays(parseISO(endDate), 2), "yyyy-MM-dd");
    const records3d = await prisma.factMetaPerformance.findMany({
      where: {
        account_id: accountId,
        level: "account",
        date: { gte: startDate3d, lte: endDate }
      }
    });
    const spend3d = records3d.reduce((sum, r) => sum + (r.spend || 0), 0);
    const impressions3d = records3d.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const clicks3d = records3d.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const purchases3d = records3d.reduce((sum, r) => sum + (r.purchases || 0), 0);
    const purchaseValue3d = records3d.reduce((sum, r) => sum + (r.purchase_value || 0), 0);
    const cpc3d = clicks3d > 0 ? spend3d / clicks3d : 0;
    const cpm3d = impressions3d > 0 ? (spend3d / impressions3d) * 1000 : 0;
    const roas3d = spend3d > 0 ? purchaseValue3d / spend3d : 0;

    // Fetch 30-day stats
    const startDate30d = format(subDays(parseISO(endDate), 29), "yyyy-MM-dd");
    const records30d = await prisma.factMetaPerformance.findMany({
      where: {
        account_id: accountId,
        level: "account",
        date: { gte: startDate30d, lte: endDate }
      }
    });
    const spend30d = records30d.reduce((sum, r) => sum + (r.spend || 0), 0);
    const impressions30d = records30d.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const clicks30d = records30d.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const purchases30d = records30d.reduce((sum, r) => sum + (r.purchases || 0), 0);
    const purchaseValue30d = records30d.reduce((sum, r) => sum + (r.purchase_value || 0), 0);
    const cpc30d = clicks30d > 0 ? spend30d / clicks30d : 0;
    const cpm30d = impressions30d > 0 ? (spend30d / impressions30d) * 1000 : 0;
    const roas30d = spend30d > 0 ? purchaseValue30d / spend30d : 0;

    const baseEvidence = {
      primarySource: "FactMetaPerformance",
      supportingSources: ["AdAccount", "AccountMapping"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: {
        spend, impressions, clicks, purchases, purchaseValue,
        ctr, cpc, cpm, roas, cpa,
        trend3d: { spend: spend3d, purchases: purchases3d, roas: roas3d, cpc: cpc3d, cpm: cpm3d },
        trend30d: { spend: spend30d, purchases: purchases30d, roas: roas30d, cpc: cpc30d, cpm: cpm30d }
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

    // Check account mapping
    const mapping = await prisma.accountMapping.findUnique({ where: { fbAccountId: accountId } });

    // Rules logic:
    // 1. Unmapped Account but has spend
    if (!mapping || !mapping.storeId) {
      if (spend > 0) {
        issues.push({
          issueId: `acc_${accountId}_unmapped`,
          issueType: "unmapped_spend_risk",
          category: "production_suggestion", // Will pass gate if criteria matched
          severity: "critical",
          entityType: "account",
          entityId: accountId,
          entityName: accountName,
          title: "活跃广告账户未绑定独立站店铺",
          oneLineReason: `该广告账户在周期内产生真实消耗 $${spend.toFixed(2)}，但系统内未能识别到该账户的店铺指派与绑定，整店 ROI 存在归因风险。`,
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
    }

    // No spend accounts do not generate production suggestions (will downgrade to notice or debug)
    const isZeroSpend = spend <= 0;

    // 2. High Spend Low ROAS
    if (spend > 100 && roas < 1.3) {
      issues.push({
        issueId: `acc_${accountId}_high_spend_low_roas`,
        issueType: "high_spend_low_roas",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
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

    // 3. High Spend No Purchase
    if (spend > 150 && purchases === 0) {
      issues.push({
        issueId: `acc_${accountId}_high_spend_no_purchase`,
        issueType: "high_spend_no_purchase",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "critical",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "账户花费溢出但购买转换颗粒无收",
        oneLineReason: `本期广告账户总支出 $${spend.toFixed(2)} 并带来 ${clicks} 次点击，但未在独立站侧捕获到任何实际成单。`,
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

    // 4. High Clicks Low Purchase
    if (clicks > 100 && purchases <= 1) {
      issues.push({
        issueId: `acc_${accountId}_high_clicks_low_purchase`,
        issueType: "high_clicks_low_purchase",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "warning",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "广告引导流量充足但下单转化受阻",
        oneLineReason: `账户已分流 ${clicks} 次跳转，但在独立站后端仅产出 ${purchases} 笔真实付款，流失严重，可能由于结账路径或商品定价所致。`,
        actionVerb: "optimize_funnel",
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

    // 5. CPC Spike
    if (spend > 50 && cpc3d > cpc30d * 1.3 && cpc3d > 0.5) {
      issues.push({
        issueId: `acc_${accountId}_cpc_spike`,
        issueType: "cpc_spike",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "warning",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "近期单次点击成本 CPC 发生异常飙升",
        oneLineReason: `近 3 天平摊单次点击 CPC 为 $${cpc3d.toFixed(2)}，较 30 天均值 ($${cpc30d.toFixed(2)}) 剧增了 ${((cpc3d/cpc30d - 1)*100).toFixed(0)}%，买量效率骤然恶化。`,
        actionVerb: "optimize_creative",
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

    // 6. CPM Spike
    if (spend > 50 && cpm3d > cpm30d * 1.3 && cpm3d > 5.0) {
      issues.push({
        issueId: `acc_${accountId}_cpm_spike`,
        issueType: "cpm_spike",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "warning",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "近期千次展示成本 CPM 发生急剧飙升",
        oneLineReason: `近 3 天平均千次展现保费 $${cpm3d.toFixed(2)} 较 30 天历史大盘均值 ($${cpm30d.toFixed(2)}) 上浮超 30%，表明受众精聚焦过窄或竞争剧化。`,
        actionVerb: "optimize_audience",
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

    // 7. ROAS Decline
    if (spend > 50 && roas30d > 1.2 && roas3d < roas30d * 0.75) {
      issues.push({
        issueId: `acc_${accountId}_roas_decline`,
        issueType: "roas_decline",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "warning",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "买量段位 ROAS 底盘近期发生俯冲式下滑",
        oneLineReason: `近 3 天 ROAS 实录为 ${roas3d.toFixed(2)}x，相比 30 天均值健康水位 (${roas30d.toFixed(2)}x) 滑坡高达 ${((1 - roas3d/roas30d)*100).toFixed(0)}%，利润回收受挫。`,
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

    // 8. High ROAS Observable
    if (spend > 50 && roas > 2.5) {
      issues.push({
        issueId: `acc_${accountId}_high_roas_observable`,
        issueType: "high_roas_observable",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "healthy",
        entityType: "account",
        entityId: accountId,
        entityName: accountName,
        title: "账户成效显著，观察到具备扩量溢价能力",
        oneLineReason: `在周期内持续录得 ROAS ${roas.toFixed(2)}x 且流量表现优秀，具备极佳的盈利溢价。`,
        actionVerb: "scale_budget",
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
    const storeName = store.name || `Store #${storeId}`;

    // Get order data
    const orders = await prisma.order.findMany({ where: { storeId } });

    // Helper helper to filter by dates
    const filterByDateRange = (list: any[], start: string, end: string) => {
      return list.filter(o => {
        let orderDate = o.store_local_date;
        if (!orderDate && o.createdAt) {
          orderDate = new Date(o.createdAt).toISOString().split('T')[0];
        }
        return orderDate && orderDate >= start && orderDate <= end;
      });
    };

    const ordersInRange = filterByDateRange(orders, startDate, endDate);

    // Compute standard orders counts
    const calculateStoreStats = (filtered: any[]) => {
      const valid = filtered.filter(o => {
        const payStatus = (o.paymentStatus || "").toLowerCase();
        const fulStatus = (o.fulfillmentStatus || "").toLowerCase();
        return !["waiting", "unpaid", "pending", "failed", "cancelled", "canceled"].includes(payStatus) &&
               !["cancelled", "canceled"].includes(fulStatus) &&
               o.refunded !== true;
      });

      const storeRevenue = valid.reduce((sum, o) => {
        const val = (o.orderTotal !== null && o.orderTotal !== undefined && o.orderTotal > 0) ? o.orderTotal : (o.revenue || 0);
        return sum + val;
      }, 0);

      const orderCount = valid.length;
      const totalCount = filtered.length;
      const refundedCount = filtered.filter(o => o.refunded).length;
      const refundRate = totalCount > 0 ? (refundedCount / totalCount) * 100 : 0;
      const AOV = orderCount > 0 ? storeRevenue / orderCount : 0;

      return { storeRevenue, orderCount, totalCount, refundedCount, refundRate, AOV };
    };

    const mainStats = calculateStoreStats(ordersInRange);

    // Mapped advertiser statistics
    const mappedAccounts = await prisma.accountMapping.findMany({ where: { storeId } });
    const fbAccountIds = mappedAccounts.map(m => m.fbAccountId);

    let boundAccountSpend = 0;
    let metaPurchases = 0;
    let metaPurchaseValue = 0;

    if (fbAccountIds.length > 0) {
      const performances = await prisma.factMetaPerformance.findMany({
        where: {
          account_id: { in: fbAccountIds },
          level: "account",
          date: { gte: startDate, lte: endDate }
        }
      });
      boundAccountSpend = performances.reduce((sum, r) => sum + (r.spend || 0), 0);
      metaPurchases = performances.reduce((sum, r) => sum + (r.purchases || 0), 0);
      metaPurchaseValue = performances.reduce((sum, r) => sum + (r.purchase_value || 0), 0);
    }

    const storeRoas = boundAccountSpend > 0 ? mainStats.storeRevenue / boundAccountSpend : 0;
    const metaRoas = boundAccountSpend > 0 ? metaPurchaseValue / boundAccountSpend : 0;

    // Check system-wide unmapped accounts
    const allMapped = await prisma.accountMapping.findMany();
    const mappedAccountIds = allMapped.map(m => m.fbAccountId);
    const unmappedPerformances = await prisma.factMetaPerformance.findMany({
      where: {
        account_id: { notIn: mappedAccountIds },
        level: "account",
        date: { gte: startDate, lte: endDate }
      }
    });
    const unmappedSpendRisk = unmappedPerformances.reduce((sum, r) => sum + (r.spend || 0), 0);

    // Trend analysis: 3d vs 30d
    const startDate3d = format(subDays(parseISO(endDate), 2), "yyyy-MM-dd");
    const startDate30d = format(subDays(parseISO(endDate), 29), "yyyy-MM-dd");

    const orders3d = filterByDateRange(orders, startDate3d, endDate);
    const orders30d = filterByDateRange(orders, startDate30d, endDate);

    const stats3d = calculateStoreStats(orders3d);
    const stats30d = calculateStoreStats(orders30d);

    let spend3d = 0;
    let spend30d = 0;

    if (fbAccountIds.length > 0) {
      const perf3d = await prisma.factMetaPerformance.findMany({
        where: { account_id: { in: fbAccountIds }, level: "account", date: { gte: startDate3d, lte: endDate } }
      });
      const perf30d = await prisma.factMetaPerformance.findMany({
        where: { account_id: { in: fbAccountIds }, level: "account", date: { gte: startDate30d, lte: endDate } }
      });
      spend3d = perf3d.reduce((sum, r) => sum + (r.spend || 0), 0);
      spend30d = perf30d.reduce((sum, r) => sum + (r.spend || 0), 0);
    }

    const storeRoas3d = spend3d > 0 ? stats3d.storeRevenue / spend3d : 0;
    const storeRoas30d = spend30d > 0 ? stats30d.storeRevenue / spend30d : 0;

    const baseEvidence = {
      primarySource: "Store",
      supportingSources: ["Order", "AccountMapping", "FactMetaPerformance"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: {
        storeRevenue: mainStats.storeRevenue,
        orderCount: mainStats.orderCount,
        AOV: mainStats.AOV,
        refundRate: mainStats.refundRate,
        boundAccountSpend,
        storeRoas,
        metaPurchases,
        metaPurchaseValue,
        metaRoas,
        unmappedSpendRisk,
        trend3d: { spend: spend3d, orderCount: stats3d.orderCount, storeRoas: storeRoas3d, revenue: stats3d.storeRevenue },
        trend30d: { spend: spend30d, orderCount: stats30d.orderCount, storeRoas: storeRoas30d, revenue: stats30d.storeRevenue }
      }
    };

    const entityRefs = [
      {
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        route: `/ai/store?storeId=${storeId}`,
        sourceTable: "Store"
      }
    ];

    const isZeroSpend = boundAccountSpend <= 0;

    // 1. Store ROAS Decline
    if (boundAccountSpend > 100 && storeRoas30d > 1.2 && storeRoas3d < storeRoas30d * 0.75) {
      issues.push({
        issueId: `store_${storeId}_roas_decline`,
        issueType: "store_roas_decline",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "critical",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "整站实际支付 ROAS 线近期滑坡下滑",
        oneLineReason: `店铺滚动 3 天支付 ROAS (${storeRoas3d.toFixed(2)}x) 较过去 30 天大盘均线 (${storeRoas30d.toFixed(2)}x) 倒退滑落超 25%。`,
        actionVerb: "optimize_channels",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/ai/store?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 2. Spend UP but Orders Flat/Down
    const avgSpend3d = spend3d / 3;
    const avgSpend30d = spend30d / 30;
    const avgOrders3d = stats3d.orderCount / 3;
    const avgOrders30d = stats30d.orderCount / 30;

    if (spend3d > 100 && avgSpend3d > avgSpend30d * 1.25 && avgOrders3d <= avgOrders30d * 1.0) {
      issues.push({
        issueId: `store_${storeId}_spend_up_order_flat`,
        issueType: "spend_up_order_flat",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "warning",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "买量支出显著追涨但实际出单陷入停滞",
        oneLineReason: `近期日均预算大增 ${((avgSpend3d/avgSpend30d - 1)*100).toFixed(0)}%，但日成交笔数却呈现逆势阻平，存在买量流量堆叠空转。`,
        actionVerb: "audit_pixel",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/ai/store?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 3. Pixel vs Backend Orders discrepancy
    if (mainStats.orderCount > 10 && Math.abs(metaPurchases - mainStats.orderCount) / mainStats.orderCount > 0.4) {
      issues.push({
        issueId: `store_${storeId}_discrepancy`,
        issueType: "meta_vs_store_discrepancy",
        category: isZeroSpend ? "debug_invalid" : "production_suggestion",
        severity: "warning",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "Meta 像素回传成效与店铺实际订单差额悬殊",
        oneLineReason: `Meta 数据回传上报 ${metaPurchases} 笔转化，但独立站后台拦截验证仅存 ${mainStats.orderCount} 笔有效销售订单，缺口比例宽阔。`,
        actionVerb: "investigate_data_gap",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/ai/store?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 4. Refund rate anomaly
    if (mainStats.totalCount >= 10 && mainStats.refundRate > 10) {
      issues.push({
        issueId: `store_${storeId}_refund_anomaly`,
        issueType: "refund_rate_anomaly",
        category: "production_suggestion",
        severity: "warning",
        entityType: "store",
        entityId: String(storeId),
        entityName: storeName,
        title: "独立站收单退货率上浮触及预警水位",
        oneLineReason: `近 30 天综合对账计算出退货退款比例已攀爬至 ${mainStats.refundRate.toFixed(1)}%，严重压榨测款期前端买量利润。`,
        actionVerb: "investigate_refund",
        actionTarget: `store:${storeId}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/ai/store?storeId=${storeId}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 5. 特定关联账户拖后腿
    if (fbAccountIds.length > 1) {
      for (const fbid of fbAccountIds) {
        const matchingAcc = await prisma.adAccount.findUnique({ where: { fb_account_id: fbid } });
        const perf = await prisma.factMetaPerformance.findMany({
          where: { account_id: fbid, level: "account", date: { gte: startDate, lte: endDate } }
        });
        const accSpend = perf.reduce((sum, r) => sum + (r.spend || 0), 0);
        const accVal = perf.reduce((sum, r) => sum + (r.purchase_value || 0), 0);
        const accRoas = accSpend > 0 ? accVal / accSpend : 0;

        if (accSpend > 100 && accRoas < 1.0 && metaRoas > 1.4) {
          issues.push({
            issueId: `store_${storeId}_bad_acc_${fbid}`,
            issueType: "bad_account_drags_store",
            category: "production_suggestion",
            severity: "critical",
            entityType: "account",
            entityId: fbid,
            entityName: matchingAcc?.fb_account_name || fbid,
            title: "局域多户投流：特定低效账户严重拖包全局",
            oneLineReason: `账户「${matchingAcc?.fb_account_name || fbid}」在本期逆差跑出 $${accSpend.toFixed(2)} 的高耗，但局部 ROAS 仅为 ${accRoas.toFixed(2)}x，远大拉低了整店 ROI 均值。`,
            actionVerb: "reduce_budget",
            actionTarget: `account:${fbid}`,
            evidence: {
              primarySource: "FactMetaPerformance",
              supportingSources: ["Store", "AdAccount"],
              dateRange: `${startDate} 至 ${endDate}`,
              metrics: { spend: accSpend, roas: accRoas, parentStoreId: storeId }
            },
            entityRefs: [
              {
                entityType: "account",
                entityId: fbid,
                entityName: matchingAcc?.fb_account_name || fbid,
                route: `/data-center/accounts?accountId=${fbid}`,
                sourceTable: "AdAccount"
              }
            ],
            route: `/data-center/accounts?accountId=${fbid}`,
            limitations: [],
            generationMode: "offline_rule_engine",
            humanConfirmationRequired: true,
            status: "pending"
          });
        }
      }
    }
  }

  return issues;
}

/**
 * 5. 素材诊断规则 Creative Diagnostics
 */
export async function detectCreativeIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const rawPerformances = await prisma.creativePerformanceDaily.findMany({
    where: { date: { gte: startDate, lte: endDate } }
  });

  const grouped: Record<string, any> = {};
  for (const item of rawPerformances) {
    const cid = item.creativeId;
    if (!grouped[cid]) {
      grouped[cid] = {
        creativeId: cid,
        creativeName: item.creativeName || cid,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        revenue: 0,
        type: item.type || "IMAGE"
      };
    }
    grouped[cid].spend += item.spend || 0;
    grouped[cid].impressions += item.impressions || 0;
    grouped[cid].clicks += item.clicks || 0;
    grouped[cid].purchases += item.purchases || 0;
    grouped[cid].revenue += item.revenue || 0;
  }

  for (const cid of Object.keys(grouped)) {
    const snap = grouped[cid];
    const isProhibited = PROHIBITED_ENTITIES.some(bad => cid.toLowerCase().includes(bad));

    const spend = snap.spend;
    const impressions = snap.impressions;
    const clicks = snap.clicks;
    const purchases = snap.purchases;
    const revenue = snap.revenue;
    const roas = spend > 0 ? revenue / spend : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;

    const baseEvidence = {
      primarySource: "CreativePerformanceDaily",
      supportingSources: ["AdCreative"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: { spend, impressions, clicks, purchases, revenue, roas, ctr, cpc }
    };

    const entityRefs = [
      {
        entityType: "creative",
        entityId: cid,
        entityName: snap.creativeName,
        route: `/data-center/creatives?creativeId=${cid}`,
        sourceTable: "AdCreative"
      }
    ];

    const category = (isProhibited || spend <= 0) ? "debug_invalid" : "production_suggestion";

    // 1. Pause Inefficient Creative
    if (spend > 100 && roas < 1.1) {
      issues.push({
        issueId: `crt_${cid}_pause`,
        issueType: "pause_inefficient_creative",
        category,
        severity: "critical",
        entityType: "creative",
        entityId: cid,
        entityName: snap.creativeName,
        title: "关停高消耗低效广告展示素材",
        oneLineReason: `该视觉创意表现平庸且消耗支出 $${spend.toFixed(2)}，唯独换得 ${roas.toFixed(2)}x 的亏损级超低转化回报。`,
        actionVerb: "pause",
        actionTarget: `creative:${cid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/creatives?creativeId=${cid}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 2. Keep High ROAS Creative
    if (spend > 50 && roas > 2.5) {
      issues.push({
        issueId: `crt_${cid}_scale`,
        issueType: "keep_high_roas_creative",
        category,
        severity: "healthy",
        entityType: "creative",
        entityId: cid,
        entityName: snap.creativeName,
        title: "素材转化效益极佳，建议对其持久分配预算",
        oneLineReason: `素材转化率强劲，产出 ROAS达 ${roas.toFixed(2)}x，建议在不扰乱学习期的大前提下进行稳健放量。`,
        actionVerb: "scale",
        actionTarget: `creative:${cid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/creatives?creativeId=${cid}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 3. Create Variant for High CTR
    if (spend > 35 && ctr > 3.0 && roas >= 1.2) {
      issues.push({
        issueId: `crt_${cid}_variant`,
        issueType: "copy_high_ctr_creative",
        category,
        severity: "healthy",
        entityType: "creative",
        entityId: cid,
        entityName: snap.creativeName,
        title: "素材吸睛拉满，考虑其制作全新文案变体",
        oneLineReason: `此创意跑出超群的点击率 ${ctr.toFixed(2)}%（大幅高过大盘基准），表明前段极具张力，可在副文本微创全新文案变体。`,
        actionVerb: "create_variant",
        actionTarget: `creative:${cid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/creatives?creativeId=${cid}`,
        limitations: [],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 4. High Click Low Purchase (Landing Page loader / catalog mismatch)
    if (clicks > 150 && purchases === 0) {
      issues.push({
        issueId: `crt_${cid}_landing_page`,
        issueType: "high_click_low_purchase_creative",
        category,
        severity: "warning",
        entityType: "creative",
        entityId: cid,
        entityName: snap.creativeName,
        title: "引流能力满载但终端成单颗粒全无",
        oneLineReason: `素材跑出高达 ${clicks} 次点击流转，但付款归因却交白卷，建议迅速审查落地页展现、独立站加载用时或支付工具。`,
        actionVerb: "audit_landing_page",
        actionTarget: `creative:${cid}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/data-center/creatives?creativeId=${cid}`,
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
 * 6. 国家诊断规则 Country Diagnostics
 */
export async function detectCountryIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const rawRecords = await prisma.factAudienceBreakdown.findMany({
    where: {
      dimension_type: "country",
      date: { gte: startDate, lte: endDate }
    }
  });

  const grouped: Record<string, any> = {};
  for (const item of rawRecords) {
    const code = item.dimension_value || "unknown";
    if (!grouped[code]) {
      grouped[code] = {
        countryCode: code,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchaseValue: 0
      };
    }
    grouped[code].spend += item.spend || 0;
    grouped[code].impressions += item.impressions || 0;
    grouped[code].clicks += item.clicks || 0;
    grouped[code].purchases += item.purchases || 0;
    grouped[code].purchaseValue += item.purchase_value || 0;
  }

  const limitations = ["当前为 Meta 受众国家表现，不代表真实订单国家销售。"];

  for (const code of Object.keys(grouped)) {
    if (code === "unknown") continue;

    const snap = grouped[code];
    const spend = snap.spend;
    const impressions = snap.impressions;
    const clicks = snap.clicks;
    const purchases = snap.purchases;
    const purchaseValue = snap.purchaseValue;
    const roas = spend > 0 ? purchaseValue / spend : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;

    const baseEvidence = {
      primarySource: "FactAudienceBreakdown",
      supportingSources: [],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: { spend, impressions, clicks, purchases, purchaseValue, roas, ctr }
    };

    const entityRefs = [
      {
        entityType: "country",
        entityId: code,
        entityName: `国别地区 ${code}`,
        route: `/ai/country?countryCode=${code}`,
        sourceTable: "FactAudienceBreakdown"
      }
    ];

    const isZeroSpend = spend <= 0;
    const category = isZeroSpend ? "debug_invalid" : "production_suggestion";

    // 1. High spend low ROAS country
    if (spend > 100 && roas < 1.0) {
      issues.push({
        issueId: `country_${code}_high_spend_low_roas`,
        issueType: "high_spend_low_roas_country",
        category,
        severity: "warning",
        entityType: "country",
        entityId: code,
        entityName: `国别地区 ${code}`,
        title: "高消耗地域市场 ROAS 发生折旧损耗",
        oneLineReason: `该国度本期分配了 $${spend.toFixed(2)} 预算，但实际大盘 ROAS 仅有 ${roas.toFixed(2)}x 弱于预期，需在地域过滤器中有序隔离。`,
        actionVerb: "exclude_country",
        actionTarget: `country:${code}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/ai/country?countryCode=${code}`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 2. High click low purchase country
    if (clicks > 80 && purchases === 0) {
      issues.push({
        issueId: `country_${code}_high_clicks_no_purchase`,
        issueType: "high_click_low_purchase_country",
        category,
        severity: "warning",
        entityType: "country",
        entityId: code,
        entityName: `国别地区 ${code}`,
        title: "买量点击旺盛但最终结账流量大量损漏",
        oneLineReason: `点击吞吐 ${clicks} 次而零最终订单落袋，暗示流量可能来自低客单无意向误触。`,
        actionVerb: "exclude_country",
        actionTarget: `country:${code}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/ai/country?countryCode=${code}`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 3. High ROAS country scale
    if (spend > 40 && roas > 2.5) {
      issues.push({
        issueId: `country_${code}_high_roas_scale`,
        issueType: "high_roas_country",
        category,
        severity: "healthy",
        entityType: "country",
        entityId: code,
        entityName: `国别地区 ${code}`,
        title: "受众地域表现极佳，建议精细扩增获客",
        oneLineReason: `该区域跑出了卓越的 ${roas.toFixed(2)}x 资本回收率，可在此地域展开专项受众攻防增投。`,
        actionVerb: "scale_country",
        actionTarget: `country:${code}`,
        evidence: baseEvidence,
        entityRefs,
        route: `/ai/country?countryCode=${code}`,
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  // 4. Insufficient data warning
  if (rawRecords.length === 0) {
    issues.push({
      issueId: "country_global_insufficient",
      issueType: "insufficient_country_data",
      category: "data_health_notice",
      severity: "info",
      entityType: "country",
      entityId: "country_breakdown_nil",
      entityName: "出海受众国家底盘",
      title: "国家受众维度的展现数据尚不充分",
      oneLineReason: "系统受众画像拆分明细表为空，暂不支持离线针对地域买量转化漏斗精准研判。",
      actionVerb: "observe",
      actionTarget: "country:all",
      evidence: { primarySource: "FactAudienceBreakdown", metrics: { count: 0 } },
      entityRefs: [
        {
          entityType: "country",
          entityId: "country_breakdown_nil",
          entityName: "全量待测地域",
          route: "/data-center/accounts",
          sourceTable: "FactAudienceBreakdown"
        }
      ],
      route: "/data-center/accounts",
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  return issues;
}

/**
 * 7. 产品诊断规则 Product Diagnostics
 * Based entirely on Order/Product tables. No ProductPerformanceDaily reading!
 */
export async function detectProductIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const storeIdFilter = params.storeId ? Number(params.storeId) : undefined;
  const rawOrders = await prisma.order.findMany({
    where: storeIdFilter ? { storeId: storeIdFilter } : {}
  });

  const filteredOrders = rawOrders.filter(o => {
    let orderDate = o.store_local_date;
    if (!orderDate && o.createdAt) {
      orderDate = new Date(o.createdAt).toISOString().split('T')[0];
    }
    return orderDate && orderDate >= startDate && orderDate <= endDate;
  });

  const productIds = Array.from(new Set(filteredOrders.map(o => o.productId).filter(Boolean)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } }
  });

  const limitations = [
    "当前不支持产品级广告花费归因，因此不得输出产品级广告 ROAS 结论。",
    "当前不支持产品级广告花费归因，因此不得输出产品级广告预算建议。"
  ];

  for (const pid of productIds) {
    const product = products.find(p => p.id === pid);
    const name = product?.name || `Product Name #${pid}`;
    const sku = product?.sku || "N/A";

    const productOrders = filteredOrders.filter(o => o.productId === pid);
    
    // valid orders only for revenue
    const valid = productOrders.filter(o => {
      const payStatus = (o.paymentStatus || "").toLowerCase();
      const fulStatus = (o.fulfillmentStatus || "").toLowerCase();
      return !["waiting", "unpaid", "pending", "failed", "cancelled", "canceled"].includes(payStatus) &&
             !["cancelled", "canceled"].includes(fulStatus) &&
             o.refunded !== true;
    });

    const revenue = valid.reduce((sum, o) => {
      const val = (o.orderTotal !== null && o.orderTotal !== undefined && o.orderTotal > 0) ? o.orderTotal : (o.revenue || 0);
      return sum + val;
    }, 0);

    const orderCount = valid.length;
    const totalCount = productOrders.length;
    const refundedCount = productOrders.filter(o => o.refunded).length;
    const refundRate = totalCount > 0 ? (refundedCount / totalCount) * 100 : 0;
    const AOV = orderCount > 0 ? revenue / orderCount : 0;

    const baseEvidence = {
      primarySource: "Order",
      supportingSources: ["Product"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: { orderCount, revenue, refundRate, AOV, sku }
    };

    const entityRefs = [
      {
        entityType: "product",
        entityId: pid,
        entityName: name,
        route: "/data-center/accounts",
        sourceTable: "Product"
      }
    ];

    // 1. High volume product
    if (orderCount >= 10) {
      issues.push({
        issueId: `prd_${pid}_king`,
        issueType: "high_sales_product",
        category: "production_suggestion",
        severity: "healthy",
        entityType: "product",
        entityId: pid,
        entityName: name,
        title: "店铺爆款单品成交旺盛，建议核查仓储备货",
        oneLineReason: `商品「${name}」在周期内大卖 ${orderCount} 件，为极度活跃出海爆款，请立刻锁仓、排查供应链承裁。`,
        actionVerb: "audit_inventory",
        actionTarget: `product:${pid}`,
        evidence: baseEvidence,
        entityRefs,
        route: "/data-center/accounts",
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 2. High refund rate
    if (refundRate > 15 && totalCount >= 5) {
      issues.push({
        issueId: `prd_${pid}_refund_high`,
        issueType: "high_refund_product",
        category: "production_suggestion",
        severity: "critical",
        entityType: "product",
        entityId: pid,
        entityName: name,
        title: "商品售后退单率异常偏高，面临质检和交付排查",
        oneLineReason: `商品累计成交中退单率飚高至 ${refundRate.toFixed(1)}%，侵吞了大部分前端推流净资产，亟待物理返修排除瑕疵。`,
        actionVerb: "investigate_refund",
        actionTarget: `product:${pid}`,
        evidence: baseEvidence,
        entityRefs,
        route: "/data-center/accounts",
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

    // 3. High AOV product
    if (AOV > 80 && orderCount >= 3) {
      issues.push({
        issueId: `prd_${pid}_high_aov`,
        issueType: "high_aov_product",
        category: "production_suggestion",
        severity: "healthy",
        entityType: "product",
        entityId: pid,
        entityName: name,
        title: "高单客客单价商品，适宜组合开展交叉销售",
        oneLineReason: `该单品平均 AOV 触及极具诱惑的 $${AOV.toFixed(2)}，可用作整店提高拉平客单值的专属套组测款。`,
        actionVerb: "observe",
        actionTarget: `product:${pid}`,
        evidence: baseEvidence,
        entityRefs,
        route: "/data-center/accounts",
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  // 4. Products list empty
  if (products.length === 0) {
    issues.push({
      issueId: "prd_global_missing",
      issueType: "product_data_missing",
      category: "data_health_notice",
      severity: "warning",
      entityType: "product",
      entityId: "store_product_nil",
      entityName: "独立站商品主档",
      title: "系统独立站商品大表主档配置信息不全",
      oneLineReason: "未能匹配底层在册独立站商品主档，出海测款模型与多级对账将受到系统局限。",
      actionVerb: "sync_store",
      actionTarget: "product:unknown",
      evidence: { primarySource: "Product", metrics: { count: 0 } },
      entityRefs: [
        {
          entityType: "product",
          entityId: "store_product_nil",
          entityName: "全量待测单品群",
          route: "/data-center/accounts",
          sourceTable: "Product"
        }
      ],
      route: "/data-center/accounts",
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  // 5. Product attributions warning
  issues.push({
    issueId: "prd_global_not_integrated",
    issueType: "product_pixel_not_integrated",
    category: "data_health_notice",
    severity: "info",
    entityType: "product",
    entityId: "store_pixel_remind",
    entityName: "独立站像素归因流",
    title: "独立站商品像素归因与 Feed 录入提示",
    oneLineReason: "目前暂没有像素层颗粒单品级广告投放支出归属。建议接入标准 Meta Catalog feed 流做跨端映射。",
    actionVerb: "setup_pixels",
    actionTarget: "product:setup",
    evidence: { primarySource: "Order", metrics: { count: products.length } },
    entityRefs: [
      {
        entityType: "product",
        entityId: "store_pixel_remind",
        entityName: "单品底层归流",
        route: "/data-center/accounts",
        sourceTable: "Store"
      }
    ],
    route: "/data-center/accounts",
    limitations,
    generationMode: "offline_rule_engine",
    humanConfirmationRequired: true,
    status: "pending"
  });

  return issues;
}

/**
 * 8. 数据健康诊断规则 Data Health Diagnostics
 */
export async function detectDataHealthIssues(params: DiagnosticParams): Promise<UniformIssue[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const limitations = ["诊断完全基于本地事实物理表勾稽，不包含未抓取到系统的外部流。"];

  // 1. Meta Token blocked check
  let isApiBlocked = false;
  const lastTestLog = await prisma.syncLog.findFirst({
    where: { type: "META_TOKEN_TEST" },
    orderBy: { startedAt: "desc" }
  });
  const tokenSetting = await prisma.setting.findFirst({
    where: { key: { in: ["META_ACCESS_TOKEN", "meta_token"] } }
  });

  if (!tokenSetting || !tokenSetting.value.trim() || tokenSetting.value.includes("...") || (lastTestLog?.status === "failed")) {
    isApiBlocked = true;
  }

  if (isApiBlocked) {
    issues.push({
      issueId: "token_blockage_warning",
      issueType: "token_health_block",
      category: "data_health_notice",
      severity: "critical",
      entityType: "token",
      entityId: "meta_token",
      entityName: "Meta 令牌信道",
      title: "Meta API 密钥通信信道处于阻断阻滞状态",
      oneLineReason: "验证接口上报 400 Access Token Expired 令牌阻断，全天增量自动同步计划已被系统限制搁置。",
      actionVerb: "refresh_token",
      actionTarget: "token:meta_token",
      evidence: { primarySource: "Setting", syncLog: lastTestLog || null },
      entityRefs: [
        {
          entityType: "token",
          entityId: "meta_token",
          entityName: "Meta API 信托长信标",
          route: "/data-center/accounts",
          sourceTable: "Setting"
        }
      ],
      route: "/data-center/accounts",
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  // 2. Unmapped bound spend check
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
        oneLineReason: `广告账户「${acc.fb_account_name || acc.fb_account_id}」持续进行消耗 $${subspend.toFixed(2)}，但未绑定或指派到具体独立站。`,
        actionVerb: "bind_account",
        actionTarget: `account:${acc.fb_account_id}`,
        evidence: { primarySource: "FactMetaPerformance", metrics: { spend: subspend } },
        entityRefs: [
          {
            entityType: "account",
            entityId: acc.fb_account_id,
            entityName: acc.fb_account_name || acc.fb_account_id,
            route: "/data-center/accounts",
            sourceTable: "AdAccount"
          }
        ],
        route: "/data-center/accounts",
        limitations,
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  // 3. Country field missing check
  issues.push({
    issueId: "field_country_missing_notice",
    issueType: "order_country_missing",
    category: "data_health_notice",
    severity: "info",
    entityType: "data_pipeline",
    entityId: "order_country_pipeline",
    entityName: "订单地域归类通道",
    title: "独立站收货国家物理数据列存在局部解构缺陷",
    oneLineReason: "销售订单表中缺少直接的ISO国家拆分地理二位码字段，系统依靠 Meta Audience 回传估算受众热度分布。",
    actionVerb: "patch_pipeline",
    actionTarget: "pipeline:order_country_pipeline",
    evidence: { primarySource: "Order", metrics: {} },
    entityRefs: [
      {
        entityType: "data_pipeline",
        entityId: "order_country_pipeline",
        entityName: "订单大区拆分流水轴",
        route: "/data-center/accounts",
        sourceTable: "Order"
      }
    ],
    route: "/data-center/accounts",
    limitations,
    generationMode: "offline_rule_engine",
    humanConfirmationRequired: true,
    status: "pending"
  });

  // 4. Product attribution missing check
  issues.push({
    issueId: "product_pixel_attribution_missing_notice",
    issueType: "product_attribution_missing",
    category: "data_health_notice",
    severity: "info",
    entityType: "data_pipeline",
    entityId: "product_attribution_pipeline",
    entityName: "爆款广告直归因服务",
    title: "商品层级底层广告监测直连发生归因缺口",
    oneLineReason: "系统缺少直观匹配单品像素成交归依，仅支持整店商业及多账户级漏斗大账研判。",
    actionVerb: "setup_flow",
    actionTarget: "pipeline:product_attribution_pipeline",
    evidence: { primarySource: "Product", metrics: {} },
    entityRefs: [
      {
        entityType: "data_pipeline",
        entityId: "product_attribution_pipeline",
        entityName: "单品像素全网归宿流",
        route: "/data-center/accounts",
        sourceTable: "Product"
      }
    ],
    route: "/data-center/accounts",
    limitations,
    generationMode: "offline_rule_engine",
    humanConfirmationRequired: true,
    status: "pending"
  });

  // 5. Data synchronization lag check
  const lastSync = await prisma.syncLog.findFirst({
    where: { status: "success" },
    orderBy: { startedAt: "desc" }
  });
  let isLagging = false;
  let lagHours = 0;
  if (lastSync && lastSync.finishedAt) {
    const elapsedMs = new Date().getTime() - new Date(lastSync.finishedAt).getTime();
    lagHours = elapsedMs / (1000 * 60 * 60);
    if (lagHours > 24) {
      isLagging = true;
    }
  } else if (!lastSync) {
    isLagging = true;
  }

  if (isLagging) {
    issues.push({
      issueId: "sys_sync_delay_warning",
      issueType: "data_sync_delay",
      category: "data_health_notice",
      severity: "warning",
      entityType: "sync_service",
      entityId: "sync_scheduler",
      entityName: "计划同步引擎",
      title: "系统底层离线定时物理同步存在时域延宕",
      oneLineReason: lastSync 
        ? `最近一次完美增量同步在 ${lagHours.toFixed(0)} 小时前，看盘数据信道发生局部时滞。`
        : "系统目前没有任何同步历史记录，主看盘数据全段离线。",
      actionVerb: "trigger_sync",
      actionTarget: "service:sync_scheduler",
      evidence: { primarySource: "SyncLog", lastSuccessfulSync: lastSync || null, lagHours },
      entityRefs: [
        {
          entityType: "sync_service",
          entityId: "sync_scheduler",
          entityName: "高频秒级拉取常置任务",
          route: "/data-center/accounts",
          sourceTable: "SyncLog"
        }
      ],
      route: "/data-center/accounts",
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  // 6. Sandbox testing clean leakage check
  const demoAccounts = await prisma.adAccount.findMany({
    where: {
      OR: [
        { fb_account_id: { contains: "123456" } },
        { fb_account_id: { contains: "sandbox" } },
        { fb_account_id: { contains: "demo" } }
      ]
    }
  });

  if (demoAccounts.length > 0) {
    issues.push({
      issueId: "sandbox_data_pollution_risk_warning",
      issueType: "temp_seed_leak",
      category: "data_health_notice",
      severity: "warning",
      entityType: "database",
      entityId: "sandbox_seed_detect",
      entityName: "沙盒混杂排查器",
      title: "关系数据库中并存沙盒测试拥有的临时 Seed 实例",
      oneLineReason: `抓取到了 ${demoAccounts.length} 个沙盒或 Demo 虚拟假定账户，出海实盘建议从统计基线中对账摒除。`,
      actionVerb: "cleanup_seed",
      actionTarget: "database:sandbox_seed_detect",
      evidence: { primarySource: "AdAccount", demoAccountsCount: demoAccounts.length },
      entityRefs: [
        {
          entityType: "database",
          entityId: "sandbox_seed_detect",
          entityName: "物理数据库防混淆切片",
          route: "/data-center/accounts",
          sourceTable: "AdAccount"
        }
      ],
      route: "/data-center/accounts",
      limitations,
      generationMode: "offline_rule_engine",
      humanConfirmationRequired: true,
      status: "pending"
    });
  }

  // 7. Router path mismatch check
  issues.push({
    issueId: "router_leakage_warning_notice",
    issueType: "route_integrity_warning",
    category: "data_health_notice",
    severity: "info",
    entityType: "security_framework",
    entityId: "router_gatekeeper",
    entityName: "主路网防漏关口",
    title: "统一数据看盘部分前端多核路由未正常映射",
    oneLineReason: "系统多重诊断路由与本地物理跳转配置页面未映射完毕，请手动通过导航栏完成翻阅。",
    actionVerb: "verify_route",
    actionTarget: "framework:router_gatekeeper",
    evidence: { primarySource: "Setting", metrics: {} },
    entityRefs: [
      {
        entityType: "security_framework",
        entityId: "router_gatekeeper",
        entityName: "统一系统多跳跃中继门锁",
        route: "/data-center/accounts",
        sourceTable: "Setting"
      }
    ],
    route: "/data-center/accounts",
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
    const activeIds = await getActiveAccountIds(params);

    // Call sub-engines
    const [
      accountIssues,
      storeIssues,
      creativeIssues,
      countryIssues,
      productIssues,
      dataHealthIssues
    ] = await Promise.all([
      detectAccountIssues(params),
      detectStoreIssues(params),
      detectCreativeIssues(params),
      detectCountryIssues(params),
      detectProductIssues(params),
      detectDataHealthIssues(params)
    ]);

    // Concatenate issues
    const rawAll = [
      ...accountIssues,
      ...storeIssues,
      ...creativeIssues,
      ...countryIssues,
      ...productIssues,
      ...dataHealthIssues
    ];

    // Filter, validate, and process through Issue Eligibility Gate
    const validatedAll = rawAll.map(issue => validateIssueEligibility(issue));

    // Summary counters
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

    // Filter which issues to return (debug output is only returned if includeDebug is true, or let's return them all so UI can filter)
    // To ensure exact adherence to "Debug 默认隐藏", we return all issues, letting UI filter them by category, or filter them out if includeDebug is false.
    // Let's filter out debug_invalid items if params.includeDebug is explicitly false (or undefined) to save transfer size,
    // but keep them in summary! Let's return the final array based on selection.
    const filteredIssues = params.includeDebug 
      ? validatedAll 
      : validatedAll.filter(issue => issue.category !== "debug_invalid");

    return {
      success: true,
      issues: filteredIssues,
      summary: {
        productionCount,
        noticeCount,
        debugInvalidCount,
        activeAccountCount: activeIds.length,
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
