export interface MenuItem {
  id: string;
  label: string;
  icon?: any;
  subs?: { id: string; label: string; }[];
}

export type DateRangeType = 
  | 'today' | 'yesterday' | 'past_7' | 'past_14' | 'past_30' 
  | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';

/**
 * AI Data Decision Interface - Meta Advertising Audience Country Perspective
 * Describes geographical distribution aggregates retrieved from Meta ad delivery.
 * "metaGroupedCountry" represents the country segment from active ad delivery breakdown.
 */
export interface MetaGroupedCountry {
  /** Two-letter uppercase ISO country code, e.g. "US", "DE" */
  countryCode: string;
  /** Full English country name or fallback label, e.g. "United States" */
  countryName: string;
  /** Total ad delivery dollars spent in this country */
  metaSpend: number;
  /** Volume of times ads shown to citizens of this country */
  metaImpressions: number;
  /** Count of click interactions on delivered ads */
  metaClicks: number;
  /** Number of recorded purchases initiated from this country's ad traffic */
  metaPurchases: number;
  /** Aggregate dollar valuation generated from pixel purchases mapped to this country */
  metaPurchaseValue: number;
  /** Return on Ad Spend specifically within this meta breakdown segment */
  metaRoas: number | null;
  /** Calculated Click-Through Rate */
  ctr: number;
  /** Calculated Cost per Click */
  cpc: number;
  /** Calculated Cost per Mille (Impressions) */
  cpm: number;
  /** Mapped ad account IDs driving delivery performance */
  accountIds: string[];
}

/**
 * AI Data Decision Interface - Store Order Country Perspective
 * Describes geographical order destination aggregates retrieved directly from shipping/billing addresses in transactions.
 * "orderGroupedCountry" represents the actual transactional destination country.
 */
export interface OrderGroupedCountry {
  /** Two-letter uppercase ISO country code matching order addresses, e.g. "US", "CA" */
  countryCode: string;
  /** Full English country name derived from transaction payloads */
  countryName: string;
  /** Sum total order volume revenue parsed directly from transactions in this country */
  orderRevenue: number | null;
  /** Count of distinct, canonical orders registered from this country */
  orderCount: number | null;
  /** Profit calculated from sales (Revenue * 0.4 fallback in core) */
  orderProfit: number | null;
  /** Segment order level refund rate incidence */
  refundRate: number | null;
  /** Average Order Value of finalized transactions */
  averageOrderValue: number | null;
  /** UTC timestamp string representing first observed order from this country */
  orderFirstAt: string | null;
  /** UTC timestamp string representing latest observed order from this country */
  orderLastAt: string | null;
}

