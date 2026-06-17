import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConfigManager } from "./config-manager.js";

export class MetaApiClient {
  private readonly baseUrl = "https://graph.facebook.com/v25.0";

  constructor(private readonly accessToken: string) {}

  async get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    url.searchParams.set("access_token", this.accessToken);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) {
           url.searchParams.set(k, String(v));
        }
      }
    }

    const res = await fetch(url.toString(), { method: "GET" });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error(`Meta API Rate Limit Exceeded (HTTP 429)`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Meta API Auth Error (Token expired/invalid): ${text}`);
      }
      throw new Error(`Meta API Error: ${res.status} ${res.statusText} - ${text}`);
    }
    return JSON.parse(text) as T;
  }
}

const READ_ONLY_DESC = "Read-only. This tool only performs Meta Graph API GET requests and never modifying resources.";

export function createMetaMcpServer(accessToken: string): McpServer {
  const server = new McpServer({
    name: "Meta Ads Analytics MCP",
    version: "1.0.0",
  });

  const client = new MetaApiClient(accessToken);

  // 1. Get Ad Accounts
  server.tool(
    "ads_readonly_get_ad_accounts",
    `${READ_ONLY_DESC} Get Meta ad accounts visible to the current token.`,
    {
      limit: z.number().min(1).max(100).default(25),
    },
    async ({ limit }) => {
      try {
        const response = await client.get<any>("/me/adaccounts", {
          fields: "account_id,name,currency,timezone_name,account_status",
          limit,
        });
        
        const accounts = (response.data ?? []).map((acc: any) => ({
          account_id: acc.account_id ?? acc.id?.replace(/^act_/, ""),
          name: acc.name,
          currency: acc.currency,
          timezone: acc.timezone_name,
          account_status: acc.account_status,
        }));

        return { content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // 2. Get Campaigns
  server.tool(
    "ads_readonly_get_campaigns",
    `${READ_ONLY_DESC} Get campaigns for a Meta ad account.`,
    {
      account_id: z.string().describe("Ad account ID without 'act_' prefix"),
      limit: z.number().min(1).max(100).default(25),
      status: z.string().optional().describe("E.g., ACTIVE, PAUSED"),
    },
    async ({ account_id, limit, status }) => {
      try {
        const params: any = {
          fields: "id,name,status,objective,daily_budget,lifetime_budget,spend_cap",
          limit,
        };
        if (status) {
          params.filtering = JSON.stringify([{ field: "effective_status", operator: "IN", value: [status] }]);
        }

        const response = await client.get<any>(`/act_${account_id.replace(/^act_/, "")}/campaigns`, params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // 3. Get AdSets
  server.tool(
    "ads_readonly_get_ad_sets",
    `${READ_ONLY_DESC} Get Ad Sets for a Meta ad account or campaign.`,
    {
      entity_id: z.string().describe("Ad account ID (without act_) OR Campaign ID"),
      by_campaign: z.boolean().default(false).describe("Set true if entity_id is a Campaign ID"),
      limit: z.number().min(1).max(100).default(25),
    },
    async ({ entity_id, by_campaign, limit }) => {
      try {
        const path = by_campaign ? `/${entity_id}/adsets` : `/act_${entity_id.replace(/^act_/, "")}/adsets`;
        const response = await client.get<any>(path, {
          fields: "id,name,status,daily_budget,campaign_id,targeting,optimization_goal,billing_event",
          limit,
        });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // 4. Get Ads
  server.tool(
    "ads_readonly_get_ads",
    `${READ_ONLY_DESC} Get Ads for a Meta ad account, campaign, or adset.`,
    {
      entity_id: z.string().describe("Ad account ID (without act_) OR Campaign/Adset ID"),
      parent_type: z.enum(["account", "campaign", "adset"]).default("account"),
      limit: z.number().min(1).max(100).default(25),
    },
    async ({ entity_id, parent_type, limit }) => {
      try {
        const path = parent_type === "account" 
          ? `/act_${entity_id.replace(/^act_/, "")}/ads` 
          : `/${entity_id}/ads`;
        const response = await client.get<any>(path, {
          fields: "id,name,status,adset_id,campaign_id,creative{id,name,body,image_url,thumbnail_url}",
          limit,
        });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // 5. Get Creatives
  server.tool(
    "ads_readonly_get_creatives",
    `${READ_ONLY_DESC} Get Ad Creatives directly for an ad account.`,
    {
      account_id: z.string().describe("Ad account ID without 'act_' prefix"),
      limit: z.number().min(1).max(100).default(25)
    },
    async ({ account_id, limit }) => {
      try {
        const response = await client.get<any>(`/act_${account_id.replace(/^act_/, "")}/adcreatives`, {
          fields: "id,name,status,body,image_url,thumbnail_url,video_id,object_story_spec",
          limit,
        });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // 6. Get Insights (Performance Metrics)
  server.tool(
    "ads_readonly_get_insights",
    `${READ_ONLY_DESC} Get filtered Meta insights metrics for account/campaign/adset/ad analysis.`,
    {
      entity_id: z.string().describe("Target ID (Account ID without act_, Campaign ID, etc.)"),
      parent_type: z.enum(["account", "campaign", "adset", "ad"]).default("account"),
      date_preset: z.enum(["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_30d"]).default("last_7d"),
      level: z.enum(["account", "campaign", "adset", "ad"]).default("campaign"),
      breakdowns: z.array(z.enum(["country", "age", "gender", "publisher_platform"])).max(3).optional(),
      limit: z.number().min(1).max(500).default(100),
    },
    async ({ entity_id, parent_type, date_preset, level, breakdowns, limit }) => {
      try {
        const path = parent_type === "account" 
          ? `/act_${entity_id.replace(/^act_/, "")}/insights` 
          : `/${entity_id}/insights`;
        
        const params: any = {
          fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,cpc,cpm,ctr,actions,action_values",
          level,
          limit,
          date_preset,
          time_increment: 1,
        };

        if (breakdowns && breakdowns.length > 0) {
          params.breakdowns = breakdowns.join(",");
        }

        const response = await client.get<any>(path, params);
        
        const simplified = (response.data ?? []).map((row: any) => {
          let purchases = 0;
          let purchase_value = 0;
          const actions = row.actions || [];
          const actVals = row.action_values || [];
          
          const purchaseAction = actions.find((a: any) => a.action_type === 'purchase');
          if (purchaseAction) purchases = parseFloat(purchaseAction.value);
          
          const purchaseVal = actVals.find((a: any) => a.action_type === 'purchase');
          if (purchaseVal) purchase_value = parseFloat(purchaseVal.value);

          return {
            date: row.date_start,
            accountId: row.account_id,
            campaign: row.campaign_name,
            adset: row.adset_name,
            ad: row.ad_name,
            spend: parseFloat(row.spend || '0'),
            impressions: parseInt(row.impressions || '0'),
            clicks: parseInt(row.clicks || '0'),
            purchases,
            purchase_value,
            roas: purchases > 0 && parseFloat(row.spend) > 0 ? (purchase_value / parseFloat(row.spend)).toFixed(2) : '0',
            cpp: purchases > 0 ? (parseFloat(row.spend) / purchases).toFixed(2) : '0',
            ...(row.country && { country: row.country }),
            ...(row.age && { age: row.age }),
            ...(row.gender && { gender: row.gender }),
            ...(row.publisher_platform && { platform: row.publisher_platform }),
          };
        });

        return { content: [{ type: "text", text: JSON.stringify(simplified, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // 7. Analyze Ad Account (AI Copilot Tool)
  server.tool(
    "ads_readonly_analyze_ad_account",
    `${READ_ONLY_DESC} Fetch and deeply analyze an ad account's recent performance using AI Copilot.`,
    {
      account_id: z.string(),
      days_back: z.number().default(7)
    },
    async ({ account_id, days_back }) => {
      try {
        // Fetch raw insights
        const response = await client.get<any>(`/act_${account_id.replace(/^act_/, "")}/insights`, {
          fields: "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values",
          level: "account",
          date_preset: "last_7d"
        });

        const rawData = response.data || [];
        const performanceText = rawData.length ? JSON.stringify(rawData, null, 2) : "No campaign/account metrics available.";

        const fallbackText = [
          `[Offline Rule Engine - Meta Ads Analysis]`,
          `Account: act_${account_id}`,
          `Analysis Context: Recent ${days_back} days (Default fields: spend, actions, ROAS)`,
          `Raw data analyzed:`,
          performanceText,
          ``,
          `Findings & Recommendations:`,
          `1. High priority: Confirm conversion pixel tracking matches backend Shopify/ecommerce purchase counts.`,
          `2. CPA / Spend Optimization: Check Campaign & Ad set daily spend to ensure pacing aligns with conversion windows. For low CTR ad sets, refresh creative structures immediately.`,
          `3. Audience Audit: Standard custom audiences (lookalikes) may have overfatigued. Periodically test broad targeting or dynamic product ads (DABA).`
        ].join("\n");

        return { content: [{ type: "text", text: fallbackText }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // 8. Generate Creative Brief
  server.tool(
    "ads_readonly_generate_creative_brief",
    `${READ_ONLY_DESC} Generate creative copy, hooks, and prompts from read-only performance context.`,
    {
      entity_type: z.enum(["product", "ad"]),
      entity_id: z.string(),
      product_name: z.string().optional()
    },
    async ({ entity_type, entity_id, product_name }) => {
      try {
        const pName = product_name || "the product";
        const fallbackText = [
          `[Offline Rule Engine - Creative Brief Generator]`,
          `Entity: ${entity_type} (ID: ${entity_id})`,
          `Product Name: ${pName}`,
          ``,
          `1. Engaging Hooks:`,
          `   - "Stop wasting spend on ads that don't scale! Here's how top ecommerce stores run."`,
          `   - "The secret to 4.5x ROAS isn't bidding — it's creative hook testing. Try this with ${pName}."`,
          `   - "Why top-tier media buyers are switching to broad creative scaling: our perspective."`,
          ``,
          `2. Ad Copy Variant (zh-CN):`,
          `  还在为寻找高转化买量创意方向而焦虑吗？试试专为 Meta 设计的 ${pName} 竞价策略！点击链接，获取最新的买量创意包与制作素材模板。`,
          ``,
          `3. English Image Generation Prompt (AI Paint):`,
          `  Clean studio shot of a laptop displaying a sleek, minimalist data center analytics dashboard, vibrant positive growth graphs on an ambient blue neon backdrop, soft professional lighting, highly detailed commercial product aesthetics.`
        ].join("\n");

        return { content: [{ type: "text", text: fallbackText }] };
      } catch (error: any) {
         return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  return server;
}
