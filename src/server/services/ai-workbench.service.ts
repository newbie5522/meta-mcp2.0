import prisma from "../../db/index.js";
import { completeWithConfiguredAi, isAiProviderRuntimeDisabled } from "../../packages/ai/src/providers.js";

export interface AiWorkbenchOverviewParams {
  startDate: string;
  endDate: string;
  storeId?: number;
  accountId?: string;
}

export interface AiWorkbenchCard {
  id: string;
  source: "auto" | "manual";
  analysisType: string;
  entityType: "account" | "store" | "creative" | "system";
  entityId: string;
  entityName?: string;
  priority: "high" | "medium" | "low";
  title: string;
  summary: string;
  evidence: {
    startDate: string;
    endDate: string;
    metrics: Record<string, any>;
    dataSources: string[];
  };
  recommendation: {
    judgment: string;
    action: string;
    budgetAction?: string;
    observationWindow: string;
    riskControl: string;
    nextCheck: string;
  };
  aiMode: "ai_model" | "rule_fallback";
  createdAt: string;
}

export interface AiWorkbenchOverviewResult {
  success: true;
  generatedAt: string;
  dateRange: { startDate: string; endDate: string };
  aiSummary: string;
  coverage: {
    activeAccountsScanned: number;
    activeStoresScanned: number;
    businessCardsGenerated: number;
    dataHealthNotices: number;
  };
  cards: AiWorkbenchCard[];
  dataHealthNotices: any[];
  aiRuntime: {
    enabled: boolean;
    mode: "ai_model" | "rule_fallback";
  };
}

export interface AiManualAnalysisParams {
  analysisType: string;
  entityType: "account" | "store" | "creative" | "system";
  entityId: string;
  startDate: string;
  endDate: string;
  question?: string;
}

export interface AiFollowUpParams {
  card: AiWorkbenchCard;
  question: string;
}

type MetricGroup = {
  accountId: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  revenue: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpa: number;
};

