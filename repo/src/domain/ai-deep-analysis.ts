import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { completeWithConfiguredAi, type AiCompletionResponse } from "../../packages/ai/src/providers.js";
import { prisma } from "../db/prisma.js";
import { accountAnalysisQuerySchema, getAccountDetailAnalysis, type AccountAnalysisInput } from "./account-analysis.js";

type AccountDetailAnalysis = Awaited<ReturnType<typeof getAccountDetailAnalysis>>;
type AnalysisRow = AccountDetailAnalysis["campaigns"][number]
  | AccountDetailAnalysis["adsets"][number]
  | AccountDetailAnalysis["ads"][number];

export const entityDeepAnalysisSchema = accountAnalysisQuerySchema.extend({
  entityType: z.enum(["campaign", "adset", "ad", "creative"]),
  entityId: z.string().min(1),
});

export type EntityDeepAnalysisInput = z.input<typeof entityDeepAnalysisSchema>;

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function topBySpend<T extends { spend: number }>(rows: T[], limit: number): T[] {
  return [...rows].sort((a, b) => b.spend - a.spend).slice(0, limit);
}

function priorityForAction(action: string): 1 | 2 | 3 | 4 | 5 {
  if (action.includes("降预算") || action.includes("检查转化链路")) return 1;
  if (action.includes("补充素材") || action.includes("加预算")) return 2;
  if (action.includes("保持")) return 4;
  if (action.includes("观察")) return 5;
  return 3;
}

function compactMetricRow(row: Record<string, unknown>) {
  return {
    id: row.campaignId ?? row.adsetId ?? row.adId ?? "",
    name: row.campaignName ?? row.adsetName ?? row.adName ?? "",
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    cpc: row.cpc,
    cpm: row.cpm,
    purchases: row.purchases,
    roas: row.roas,
    action: row.action,
    creativeJudgement: row.creativeJudgement,
    suggestions: row.suggestions,
  };
}

function actionForRow(scope: string, row: AnalysisRow): string {
  const record = row as Record<string, unknown>;
  const id = record.campaignId ?? record.adsetId ?? record.adId ?? "";
  const name = record.campaignName ?? record.adsetName ?? record.adName ?? "";
  return `${scope}「${name || id}」：${row.action}`;
}

function rowName(row: AnalysisRow): string {
  const record = row as Record<string, unknown>;
  return String(record.campaignName ?? record.adsetName ?? record.adName ?? record.campaignId ?? record.adsetId ?? record.adId ?? "");
}

function rationaleForRow(row: AnalysisRow): string {
  if (Array.isArray(row.suggestions) && row.suggestions.length > 0) {
    return row.suggestions.join("；");
  }
  return `消耗 ${row.spend}，购买 ${row.purchases}，ROAS ${row.roas ?? "N/A"}。`;
}

function rowChecklist(scope: string): string[] {
  return [
    `打开账户分析页，定位这条 ${scope} 的最近 7 天和 30 天走势。`,
    "核对国家、素材、落地页与转化链路，避免只凭单日波动执行。",
    "所有预算、暂停、排除、拆系列动作都由运营在 Meta 后台人工确认后执行。",
  ];
}

function buildStructuredPrompt(analysis: AccountDetailAnalysis) {
  return {
    instruction: "只基于这些只读数据输出投放建议，禁止写入或自动执行广告操作。",
    requiredOutput: ["结论", "建议动作", "数据依据", "风险点", "优先级", "观察周期", "执行清单"],
    account: analysis.account,
    range: analysis.range,
    overview: analysis.overview,
    dataQuality: analysis.dataQuality,
    accountAdvice: analysis.advice,
    countries: topBySpend(analysis.countries, 10),
    campaigns: topBySpend(analysis.campaigns, 10).map(compactMetricRow),
    adsets: topBySpend(analysis.adsets, 10).map(compactMetricRow),
    ads: topBySpend(analysis.ads, 15).map(compactMetricRow),
  };
}

function systemPrompt(): string {
  return [
    "你是 AI Media Buyer Copilot。",
    "你只能基于只读广告和订单数据给出建议，不能创建、修改、暂停、删除广告，也不能上传素材。",
    "请用中文输出结构化深度分析，必须包含：结论、建议动作、数据依据、风险点、优先级、观察周期、执行清单。",
    "涉及加预算、降预算、排除国家、拆系列、替换素材时，必须明确写成“建议”，并说明需要运营人工确认。",
  ].join("\n");
}

