// @ts-nocheck
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaApiResponse, MetaInsightsRow } from "../meta/types.js";
import { normalizeAccountId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { INSIGHTS_FIELDS, normalizeInsightsRow, toJsonContent } from "./field-policy.js";
import { READ, READ_ONLY_DESCRIPTION } from "./_register.js";

const datePresetEnum = z.enum(["yesterday", "last_3d", "last_7d", "last_14d", "last_30d"]);
const levelEnum = z.enum(["account", "campaign", "adset", "ad"]);
const breakdownEnum = z.enum(["country", "age", "gender", "publisher_platform", "platform_position", "impression_device"]);

export function registerInsightsTools(server: McpServer): void {
  server.registerTool(
    "ads_readonly_get_insights",
    {
      description: `${READ_ONLY_DESCRIPTION} Get filtered Meta insights metrics for account/campaign/adset/ad analysis.`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        date_preset: datePresetEnum.default("last_7d"),
        time_range: z
          .object({
            since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .optional(),
        level: levelEnum.default("ad"),
        country_breakdown: z.boolean().default(true),
        breakdowns: z.array(breakdownEnum).max(3).optional(),
        limit: z.number().min(1).max(1000).default(500),
      },
      annotations: { ...READ },
    },
    async ({ account_id, date_preset, time_range, level, country_breakdown, breakdowns, limit }) => {
      const params: Record<string, string | number | boolean | undefined> = {
        fields: buildFieldsParam(INSIGHTS_FIELDS),
        level,
        limit,
        time_increment: 1,
        use_unified_attribution_setting: true,
      };
      if (time_range) {
        params.time_range = JSON.stringify(time_range);
      } else {
        params.date_preset = date_preset;
      }
      const requestedBreakdowns = breakdowns && breakdowns.length > 0
        ? breakdowns
        : country_breakdown
          ? ["country"]
          : [];
      if (requestedBreakdowns.length > 0) {
        params.breakdowns = requestedBreakdowns.join(",");
      }

      const response = await metaApiClient.get<MetaApiResponse<MetaInsightsRow>>(
        `/${normalizeAccountId(account_id)}/insights`,
        params,
      );
      const rows = (response.data ?? []).map(normalizeInsightsRow);
      return {
        content: [
          { type: "text", text: `Found ${rows.length} read-only insight row(s).` },
          toJsonContent(rows),
        ],
      };
    },
  );
}
