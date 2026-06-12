import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { generateCreativeBrief } from "../../packages/ai/src/creative.js";
import { prisma } from "../db/prisma.js";
import { plainMetaAccountId } from "./ad-accounts.js";

const suggestionStatusSchema = z.enum(["pending", "accepted", "rejected", "done"]);
const reportTypeSchema = z.enum(["media_buyer", "creative", "anomaly", "chat_followup"]);

export const listAiSuggestionsQuerySchema = z.object({
  status: suggestionStatusSchema.optional(),
  type: reportTypeSchema.optional(),
  entityType: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const updateAiSuggestionStatusSchema = z.object({
  status: suggestionStatusSchema,
});

export const creativeBriefFromSuggestionSchema = z.object({
  language: z.string().default("zh-CN"),
});

function checklistFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function metadataEntityLabel(metadata: Prisma.JsonValue | null | undefined): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const label = metadata.entityLabel;
  return typeof label === "string" && label.trim() ? label : undefined;
}

function metadataString(metadata: Prisma.JsonValue | null | undefined, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function creativeEntityType(entityType: string) {
  const supported = new Set(["ad", "creative", "product", "country", "campaign", "adset", "store", "ad_account"]);
  return (supported.has(entityType) ? entityType : "product") as
    | "ad"
    | "creative"
    | "product"
    | "country"
    | "campaign"
    | "adset"
    | "store"
    | "ad_account";
}

function createReportFilter(
  query: z.infer<typeof listAiSuggestionsQuerySchema>,
): Prisma.AiAnalysisReportWhereInput | undefined {
  const filter: Prisma.AiAnalysisReportWhereInput = {};
  if (query.type) filter.type = query.type;
  if (query.entityType) filter.entityType = query.entityType;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

async function buildAdAccountLabels(entityIds: string[]) {
  if (entityIds.length === 0) return new Map<string, { label: string; href: string }>();
  const accounts = await prisma.adAccount.findMany({
    where: { id: { in: [...new Set(entityIds)] } },
    select: {
      id: true,
      metaAccountId: true,
      name: true,
    },
  });
  return new Map(accounts.map((account) => [
    account.id,
    {
      label: `${plainMetaAccountId(account.metaAccountId)}${account.name ? ` / ${account.name}` : ""}`,
      href: `/admin/account-analysis?adAccountId=${encodeURIComponent(account.id)}`,
    },
  ]));
}

export async function listAiActionSuggestions(input: unknown) {
  const query = listAiSuggestionsQuerySchema.parse(input);
  const reportFilter = createReportFilter(query);
  const baseWhere: Prisma.AiActionSuggestionWhereInput = {
    report: reportFilter,
  };
  const where: Prisma.AiActionSuggestionWhereInput = {
    ...baseWhere,
    status: query.status,
  };

  const [items, counts] = await Promise.all([
    prisma.aiActionSuggestion.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: query.limit,
      include: {
        report: {
          select: {
            id: true,
            type: true,
            entityType: true,
            entityId: true,
            dateRange: true,
            conclusion: true,
            dataBasis: true,
            riskPoints: true,
            priority: true,
            observationWindow: true,
            model: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    }),
    Promise.all(suggestionStatusSchema.options.map(async (status) => ({
      status,
      count: await prisma.aiActionSuggestion.count({
        where: { ...baseWhere, status },
      }),
    }))),
  ]);

  const accountIds = items
    .filter((item) => item.report.entityType === "ad_account")
    .map((item) => item.report.entityId);
  const accountLabels = await buildAdAccountLabels(accountIds);

  return {
    summary: Object.fromEntries(counts.map((count) => [count.status, count.count])),
    items: items.map((item) => {
      const account = item.report.entityType === "ad_account"
        ? accountLabels.get(item.report.entityId)
        : undefined;
      return {
        id: item.id,
        action: item.action,
        rationale: item.rationale,
        priority: item.priority,
        status: item.status,
        executionChecklist: checklistFromJson(item.executionChecklist),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        report: item.report,
        entity: {
          type: item.report.entityType,
          id: item.report.entityId,
          label: account?.label ?? metadataEntityLabel(item.report.metadata) ?? `${item.report.entityType}:${item.report.entityId}`,
          href: account?.href ?? null,
        },
      };
    }),
  };
}

export async function updateAiActionSuggestionStatus(id: string, input: unknown) {
  const body = updateAiSuggestionStatusSchema.parse(input);
  const updated = await prisma.aiActionSuggestion.update({
    where: { id },
    data: { status: body.status },
    select: {
      id: true,
      status: true,
      updatedAt: true,
    },
  });
  return updated;
}

export async function getAiActionSuggestionReport(id: string) {
  const suggestion = await prisma.aiActionSuggestion.findUnique({
    where: { id },
    include: {
      report: true,
    },
  });
  if (!suggestion) throw new Error("AI suggestion not found");

  const accountLabels = suggestion.report.entityType === "ad_account"
    ? await buildAdAccountLabels([suggestion.report.entityId])
    : new Map<string, { label: string; href: string }>();
  const account = accountLabels.get(suggestion.report.entityId);

  return {
    suggestion: {
      id: suggestion.id,
      action: suggestion.action,
      rationale: suggestion.rationale,
      priority: suggestion.priority,
      status: suggestion.status,
      executionChecklist: checklistFromJson(suggestion.executionChecklist),
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
    },
    report: suggestion.report,
    entity: {
      type: suggestion.report.entityType,
      id: suggestion.report.entityId,
      label: account?.label ?? metadataEntityLabel(suggestion.report.metadata) ?? `${suggestion.report.entityType}:${suggestion.report.entityId}`,
      href: account?.href ?? null,
    },
  };
}

export async function getAiAnalysisReportById(id: string) {
  const report = await prisma.aiAnalysisReport.findUnique({
    where: { id },
    include: {
      suggestions: {
        orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!report) throw new Error("AI analysis report not found");

  const accountLabels = report.entityType === "ad_account"
    ? await buildAdAccountLabels([report.entityId])
    : new Map<string, { label: string; href: string }>();
  const account = accountLabels.get(report.entityId);

  return {
    report,
    suggestions: report.suggestions.map((suggestion) => ({
      id: suggestion.id,
      action: suggestion.action,
      rationale: suggestion.rationale,
      priority: suggestion.priority,
      status: suggestion.status,
      executionChecklist: checklistFromJson(suggestion.executionChecklist),
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
    })),
    entity: {
      type: report.entityType,
      id: report.entityId,
      label: account?.label ?? metadataEntityLabel(report.metadata) ?? `${report.entityType}:${report.entityId}`,
      href: account?.href ?? null,
    },
  };
}

export async function generateCreativeBriefFromSuggestion(id: string, input: unknown) {
  const body = creativeBriefFromSuggestionSchema.parse(input ?? {});
  const suggestion = await prisma.aiActionSuggestion.findUnique({
    where: { id },
    include: { report: true },
  });
  if (!suggestion) throw new Error("AI suggestion not found");

  const accountLabels = suggestion.report.entityType === "ad_account"
    ? await buildAdAccountLabels([suggestion.report.entityId])
    : new Map<string, { label: string; href: string }>();
  const account = accountLabels.get(suggestion.report.entityId);
  const entityLabel = account?.label
    ?? metadataEntityLabel(suggestion.report.metadata)
    ?? `${suggestion.report.entityType}:${suggestion.report.entityId}`;
  const productName = metadataString(suggestion.report.metadata, "productName") ?? entityLabel;
  const market = metadataString(suggestion.report.metadata, "country");

  const creative = await generateCreativeBrief({
    entityType: creativeEntityType(suggestion.report.entityType),
    entityId: suggestion.report.entityId,
    language: body.language,
    market,
    productName,
    performanceSummary: {
      source: "ai_action_suggestion",
      entityLabel,
      suggestion: {
        action: suggestion.action,
        rationale: suggestion.rationale,
        priority: suggestion.priority,
        status: suggestion.status,
      },
      report: {
        type: suggestion.report.type,
        entityType: suggestion.report.entityType,
        entityId: suggestion.report.entityId,
        conclusion: suggestion.report.conclusion,
        dataBasis: suggestion.report.dataBasis,
        riskPoints: suggestion.report.riskPoints,
        observationWindow: suggestion.report.observationWindow,
        metadata: suggestion.report.metadata,
      },
    },
  });

  const report = await prisma.aiAnalysisReport.create({
    data: {
      type: "creative",
      entityType: suggestion.report.entityType,
      entityId: suggestion.report.entityId,
      dateRange: suggestion.report.dateRange as Prisma.InputJsonValue,
      conclusion: `Creative Copilot 已基于建议卡片为「${entityLabel}」生成创意方向。`,
      dataBasis: {
        sourceSuggestionId: suggestion.id,
        sourceReportId: suggestion.reportId,
        sourceConclusion: suggestion.report.conclusion,
        brief: creative.brief,
      },
      riskPoints: [
        "创意 Brief 只用于人工制作素材，不会自动上传素材。",
        "创意 Brief 不会自动创建、修改、暂停或调整任何 Meta 广告。",
      ],
      priority: suggestion.priority,
      observationWindow: "制作后至少观察 3 天，并结合真实 ROAS 与素材 CTR 复盘。",
      model: creative.model,
      metadata: {
        entityLabel,
        generatedBy: "creative-copilot-from-suggestion",
        provider: creative.provider,
        sourceSuggestionId: suggestion.id,
      },
      suggestions: {
        create: [{
          action: "根据 Creative Copilot 输出制作 3 条 Hook 变体、2 套主图或 1 条 15 秒短视频脚本，由运营人工上传和测试。",
          rationale: "该创意方向来自已触发的 AI 建议卡片和真实经营/广告数据。",
          priority: suggestion.priority,
          executionChecklist: [
            "确认建议卡片的数据依据是否仍然有效。",
            "从 Creative Brief 中选择 1 个主卖点和 2-3 个 Hook 变体。",
            "制作素材后由运营人工上传到 Meta 后台。",
            "上线后按 CTR、CPA、真实 ROAS 观察至少 3 天。",
          ],
        }],
      },
    },
  });

  return {
    ...creative,
    reportId: report.id,
    sourceSuggestionId: suggestion.id,
    entity: {
      type: suggestion.report.entityType,
      id: suggestion.report.entityId,
      label: entityLabel,
      href: account?.href ?? null,
    },
  };
}
