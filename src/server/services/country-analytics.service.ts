import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getStoreOrderFacts, normalizeStoreOrderFacts } from "./order-fact.service.js";
import {
  applyMinOrdersFilter,
  collectCountryRowWarnings,
  filterStoreOrderCountryRows,
  summarizeCountryRows
} from "./country-analytics.logic.js";

export interface CountryAnalyticsResult {
  rows: MergedCountryRow[];
  summary: {
    countriesCount: number;
    countryCount: number;
    orderCountriesCount: number;
    metaCountriesCount: number;
    orderCount: number;
    revenue: number;
    averageOrderValue: number;
    totalOrderRevenue: number | null;
    totalOrderCount: number | null;
    totalMetaSpend: number;
    totalMetaPurchases: number;
    totalMetaPurchaseValue: number;
    orderProfit: number | null;
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
    legacyInsightUsed: boolean;
    legacySummaryUsed: boolean;
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
      adAccountStoreMap.set(normalizeMetaAccountId(m.fbAccountId), m.storeId);
    }
  }
  for (const a of adAccounts) {
    if (a.fb_account_id && a.storeId) {
      adAccountStoreMap.set(normalizeMetaAccountId(a.fb_account_id), a.storeId);
    }
  }

  // Determine unmapped accounts in the database for health reporting
  const allAccountIdsInMappings = new Set([
    ...accountMappings.map(m => m.fbAccountId ? normalizeMetaAccountId(m.fbAccountId) : ""),
    ...adAccounts.map(a => a.fb_account_id ? normalizeMetaAccountId(a.fb_account_id) : "")
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
    const aid = item.account_id ? normalizeMetaAccountId(item.account_id) : "";
    const mappedStoreId = aid ? adAccountStoreMap.get(aid) : undefined;

    // If storeId filter is active, check if it matches
    if (filterStoreId && filterStoreId !== "all") {
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

  // 3. Query and aggregate real database order country performance.
  // Countries reuses the canonical Store order fact helper for date, storeId,
  // payment status, deduplication, refund availability, and business date rules.
  const dbOrders = await getStoreOrderFacts({
    startDate,
    endDate,
    storeId: filterStoreId || "all"
  });
  const normalizedOrders = normalizeStoreOrderFacts(dbOrders);

  const orderCountryGroup: Record<string, {
    countryCode: string;
    countryName: string;
    revenue: number;
    profit: number | null;
    totalOrders: number;
    refundedCount: number;
    refundAmountUnavailable: boolean;
    firstAt: string | null;
    lastAt: string | null;
  }> = {};

  for (const order of normalizedOrders.orders) {
    const resolvedCountryCode = order.countryCode;
    const resolvedCountryName = order.countryName || COUNTRY_NAME_MAP[resolvedCountryCode] || resolvedCountryCode;

    if (!orderCountryGroup[resolvedCountryCode]) {
      orderCountryGroup[resolvedCountryCode] = {
        countryCode: resolvedCountryCode,
        countryName: resolvedCountryName,
        revenue: 0,
        profit: 0,
        totalOrders: 0,
        refundedCount: 0,
        refundAmountUnavailable: false,
        firstAt: null,
        lastAt: null
      };
    }

    const og = orderCountryGroup[resolvedCountryCode];
    og.revenue += order.revenue;
    if (og.profit === null || order.profit === null) {
      og.profit = null;
    } else {
      og.profit += order.profit;
    }
    og.totalOrders++;
    if (order.refunded) {
      og.refundedCount++;
      if (!order.refundAmountAvailable) {
        og.refundAmountUnavailable = true;
      }
    }

    if (order.businessDateFirst) {
      if (!og.firstAt || order.businessDateFirst < og.firstAt) og.firstAt = order.businessDateFirst;
    }
    if (order.businessDateLast) {
      if (!og.lastAt || order.businessDateLast > og.lastAt) og.lastAt = order.businessDateLast;
    }
  }

  // 4. Combine the Union of all countries
  const allCountryCodes = Array.from(new Set([
    ...Object.keys(countryBreakdownGroup),
    ...Object.keys(orderCountryGroup)
  ]));

  // Convert map to final rows with formula metrics
  const storeCountryRows: MergedCountryRow[] = filterStoreOrderCountryRows(
    allCountryCodes.map(countryCode => {
      const g = countryBreakdownGroup[countryCode];
      const og = orderCountryGroup[countryCode];
      const countryName = og?.countryName || COUNTRY_NAME_MAP[countryCode] || countryCode;

      const metaSpend = g ? g.spend : 0;
      const metaImpressions = g ? g.impressions : 0;
      const metaClicks = g ? g.clicks : 0;
      const metaPurchases = g ? g.purchases : 0;
      const metaPurchaseValue = g ? g.purchaseValue : 0;

      const metaRoas = metaSpend > 0 ? metaPurchaseValue / metaSpend : null;
      const ctr = metaImpressions > 0 ? metaClicks / metaImpressions : 0;
      const cpc = metaClicks > 0 ? metaSpend / metaClicks : 0;
      const cpm = metaImpressions > 0 ? (metaSpend / metaImpressions) * 1000 : 0;

      const orderRevenue = og ? og.revenue : null;
      const orderCount = og ? og.totalOrders : null;
      const orderProfit = og ? og.profit : null;
      const refundRate = og && og.totalOrders > 0
        ? og.refundedCount / og.totalOrders
        : null;
      const paidOrderCount = og ? og.totalOrders : null;
      const averageOrderValue = og && og.totalOrders > 0 ? (og.revenue / og.totalOrders) : null;
      const orderFirstAt = og?.firstAt || null;
      const orderLastAt = og?.lastAt || null;

      const accountIds = g ? Array.from(g.accountIds) : [];
      const mappedStoreIds = g ? Array.from(g.mappedStoreIds) : [];

      return {
        countryCode,
        countryName,
        
        orderRevenue,
        orderCount,
        orderProfit,
        refundRate,
        paidOrderCount,
        averageOrderValue,
        orderFirstAt,
        orderLastAt,

        metaSpend,
        metaImpressions,
        metaClicks,
        metaPurchases,
        metaPurchaseValue,
        metaRoas,
        ctr,
        cpc,
        cpm,

        accountIds,
        mappedStoreIds,
        dataSourceExplain: `Store-order country aggregate. Date field=Order.store_local_date; country=Order.${og?.totalOrders ? "shippingCountryCode/billingCountryCode" : "none"}; Meta metrics are attached only for this store-order country.`
      };
    })
  );

  const minOrdersResult = applyMinOrdersFilter(storeCountryRows, minOrders);
  const mergedRows = minOrdersResult.rows as MergedCountryRow[];

  // Sort rows by Store order facts first. Meta spend is only an attached diagnostic metric here.
  mergedRows.sort((a, b) => {
    const revenueDiff = (b.orderRevenue || 0) - (a.orderRevenue || 0);
    if (Math.abs(revenueDiff) > 0.01) return revenueDiff;
    const orderDiff = (b.orderCount || 0) - (a.orderCount || 0);
    if (orderDiff !== 0) return orderDiff;
    return b.metaSpend - a.metaSpend;
  });

  const countriesCount = mergedRows.length;
  const orderCountriesCount = mergedRows.filter(r => (r.orderCount || 0) > 0).length;
  const metaCountriesCount = mergedRows.filter(r => r.metaSpend > 0).length;
  const rowSummary = summarizeCountryRows(mergedRows);

  const unmappedSpendRate = totalMetaSpendOverall > 0 
    ? unmappedMetaSpendOverall / totalMetaSpendOverall 
    : 0;

  // Set up health and warnings
  const warnings: string[] = [];
  for (const warning of normalizedOrders.warnings) warnings.push(warning);
  for (const warning of minOrdersResult.warnings) warnings.push(warning);
  for (const warning of collectCountryRowWarnings(mergedRows)) warnings.push(warning);
  if (unmappedSpendRate > 0.05) {
    warnings.push(`High share of unmapped Meta Ad Account Spend: ${(unmappedSpendRate * 100).toFixed(1)}% of spend is associated with unmapped accounts.`);
  }
  if (minSpend > 0) {
    warnings.push("COUNTRIES_STORE_SCOPE_IGNORES_MIN_SPEND");
  }

  const hasCountryFieldData = dbOrders.some(r => r.shippingCountryCode || r.billingCountryCode);
  if (dbOrders.length > 0 && !hasCountryFieldData) {
    warnings.push("ORDER_COUNTRY_BACKFILL_REQUIRED");
  }

  const orderCountryAvailable = dbOrders.length > 0 && hasCountryFieldData;

  return {
    rows: mergedRows,
    summary: {
      countriesCount,
      countryCount: rowSummary.countryCount,
      orderCountriesCount,
      metaCountriesCount,
      orderCount: rowSummary.orderCount,
      revenue: Number(rowSummary.revenue.toFixed(4)),
      averageOrderValue: Number(rowSummary.averageOrderValue.toFixed(4)),
      totalOrderRevenue: Number(rowSummary.revenue.toFixed(4)),
      totalOrderCount: rowSummary.orderCount,
      totalMetaSpend: Number(rowSummary.totalMetaSpend.toFixed(4)),
      totalMetaPurchases: Number(rowSummary.totalMetaPurchases.toFixed(4)),
      totalMetaPurchaseValue: Number(rowSummary.totalMetaPurchaseValue.toFixed(4)),
      orderProfit: rowSummary.orderProfit === null ? null : Number(rowSummary.orderProfit.toFixed(4)),
      unmappedMetaSpend: unmappedMetaSpendOverall,
      unmappedMetaSpendRate: unmappedSpendRate
    },
    dataHealth: {
      orderCountryAvailable,
      metaCountryAvailable: rawBreakdowns.length > 0,
      unmappedAccountsCount: uniqueUnmappedAccountIds.size,
      unmappedSpendRate,
      warnings: Array.from(new Set(warnings))
    },
    dataSourceExplain: {
      orderPrimarySource: hasCountryFieldData ? "Order.shippingCountryCode" : "none",
      metaPrimarySource: "FactAudienceBreakdown",
      legacyInsightUsed: false,
      legacySummaryUsed: false,
      storeMappingUsed: true,
      countryJoinKey: "countryCode",
      storeRoasMeaning: "Total order revenue divided by Meta country spend.",
      orderUnavailableReason: dbOrders.length > 0 ? (hasCountryFieldData ? "OK" : "ORDER_COUNTRY_BACKFILL_REQUIRED") : "No country-related orders parsed for this store range."
    }
  };
}