function fallbackNarrative(analysis: AccountDetailAnalysis): string {
  return [
    `结论：账户 ${analysis.account.accountId} 当前消耗 ${analysis.overview.spend}，Meta ROAS ${analysis.overview.roas ?? "N/A"}，归因订单 ${analysis.overview.purchases}。`,
    `建议动作：${analysis.advice.suggestedActions.join("；")}`,
    `数据依据：展示 ${analysis.overview.impressions}，点击 ${analysis.overview.clicks}，CTR ${analysis.overview.ctr ?? "N/A"}%，CPC ${analysis.overview.cpc ?? "N/A"}，CPM ${analysis.overview.cpm ?? "N/A"}。`,
    `风险点：${analysis.advice.riskWarnings.join("；")}`,
    "优先级：按高消耗低转化、高点击无购买、素材疲劳、可扩量对象依次处理。",
    "观察周期：建议至少观察 3 天，并和 7 天、30 天趋势对比。",
    `执行清单：${analysis.advice.operatorChecklist.join("；")}`,
  ].join("\n");
}

async function runDeepAiCompletion(analysis: AccountDetailAnalysis): Promise<{
  completion: AiCompletionResponse | null;
  text: string;
  error?: string;
}> {
  try {
    const completion = await completeWithConfiguredAi({
      purpose: "analysis",
      system: systemPrompt(),
      user: JSON.stringify(buildStructuredPrompt(analysis), null, 2),
    });
    return {
      completion,
      text: completion?.text || fallbackNarrative(analysis),
    };
  } catch (error) {
    return {
      completion: null,
      text: fallbackNarrative(analysis),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runEntityAiCompletion(input: {
  analysis: AccountDetailAnalysis;
  entityType: z.infer<typeof entityDeepAnalysisSchema>["entityType"];
  row: AnalysisRow;
  relatedRows: Record<string, unknown>;
}): Promise<{ completion: AiCompletionResponse | null; text: string; error?: string }> {
  const fallback = [
    `结论：${input.entityType}「${rowName(input.row)}」当前消耗 ${input.row.spend}，购买 ${input.row.purchases}，ROAS ${input.row.roas ?? "N/A"}，建议为：${input.row.action}。`,
    `建议动作：${rationaleForRow(input.row)}`,
    "数据依据：报告已写入当前对象的消耗、点击、CTR、CPC、CPM、购买、ROAS 和相关下级对象。",
    "风险点：所有调整都必须由运营人工确认；不要只凭单日波动执行预算或暂停动作。",
    `优先级：P${priorityForAction(input.row.action)}`,
    "观察周期：建议观察 3 天，并对比 7 天和 30 天趋势。",
    `执行清单：${rowChecklist(input.entityType).join("；")}`,
  ].join("\n");

  try {
    const completion = await completeWithConfiguredAi({
      purpose: "analysis",
      system: systemPrompt(),
      user: JSON.stringify({
        instruction: "请对单个广告实体做深度投放分析，只输出建议，不执行动作。",
        account: input.analysis.account,
        range: input.analysis.range,
        entityType: input.entityType,
        entity: compactMetricRow(input.row as unknown as Record<string, unknown>),
        relatedRows: input.relatedRows,
        requiredOutput: ["结论", "建议动作", "数据依据", "风险点", "优先级", "观察周期", "执行清单"],
      }, null, 2),
    });
    return { completion, text: completion?.text || fallback };
  } catch (error) {
    return {
      completion: null,
      text: fallback,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function actionableRows<T extends AnalysisRow>(rows: T[], limit: number): T[] {
  const filtered = rows.filter((row) => !["继续观察", "观察", "建议保持"].includes(row.action));
  return topBySpend(filtered.length > 0 ? filtered : rows, limit);
}

function buildSuggestionPayloads(analysis: AccountDetailAnalysis) {
  if (analysis.dataQuality.status === "missing") {
    return [{
      action: "先补齐账户 Insights 数据，再生成投放动作建议。",
      rationale: analysis.dataQuality.warnings.join("；") || "当前账户缺少核心消耗与转化数据。",
      priority: 1 as const,
      executionChecklist: [
        "在账户深度分析页点击“同步 Meta 数据”。",
        "确认时间范围内有 spend、impressions、clicks、purchases 和 purchaseValue。",
        "同步完成后重新生成账户级 AI 深度分析。",
      ],
    }];
  }

  if (analysis.dataQuality.status === "partial") {
    const dataFixActions = analysis.dataQuality.warnings.slice(0, 3).map((warning) => ({
      action: "补齐分析数据：" + warning,
      rationale: "当前分析可以参考，但部分数据缺失会影响 AI 对结构、素材或最新趋势的判断。",
      priority: 2 as const,
      executionChecklist: [
        "优先补同步 Meta 结构、Insights、素材快照。",
        "刷新账户数据质量状态，确认从“部分数据缺失”变为“数据可分析”。",
        "再对高消耗 Campaign、Ad Set、Ad 生成深度分析。",
      ],
    }));
    if (dataFixActions.length > 0) {
      return dataFixActions;
    }
  }

  const accountActions = analysis.advice.suggestedActions.slice(0, 4).map((action) => ({
    action,
    rationale: analysis.advice.currentConclusion,
    priority: priorityForAction(action),
    executionChecklist: analysis.advice.operatorChecklist,
  }));

  const campaignActions = actionableRows(analysis.campaigns, 4).map((row) => ({
    action: actionForRow("Campaign", row),
    rationale: rationaleForRow(row),
    priority: priorityForAction(row.action),
    executionChecklist: rowChecklist("Campaign"),
  }));

  const adsetActions = actionableRows(analysis.adsets, 4).map((row) => ({
    action: actionForRow("Ad Set", row),
    rationale: rationaleForRow(row),
    priority: priorityForAction(row.action),
    executionChecklist: rowChecklist("Ad Set"),
  }));

  const adActions = actionableRows(analysis.ads, 6).map((row) => ({
    action: actionForRow("Ad", row),
    rationale: `${rationaleForRow(row)}${row.creativeJudgement ? `；素材判断：${row.creativeJudgement}` : ""}`,
    priority: priorityForAction(row.action),
    executionChecklist: rowChecklist("Ad"),
  }));

  const suggestions = [...accountActions, ...campaignActions, ...adsetActions, ...adActions]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 18);

  if (suggestions.length > 0) return suggestions;
  return [{
    action: "继续观察账户表现，等待更多转化样本后再做结构调整。",
    rationale: analysis.advice.currentConclusion,
    priority: 5 as const,
    executionChecklist: analysis.advice.operatorChecklist,
  }];
}

export async function createAdAccountDeepAnalysisReport(input: AccountAnalysisInput) {
  const parsed = accountAnalysisQuerySchema.parse(input);
  const analysis = await getAccountDetailAnalysis(parsed);
  const ai = await runDeepAiCompletion(analysis);
  const suggestions = buildSuggestionPayloads(analysis);
  const highestPriority = suggestions.reduce((min, item) => Math.min(min, item.priority), 5);

  const report = await prisma.aiAnalysisReport.create({
    data: {
      type: "media_buyer",
      entityType: "ad_account",
      entityId: analysis.account.id,
      dateRange: toJson(analysis.range),
      conclusion: analysis.advice.currentConclusion,
      dataBasis: toJson({
        overview: analysis.overview,
        dataQuality: analysis.dataQuality,
        account: analysis.account,
        countries: topBySpend(analysis.countries, 10),
        campaigns: topBySpend(analysis.campaigns, 10).map(compactMetricRow),
        adsets: topBySpend(analysis.adsets, 10).map(compactMetricRow),
        ads: topBySpend(analysis.ads, 15).map(compactMetricRow),
      }),
      riskPoints: toJson(analysis.advice.riskWarnings),
      priority: highestPriority,
      observationWindow: "3 天，必要时复盘 7 天和 30 天趋势",
      model: ai.completion ? `${ai.completion.provider}:${ai.completion.model}` : "local-structured-analysis",
      metadata: toJson({
        generatedBy: "ad-account-deep-analysis",
        structuredAdvice: analysis.advice,
        aiNarrative: ai.text,
        aiError: ai.error,
        detailCounts: {
          countries: analysis.countries.length,
          campaigns: analysis.campaigns.length,
          adsets: analysis.adsets.length,
          ads: analysis.ads.length,
        },
      }),
      suggestions: {
        create: suggestions.map((suggestion) => ({
          action: suggestion.action,
          rationale: suggestion.rationale,
          priority: suggestion.priority,
          executionChecklist: toJson(suggestion.executionChecklist),
        })),
      },
    },
    include: {
      suggestions: true,
    },
  });

  return {
    reportId: report.id,
    suggestionsCreated: report.suggestions.length,
    provider: ai.completion?.provider ?? "rules",
    model: ai.completion?.model ?? "local-structured-analysis",
    aiError: ai.error,
  };
}

function findEntityRow(
  analysis: AccountDetailAnalysis,
  entityType: z.infer<typeof entityDeepAnalysisSchema>["entityType"],
  entityId: string,
): AnalysisRow {
  if (entityType === "campaign") {
    const row = analysis.campaigns.find((item) => item.campaignId === entityId);
    if (!row) throw new Error("Campaign analysis row not found");
    return row;
  }
  if (entityType === "adset") {
    const row = analysis.adsets.find((item) => item.adsetId === entityId);
    if (!row) throw new Error("Ad Set analysis row not found");
    return row;
  }
  if (entityType === "creative") {
    const row = analysis.ads.find((item) => item.creativeId === entityId);
    if (!row) throw new Error("Creative analysis row not found");
    return row;
  }
  const row = analysis.ads.find((item) => item.adId === entityId);
  if (!row) throw new Error("Ad analysis row not found");
  return row;
}

function relatedRowsForEntity(
  analysis: AccountDetailAnalysis,
  entityType: z.infer<typeof entityDeepAnalysisSchema>["entityType"],
  row: AnalysisRow,
) {
  if (entityType === "campaign" && "campaignId" in row) {
    return {
      adsets: topBySpend(analysis.adsets.filter((item) => item.campaignId === row.campaignId), 10).map(compactMetricRow),
      ads: topBySpend(analysis.ads.filter((item) => item.campaignId === row.campaignId), 15).map(compactMetricRow),
      countries: topBySpend(analysis.countries, 10),
    };
  }
  if (entityType === "adset" && "adsetId" in row) {
    return {
      campaign: analysis.campaigns.find((item) => item.campaignId === row.campaignId) ?? null,
      ads: topBySpend(analysis.ads.filter((item) => item.adsetId === row.adsetId), 15).map(compactMetricRow),
      countries: topBySpend(analysis.countries, 10),
    };
  }
  return {
    campaign: "campaignId" in row ? analysis.campaigns.find((item) => item.campaignId === row.campaignId) ?? null : null,
    adset: "adsetId" in row ? analysis.adsets.find((item) => item.adsetId === row.adsetId) ?? null : null,
    creative: "creativeId" in row ? {
      creativeId: row.creativeId,
      title: row.title,
      body: row.body,
      linkUrl: row.linkUrl,
      creativeJudgement: row.creativeJudgement,
    } : null,
    countries: topBySpend(analysis.countries, 10),
  };
}

function suggestionPayloadsForEntity(
  entityType: z.infer<typeof entityDeepAnalysisSchema>["entityType"],
  row: AnalysisRow,
) {
  const label = entityType === "campaign" ? "Campaign" : entityType === "adset" ? "Ad Set" : entityType === "creative" ? "Creative" : "Ad";
  const sourceActions = Array.isArray(row.suggestions) && row.suggestions.length > 0 ? row.suggestions : [row.action];
  return sourceActions.slice(0, 6).map((action) => ({
    action: `${label}「${rowName(row)}」：${action}`,
    rationale: `${rationaleForRow(row)}${"creativeJudgement" in row && row.creativeJudgement ? `；素材判断：${row.creativeJudgement}` : ""}`,
    priority: priorityForAction(action),
    executionChecklist: rowChecklist(label),
  }));
}

export async function createEntityDeepAnalysisReport(input: EntityDeepAnalysisInput) {
  const parsed = entityDeepAnalysisSchema.parse(input);
  const analysis = await getAccountDetailAnalysis(parsed);
  const row = findEntityRow(analysis, parsed.entityType, parsed.entityId);
  const relatedRows = relatedRowsForEntity(analysis, parsed.entityType, row);
  const ai = await runEntityAiCompletion({
    analysis,
    entityType: parsed.entityType,
    row,
    relatedRows,
  });
  const suggestions = suggestionPayloadsForEntity(parsed.entityType, row);
  const highestPriority = suggestions.reduce((min, item) => Math.min(min, item.priority), 5);

  const report = await prisma.aiAnalysisReport.create({
    data: {
      type: parsed.entityType === "creative" ? "creative" : "media_buyer",
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      dateRange: toJson(analysis.range),
      conclusion: `${parsed.entityType}「${rowName(row)}」当前建议：${row.action}`,
      dataBasis: toJson({
        account: analysis.account,
        entity: compactMetricRow(row as unknown as Record<string, unknown>),
        relatedRows,
      }),
      riskPoints: toJson([
        "该报告只基于已同步的本地只读数据生成。",
        "预算、暂停、排除、拆系列、替换素材等动作必须由运营人工确认后执行。",
      ]),
      priority: highestPriority,
      observationWindow: "3 天，必要时复盘 7 天和 30 天趋势",
      model: ai.completion ? `${ai.completion.provider}:${ai.completion.model}` : "local-entity-analysis",
      metadata: toJson({
        generatedBy: "entity-deep-analysis",
        aiNarrative: ai.text,
        aiError: ai.error,
        entityType: parsed.entityType,
      }),
      suggestions: {
        create: suggestions.map((suggestion) => ({
          action: suggestion.action,
          rationale: suggestion.rationale,
          priority: suggestion.priority,
          executionChecklist: toJson(suggestion.executionChecklist),
        })),
      },
    },
    include: {
      suggestions: true,
    },
  });

  return {
    reportId: report.id,
    suggestionsCreated: report.suggestions.length,
    provider: ai.completion?.provider ?? "rules",
    model: ai.completion?.model ?? "local-entity-analysis",
    aiError: ai.error,
  };
}
