// @ts-nocheck
export interface MetaApiResponse<T> {
  data?: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
}

export interface MetaAdAccount {
  account_id?: string;
  id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

export interface MetaCampaign {
  id: string;
  name?: string;
  status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export interface MetaAdSet {
  id: string;
  campaign_id?: string;
  name?: string;
  status?: string;
  daily_budget?: string;
  bid_strategy?: string;
  optimization_goal?: string;
  targeting?: {
    geo_locations?: unknown;
  };
}

export interface MetaAd {
  id: string;
  adset_id?: string;
  campaign_id?: string;
  name?: string;
  status?: string;
  creative?: {
    id?: string;
  };
}

export interface MetaCreative {
  id: string;
  title?: string;
  body?: string;
  image_url?: string;
  video_id?: string;
  object_story_spec?: Record<string, unknown>;
}

export interface MetaInsightsRow {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  country?: string;
  age?: string;
  gender?: string;
  publisher_platform?: string;
  platform_position?: string;
  impression_device?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
}
