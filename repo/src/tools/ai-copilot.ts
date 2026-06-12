import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAccountDetailAnalysis } from "../domain/account-analysis.js";
import { generateCreativeBrief } from "../../packages/ai/src/creative.js";
import { toJsonContent } from "./field-policy.js";
import { READ, READ_ONLY_DESCRIPTION } from "./_register.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export function registerAiCopilotTools(server: McpServer): void {
  server.registerTool(
    "ads_readonly_analyze_ad_account",
    {
      description: `${READ_ONLY_DESCRIPTION} Analyze one local ad account with synced read-only insights and return advisory media buying guidance.`,
      inputSchema: {
        ad_account_id: z.string().min(1).describe("Internal ad account id from the dashboard database."),
        since: dateSchema,
        until: dateSchema,
      },
      annotations: { ...READ },
    },
    async ({ ad_account_id, since, until }) => {
      const analysis = await getAccountDetailAnalysis({
        adAccountId: ad_account_id,
        since,
        until,
      });
      return {
        content: [
          { type: "text", text: "Generated read-only ad account analysis. Suggestions require human execution." },
          toJsonContent(analysis),
        ],
      };
    },
  );

  server.registerTool(
    "ads_readonly_generate_creative_brief",
    {
      description: `${READ_ONLY_DESCRIPTION} Generate creative copy, hooks, scripts, and prompts from read-only performance context. Never uploads or creates ads.`,
      inputSchema: {
        entity_type: z.enum(["ad", "creative", "product", "country", "campaign", "adset", "store", "ad_account"]),
        entity_id: z.string().min(1),
        language: z.string().default("zh-CN"),
        market: z.string().optional(),
        product_name: z.string().optional(),
        performance_summary: z.record(z.unknown()).optional(),
      },
      annotations: { ...READ },
    },
    async ({ entity_type, entity_id, language, market, product_name, performance_summary }) => {
      const brief = await generateCreativeBrief({
        entityType: entity_type,
        entityId: entity_id,
        language,
        market,
        productName: product_name,
        performanceSummary: performance_summary,
      });
      return {
        content: [
          { type: "text", text: "Generated read-only creative brief. No Meta write operation was performed." },
          toJsonContent(brief),
        ],
      };
    },
  );
}
