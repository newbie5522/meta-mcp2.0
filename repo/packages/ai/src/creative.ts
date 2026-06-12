import { z } from "zod";
import { completeWithConfiguredAi } from "./providers.js";

export const creativeBriefSchema = z.object({
  entityType: z.enum(["ad", "creative", "product", "country", "campaign", "adset", "store", "ad_account"]),
  entityId: z.string().min(1),
  language: z.string().default("zh-CN"),
  market: z.string().optional(),
  productName: z.string().optional(),
  performanceSummary: z.record(z.unknown()).optional(),
});

function creativeSystemPrompt(): string {
  return [
    "你是 AI Creative Copilot，负责根据广告、产品、国家、店铺或账户表现生成创意方向。",
    "你只能生成文案、脚本、Prompt、A/B Test 方案和素材制作建议。",
    "禁止建议系统自动上传素材、自动创建广告或自动修改广告。",
    "输出必须结构化：成功原因、可复制元素、广告文案、标题、Hook、15 秒视频脚本、Reels/TikTok 脚本、图片 Prompt、视频 Prompt、本地化版本、A/B Test 方案、制作建议。",
  ].join("\n");
}

export async function generateCreativeBrief(input: z.input<typeof creativeBriefSchema>) {
  const parsed = creativeBriefSchema.parse(input);
  const completion = await completeWithConfiguredAi({
    purpose: "creative",
    system: creativeSystemPrompt(),
    user: JSON.stringify(parsed, null, 2),
  });

  return {
    provider: completion?.provider ?? "rules",
    model: completion?.model ?? "local-creative-rules",
    brief: completion?.text ?? fallbackCreativeBrief(parsed),
  };
}

function fallbackCreativeBrief(input: z.infer<typeof creativeBriefSchema>): string {
  const product = input.productName || "当前对象";
  const market = input.market || "目标市场";
  return [
    `成功原因：${product} 当前可能具备明确痛点、利益点、价格吸引力或国家/人群承接优势。`,
    "可复制元素：保留主卖点、强对比开头、真实使用场景和明确 CTA。",
    `广告文案：${product} 适合正在寻找高性价比解决方案的用户，现在查看最新优惠。`,
    `标题：${market} 热卖方向推荐`,
    "Hook：前 3 秒展示痛点对比、结果画面或真实使用前后差异。",
    "15 秒视频脚本：0-3 秒痛点；4-8 秒展示解决方案；9-12 秒展示结果；13-15 秒 CTA。",
    "Reels/TikTok 脚本：快节奏开场、字幕突出利益点、结尾引导点击。",
    "图片 Prompt：clean ecommerce product photo, realistic lifestyle scene, clear benefit text area, high contrast, mobile ad composition.",
    "视频 Prompt：short vertical UGC style product demo, fast hook, before-after contrast, natural lighting, clear CTA.",
    "本地化版本：替换当地语言、货币、使用场景、物流承诺和节日元素。",
    "A/B Test 方案：测试 Hook、首图、CTA、价格利益点、场景人群。",
    "制作建议：先做 3 条 Hook 变体和 2 套主图，再按 CTR 与真实 ROAS 筛选。",
  ].join("\n");
}
