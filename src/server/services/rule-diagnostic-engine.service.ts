// rule-diagnostic-engine
// generateDiagnosticIssues
// diagnostics/issues

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

  // Added P1 funnel and classification fields
  problemStage?:
    | "ad_delivery"
    | "creative_attraction"
    | "landing_page_arrival"
    | "product_page_intent"
    | "cart_to_checkout"
    | "checkout_payment"
    | "outcome"
    | "data_health"
    | null;

  optimizationArea?:
    | "budget"
    | "audience"
    | "creative"
    | "landing_page_speed"
    | "product_page"
    | "pricing"
    | "trust"
    | "cart"
    | "checkout"
    | "payment"
    | "retargeting"
    | "tracking"
    | "mapping"
    | "data_sync"
    | null;

  funnelStage?:
    | "impression_to_click"
    | "click_to_landing_page"
    | "landing_page_to_add_to_cart"
    | "add_to_cart_to_checkout"
    | "checkout_to_purchase"
    | "meta_to_store_reconciliation"
    | "not_applicable"
    | null;

  diagnosisReason?: string | null;
  suggestedActions?: string[];
  validationMetrics?: string[];
  priorityScore?: number;
  confidenceScore?: number;
  impactScore?: number;
  urgencyScore?: number;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
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
  "sample",
  "sandbox",
  "fake"
];

export function sanitizeIssueForbiddenWords(issue: UniformIssue): UniformIssue {
  // P0 correction: Disable replacement/whitewashing behavior completely!
  return issue;
}

