import prisma from "../../db/index.js";

export interface CountryAnalyticsResult {
  rows: MergedCountryRow[];
  summary: {
    countriesCount: number;
    orderCountriesCount: number;
    metaCountriesCount: number;
    totalOrderRevenue: number | null;
    totalOrderCount: number | null;
    totalMetaSpend: number;
    totalMetaPurchases: number;
    totalMetaPurchaseValue: number;
    unmappedMetaSpend: number;
    unmappedMetaSpendRate: number;
  };
  dataHealth: {
    orderCountryAvailable: boolean;
    metaCountryAvailable: boolean;
    unmappedAccountsCount: number;
    unmappedSpendRate: number;
    warnings: string[];
  };
  dataSourceExplain: {
    orderPrimarySource: string;
    metaPrimarySource: string;
    adInsightUsed: boolean;
    dailySummaryUsed: boolean;
    storeMappingUsed: boolean;
    countryJoinKey: string;
    storeRoasMeaning: string;
    orderUnavailableReason: string;
  };
}

export interface MergedCountryRow {
  countryCode: string; // e.g. "US"
  countryName: string; // e.g. "United States" or code if translation not available
  
  // order data (marked unavailable completely inside)
  orderRevenue: number | null;
  orderCount: number | null;
  orderProfit: number | null;
  refundRate: number | null;
  paidOrderCount: number | null;
  averageOrderValue: number | null;
  orderFirstAt: string | null;
  orderLastAt: string | null;

  // meta performance data
  metaSpend: number;
  metaImpressions: number;
  metaClicks: number;
  metaPurchases: number;
  metaPurchaseValue: number;
  metaRoas: number | null;
  ctr: number;
  cpc: number;
  cpm: number;

  accountIds: string[];
  mappedStoreIds: number[];
  dataSourceExplain: string;
}

// Simple country code to name mapping
const COUNTRY_NAME_MAP: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  AU: "Australia",
  CA: "Canada",
  DE: "Germany",
  MX: "Mexico",
  FR: "France",
  BE: "Belgium",
  IE: "Ireland",
  IT: "Italy",
  DK: "Denmark",
  AT: "Austria",
  SE: "Sweden",
  ES: "Spain",
  NL: "Netherlands",
  PT: "Portugal",
  FI: "Finland",
  CH: "Switzerland",
  PL: "Poland",
  NO: "Norway",
  NZ: "New Zealand",
  JP: "Japan",
  SG: "Singapore",
  HK: "Hong Kong",
  MY: "Malaysia",
  PH: "Philippines",
  ZA: "South Africa",
  BR: "Brazil",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  PE: "Peru",
};

