// @ts-nocheck
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaApiResponse, MetaCampaign } from "../meta/types.js";
import { normalizeAccountId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { CAMPAIGN_FIELDS, toJsonContent } from "./field-policy.js";
import { READ, READ_ONLY_DESCRIPTION } from "./_register.js";

const statusEnum = z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]);

function normalizeCampaign(campaign: MetaCampaign): Record<string, unknown> {
  return {
    campaign_id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    daily_budget: campaign.daily_budget,
    lifetime_budget: campaign.lifetime_budget,
  };
}

export function registerCampaignTools(server: McpServer): void {
  server.registerTool(
    "ads_readonly_get_campaigns",
    {
      description: `${READ_ONLY_DESCRIPTION} List campaigns with safe basic fields only.`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        limit: z.number().min(1).max(100).default(25),
        status_filter: z.array(statusEnum).optional(),
      },
      annotations: { ...READ },
    },
    async ({ account_id, limit, status_filter }) => {
      const params: Record<string, string | number | boolean | undefined> = {
        fields: buildFieldsParam(CAMPAIGN_FIELDS),
        limit,
      };
      if (status_filter && status_filter.length > 0) {
        params.filtering = JSON.stringify([
          { field: "effective_status", operator: "IN", value: status_filter },
        ]);
      }

      const response = await metaApiClient.get<MetaApiResponse<MetaCampaign>>(
        `/${normalizeAccountId(account_id)}/campaigns`,
        params,
      );
      const campaigns = (response.data ?? []).map(normalizeCampaign);
      return {
        content: [
          { type: "text", text: `Found ${campaigns.length} read-only campaign(s).` },
          toJsonContent(campaigns),
        ],
      };
    },
  );
}
