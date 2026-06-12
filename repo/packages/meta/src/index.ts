export { metaApiClient, ReadOnlyModeError, isReadOnlyModeEnabled } from "../../../src/meta/client.js";

export const META_READONLY_CAPABILITIES = [
  "ad_accounts.read",
  "campaigns.read",
  "adsets.read",
  "ads.read",
  "creatives.read",
  "insights.read",
  "breakdowns.read",
] as const;

export const META_BLOCKED_CAPABILITIES = [
  "campaigns.create",
  "campaigns.update",
  "campaigns.delete",
  "campaigns.pause",
  "campaigns.activate",
  "adsets.create",
  "adsets.update",
  "adsets.delete",
  "ads.create",
  "ads.update",
  "ads.delete",
  "creatives.upload",
  "audiences.write",
  "rules.write",
  "billing.write",
] as const;

export const insightBreakdowns = [
  "country",
  "age",
  "gender",
  "publisher_platform",
  "platform_position",
  "impression_device",
] as const;

export type InsightBreakdown = typeof insightBreakdowns[number];
