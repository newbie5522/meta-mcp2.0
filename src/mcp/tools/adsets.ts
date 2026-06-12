// @ts-nocheck
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaAdSet, MetaApiResponse } from "../meta/types.js";
import { normalizeAccountId, validateMetaId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { ADSET_FIELDS, toJsonContent } from "./field-policy.js";
import { READ, READ_ONLY_DESCRIPTION } from "./_register.js";

const statusEnum = z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]);

function normalizeAdSet(adset: MetaAdSet): Record<string, unknown> {
  return {
    adset_id: adset.id,
    campaign_id: adset.campaign_id,
    name: adset.name,
    status: adset.status,
    daily_budget: adset.daily_budget,
    bid_strategy: adset.bid_strategy,
    optimization_goal: adset.optimization_goal,
    targeting_geo_locations: adset.targeting?.geo_locations,
  };
}

export function registerAdSetTools(server: McpServer): void {
  server.registerTool(
    "ads_readonly_get_ad_sets",
    {
      description: `${READ_ONLY_DESCRIPTION} List ad sets with safe basic fields and geo targeting only.`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        campaign_id: z.string().optional().describe("Optional campaign ID filter"),
        limit: z.number().min(1).max(100).default(25),
        status_filter: z.array(statusEnum).optional(),
      },
      annotations: { ...READ },
    },
    async ({ account_id, campaign_id, limit, status_filter }) => {
      const parentPath = campaign_id
        ? validateMetaId(campaign_id, "campaign")
        : normalizeAccountId(account_id);
      const params: Record<string, string | number | boolean | undefined> = {
        fields: buildFieldsParam(ADSET_FIELDS),
        limit,
      };
      if (status_filter && status_filter.length > 0) {
        params.filtering = JSON.stringify([
          { field: "effective_status", operator: "IN", value: status_filter },
        ]);
      }

      const response = await metaApiClient.get<MetaApiResponse<MetaAdSet>>(`/${parentPath}/adsets`, params);
      const adsets = (response.data ?? []).map(normalizeAdSet);
      return {
        content: [
          { type: "text", text: `Found ${adsets.length} read-only ad set(s).` },
          toJsonContent(adsets),
        ],
      };
    },
  );
}
