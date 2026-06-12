// @ts-nocheck
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaAdAccount, MetaApiResponse } from "../meta/types.js";
import { normalizeAccountId } from "../utils/format.js";
import { buildFieldsParam } from "../utils/validation.js";
import { ACCOUNT_FIELDS, toJsonContent } from "./field-policy.js";
import { READ, READ_ONLY_DESCRIPTION } from "./_register.js";
import { getNumericAccountId } from "../../server/utils.js";

function normalizeAccount(account: MetaAdAccount): Record<string, unknown> {
  return {
    account_id: getNumericAccountId(account.account_id ?? account.id),
    name: account.name,
    currency: account.currency,
    timezone: account.timezone_name,
    account_status: account.account_status,
  };
}

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    "ads_readonly_get_ad_accounts",
    {
      description: `${READ_ONLY_DESCRIPTION} Get Meta ad accounts visible to the current token.`,
      inputSchema: {
        limit: z.number().min(1).max(100).default(25),
      },
      annotations: { ...READ },
    },
    async ({ limit }) => {
      const response = await metaApiClient.get<MetaApiResponse<MetaAdAccount>>("/me/adaccounts", {
        fields: buildFieldsParam(ACCOUNT_FIELDS),
        limit,
      });
      const accounts = (response.data ?? []).map(normalizeAccount);
      return {
        content: [
          { type: "text", text: `Found ${accounts.length} read-only Meta ad account(s).` },
          toJsonContent(accounts),
        ],
      };
    },
  );

  server.registerTool(
    "ads_readonly_get_account_info",
    {
      description: `${READ_ONLY_DESCRIPTION} Get safe basic fields for one Meta ad account.`,
      inputSchema: {
        account_id: z.string().describe("Ad account ID, with or without act_ prefix"),
      },
      annotations: { ...READ },
    },
    async ({ account_id }) => {
      const account = await metaApiClient.get<MetaAdAccount>(`/${normalizeAccountId(account_id)}`, {
        fields: buildFieldsParam(ACCOUNT_FIELDS),
      });
      return {
        content: [
          { type: "text", text: `Read-only account info for ${normalizeAccountId(account_id)}.` },
          toJsonContent(normalizeAccount(account)),
        ],
      };
    },
  );
}