type StoreMetrics = {
  storeId: number;
  storeName: string;
  ordersCount: number;
  revenue: number;
  adSpend: number;
  mappedAccountCount: number;
  realRoas: number;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function buildId(prefix: string, entityId: string, analysisType: string): string {
  return `${prefix}_${analysisType}_${entityId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isValidOrder(order: any): boolean {
  const paymentStatus = String(order.paymentStatus || "").toLowerCase();
  const fulfillmentStatus = String(order.fulfillmentStatus || "").toLowerCase();
  return (
    order.refunded !== true &&
    !["waiting", "unpaid", "pending", "failed", "cancelled", "canceled"].includes(paymentStatus) &&
    !["cancelled", "canceled"].includes(fulfillmentStatus)
  );
}

function orderRevenue(order: any): number {
  const total = toNumber(order.orderTotal);
  return total > 0 ? total : toNumber(order.revenue);
}

function isOrderInRange(order: any, startDate: string, endDate: string): boolean {
  if (order.store_local_date) {
    return order.store_local_date >= startDate && order.store_local_date <= endDate;
  }

  if (!order.createdAt) return false;
  const createdDate = new Date(order.createdAt).toISOString().slice(0, 10);
  return createdDate >= startDate && createdDate <= endDate;
}

function summarizeRows(rows: any[], accountId = "all"): MetricGroup {
  const spend = rows.reduce((sum, row) => sum + toNumber(row.spend), 0);
  const impressions = rows.reduce((sum, row) => sum + toNumber(row.impressions), 0);
  const clicks = rows.reduce((sum, row) => sum + toNumber(row.clicks), 0);
  const purchases = rows.reduce((sum, row) => sum + toNumber(row.purchases), 0);
  const purchaseValue = rows.reduce((sum, row) => sum + toNumber(row.purchase_value), 0);
  const roas = spend > 0 ? purchaseValue / spend : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cpa = purchases > 0 ? spend / purchases : 0;

  return {
    accountId,
    spend: round(spend),
    impressions,
    clicks,
    purchases,
    purchaseValue: round(purchaseValue),
    revenue: round(purchaseValue),
    roas: round(roas),
    ctr: round(ctr),
    cpc: round(cpc),
    cpa: round(cpa)
  };
}

function groupAccountMetrics(rows: any[]): Map<string, MetricGroup> {
  const groupedRows = new Map<string, any[]>();
  rows.forEach((row) => {
    const accountId = String(row.account_id || "").trim();
    if (!accountId) return;
    const bucket = groupedRows.get(accountId) || [];
    bucket.push(row);
    groupedRows.set(accountId, bucket);
  });

  const metrics = new Map<string, MetricGroup>();
  groupedRows.forEach((items, accountId) => {
    metrics.set(accountId, summarizeRows(items, accountId));
  });
  return metrics;
}

function isActiveAccount(metrics: MetricGroup): boolean {
  return metrics.spend > 0 || metrics.impressions > 0 || metrics.clicks > 0;
}

function priorityFor(metrics: MetricGroup): "high" | "medium" | "low" {
  if ((metrics.spend > 50 && metrics.roas < 1.2) || (metrics.clicks >= 50 && metrics.purchases === 0)) {
    return "high";
  }
  if (metrics.spend > 30 || metrics.purchases >= 2) {
    return "medium";
  }
  return "low";
}

function makeAccountCard(
  analysisType: string,
  accountId: string,
  accountName: string | undefined,
  metrics: MetricGroup,
  startDate: string,
  endDate: string
): AiWorkbenchCard {
  const base = {
    id: buildId("auto", accountId, analysisType),
    source: "auto" as const,
    analysisType,
    entityType: "account" as const,
    entityId: accountId,
    entityName: accountName,
    priority: priorityFor(metrics),
    evidence: {
      startDate,
      endDate,
      metrics: { ...metrics },
      dataSources: ["FactMetaPerformance", "AdAccount"]
    },
    aiMode: "rule_fallback" as const,
    createdAt: new Date().toISOString()
  };

  if (analysisType === "account_roas_low") {
    return {
      ...base,
      title: "广告账户 ROAS 偏低",
      summary: `该账户当前周期花费 $${metrics.spend.toFixed(2)}，ROAS ${metrics.roas.toFixed(2)}x，低于扩量线。`,
      recommendation: {
        judgment: "当前投放效率偏低，继续放量前需要先收紧低效流量。",
        action: "优先检查消耗最高的 Campaign / Ad Set，暂停明显无购买的组合，并保留有购买信号的素材继续观察。",
        budgetAction: "先冻结新增预算，低效组合预算下调 20%-30%，待 ROAS 连续 2 天回升后再恢复测试。",
        observationWindow: "观察 48-72 小时。",
        riskControl: "不要一次性关闭全部广告组，避免学习期重置和稳定订单来源中断。",
        nextCheck: "复查最高消耗广告组的 CTR、CPC、购买数和落地页承接数据。"
      }
    };
  }

  if (analysisType === "account_scale_candidate") {
    return {
      ...base,
      title: "广告账户具备小幅扩量条件",
      summary: `该账户当前周期购买 ${metrics.purchases} 次，ROAS ${metrics.roas.toFixed(2)}x，已有正向订单信号。`,
      recommendation: {
        judgment: "账户有可扩量信号，但应采用小步增量，避免破坏稳定转化。",
        action: "选择 ROAS 稳定的广告组进行预算递增，同时保留原广告组作为对照。",
        budgetAction: "单次预算上调 10%-15%，不要超过 20%。",
        observationWindow: "观察 2-3 天，至少覆盖一个完整投放日。",
        riskControl: "若 CPC 上升超过 25% 或 ROAS 连续两天下滑，应回退预算。",
        nextCheck: "复查扩量广告组的 CPA、购买数、素材频次和受众重叠。"
      }
    };
  }

  return {
    ...base,
    title: "点击量较高但购买偏弱",
    summary: `该账户当前周期点击 ${metrics.clicks} 次但购买为 0，需要排查点击质量和落地页承接。`,
    recommendation: {
      judgment: "点击已形成，但购买未承接，问题更可能出现在流量质量、商品页或结账路径。",
      action: "先检查高点击广告组的落地页、商品价格、运费和支付流程，再决定是否继续投放。",
      budgetAction: "保留少量验证预算，暂停新增预算；无购买广告组预算下调 20%-40%。",
      observationWindow: "观察 24-48 小时。",
      riskControl: "不要只因 CTR 高就扩量，必须等待购买或加购信号确认。",
      nextCheck: "复查点击来源、落地页加载速度、加购率和结账失败记录。"
    }
  };
}

function makeStoreCard(
  analysisType: string,
  storeMetrics: StoreMetrics,
  startDate: string,
  endDate: string
): AiWorkbenchCard {
  const base = {
    id: buildId("auto", String(storeMetrics.storeId), analysisType),
    source: "auto" as const,
    analysisType,
    entityType: "store" as const,
    entityId: String(storeMetrics.storeId),
    entityName: storeMetrics.storeName,
    priority: (analysisType === "store_roas_low" ? "high" : "medium") as "high" | "medium",
    evidence: {
      startDate,
      endDate,
      metrics: {
        storeId: storeMetrics.storeId,
        ordersCount: storeMetrics.ordersCount,
        revenue: round(storeMetrics.revenue),
        spend: round(storeMetrics.adSpend),
        mappedAccountCount: storeMetrics.mappedAccountCount,
        realRoas: round(storeMetrics.realRoas),
        roas: round(storeMetrics.realRoas)
      },
      dataSources: ["Store", "Order", "AccountMapping", "FactMetaPerformance"]
    },
    aiMode: "rule_fallback" as const,
    createdAt: new Date().toISOString()
  };

  if (analysisType === "store_roas_low") {
    return {
      ...base,
      title: "店铺真实 ROAS 偏低",
      summary: `店铺当前周期广告花费 $${storeMetrics.adSpend.toFixed(2)}，订单收入 $${storeMetrics.revenue.toFixed(2)}，真实 ROAS ${storeMetrics.realRoas.toFixed(2)}x。`,
      recommendation: {
        judgment: "店铺承接效率偏低，广告消耗没有形成足够订单收入。",
        action: "先对照店铺订单、广告账户和高消耗广告组，定位是投放问题还是商品页承接问题。",
        budgetAction: "整店预算暂不扩量，低 ROAS 账户预算下调 15%-25%。",
        observationWindow: "观察 2-3 天。",
        riskControl: "不要直接关闭全部账户，保留有订单的广告组维持学习信号。",
        nextCheck: "复查店铺热卖 SKU、支付成功率、运费展示和广告账户花费结构。"
      }
    };
  }

  return {
    ...base,
    title: "店铺具备经营增长信号",
    summary: `店铺当前周期有效订单 ${storeMetrics.ordersCount} 笔，真实 ROAS ${storeMetrics.realRoas.toFixed(2)}x。`,
    recommendation: {
      judgment: "店铺订单承接和广告投入形成正向关系，可以小步测试增长。",
      action: "优先复制当前有订单贡献的广告组或素材，新增小预算测试相近受众。",
      budgetAction: "单次预算上调 10%-15%，先覆盖 1-2 个稳定广告组。",
      observationWindow: "观察 3 天。",
      riskControl: "同步监控退款、支付失败和客单价变化，避免只看投放端 ROAS。",
      nextCheck: "复查订单来源、SKU 销售结构、广告账户消耗占比和真实毛利空间。"
    }
  };
}

function makeDataHealthNotice(input: {
  type: string;
  severity: "warning" | "info" | "critical";
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  metrics?: Record<string, any>;
}) {
  return {
    ...input,
    createdAt: new Date().toISOString()
  };
}

function parseAiRecommendation(text: string): Partial<AiWorkbenchCard["recommendation"]> | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      judgment: typeof parsed.judgment === "string" ? parsed.judgment : undefined,
      action: typeof parsed.action === "string" ? parsed.action : undefined,
      budgetAction: typeof parsed.budgetAction === "string" ? parsed.budgetAction : undefined,
      observationWindow: typeof parsed.observationWindow === "string" ? parsed.observationWindow : undefined,
      riskControl: typeof parsed.riskControl === "string" ? parsed.riskControl : undefined,
      nextCheck: typeof parsed.nextCheck === "string" ? parsed.nextCheck : undefined
    };
  } catch {
    return null;
  }
}

async function enhanceCardsWithAi(cards: AiWorkbenchCard[]): Promise<AiWorkbenchCard[]> {
  if (isAiProviderRuntimeDisabled()) {
    return cards;
  }

  const system = "你是跨境电商 Meta 广告投放诊断助手。你必须输出运营语言，不能输出空话。不得直接修改广告账户，只能给人工作业建议。必须基于输入指标，给出判断、证据、建议动作、预算或操作幅度、观察周期、风险控制、下一步检查。";

  const enhanced = await Promise.all(cards.map(async (card, index) => {
    if (index >= 10) return card;

    const completion = await completeWithConfiguredAi({
      purpose: "analysis",
      system,
      user: [
        "请基于下面的诊断卡片，只返回 JSON：",
        '{"judgment":"","action":"","budgetAction":"","observationWindow":"","riskControl":"","nextCheck":""}',
        JSON.stringify(card)
      ].join("\n")
    });

    if (!completion) return card;

    const parsed = parseAiRecommendation(completion.text);
    if (!parsed?.judgment || !parsed.action || !parsed.observationWindow || !parsed.riskControl || !parsed.nextCheck) {
      return card;
    }

    return {
      ...card,
      recommendation: {
        ...card.recommendation,
        ...parsed
      },
      aiMode: "ai_model" as const
    };
  }));

  return enhanced;
}

async function getAccountRows(params: AiWorkbenchOverviewParams): Promise<any[]> {
  const where: any = {
    level: "account",
    date: { gte: params.startDate, lte: params.endDate }
  };

  if (params.accountId) {
    where.account_id = params.accountId;
  }

  return prisma.factMetaPerformance.findMany({ where });
}

async function getStoreMetrics(
  params: AiWorkbenchOverviewParams,
  accountMetrics: Map<string, MetricGroup>
): Promise<{ activeStores: StoreMetrics[]; dataHealthNotices: any[] }> {
  const stores = await prisma.store.findMany({
    where: params.storeId ? { id: params.storeId } : undefined,
    select: { id: true, name: true }
  });

  if (stores.length === 0) {
    return { activeStores: [], dataHealthNotices: [] };
  }

  const storeIds = stores.map((store) => store.id);
  const orders = await prisma.order.findMany({
    where: {
      storeId: { in: storeIds },
      OR: [
        { store_local_date: { gte: params.startDate, lte: params.endDate } },
        {
          store_local_date: null,
          createdAt: {
            gte: new Date(`${params.startDate}T00:00:00.000Z`),
            lte: new Date(`${params.endDate}T23:59:59.999Z`)
          }
        }
      ]
    }
  });

  const validOrdersByStore = new Map<number, any[]>();
  orders
    .filter((order) => isValidOrder(order) && isOrderInRange(order, params.startDate, params.endDate))
    .forEach((order) => {
      const bucket = validOrdersByStore.get(order.storeId) || [];
      bucket.push(order);
      validOrdersByStore.set(order.storeId, bucket);
    });

  const mappings = await prisma.accountMapping.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true, fbAccountId: true }
  });

  const mappingsByStore = new Map<number, string[]>();
  mappings.forEach((mapping) => {
    if (!mapping.storeId) return;
    const bucket = mappingsByStore.get(mapping.storeId) || [];
    bucket.push(mapping.fbAccountId);
    mappingsByStore.set(mapping.storeId, bucket);
  });

  const activeStores: StoreMetrics[] = [];
  const dataHealthNotices: any[] = [];

  stores.forEach((store) => {
    const validOrders = validOrdersByStore.get(store.id) || [];
    const ordersCount = validOrders.length;
    const revenue = validOrders.reduce((sum, order) => sum + orderRevenue(order), 0);
    const mappedAccounts = mappingsByStore.get(store.id) || [];
    const adSpend = mappedAccounts.reduce((sum, accountId) => sum + (accountMetrics.get(accountId)?.spend || 0), 0);
    const realRoas = adSpend > 0 ? revenue / adSpend : 0;
    const isActive = ordersCount > 0 || adSpend > 0;

    if (ordersCount > 0 && mappedAccounts.length === 0) {
      dataHealthNotices.push(makeDataHealthNotice({
        type: "store_orders_without_mapped_account",
        severity: "warning",
        title: "店铺有订单但未绑定广告账户",
        message: "该店铺当前周期存在有效订单，但未绑定 Meta 广告账户。可以观察店铺经营表现，但暂不能计算店铺级广告承接 ROAS。",
        entityType: "store",
        entityId: String(store.id),
        metrics: { ordersCount, revenue: round(revenue) }
      }));
    }

    if (!isActive) return;

    activeStores.push({
      storeId: store.id,
      storeName: store.name,
      ordersCount,
      revenue: round(revenue),
      adSpend: round(adSpend),
      mappedAccountCount: mappedAccounts.length,
      realRoas: round(realRoas)
    });
  });

  return { activeStores, dataHealthNotices };
}

function buildOverviewSummary(cards: AiWorkbenchCard[], dataHealthNotices: any[], aiEnabled: boolean): string {
  if (cards.length === 0 && dataHealthNotices.length === 0) {
    return "当前日期范围没有发现可生成业务建议的活跃账户或店铺。请确认 Meta 与店铺订单已同步，或扩大日期范围。";
  }

  const high = cards.filter((card) => card.priority === "high").length;
  const medium = cards.filter((card) => card.priority === "medium").length;
  const modeText = aiEnabled ? "AI 模型增强" : "规则兜底";
  return `本次自动扫描生成 ${cards.length} 条业务建议，其中高优先级 ${high} 条、中优先级 ${medium} 条；另有 ${dataHealthNotices.length} 条数据健康提醒。当前使用${modeText}模式。`;
}

export async function getAiWorkbenchOverview(params: AiWorkbenchOverviewParams): Promise<AiWorkbenchOverviewResult> {
  const factRows = await getAccountRows(params);
  const groupedMetrics = groupAccountMetrics(factRows);
  const activeMetrics = Array.from(groupedMetrics.values()).filter(isActiveAccount);
  const accountIds = activeMetrics.map((metrics) => metrics.accountId);
  const adAccounts = accountIds.length > 0
    ? await prisma.adAccount.findMany({
        where: { fb_account_id: { in: accountIds } },
        select: { fb_account_id: true, fb_account_name: true, storeId: true }
      })
    : [];
  const adAccountById = new Map(adAccounts.map((account) => [account.fb_account_id, account]));

  const dataHealthNotices: any[] = [];
  const cards: AiWorkbenchCard[] = [];

  activeMetrics.forEach((metrics) => {
    const account = adAccountById.get(metrics.accountId);
    if (!account?.storeId) {
      dataHealthNotices.push(makeDataHealthNotice({
        type: "unmapped_active_account",
        severity: "warning",
        title: "活跃广告账户未绑定店铺",
        message: "该账户当前周期有广告消耗或投放数据，但未绑定店铺。账户级广告表现仍可分析；绑定店铺后可计算店铺 ROAS 和订单承接。",
        entityType: "account",
        entityId: metrics.accountId,
        metrics
      }));
      return;
    }

    if (metrics.spend > 50 && metrics.roas < 1.2) {
      cards.push(makeAccountCard("account_roas_low", metrics.accountId, account.fb_account_name || undefined, metrics, params.startDate, params.endDate));
    }

    if (metrics.spend > 30 && metrics.purchases >= 2 && metrics.roas >= 1.6) {
      cards.push(makeAccountCard("account_scale_candidate", metrics.accountId, account.fb_account_name || undefined, metrics, params.startDate, params.endDate));
    }

    if (metrics.clicks >= 50 && metrics.purchases === 0) {
      cards.push(makeAccountCard("account_clicks_no_purchase", metrics.accountId, account.fb_account_name || undefined, metrics, params.startDate, params.endDate));
    }
  });

  const storeResult = await getStoreMetrics(params, groupedMetrics);
  dataHealthNotices.push(...storeResult.dataHealthNotices);

  storeResult.activeStores.forEach((storeMetrics) => {
    if (storeMetrics.mappedAccountCount === 0 && storeMetrics.ordersCount > 0) {
      return;
    }

    if (storeMetrics.adSpend > 0 && storeMetrics.realRoas < 1.3) {
      cards.push(makeStoreCard("store_roas_low", storeMetrics, params.startDate, params.endDate));
    }

    if (storeMetrics.ordersCount > 0 && storeMetrics.realRoas >= 1.6) {
      cards.push(makeStoreCard("store_active_growth", storeMetrics, params.startDate, params.endDate));
    }
  });

  const sortedCards = cards.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority];
  });
  const enhancedCards = await enhanceCardsWithAi(sortedCards);
  const aiEnabled = !isAiProviderRuntimeDisabled();

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    dateRange: { startDate: params.startDate, endDate: params.endDate },
    aiSummary: buildOverviewSummary(enhancedCards, dataHealthNotices, aiEnabled),
    coverage: {
      activeAccountsScanned: activeMetrics.length,
      activeStoresScanned: storeResult.activeStores.length,
      businessCardsGenerated: enhancedCards.length,
      dataHealthNotices: dataHealthNotices.length
    },
    cards: enhancedCards,
    dataHealthNotices,
    aiRuntime: {
      enabled: aiEnabled,
      mode: aiEnabled ? "ai_model" : "rule_fallback"
    }
  };
}

async function buildManualAccountCard(params: AiManualAnalysisParams): Promise<AiWorkbenchCard> {
  const rows = await prisma.factMetaPerformance.findMany({
    where: {
      level: "account",
      account_id: params.entityId,
      date: { gte: params.startDate, lte: params.endDate }
    }
  });
  const metrics = summarizeRows(rows, params.entityId);
  const account = await prisma.adAccount.findUnique({
    where: { fb_account_id: params.entityId },
    select: { fb_account_name: true }
  });

  if (metrics.spend > 50 && metrics.roas < 1.2) {
    return { ...makeAccountCard("manual_account_roas_low", params.entityId, account?.fb_account_name || undefined, metrics, params.startDate, params.endDate), source: "manual" };
  }

  if (metrics.spend > 30 && metrics.purchases >= 2 && metrics.roas >= 1.6) {
    return { ...makeAccountCard("manual_account_scale_candidate", params.entityId, account?.fb_account_name || undefined, metrics, params.startDate, params.endDate), source: "manual" };
  }

  return {
    id: buildId("manual", params.entityId, params.analysisType),
    source: "manual",
    analysisType: params.analysisType,
    entityType: "account",
    entityId: params.entityId,
    entityName: account?.fb_account_name || undefined,
    priority: metrics.spend > 0 ? "medium" : "low",
    title: metrics.spend > 0 ? "广告账户人工分析" : "该账户当前周期暂无明显投放数据",
    summary: metrics.spend > 0
      ? `账户当前周期花费 $${metrics.spend.toFixed(2)}，购买 ${metrics.purchases} 次，ROAS ${metrics.roas.toFixed(2)}x。`
      : "当前日期范围内没有发现该账户的有效消耗、曝光或点击数据。",
    evidence: {
      startDate: params.startDate,
      endDate: params.endDate,
      metrics,
      dataSources: ["FactMetaPerformance", "AdAccount"]
    },
    recommendation: {
      judgment: metrics.spend > 0 ? "账户有可分析投放数据，应结合购买和点击质量判断下一步。" : "当前样本不足，不能给出扩量或降预算结论。",
      action: metrics.spend > 0 ? "查看高消耗广告组的购买、CPA 和素材表现。" : "先同步数据或扩大日期范围后再分析。",
      budgetAction: metrics.spend > 0 ? "暂不做大幅调整，单次预算变动控制在 10%-15%。" : "不建议调整预算。",
      observationWindow: "观察 24-72 小时。",
      riskControl: "避免在数据不足时做结构性调整。",
      nextCheck: "复查 FactMetaPerformance 是否覆盖所选日期范围。"
    },
    aiMode: "rule_fallback",
    createdAt: new Date().toISOString()
  };
}

async function buildManualStoreCard(params: AiManualAnalysisParams): Promise<AiWorkbenchCard> {
  const storeId = Number(params.entityId);
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true } });
  const accountRows = await getAccountRows({ startDate: params.startDate, endDate: params.endDate });
  const accountMetrics = groupAccountMetrics(accountRows);
  const result = await getStoreMetrics({ startDate: params.startDate, endDate: params.endDate, storeId }, accountMetrics);
  const metrics = result.activeStores[0] || {
    storeId,
    storeName: store?.name || `Store ${storeId}`,
    ordersCount: 0,
    revenue: 0,
    adSpend: 0,
    mappedAccountCount: 0,
    realRoas: 0
  };

  if (metrics.adSpend > 0 && metrics.realRoas < 1.3) {
    return { ...makeStoreCard("manual_store_roas_low", metrics, params.startDate, params.endDate), source: "manual" };
  }

  if (metrics.ordersCount > 0 && metrics.realRoas >= 1.6) {
    return { ...makeStoreCard("manual_store_active_growth", metrics, params.startDate, params.endDate), source: "manual" };
  }

  return {
    id: buildId("manual", params.entityId, params.analysisType),
    source: "manual",
    analysisType: params.analysisType,
    entityType: "store",
    entityId: params.entityId,
    entityName: metrics.storeName,
    priority: metrics.ordersCount > 0 || metrics.adSpend > 0 ? "medium" : "low",
    title: "店铺人工分析",
    summary: `店铺当前周期有效订单 ${metrics.ordersCount} 笔，收入 $${metrics.revenue.toFixed(2)}，广告花费 $${metrics.adSpend.toFixed(2)}。`,
    evidence: {
      startDate: params.startDate,
      endDate: params.endDate,
      metrics: {
        ...metrics,
        spend: metrics.adSpend,
        roas: metrics.realRoas
      },
      dataSources: ["Store", "Order", "AccountMapping", "FactMetaPerformance"]
    },
    recommendation: {
      judgment: metrics.ordersCount > 0 || metrics.adSpend > 0 ? "店铺有经营信号，可继续拆分广告与订单承接。" : "当前店铺在所选日期范围内没有足够经营数据。",
      action: metrics.ordersCount > 0 ? "对照订单 SKU 与绑定广告账户消耗，确认主要增长来源。" : "先同步订单和广告事实表，再做店铺经营判断。",
      budgetAction: metrics.realRoas >= 1.3 ? "如需测试，单次预算调整不超过 15%。" : "暂不建议扩量。",
      observationWindow: "观察 2-3 天。",
      riskControl: "避免只看订单或只看广告花费，必须使用店铺收入与广告消耗一起判断。",
      nextCheck: "复查店铺绑定账户、订单本地日期和退款状态。"
    },
    aiMode: "rule_fallback",
    createdAt: new Date().toISOString()
  };
}

async function buildManualCreativeCard(params: AiManualAnalysisParams): Promise<AiWorkbenchCard> {
  const rows = await prisma.factMetaPerformance.findMany({
    where: {
      level: "ad",
      date: { gte: params.startDate, lte: params.endDate },
      OR: [
        { creative_id: params.entityId },
        { ad_id: params.entityId },
        { entity_id: params.entityId }
      ]
    }
  });
  const metrics = summarizeRows(rows, params.entityId);
  return {
    id: buildId("manual", params.entityId, params.analysisType),
    source: "manual",
    analysisType: params.analysisType,
    entityType: "creative",
    entityId: params.entityId,
    priority: metrics.spend > 50 && metrics.purchases === 0 ? "high" : "medium",
    title: "素材表现人工分析",
    summary: `素材相关广告当前周期花费 $${metrics.spend.toFixed(2)}，点击 ${metrics.clicks} 次，购买 ${metrics.purchases} 次，ROAS ${metrics.roas.toFixed(2)}x。`,
    evidence: {
      startDate: params.startDate,
      endDate: params.endDate,
      metrics,
      dataSources: ["FactMetaPerformance level=ad"]
    },
    recommendation: {
      judgment: metrics.spend > 0 ? "素材有可分析投放数据，应重点看点击后购买承接。" : "当前素材没有足够事实数据，不能判断疲劳或扩量。",
      action: metrics.purchases > 0 ? "保留产生购买的素材，复制相近卖点做小预算测试。" : "检查素材卖点、落地页一致性和受众匹配度。",
      budgetAction: metrics.purchases > 0 ? "测试预算控制在原素材预算的 10%-15%。" : "无购买素材先暂停加预算。",
      observationWindow: "观察 48 小时。",
      riskControl: "避免只依据 CTR 判断素材质量，必须结合购买或加购信号。",
      nextCheck: "复查 creative_id/ad_id 对应的广告层事实数据。"
    },
    aiMode: "rule_fallback",
    createdAt: new Date().toISOString()
  };
}

async function buildManualSystemCard(params: AiManualAnalysisParams): Promise<AiWorkbenchCard> {
  const rows = await getAccountRows({ startDate: params.startDate, endDate: params.endDate });
  const metricsByAccount = groupAccountMetrics(rows);
  const activeAccounts = Array.from(metricsByAccount.values()).filter(isActiveAccount);
  const adAccounts = activeAccounts.length > 0
    ? await prisma.adAccount.findMany({
        where: { fb_account_id: { in: activeAccounts.map((item) => item.accountId) } },
        select: { fb_account_id: true, storeId: true }
      })
    : [];
  const mapped = new Map(adAccounts.map((account) => [account.fb_account_id, account.storeId]));
  const unmappedActiveAccounts = activeAccounts.filter((item) => !mapped.get(item.accountId)).length;

  return {
    id: buildId("manual", params.entityId, params.analysisType),
    source: "manual",
    analysisType: params.analysisType,
    entityType: "system",
    entityId: params.entityId || "system",
    priority: unmappedActiveAccounts > 0 ? "medium" : "low",
    title: "数据健康人工分析",
    summary: `当前周期活跃账户 ${activeAccounts.length} 个，其中未绑定店铺的活跃账户 ${unmappedActiveAccounts} 个。`,
    evidence: {
      startDate: params.startDate,
      endDate: params.endDate,
      metrics: {
        activeAccounts: activeAccounts.length,
        unmappedActiveAccounts,
        factRows: rows.length
      },
      dataSources: ["FactMetaPerformance", "AdAccount", "AccountMapping"]
    },
    recommendation: {
      judgment: unmappedActiveAccounts > 0 ? "存在活跃账户未绑定店铺，店铺级 ROAS 会缺失承接关系。" : "当前活跃账户绑定关系未发现明显阻断。",
      action: unmappedActiveAccounts > 0 ? "先在配置中心完成账户与真实店铺绑定，再判断店铺级经营成效。" : "继续保持账户绑定巡检，并检查 Fact 数据同步完整性。",
      budgetAction: "数据健康类问题不直接调整预算。",
      observationWindow: "每次同步后复查。",
      riskControl: "不要把绑定缺失当作业务扩量建议，避免误导投放操作。",
      nextCheck: "复查 AccountMapping、AdAccount.storeId 和 FactMetaPerformance 覆盖日期。"
    },
    aiMode: "rule_fallback",
    createdAt: new Date().toISOString()
  };
}

export async function runManualAiAnalysis(params: AiManualAnalysisParams): Promise<{
  success: true;
  card: AiWorkbenchCard;
  aiRuntime: { enabled: boolean; mode: "ai_model" | "rule_fallback" };
}> {
  let card: AiWorkbenchCard;

  if (params.entityType === "account") {
    card = await buildManualAccountCard(params);
  } else if (params.entityType === "store") {
    card = await buildManualStoreCard(params);
  } else if (params.entityType === "creative") {
    card = await buildManualCreativeCard(params);
  } else {
    card = await buildManualSystemCard(params);
  }

  const [enhancedCard] = await enhanceCardsWithAi([card]);
  const aiEnabled = !isAiProviderRuntimeDisabled();

  return {
    success: true,
    card: enhancedCard,
    aiRuntime: {
      enabled: aiEnabled,
      mode: aiEnabled ? "ai_model" : "rule_fallback"
    }
  };
}

export async function runAiCardFollowUp(params: AiFollowUpParams): Promise<{
  success: true;
  answer: string;
  aiMode: "ai_model" | "rule_fallback";
  createdAt: string;
}> {
  const createdAt = new Date().toISOString();

  if (!isAiProviderRuntimeDisabled()) {
    const completion = await completeWithConfiguredAi({
      purpose: "chat",
      system: "你是跨境电商 Meta 广告投放诊断助手。请基于既有诊断卡片回答运营追问，只给人工可执行建议，不要声称已经修改广告账户。",
      user: JSON.stringify({
        question: params.question,
        evidence: params.card.evidence,
        recommendation: params.card.recommendation,
        cardTitle: params.card.title,
        entityType: params.card.entityType,
        entityId: params.card.entityId
      })
    });

    if (completion?.text) {
      return {
        success: true,
        answer: completion.text,
        aiMode: "ai_model",
        createdAt
      };
    }
  }

  const metrics = params.card.evidence.metrics || {};
  const answer = [
    "当前使用规则兜底回答。",
    `基于卡片「${params.card.title}」，优先判断为：${params.card.recommendation.judgment}`,
    `针对你的问题「${params.question}」，建议先执行：${params.card.recommendation.action}`,
    `操作幅度：${params.card.recommendation.budgetAction || "本轮不建议做大幅预算变动。"}`,
    `观察周期：${params.card.recommendation.observationWindow}`,
    `风险控制：${params.card.recommendation.riskControl}`,
    `下一步检查：${params.card.recommendation.nextCheck}`,
    `关键指标：spend=${toNumber(metrics.spend).toFixed(2)}, roas=${toNumber(metrics.roas || metrics.realRoas).toFixed(2)}, purchases=${toNumber(metrics.purchases)}, orders=${toNumber(metrics.ordersCount)}。`
  ].join("\n");

  return {
    success: true,
    answer,
    aiMode: "rule_fallback",
    createdAt
  };
}
