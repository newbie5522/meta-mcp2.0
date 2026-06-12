// @ts-nocheck
import { truncateResponse } from "../utils/format.js";
import type { MetaInsightsRow } from "../meta/types.js";

export const ACCOUNT_FIELDS = [
  "account_id",
  "name",
  "currency",
  "timezone_name",
  "account_status",
] as const;

export const CAMPAIGN_FIELDS = [
  "id",
  "name",
  "status",
  "objective",
  "daily_budget",
  "lifetime_budget",
] as const;

export const ADSET_FIELDS = [
  "id",
  "campaign_id",
  "name",
  "status",
  "daily_budget",
  "bid_strategy",
  "optimization_goal",
  "targeting{geo_locations}",
] as const;

export const AD_FIELDS = [
  "id",
  "adset_id",
  "campaign_id",
  "name",
  "status",
  "creative{id}",
] as const;

export const CREATIVE_FIELDS = [
  "id",
  "title",
  "body",
  "image_url",
  "video_id",
  "object_story_spec",
] as const;

export const INSIGHTS_FIELDS = [
  "date_start",
  "date_stop",
  "account_id",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "purchase_roas",
  "cost_per_action_type",
] as const;

const PURCHASE_ACTION_TYPES = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
]);

const ADD_TO_CART_ACTION_TYPES = new Set([
  "add_to_cart",
  "omni_add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
]);

const CHECKOUT_ACTION_TYPES = new Set([
  "initiate_checkout",
  "omni_initiated_checkout",
  "offsite_conversion.fb_pixel_initiate_checkout",
]);

function findActionValue(
  rows: Array<{ action_type: string; value: string }> | undefined,
  types: Set<string>,
): number {
  if (!rows) return 0;
  for (const row of rows) {
    if (types.has(row.action_type)) {
      return Number(row.value) || 0;
    }
  }
  return 0;
}

function firstActionValue(
  rows: Array<{ action_type: string; value: string }> | undefined,
): number {
  if (!rows || rows.length === 0) return 0;
  return Number(rows[0]?.value) || 0;
}

export function toJsonContent(data: unknown): { type: "text"; text: string } {
  return {
    type: "text",
    text: truncateResponse(JSON.stringify(data, null, 2)),
  };
}

export function normalizeInsightsRow(row: MetaInsightsRow): Record<string, unknown> {
  const purchases = findActionValue(row.actions, PURCHASE_ACTION_TYPES);
  const purchaseValue = findActionValue(row.action_values, PURCHASE_ACTION_TYPES);
  const addToCart = findActionValue(row.actions, ADD_TO_CART_ACTION_TYPES);
  const initiateCheckout = findActionValue(row.actions, CHECKOUT_ACTION_TYPES);
  const purchaseRoas = firstActionValue(row.purchase_roas);
  const costPerPurchase = findActionValue(row.cost_per_action_type, PURCHASE_ACTION_TYPES);

  return {
    date: row.date_start,
    account_id: row.account_id,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    adset_id: row.adset_id,
    adset_name: row.adset_name,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    country: row.country,
    age: row.age,
    gender: row.gender,
    publisher_platform: row.publisher_platform,
    platform_position: row.platform_position,
    impression_device: row.impression_device,
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    frequency: Number(row.frequency) || 0,
    clicks: Number(row.clicks) || 0,
    ctr: Number(row.ctr) || 0,
    cpc: Number(row.cpc) || 0,
    cpm: Number(row.cpm) || 0,
    purchases,
    purchase_value: purchaseValue,
    purchase_roas: purchaseRoas,
    add_to_cart: addToCart,
    initiate_checkout: initiateCheckout,
    cost_per_purchase: costPerPurchase,
  };
}
