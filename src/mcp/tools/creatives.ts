// @ts-nocheck
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaApiResponse, MetaCreative } from "../meta/types.js";
import { normalizeAccountId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { CREATIVE_FIELDS, toJsonContent } from "./field-policy.js";
import { READ, READ_ONLY_DESCRIPTION } from "./_register.js";

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractLinkUrl(creative: MetaCreative): string | undefined {
  const spec = creative.object_story_spec;
  const linkData = spec?.link_data;
  if (typeof linkData === "object" && linkData !== null && "link" in linkData) {
    return maybeString((linkData as Record<string, unknown>).link);
  }
  const videoData = spec?.video_data;
  if (typeof videoData === "object" && videoData !== null && "call_to_action" in videoData) {
    const callToAction = (videoData as Record<string, unknown>).call_to_action;
    if (typeof callToAction === "object" && callToAction !== null && "value" in callToAction) {
      const value = (callToAction as Record<string, unknown>).value;
      if (typeof value === "object" && value !== null && "link" in value) {
        return maybeString((value as Record<string, unknown>).link);
      }
    }
  }
  return undefined;
}

function normalizeCreative(creative: MetaCreative): Record<string, unknown> {
  return {
    creative_id: creative.id,
    title: creative.title,
    body: creative.body,
    image_url: creative.image_url,
    video_id: creative.video_id,
    link_url: extractLinkUrl(creative),
  };
}

export function registerCreativeTools(server: McpServer): void {
  server.registerTool(
    "ads_readonly_get_creatives",
    {
      description: `${READ_ONLY_DESCRIPTION} List ad creative basics. Uploads and creative mutations are not available.`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID"),
        limit: z.number().min(1).max(100).default(25),
      },
      annotations: { ...READ },
    },
    async ({ account_id, limit }) => {
      const response = await metaApiClient.get<MetaApiResponse<MetaCreative>>(
        `/${normalizeAccountId(account_id)}/adcreatives`,
        {
          fields: buildFieldsParam(CREATIVE_FIELDS),
          limit,
        },
      );
      const creatives = (response.data ?? []).map(normalizeCreative);
      return {
        content: [
          { type: "text", text: `Found ${creatives.length} read-only creative(s).` },
          toJsonContent(creatives),
        ],
      };
    },
  );
}