export function validateIssueEligibility(issue: any): any {
  const badWords = [
    "unknown",
    "free_text",
    "cr01",
    "cr02",
    "cr03",
    "mock",
    "demo",
    "sample",
    "sandbox",
    "fake"
  ];

  const checkStringContainsBadWord = (str: string) => {
    const lower = str.toLowerCase();
    return badWords.some(bad => lower.includes(bad));
  };

  // P0 verification: Ensure illegal items are fully quarantined to debug_invalid and never whitewashed.
  let hasForbiddenWord = false;
  if (issue.issueId && checkStringContainsBadWord(issue.issueId)) hasForbiddenWord = true;
  if (issue.entityId && checkStringContainsBadWord(issue.entityId)) hasForbiddenWord = true;
  if (issue.entityName && checkStringContainsBadWord(issue.entityName)) hasForbiddenWord = true;
  if (issue.actionTarget && checkStringContainsBadWord(issue.actionTarget)) hasForbiddenWord = true;
  if (issue.route && checkStringContainsBadWord(issue.route)) hasForbiddenWord = true;
  if (issue.evidence) {
    const evidenceStr = JSON.stringify(issue.evidence);
    if (checkStringContainsBadWord(evidenceStr)) hasForbiddenWord = true;
  }

  if (hasForbiddenWord) {
    issue.category = "debug_invalid";
    return issue;
  }

  const isIdProhibited = PROHIBITED_ENTITIES.some(bad => 
    (issue.entityId || "").toLowerCase().includes(bad) || 
    (issue.entityName || "").toLowerCase().includes(bad)
  );

  const hasEvidence = issue.evidence && Object.keys(issue.evidence).length > 0;
  const hasEntityRefs = Array.isArray(issue.entityRefs) && issue.entityRefs.length > 0;
  const isRouteValid = typeof issue.route === "string" && issue.route.startsWith("/");
  const isActionVerbLegal = LEGAL_ACTION_VERBS.includes(issue.actionVerb);
  
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
        
      if (isDataHealthRelated && issue.entityId) {
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

// P1 basic scoring helper functions (non-AI pure logic)
export function calculateImpactScore(issue: any): number {
  const evidence = issue.evidence || {};
  const metrics = evidence.metrics || {};
  const spend = Number(metrics.spend || metrics.boundAccountSpend || 0);
  const clicks = Number(metrics.clicks || 0);
  const revenue = Number(metrics.storeRevenue || metrics.purchaseValue || 0);

  let score = 0.2; // default base impact

  if (spend > 500) score += 0.4;
  else if (spend > 100) score += 0.2;
  else if (spend > 50) score += 0.1;

  if (revenue > 2000) score += 0.3;
  else if (revenue > 500) score += 0.15;

  if (clicks > 500) score += 0.1;
  else if (clicks > 100) score += 0.05;

  return Math.min(1.0, Math.max(0.01, score));
}

export function calculateConfidenceScore(issue: any): number {
  const evidence = issue.evidence || {};
  const metrics = evidence.metrics || {};
  const spend = Number(metrics.spend || metrics.boundAccountSpend || 0);
  const clicks = Number(metrics.clicks || 0);
  const funnelSnapshot = evidence.funnelSnapshot || {};
  const missingMetrics = funnelSnapshot.missingMetrics || [];

  let score = 0.8; // base confidence

  if (missingMetrics.length > 0) {
    score -= missingMetrics.length * 0.1;
  }

  if (spend > 0 && spend < 50) {
    score -= 0.2;
  }
  if (clicks > 0 && clicks < 20) {
    score -= 0.1;
  }

  if (issue.issueType === "route_missing_notice") {
    score = 0.5;
  }

  return Math.min(1.0, Math.max(0.1, score));
}

export function calculateUrgencyScore(issue: any): number {
  const severity = issue.severity;
  const issueType = issue.issueType;
  const evidence = issue.evidence || {};
  const metrics = evidence.metrics || {};
  const spend = Number(metrics.spend || metrics.boundAccountSpend || 0);

  let score = 0.3; // base urgency

  if (severity === "critical") {
    score += 0.4;
  } else if (severity === "warning") {
    score += 0.2;
  }

  if (issueType === "meta_token_status") {
    score += 0.3;
  }
  if (issueType === "high_spend_no_purchase" || issueType === "high_spend_low_roas") {
    if (spend > 150) {
      score += 0.2;
    }
  }

  return Math.min(1.0, Math.max(0.1, score));
}

export function calculatePriorityScore(issue: any): number {
  const impact = calculateImpactScore(issue);
  const confidence = calculateConfidenceScore(issue);
  const urgency = calculateUrgencyScore(issue);

  const rawScore = Math.round(impact * confidence * urgency * 100);
  return Math.min(100, Math.max(1, rawScore));
}

// P1 Funnel Snapshot builder helper (strict zero-mock, actual metrics)
export function buildFunnelSnapshot(
  impressions: number | null,
  linkClicks: number | null,
  landingPageViews: number | null,
  addToCart: number | null,
  initiateCheckout: number | null,
  metaPurchase: number | null,
  storeOrders: number | null,
  storeRevenue: number | null,
  spend: number | null,
  notes?: string
) {
  const missingMetrics: string[] = [];
  if (impressions === null) missingMetrics.push("impressions");
  if (linkClicks === null) missingMetrics.push("linkClicks");
  if (landingPageViews === null) missingMetrics.push("landingPageViews");
  if (addToCart === null) missingMetrics.push("addToCart");
  if (initiateCheckout === null) missingMetrics.push("initiateCheckout");
  if (metaPurchase === null) missingMetrics.push("metaPurchase");
  if (storeOrders === null) missingMetrics.push("storeOrders");
  if (storeRevenue === null) missingMetrics.push("storeRevenue");

  const linkCtr = (impressions && impressions > 0 && linkClicks !== null) ? linkClicks / impressions : null;
  const arrivalRate = (linkClicks && linkClicks > 0 && landingPageViews !== null) ? landingPageViews / linkClicks : null;
  const atcRate = (landingPageViews && landingPageViews > 0 && addToCart !== null) ? addToCart / landingPageViews : null;
  const icRate = (addToCart && addToCart > 0 && initiateCheckout !== null) ? initiateCheckout / addToCart : null;
  const purchaseRate = (initiateCheckout && initiateCheckout > 0 && metaPurchase !== null) ? metaPurchase / initiateCheckout : null;
  
  const cartAbandonmentRate = (addToCart && addToCart > 0 && initiateCheckout !== null) ? 1 - (initiateCheckout / addToCart) : null;
  const checkoutAbandonmentRate = (initiateCheckout && initiateCheckout > 0 && metaPurchase !== null) ? 1 - (metaPurchase / initiateCheckout) : null;
  
  const metaStoreOrderGap =
    metaPurchase && metaPurchase > 0 && storeOrders !== null
      ? Math.abs(storeOrders - metaPurchase) / metaPurchase
      : null;
  const storeRoas = (spend && spend > 0 && storeRevenue !== null) ? storeRevenue / spend : null;

  return {
    impressions,
    linkClicks,
    landingPageViews,
    addToCart,
    initiateCheckout,
    metaPurchase,
    storeOrders,
    storeRevenue,
    linkCtr,
    arrivalRate,
    atcRate,
    icRate,
    purchaseRate,
    cartAbandonmentRate,
    checkoutAbandonmentRate,
    metaStoreOrderGap,
    storeRoas,
    missingMetrics,
    notes: notes || null
  };
}

// P1 Dynamic Field Enricher
export function enrichIssueFields(issue: any): any {
  if (!issue.evidence) {
    issue.evidence = {};
  }
  if (!issue.evidence.funnelSnapshot) {
    issue.evidence.funnelSnapshot = buildFunnelSnapshot(
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    );
  }

  issue.problemStage = issue.problemStage || null;
  issue.optimizationArea = issue.optimizationArea || null;
  issue.funnelStage = issue.funnelStage || "not_applicable";
  issue.diagnosisReason = issue.oneLineReason || "";
  issue.suggestedActions = issue.suggestedActions || [];
  issue.validationMetrics = issue.validationMetrics || [];
  issue.ownerUserId = null;
  issue.ownerUserName = null;

  const type = issue.issueType;

  if (type === "high_spend_low_roas" || type === "store_roas_drop" || type === "low_roas_creative") {
    issue.problemStage = "outcome";
    issue.optimizationArea = "budget";
    issue.funnelStage = "not_applicable";
    issue.suggestedActions = [
      "降低预算或暂停高消耗广告组/素材",
      "检查高消耗素材的创意吸引力",
      "检查国家受众是否有亏损严重的偏差",
      "核对 Store ROAS 评估最终效益"
    ];
    issue.validationMetrics = ["ROAS", "CPA", "Store ROAS", "spend"];
  } 
  else if (type === "high_spend_no_purchase") {
    issue.problemStage = "checkout_payment";
    issue.optimizationArea = "budget";
    issue.funnelStage = "checkout_to_purchase";
    issue.suggestedActions = [
      "暂停或降低该级别预算",
      "检查支付链路是否有报错、耗时过长或阻碍",
      "检查像素回传（Pixel/CAPI）配置是否合规",
      "检查落地页及商品页的价格和结算跳转"
    ];
    issue.validationMetrics = ["Purchase", "CPA", "IC Rate", "Store Orders"];
  } 
  else if (type === "high_clicks_low_purchase" || type === "high_ctr_low_purchase_creative") {
    issue.problemStage = "product_page_intent";
    issue.optimizationArea = "product_page";
    issue.funnelStage = "landing_page_to_add_to_cart";
    issue.suggestedActions = [
      "针对产品落地页首屏内容进行排版与加载速度优化",
      "增加更有说服力的用户评价或信任背书",
      "优化价格锚点与折扣信息，提升加购意向",
      "检查广告素材的文案/承诺与落地页内容是否一致"
    ];
    issue.validationMetrics = ["ATC Rate", "IC Rate", "Purchase Rate", "Store Orders"];
  } 
  else if (type === "unmapped_spend_account" || type === "unmapped_spend_notice" || type === "unmapped_spend_risk") {
    issue.problemStage = "data_health";
    issue.optimizationArea = "mapping";
    issue.funnelStage = "not_applicable";
    issue.suggestedActions = [
      "前往店铺账户映射页面，绑定该广告账户到对应的独立站店铺",
      "检查 AccountMapping 配置表是否正确同步",
      "重新运行对账服务以正确计算 Store ROAS"
    ];
    issue.validationMetrics = ["unmappedSpend", "Store ROAS", "AccountMapping 完整度"];
  } 
  else if (type === "country_high_spend_low_roas") {
    issue.problemStage = "ad_delivery";
    issue.optimizationArea = "audience";
    issue.funnelStage = "impression_to_click";
    
    if (!issue.limitations.includes("当前为 Meta 受众国家表现，不代表真实订单国家销售。")) {
      issue.limitations.push("当前为 Meta 受众国家表现，不代表真实订单国家销售。");
    }
    
    issue.suggestedActions = [
      "降低该国家的买量预算或排除受众",
      "单独建立广告组针对该地区进行观察和冷启动",
      "等待后台订单国家销售数据补齐，核算最终 ROI"
    ];
    issue.validationMetrics = ["Country ROAS", "CPC", "CPM", "Purchases"];
  } 
  else if (
    type === "product_attribution_missing" || 
    type === "order_country_missing" || 
    type === "sync_delay_notice" || 
    type === "meta_token_status" ||
    type === "route_missing_notice" ||
    type === "country_data_insufficient" ||
    type === "product_data_missing"
  ) {
    issue.problemStage = "data_health";
    issue.funnelStage = "not_applicable";
    issue.category = "data_health_notice";
    
    if (type === "product_attribution_missing") {
      issue.optimizationArea = "tracking";
      issue.suggestedActions = ["调查单品像素归因直连通道", "核对单品配置与全站订单对账规则"];
      issue.validationMetrics = ["Product Attribution Consistency"];
    } else if (type === "order_country_missing") {
      issue.optimizationArea = "tracking";
      issue.suggestedActions = ["补齐 Order 表中的 ISO 国家物理字段", "排查同步信道中的地址解析逻辑"];
      issue.validationMetrics = ["Country Code Fill Rate"];
    } else if (type === "sync_delay_notice") {
      issue.optimizationArea = "data_sync";
      issue.suggestedActions = ["检查后台同步服务（SyncTask / SyncLog）运行状态", "排查 Meta Graph API 与独立站 API 是否耗尽限频"];
      issue.validationMetrics = ["Data Lag Hours"];
    } else if (type === "meta_token_status") {
      issue.optimizationArea = "data_sync";
      issue.suggestedActions = ["前往 Meta 配置项更新合法的长期/永久访问 Token键值", "手动运行 Token 测试接口验证健康度"];
      issue.validationMetrics = ["Token Status Valid"];
    } else {
      issue.optimizationArea = "mapping";
      issue.suggestedActions = ["持续观察账户映射或路由状态", "核查后端数据库路由是否健全"];
      issue.validationMetrics = ["Integrity Status"];
    }
  }
  else {
    if (issue.category === "production_suggestion") {
      issue.problemStage = "ad_delivery";
      issue.optimizationArea = "creative";
      issue.funnelStage = "impression_to_click";
      issue.suggestedActions = ["观察创意后续表现", "进行受众或预算微调"];
      issue.validationMetrics = ["spend", "ROAS"];
    } else {
      issue.problemStage = "data_health";
      issue.optimizationArea = "mapping";
      issue.funnelStage = "not_applicable";
      issue.suggestedActions = ["排查底层事实表之间的关联性"];
      issue.validationMetrics = ["Consistency Score"];
    }
  }

  issue.impactScore = calculateImpactScore(issue);
  issue.confidenceScore = calculateConfidenceScore(issue);
  issue.urgencyScore = calculateUrgencyScore(issue);
  issue.priorityScore = calculatePriorityScore(issue);

  return issue;
}

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

export async function detectAccountIssues(params: any): Promise<any[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const targetAccountIds = await getActiveAccountIds(params);
  const accounts = await prisma.adAccount.findMany({
    where: targetAccountIds.length > 0 ? { fb_account_id: { in: targetAccountIds } } : {}
  });

  for (const acc of accounts) {
    const accountId = acc.fb_account_id;
    const accountName = acc.fb_account_name || accountId;

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

    // Fetch addToCart and initiateCheckout from AdInsight for exact accountId - DECOMMISSIONED FOR LOCKDOWN
    const addToCart = 0;
    const initiateCheckout = 0;
    const landingPageViews = null;

    let storeOrders: number | null = null;
    let storeRevenue: number | null = null;
    if (acc.storeId) {
      const storeOrdersRecords = await prisma.order.findMany({
        where: {
          storeId: acc.storeId,
          createdAt: { gte: parseISO(startDate), lte: parseISO(endDate) }
        }
      });
      storeOrders = storeOrdersRecords.length;
      storeRevenue = storeOrdersRecords.reduce((sum, o) => sum + (o.revenue || 0), 0);
    }

    const funnelSnapshotNotes = "当前 linkClicks 暂使用 FactMetaPerformance.clicks 代替；若后续补充真实 link_clicks，应切换为真实 Link Click。当前缺少 Landing Page View 字段，暂无法计算点击到落地页到达率。";
    const funnelSnapshot = buildFunnelSnapshot(
      impressions || null,
      clicks || null,
      landingPageViews,
      addToCart || null,
      initiateCheckout || null,
      purchases || null,
      storeOrders,
      storeRevenue,
      spend || null,
      funnelSnapshotNotes
    );

    const baseEvidence = {
      primarySource: "FactMetaPerformance",
      supportingSources: ["AdAccount", "AccountMapping", "AdInsight"],
      dateRange: `${startDate} 至 ${endDate}`,
      limitations: [
        "当前 linkClicks 暂使用 FactMetaPerformance.clicks 代替；若后续补充真实 link_clicks，应切换为真实 Link Click。",
        "当前缺少 Landing Page View 字段，暂无法计算点击到落地页到达率。",
        "AdInsight 仅作为 ATC / IC 漏斗事件补充来源，不作为 spend / ROAS / purchases 主事实源。"
      ],
      funnelSnapshot,
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

export async function detectStoreIssues(params: any): Promise<any[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const storeIdFilter = params.storeId ? Number(params.storeId) : undefined;
  const stores = await prisma.store.findMany({
    where: storeIdFilter ? { id: storeIdFilter } : {}
  });

  for (const store of stores) {
    const storeId = store.id;
    const storeName = store.name;

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
    const impressions = perfRecords.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const clicks = perfRecords.reduce((sum, r) => sum + (r.clicks || 0), 0);

    const totalOrders = orders.length;
    const storeProfit = orders.reduce((sum, o) => sum + (o.profit || 0), 0);
    const storeRevenue = orders.reduce((sum, o) => sum + (o.revenue || 0), 0);
    const refundOrders = orders.filter(o => o.refunded).length;
    const refundRate = totalOrders > 0 ? (refundOrders / totalOrders) * 100 : 0;

    // Canonical diagnostic funnel uses FactMetaPerformance clicks and Order results only.
    const addToCart = 0;
    const initiateCheckout = 0;
    const landingPageViews = null;

    const funnelSnapshotNotes = "当前 linkClicks 暂使用 FactMetaPerformance.clicks 代替；当前缺少 Landing Page View、Add To Cart 与 Initiate Checkout 字段，暂无法计算完整点击到落地页到达率和加购结账漏斗。";
    const funnelSnapshot = buildFunnelSnapshot(
      impressions || null,
      clicks || null,
      landingPageViews,
      addToCart || null,
      initiateCheckout || null,
      metaPurchases || null,
      totalOrders,
      storeRevenue,
      spend || null,
      funnelSnapshotNotes
    );

    const baseEvidence = {
      primarySource: "Order",
      supportingSources: ["Store", "AccountMapping", "FactMetaPerformance"],
      dateRange: `${startDate} 至 ${endDate}`,
      limitations: [
        "当前 linkClicks 暂使用 FactMetaPerformance.clicks 代替。",
        "当前缺少 Landing Page View、Add To Cart 与 Initiate Checkout 字段，暂无法计算完整落地页到加购结账漏斗。",
        "Store ROAS 以 Order 与 FactMetaPerformance 的本地事实表对账结果为准。"
      ],
      funnelSnapshot,
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

export async function detectCreativeIssues(params: any): Promise<any[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const targetAccountIds = await getActiveAccountIds(params);

  const where: any = {
    level: "ad",
    date: { gte: startDate, lte: endDate }
  };

  if (params.accountId) {
    where.account_id = params.accountId;
  } else if (targetAccountIds.length > 0) {
    where.account_id = { in: targetAccountIds };
  }

  const performanceRecords = await prisma.factMetaPerformance.findMany({
    where
  });

  const creativeMap: Record<string, any> = {};

  for (const rec of performanceRecords) {
    const cid = rec.creative_id || rec.ad_id || rec.entity_id;

    if (!cid || PROHIBITED_ENTITIES.some(bad => String(cid).toLowerCase().includes(bad))) {
      continue;
    }

    const creativeName =
      rec.creative_name ||
      rec.ad_name ||
      rec.entity_name ||
      cid;

    if (!creativeMap[cid]) {
      creativeMap[cid] = {
        creativeId: cid,
        creativeName,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchaseValue: 0,
        purchases: 0,
        accountIds: new Set<string>(),
        factRows: 0
      };
    }

    creativeMap[cid].spend += rec.spend || 0;
    creativeMap[cid].impressions += rec.impressions || 0;
    creativeMap[cid].clicks += rec.clicks || 0;
    creativeMap[cid].purchaseValue += rec.purchase_value || 0;
    creativeMap[cid].purchases += rec.purchases || 0;
    creativeMap[cid].factRows += 1;

    if (rec.account_id) {
      creativeMap[cid].accountIds.add(rec.account_id);
    }
  }

  for (const cid of Object.keys(creativeMap)) {
    const data = creativeMap[cid];
    const {
      creativeName,
      spend,
      impressions,
      clicks,
      purchaseValue,
      purchases
    } = data;

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;

    const accountIds = Array.from(data.accountIds || []);

    const baseEvidence = {
      primarySource: "FactMetaPerformance",
      supportingSources: ["Ad", "AdCreative"],
      dateRange: `${startDate} 至 ${endDate}`,
      metrics: {
        spend,
        boundAccountSpend: spend,
        impressions,
        clicks,
        purchases,
        purchaseValue,
        ctr,
        cpc,
        cpm,
        roas,
        cpa: purchases > 0 ? spend / purchases : spend,
        accountIds,
        factRows: data.factRows,
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
        sourceTable: "FactMetaPerformance"
      }
    ];

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
        limitations: [
          "创意诊断已切换为 FactMetaPerformance 广告级事实数据；若素材结构未同步，creative_id 可能回退为 ad_id 或 entity_id。"
        ],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

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
        limitations: [
          "创意诊断已切换为 FactMetaPerformance 广告级事实数据；若素材结构未同步，creative_id 可能回退为 ad_id 或 entity_id。"
        ],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }

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
        limitations: [
          "创意诊断已切换为 FactMetaPerformance 广告级事实数据；若素材结构未同步，creative_id 可能回退为 ad_id 或 entity_id。"
        ],
        generationMode: "offline_rule_engine",
        humanConfirmationRequired: true,
        status: "pending"
      });
    }
  }

  return issues;
}

export async function detectCountryIssues(params: any): Promise<any[]> {
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

  const countryMap: Record<string, any> = {};
  for (const r of breakdowns) {
    const code = r.dimension_value || "standard";
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
    countryMap[code].spend += r.spend || 0;
    countryMap[code].impressions += r.impressions || 0;
    countryMap[code].clicks += r.clicks || 0;
    countryMap[code].purchases += r.purchases || 0;
    countryMap[code].purchaseValue += r.purchase_value || 0;
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

export async function detectProductIssues(params: any): Promise<any[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const storeIdFilter = params.storeId ? Number(params.storeId) : undefined;
  
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

export async function detectDataHealthIssues(params: any): Promise<any[]> {
  const { startDate, endDate } = params;
  const issues: UniformIssue[] = [];

  const limitations = ["诊断完全基于本地事实对账物理表勾稽测试。"];

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

export async function generateDiagnosticIssues(params: any): Promise<{
  success: boolean;
  issues: UniformIssue[];
  message?: string;
  diagnosticsDegraded?: boolean;
  failedDetectors?: Array<{
    name: string;
    message: string;
  }>;
  summary: {
    productionCount: number;
    noticeCount: number;
    debugInvalidCount: number;
    activeAccountCount: number;
    dataHealthNoticeCount: number;
    failedDetectorCount?: number;
  };
}> {
  const failedDetectors: Array<{ name: string; message: string }> = [];

  const runDetector = async (
    name: string,
    fn: (params: any) => Promise<any[]>
  ): Promise<any[]> => {
    try {
      const result = await fn(params);
      return Array.isArray(result) ? result : [];
    } catch (error: any) {
      console.error(`[generateDiagnosticIssues:${name} ERROR]`, error);
      failedDetectors.push({
        name,
        message: error?.message || String(error)
      });
      return [];
    }
  };

  const [
    accountIssues,
    storeIssues,
    creativeIssues,
    countryIssues,
    productIssues,
    dataHealthIssues
  ] = await Promise.all([
    runDetector("detectAccountIssues", detectAccountIssues),
    runDetector("detectStoreIssues", detectStoreIssues),
    runDetector("detectCreativeIssues", detectCreativeIssues),
    runDetector("detectCountryIssues", detectCountryIssues),
    runDetector("detectProductIssues", detectProductIssues),
    runDetector("detectDataHealthIssues", detectDataHealthIssues)
  ]);

  const rawAll = [
    ...accountIssues,
    ...storeIssues,
    ...creativeIssues,
    ...countryIssues,
    ...productIssues,
    ...dataHealthIssues
  ];

  const enrichedAll = rawAll.map(issue => enrichIssueFields(issue));
  const sanitizedAll = enrichedAll.map(issue => sanitizeIssueForbiddenWords(issue));
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

  let activeAccounts: string[] = [];
  try {
    activeAccounts = await getActiveAccountIds(params);
  } catch (error: any) {
    console.error("[generateDiagnosticIssues:getActiveAccountIds ERROR]", error);
    failedDetectors.push({
      name: "getActiveAccountIds",
      message: error?.message || String(error)
    });
  }

  return {
    success: true,
    issues: validatedAll,
    message:
      failedDetectors.length > 0
        ? "诊断已完成，但部分诊断模块降级跳过。"
        : "诊断已完成。",
    diagnosticsDegraded: failedDetectors.length > 0,
    failedDetectors,
    summary: {
      productionCount,
      noticeCount,
      debugInvalidCount,
      activeAccountCount: activeAccounts.length,
      dataHealthNoticeCount: noticeCount,
      failedDetectorCount: failedDetectors.length
    }
  };
}
