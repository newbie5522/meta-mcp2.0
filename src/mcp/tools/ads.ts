// @ts-nocheck
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaAd, MetaApiResponse } from "../meta/types.js";
import { normalizeAccountId, validateMetaId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { AD_FIELDS, toJsonContent } from "./field-policy.js";
import { READ, READ_ONLY_DESCRIPTION } from "./_register.js";

const statusEnum = z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]);

function normalizeAd(ad: MetaAd): Record<string, unknown> {
  return {
    ad_id: ad.id,
    adset_id: ad.adset_id,
    campaign_id: ad.campaign_id,
    name: ad.name,
    status: ad.status,
    creative_id: ad.creative?.id,
  };
}

export function registerAdTools(server: McpServer): void {
  server.registerTool(
    "ads_readonly_get_ads",
    {
      description: `${READ_ONLY_DESCRIPTION} List ads with safe basic fields only.`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        campaign_id: z.string().optional(),
        adset_id: z.string().optional(),
        limit: z.number().min(1).max(100).default(25),
        status_filter: z.array(statusEnum).optional(),
      },
      annotations: { ...READ },
    },
    async ({ account_id, campaign_id, adset_id, limit, status_filter }) => {
      const parentPath = adset_id
        ? validateMetaId(adset_id, "adset")
        : campaign_id
          ? validateMetaId(campaign_id, "campaign")
          : normalizeAccountId(account_id);
      const params: Record<string, string | number | boolean | undefined> = {
        fields: buildFieldsParam(AD_FIELDS),
        limit,
      };
      if (status_filter && status_filter.length > 0) {
        params.filtering = JSON.stringify([
          { field: "effective_status", operator: "IN", value: status_filter },
        ]);
      }

      const response = await metaApiClient.get<MetaApiResponse<MetaAd>>(`/${parentPath}/ads`, params);
      const ads = (response.data ?? []).map(normalizeAd);
      return {
        content: [
          { type: "text", text: `Found ${ads.length} read-only ad(s).` },
          toJsonContent(ads),
        ],
      };
    },
  );
}
