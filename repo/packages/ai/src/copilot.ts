import { z } from "zod";
import { prisma } from "../../../src/db/prisma.js";
import { getAccountDetailAnalysis } from "../../../src/domain/account-analysis.js";
import { completeWithConfiguredAi } from "./providers.js";

export const copilotContextSchema = z.object({
  page: z.string().min(1),
  storeId: z.string().optional(),
  adAccountId: z.string().optional(),
  campaignId: z.string().optional(),
  adsetId: z.string().optional(),
  adId: z.string().optional(),
  creativeId: z.string().optional(),
  productId: z.string().optional(),
  country: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export const copilotChatSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(8000),
  context: copilotContextSchema,
});

function systemPrompt(): string {
  return [
    "你是 AI Media Buyer Copilot。",
    "你只能基于只读数据给出投放建议，不能创建、修改、暂停、删除广告。",
    "输出必须包含：结论、建议动作、数据依据、风险点、优先级、观察周期、执行清单。",
    "涉及预算、关停、排除国家、拆系列时必须写成建议，由运营人工执行。",
  ].join("\n");
}

async function contextSnapshot(context: z.infer<typeof copilotContextSchema>) {
  if (context.adAccountId) {
    return getAccountDetailAnalysis({
      adAccountId: context.adAccountId,
      since: context.since,
      until: context.until,
    }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  }
  return { note: "No entity-specific context was selected." };
}

export async function runCopilotChat(input: z.input<typeof copilotChatSchema>) {
  const parsed = copilotChatSchema.parse(input);
  const conversation = parsed.conversationId
    ? await prisma.aiConversation.update({
      where: { id: parsed.conversationId },
      data: { context: parsed.context },
    })
    : await prisma.aiConversation.create({
      data: {
        title: parsed.message.slice(0, 80),
        context: parsed.context,
      },
    });

  await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: parsed.message,
      metadata: parsed.context,
    },
  });

  const snapshot = await contextSnapshot(parsed.context);
  const user = JSON.stringify({
    question: parsed.message,
    pageContext: parsed.context,
    dataSnapshot: snapshot,
  }, null, 2);
  const completion = await completeWithConfiguredAi({
    purpose: "chat",
    system: systemPrompt(),
    user,
  });
  const answer = completion?.text || fallbackCopilotAnswer(snapshot);

  await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: answer,
      metadata: {
        provider: completion?.provider ?? "rules",
        model: completion?.model ?? "local-rules",
      },
    },
  });

  return {
    conversationId: conversation.id,
    provider: completion?.provider ?? "rules",
    model: completion?.model ?? "local-rules",
    answer,
  };
}

function fallbackCopilotAnswer(snapshot: unknown): string {
  return [
    "结论：当前未配置外部 AI 模型，系统使用本地规则生成保守建议。",
    "建议动作：先查看账户、国家、素材和产品维度数据；对高消耗低转化对象降预算观察，对 ROAS 稳定且订单量足够对象小幅加预算。",
    `数据依据：${JSON.stringify(snapshot).slice(0, 1200)}`,
    "风险点：本地规则无法替代深度模型推理；建议配置 OpenAI 或 Gemini API Key。",
    "优先级：3",
    "观察周期：3 天",
    "执行清单：同步最新数据；查看异常建议卡；人工确认后在 Meta 后台执行调整。",
  ].join("\n");
}
