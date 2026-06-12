import type { Prisma } from "@prisma/client";
import { evaluateMediaBuyingSignals } from "../../packages/analytics/src/media-buyer-rules.js";
import { prisma } from "../db/prisma.js";
import { getAccountSpendReport } from "./account-spend.js";
import { getCountryAnalysis, getProductAnalysis, getStoreOverviewAnalysis } from "./analysis.js";

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function priorityForRealRoas(realRoas: number | null, spend: number, orders: number): 1 | 2 | 3 | 4 | 5 {
  const roas = realRoas ?? 0;
  if (spend >= 50 && orders === 0) return 1;
  if (spend >= 30 && roas > 0 && roas < 1) return 1;
  if (roas >= 2.5 && orders >= 5) return 2;
  if (roas >= 1.5 && orders > 0) return 4;
  return 3;
}

async function reportExists(entityType: string, entityId: string, since: Date): Promise<boolean> {
  const existing = await prisma.aiAnalysisReport.findFirst({
    where: {
      type: "anomaly",
      entityType,
      entityId,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function createSuggestionReport(input: {
  entityType: string;
  entityId: string;
  entityLabel: string;
  dateRange: Prisma.InputJsonValue;
  conclusion: string;
  dataBasis: Prisma.InputJsonValue;
  riskPoints: string[];
  priority: 1 | 2 | 3 | 4 | 5;
  observationWindow: string;
  action: string;
  rationale: string;
  checklist: string[];
  metadata?: Prisma.InputJsonObject;
}): Promise<void> {
  await prisma.aiAnalysisReport.create({
    data: {
      type: "anomaly",
      entityType: input.entityType,
      entityId: input.entityId,
      dateRange: input.dateRange,
      conclusion: input.conclusion,
      dataBasis: input.dataBasis,
      riskPoints: input.riskPoints,
      priority: input.priority,
      observationWindow: input.observationWindow,
      model: "local-real-roas-rule-engine",
      metadata: {
        entityLabel: input.entityLabel,
        generatedBy: "real-roas-rule-monitor",
        ...(input.metadata ?? {}),
      },
      suggestions: {
        create: [{
          action: input.action,
          rationale: input.rationale,
          priority: input.priority,
          executionChecklist: input.checklist,
        }],
      },
    },
  });
}

export async function runMediaBuyingRuleMonitor() {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(until.getUTCDate() - 6);
  const report = await getAccountSpendReport({
    since: dateOnly(since),
    until: dateOnly(until),
  });

  let reportsCreated = 0;
  for (const account of report.accounts) {
    const signals = evaluateMediaBuyingSignals({
      spend: account.spend,
      impressions: account.impressions,
      clicks: account.clicks,
      purchases: account.purchases,
      purchaseValue: account.purchaseValue,
      ctr: account.ctr,
      cpc: account.cpc,
      cpm: account.cpm,
      roas: account.roas,
    });
    const actionable = signals.filter((signal) => signal.code !== "observe");
    if (actionable.length === 0) continue;

    const existing = await prisma.aiAnalysisReport.findFirst({
      where: {
        type: "anomaly",
        entityType: "ad_account",
        entityId: account.id,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing) continue;

    const sorted = actionable.sort((a, b) => a.priority - b.priority);
    const top = sorted[0];
    const signalPayload = sorted.map((signal) => ({
      code: signal.code,
      severity: signal.severity,
      priority: signal.priority,
      conclusion: signal.conclusion,
      suggestedAction: signal.suggestedAction,
      observationWindow: signal.observationWindow,
    }));

    await prisma.aiAnalysisReport.create({
      data: {
        type: "anomaly",
        entityType: "ad_account",
        entityId: account.id,
        dateRange: report.range,
        conclusion: top.conclusion,
        dataBasis: {
          spend: account.spend,
          impressions: account.impressions,
          clicks: account.clicks,
          purchases: account.purchases,
          roas: account.roas,
        },
        riskPoints: signalPayload.map((signal) => signal.conclusion),
        priority: top.priority,
        observationWindow: top.observationWindow,
        model: "local-rule-engine",
        metadata: { signals: signalPayload } satisfies Prisma.InputJsonObject,
        suggestions: {
          create: sorted.map((signal) => ({
            action: signal.suggestedAction,
            rationale: signal.conclusion,
            priority: signal.priority,
            executionChecklist: [
              "打开账户分析页核对最近数据日。",
              "查看 Campaign / Ad Set / Ad 层级数据。",
              "由运营人员在 Meta 后台人工确认并执行调整。",
            ],
          })),
        },
      },
    });
    reportsCreated++;
  }

  const storeResult = await runStoreRealRoasRuleMonitor({ since: dateOnly(since), until: dateOnly(until), dedupeSince: since });

  return {
    scanned: report.accounts.length + storeResult.scanned,
    accountReportsCreated: reportsCreated,
    storeReportsCreated: storeResult.reportsCreated,
    reportsCreated: reportsCreated + storeResult.reportsCreated,
  };
}

async function runStoreRealRoasRuleMonitor(input: { since: string; until: string; dedupeSince: Date }) {
  const stores = await prisma.store.findMany({
    where: { status: "active" },
    select: { id: true, name: true, platform: true, domain: true },
    take: 100,
  });
  let reportsCreated = 0;

  for (const store of stores) {
    const overview = await getStoreOverviewAnalysis({ storeId: store.id, since: input.since, until: input.until });
    const metrics = overview.metrics;
    const storeLabel = `${store.name} / ${store.platform} / ${store.domain}`;
    const realRoas = metrics.realRoas === null ? null : numberValue(metrics.realRoas);
    const metaRoas = metrics.metaRoas === null ? null : numberValue(metrics.metaRoas);
    const spend = numberValue(metrics.adSpend);
    const orders = numberValue(metrics.storeOrderCount);
    const sales = numberValue(metrics.storeSales);
    const orderGap = numberValue(metrics.orderGap);

    const storeActions: Array<{
      code: string;
      conclusion: string;
      action: string;
      priority: 1 | 2 | 3 | 4 | 5;
      riskPoints: string[];
    }> = [];

    if ((overview.mappedAdAccounts?.length ?? 0) === 0) {
      storeActions.push({
        code: "store_without_mapped_accounts",
        conclusion: "店铺还没有绑定 Meta 广告账户，无法计算真实 ROAS。",
        action: "建议先完成店铺-广告账户映射，再同步订单和广告数据。",
        priority: 1,
        riskPoints: ["未绑定广告账户时，店铺销售额无法和广告花费归因到同一个经营单元。"],
      });
    }
    if (spend > 0 && orders === 0) {
      storeActions.push({
        code: "store_spend_no_orders",
        conclusion: "店铺有广告花费但没有真实订单，转化链路或投放方向存在明显风险。",
        action: "建议暂停扩量，优先检查落地页、支付、国家和素材承接。",
        priority: 1,
        riskPoints: ["仅有 Meta 消耗但没有店铺订单，继续扩量风险较高。"],
      });
    }
    if (spend >= 30 && realRoas !== null && realRoas > 0 && realRoas < 1) {
      storeActions.push({
        code: "store_low_real_roas",
        conclusion: `店铺真实 ROAS 为 ${realRoas.toFixed(2)}，低于盈亏安全线。`,
        action: "建议降低低效账户或低效国家预算，并优先排查产品、素材和支付链路。",
        priority: 1,
        riskPoints: ["Meta ROAS 不能替代真实 ROAS，预算决策应优先看店铺销售额。"],
      });
    }
    if (Math.abs(orderGap) >= 5 && orders > 0 && Math.abs(orderGap) / orders >= 0.3) {
      storeActions.push({
        code: "store_attribution_gap",
        conclusion: "真实订单与 Meta 归因订单差异较大，存在漏归因或虚高归因风险。",
        action: "建议核对 Pixel/CAPI、UTM、店铺映射、国家维度和订单同步范围。",
        priority: 2,
        riskPoints: ["归因差异过大时，不应只按 Meta 平台归因做预算动作。"],
      });
    }
    if (realRoas !== null && realRoas >= 2.5 && orders >= 5) {
      storeActions.push({
        code: "store_scale_candidate",
        conclusion: `店铺真实 ROAS 为 ${realRoas.toFixed(2)}，订单样本具备扩量参考价值。`,
        action: "建议小幅加预算，并优先复制表现好的国家、产品和素材方向。",
        priority: 2,
        riskPoints: ["扩量建议仍需人工确认，避免单日波动导致过快加预算。"],
      });
    }

    if (storeActions.length > 0 && !(await reportExists("store", store.id, input.dedupeSince))) {
      const top = storeActions.sort((a, b) => a.priority - b.priority)[0];
      await createSuggestionReport({
        entityType: "store",
        entityId: store.id,
        entityLabel: storeLabel,
        dateRange: overview.range as Prisma.InputJsonValue,
        conclusion: top.conclusion,
        dataBasis: metrics as Prisma.InputJsonValue,
        riskPoints: top.riskPoints,
        priority: top.priority,
        observationWindow: "3 天，必要时复盘 7 天和 30 天趋势",
        action: top.action,
        rationale: overview.coreProblemSummary,
        checklist: [
          "打开店铺真实 ROAS 页面，确认订单和广告数据已同步。",
          "检查店铺-广告账户映射是否完整。",
          "按国家、产品、素材维度定位真实 ROAS 的主要来源。",
          "所有预算和结构动作由运营在 Meta 后台人工确认执行。",
        ],
        metadata: { code: top.code, storeId: store.id },
      });
      reportsCreated++;
    }

    reportsCreated += await createCountrySuggestions(store, input);
    reportsCreated += await createProductSuggestions(store, input);
  }

  return { scanned: stores.length, reportsCreated };
}

async function createCountrySuggestions(
  store: { id: string; name: string; platform: string; domain: string },
  input: { since: string; until: string; dedupeSince: Date },
): Promise<number> {
  const report = await getCountryAnalysis({ storeId: store.id, since: input.since, until: input.until });
  let created = 0;
  for (const country of (report.countries || []).slice(0, 8)) {
    const spend = numberValue(country.metaSpend);
    const orders = numberValue(country.storeOrderCount);
    const sales = numberValue(country.storeSales);
    const realRoas = country.realRoas === null ? null : numberValue(country.realRoas);
    const entityId = `${store.id}:${country.country}`;
    if (await reportExists("country", entityId, input.dedupeSince)) continue;

    let action: string | null = null;
    let conclusion = "";
    let priority: 1 | 2 | 3 | 4 | 5 = priorityForRealRoas(realRoas, spend, orders);
    if (spend >= 50 && orders === 0) {
      conclusion = `${country.country} 有花费但没有真实订单。`;
      action = "建议排除或显著降预算该国家，先检查落地页语言、支付方式和物流承接。";
      priority = 1;
    } else if (realRoas !== null && realRoas >= 2.5 && orders >= 3) {
      conclusion = `${country.country} 真实 ROAS 为 ${realRoas.toFixed(2)}，具备扩量或单独开系列价值。`;
      action = "建议单独观察该国家，测试小幅加预算或单独开国家系列。";
      priority = 2;
    } else if (spend >= 30 && realRoas !== null && realRoas > 0 && realRoas < 1) {
      conclusion = `${country.country} 真实 ROAS 为 ${realRoas.toFixed(2)}，国家效率偏低。`;
      action = "建议降低该国家预算或从现有广告组中排除观察。";
      priority = 2;
    }
    if (!action) continue;

    await createSuggestionReport({
      entityType: "country",
      entityId,
      entityLabel: `${store.name} / ${country.country}`,
      dateRange: report.range as Prisma.InputJsonValue,
      conclusion,
      dataBasis: country as Prisma.InputJsonValue,
      riskPoints: ["国家建议基于店铺真实订单和 Meta 花费交叉计算，仍需运营人工确认。"],
      priority,
      observationWindow: "3 天",
      action,
      rationale: `销售额 ${sales}，花费 ${spend}，真实订单 ${orders}。`,
      checklist: [
        "打开国家分析页确认该国家真实 ROAS。",
        "对比该国家的产品、素材、支付和物流承接。",
        "需要排除或加预算时，由运营在 Meta 后台人工执行。",
      ],
      metadata: { storeId: store.id, country: country.country },
    });
    created++;
  }
  return created;
}

async function createProductSuggestions(
  store: { id: string; name: string; platform: string; domain: string },
  input: { since: string; until: string; dedupeSince: Date },
): Promise<number> {
  const report = await getProductAnalysis({ storeId: store.id, since: input.since, until: input.until });
  let created = 0;
  for (const product of (report.products || []).slice(0, 8)) {
    const orderCount = numberValue(product.orderCount);
    const sales = numberValue(product.sales);
    if (orderCount < 3 || sales <= 0) continue;
    const productKey = product.sku || product.productId || product.productName;
    const entityId = `${store.id}:${productKey}`;
    if (await reportExists("product", entityId, input.dedupeSince)) continue;

    const action = product.suitableForSingleCampaign
      ? "建议为该产品测试单独产品系列，并生成新的素材方向。"
      : product.suitableForNewCreative
        ? "建议围绕该产品补充新素材、Hook、短视频脚本和本地化文案。"
        : "建议继续混投观察，等待更多订单样本。";
    const priority: 1 | 2 | 3 | 4 | 5 = product.suitableForSingleCampaign ? 2 : 3;

    await createSuggestionReport({
      entityType: "product",
      entityId,
      entityLabel: `${store.name} / ${product.productName}${product.sku ? ` / ${product.sku}` : ""}`,
      dateRange: report.range as Prisma.InputJsonValue,
      conclusion: `产品「${product.productName}」已有 ${orderCount} 个订单，销售额 ${sales}。`,
      dataBasis: product as Prisma.InputJsonValue,
      riskPoints: ["产品建议基于店铺订单表现，不会自动创建广告或上传素材。"],
      priority,
      observationWindow: "7 天",
      action,
      rationale: `主要国家：${(product.mainCountries || []).map((item: { country: string; orders: number }) => `${item.country}:${item.orders}`).join(" / ") || "暂无"}`,
      checklist: [
        "打开产品分析页确认产品订单和主要国家。",
        "用 Creative Copilot 生成新 Hook、文案、视频脚本和图片/视频 Prompt。",
        "需要单独开系列时，由运营人工创建并控制预算。",
      ],
      metadata: { storeId: store.id, productName: product.productName, sku: product.sku ?? null },
    });
    created++;
  }
  return created;
}
