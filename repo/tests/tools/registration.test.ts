import { describe, expect, it } from "vitest";
import { REGISTERED_READONLY_TOOL_NAMES } from "../../src/tools/index.js";

const bannedPatterns = [
  /create/i,
  /update/i,
  /delete/i,
  /pause/i,
  /activate/i,
  /upload/i,
  /billing/i,
  /lead/i,
  /comment/i,
  /audience/i,
  /rule/i,
  /token/i,
];

describe("MCP tool registration", () => {
  it("only exposes explicitly named read-only tools", () => {
    expect(REGISTERED_READONLY_TOOL_NAMES).toEqual([
      "ads_readonly_get_ad_accounts",
      "ads_readonly_get_account_info",
      "ads_readonly_get_campaigns",
      "ads_readonly_get_ad_sets",
      "ads_readonly_get_ads",
      "ads_readonly_get_creatives",
      "ads_readonly_get_insights",
      "ads_readonly_analyze_ad_account",
      "ads_readonly_generate_creative_brief",
    ]);
  });

  it("does not expose write or high-risk tool names", () => {
    for (const name of REGISTERED_READONLY_TOOL_NAMES) {
      expect(name).toContain("readonly");
      for (const pattern of bannedPatterns) {
        expect(name).not.toMatch(pattern);
      }
    }
  });
});