export async function getCountryAnalytics(
  startDate: string,
  endDate: string,
  filterStoreId?: string,
  minSpend: number = 0,
  minOrders: number = 0,
  includeUnmappedSpend: boolean = true
): Promise<CountryAnalyticsResult> {
  // 1. Fetch Store mapped IDs
  const accountMappings = await prisma.accountMapping.findMany();
  const adAccounts = await prisma.adAccount.findMany();

  const adAccountStoreMap = new Map<string, number>();
  for (const m of accountMappings) {
    if (m.fbAccountId && m.storeId) {
      adAccountStoreMap.set(m.fbAccountId.trim(), m.storeId);
    }
  }
  for (const a of adAccounts) {
    if (a.fb_account_id && a.storeId) {
      adAccountStoreMap.set(a.fb_account_id.trim(), a.storeId);
    }
  }

  // Determine unmapped accounts in the database for health reporting
  const allAccountIdsInMappings = new Set([
    ...accountMappings.map(m => m.fbAccountId?.trim()),
    ...adAccounts.map(a => a.fb_account_id?.trim())
  ].filter(Boolean) as string[]);

  // 2. Fetch Audience Country breakdown data
  const rawBreakdowns = await prisma.factAudienceBreakdown.findMany({
    where: {
      dimension_type: "country",
      date: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  // Aggregation of meta insights by country
  const countryBreakdownGroup: Record<string, {
    countryCode: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchaseValue: number;
    accountIds: Set<string>;
    mappedStoreIds: Set<number>;
  }> = {};

  let totalMetaSpendOverall = 0;
  let totalMetaPurchasesOverall = 0;
  let totalMetaPurchaseValueOverall = 0;
  let unmappedMetaSpendOverall = 0;
  const uniqueUnmappedAccountIds = new Set<string>();

  for (const item of rawBreakdowns) {
    const aid = item.account_id?.trim();
    const mappedStoreId = adAccountStoreMap.get(aid);

    // If storeId filter is active, check if it matches
    if (filterStoreId) {
      const matchStoreId = Number(filterStoreId);
      if (mappedStoreId !== matchStoreId) {
        // Skip records that do not belong to the requested store
        continue;
      }
    }

    // Spend analysis overall metrics
    const spendVal = item.spend || 0;
    const purchasesVal = item.purchases || 0;
    const purchaseValueVal = item.purchase_value || 0;

    totalMetaSpendOverall += spendVal;
    totalMetaPurchasesOverall += purchasesVal;
    totalMetaPurchaseValueOverall += purchaseValueVal;

    if (!mappedStoreId) {
      unmappedMetaSpendOverall += spendVal;
      if (aid) uniqueUnmappedAccountIds.add(aid);
      
      // If client requests to exclude unmapped spend, and we are filtering/acting on it:
      if (!includeUnmappedSpend) {
        continue;
      }
    }

    const countryCode = (item.dimension_value || "unknown").toUpperCase().trim();
    
    if (!countryBreakdownGroup[countryCode]) {
      countryBreakdownGroup[countryCode] = {
        countryCode,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchaseValue: 0,
        accountIds: new Set<string>(),
        mappedStoreIds: new Set<number>()
      };
    }

    const group = countryBreakdownGroup[countryCode];
    group.spend += spendVal;
    group.impressions += item.impressions || 0;
    group.clicks += item.clicks || 0;
    group.purchases += purchasesVal;
    group.purchaseValue += purchaseValueVal;
    if (aid) group.accountIds.add(aid);
    if (mappedStoreId) group.mappedStoreIds.add(mappedStoreId);
  }

  // Convert map to final rows with formula metrics
  const mergedRows: MergedCountryRow[] = Object.values(countryBreakdownGroup)
    .map(g => {
      const countryCode = g.countryCode;
      const countryName = COUNTRY_NAME_MAP[countryCode] || countryCode;

      const metaSpend = g.spend;
      const metaImpressions = g.impressions;
      const metaClicks = g.clicks;
      const metaPurchases = g.purchases;
      const metaPurchaseValue = g.purchaseValue;

      const metaRoas = metaSpend > 0 ? metaPurchaseValue / metaSpend : null;
      const ctr = metaImpressions > 0 ? metaClicks / metaImpressions : 0;
      const cpc = metaClicks > 0 ? metaSpend / metaClicks : 0;
      const cpm = metaImpressions > 0 ? (metaSpend / metaImpressions) * 1000 : 0;

      return {
        countryCode,
        countryName,
        
        // Order numbers are completely unavailable inside schema.
        orderRevenue: null,
        orderCount: null,
        orderProfit: null,
        refundRate: null,
        paidOrderCount: null,
        averageOrderValue: null,
        orderFirstAt: null,
        orderLastAt: null,

        // Meta insights info block
        metaSpend,
        metaImpressions,
        metaClicks,
        metaPurchases,
        metaPurchaseValue,
        metaRoas,
        ctr,
        cpc,
        cpm,

        accountIds: Array.from(g.accountIds),
        mappedStoreIds: Array.from(g.mappedStoreIds),
        dataSourceExplain: "Meta country spend. Order fields not available in Prisma Order model."
      };
    })
    // Filter out rows by minSpend parameter
    .filter(row => row.metaSpend >= minSpend);

  // Sort rows by metaSpend descending
  mergedRows.sort((a, b) => b.metaSpend - a.metaSpend);

  const countriesCount = mergedRows.length;
  const unmappedSpendRate = totalMetaSpendOverall > 0 
    ? unmappedMetaSpendOverall / totalMetaSpendOverall 
    : 0;

  // Set up health and warnings
  const warnings: string[] = [];
  warnings.push("Order table lacks country, shipping, and billing address fields. Order country metrics are unavailable.");
  if (unmappedSpendRate > 0.05) {
    warnings.push(`High share of unmapped Meta Ad Account Spend: ${(unmappedSpendRate * 100).toFixed(1)}% of spend is associated with unmapped accounts.`);
  }

  return {
    rows: mergedRows,
    summary: {
      countriesCount,
      orderCountriesCount: 0, // Order country data unavailable
      metaCountriesCount: countriesCount,
      totalOrderRevenue: null,
      totalOrderCount: null,
      totalMetaSpend: totalMetaSpendOverall,
      totalMetaPurchases: totalMetaPurchasesOverall,
      totalMetaPurchaseValue: totalMetaPurchaseValueOverall,
      unmappedMetaSpend: unmappedMetaSpendOverall,
      unmappedMetaSpendRate: unmappedSpendRate
    },
    dataHealth: {
      orderCountryAvailable: false,
      metaCountryAvailable: rawBreakdowns.length > 0,
      unmappedAccountsCount: uniqueUnmappedAccountIds.size,
      unmappedSpendRate,
      warnings
    },
    dataSourceExplain: {
      orderPrimarySource: "Order",
      metaPrimarySource: "FactAudienceBreakdown",
      adInsightUsed: false,
      dailySummaryUsed: false,
      storeMappingUsed: true,
      countryJoinKey: "countryCode",
      storeRoasMeaning: "Unavailable due to Order country data absence.",
      orderUnavailableReason: "Order model schema lacks shippingCountry or equivalent fields."
    }
  };
}
