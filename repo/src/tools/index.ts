import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./accounts.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerAdSetTools } from "./adsets.js";
import { registerAdTools } from "./ads.js";
import { registerCreativeTools } from "./creatives.js";
import { registerInsightsTools } from "./insights.js";
import { registerAiCopilotTools } from "./ai-copilot.js";

export const REGISTERED_READONLY_TOOL_NAMES = [
  "ads_readonly_get_ad_accounts",
  "ads_readonly_get_account_info",
  "ads_readonly_get_campaigns",
  "ads_readonly_get_ad_sets",
  "ads_readonly_get_ads",
  "ads_readonly_get_creatives",
  "ads_readonly_get_insights",
  "ads_readonly_analyze_ad_account",
  "ads_readonly_generate_creative_brief",
] as const;

export function registerAllTools(server: McpServer): void {
  registerAccountTools(server);
  registerCampaignTools(server);
  registerAdSetTools(server);
  registerAdTools(server);
  registerCreativeTools(server);
  registerInsightsTools(server);
  registerAiCopilotTools(server);
}
