import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";

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

function buildStoreOrderCountryWhere({
  startDate,
  endDate,
  storeId
}: {
  startDate: string;
  endDate: string;
  storeId?: string | number | null;
}) {
  const where: any = {
    store_local_date: {
      gte: startDate,
      lte: endDate
    }
  };

  if (storeId && storeId !== "all" && storeId !== "undefined") {
    where.storeId = Number(storeId);
  }

  return where;
}

function filterNonZeroCountryRows(rows: MergedCountryRow[]) {
  return rows.filter(row =>
    Number(row.orderCount || 0) > 0 ||
    Number(row.orderRevenue || 0) > 0 ||
    Number(row.metaSpend || 0) > 0 ||
    Number(row.metaImpressions || 0) > 0 ||
    Number(row.metaClicks || 0) > 0 ||
    Number(row.metaPurchases || 0) > 0
  );
}

function summarizeCountryRows(rows: MergedCountryRow[]) {
  const orderCount = rows.reduce((sum, row) => sum + Number(row.orderCount || 0), 0);
  const revenue = rows.reduce((sum, row) => sum + Number(row.orderRevenue || 0), 0);

  return {
    orderCount,
    revenue,
    averageOrderValue: orderCount > 0 ? revenue / orderCount : 0,
    countryCount: rows.length
  };
}

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

  // 3. Query and aggregate real database order country performance
  const orderWhereClause = buildStoreOrderCountryWhere({
    startDate,
    endDate,
    storeId: filterStoreId
  });

  const dbOrders = await prisma.order.findMany({
    where: orderWhereClause
  });

  // Group line items by unique orderId (or fallback to id if orderId is missing)
  const ordersGroupedById = new Map<string, any[]>();
  for (const row of dbOrders) {
    const key = String(row.orderId || row.id);
    if (!ordersGroupedById.has(key)) {
      ordersGroupedById.set(key, []);
    }
    ordersGroupedById.get(key)!.push(row);
  }

  const orderCountryGroup: Record<string, {
    countryCode: string;
    revenue: number;
    profit: number;
    totalOrders: number;
    refundedCount: number;
    firstAt: Date | null;
    lastAt: Date | null;
  }> = {};

  for (const rows of ordersGroupedById.values()) {
    // 1. Determine country prioritizing shippingCountryCode, then billingCountryCode, else UNKNOWN
    let resolvedCountryCode = "UNKNOWN";
    let resolvedCountryName = "Unknown Country";

    for (const r of rows) {
      if (r.shippingCountryCode) {
        resolvedCountryCode = r.shippingCountryCode.trim().toUpperCase();
        resolvedCountryName = r.shippingCountryName || COUNTRY_NAME_MAP[resolvedCountryCode] || resolvedCountryCode;
        break;
      }
    }

    if (resolvedCountryCode === "UNKNOWN") {
      for (const r of rows) {
        if (r.billingCountryCode) {
          resolvedCountryCode = r.billingCountryCode.trim().toUpperCase();
          resolvedCountryName = r.billingCountryName || COUNTRY_NAME_MAP[resolvedCountryCode] || resolvedCountryCode;
          break;
        }
      }
    }

    // 2. Determine revenue prioritizing orderTotal else sum of line revenues
    let orderTotalVal: number | null = null;
    for (const r of rows) {
      if (r.orderTotal !== null && r.orderTotal !== undefined) {
        orderTotalVal = r.orderTotal;
        break;
      }
    }

    const calculatedRevenue = orderTotalVal !== null ? orderTotalVal : rows.reduce((sum, r) => sum + (r.revenue || 0), 0);
    const calculatedProfit = rows.reduce((sum, r) => sum + (r.profit || 0), 0) || (calculatedRevenue * 0.4);
    const hasRefund = rows.some(r => r.refunded);

    if (!orderCountryGroup[resolvedCountryCode]) {
      orderCountryGroup[resolvedCountryCode] = {
        countryCode: resolvedCountryCode,
        revenue: 0,
        profit: 0,
        totalOrders: 0,
        refundedCount: 0,
        firstAt: null,
        lastAt: null
      };
    }

    const og = orderCountryGroup[resolvedCountryCode];
    og.revenue += calculatedRevenue;
    og.profit += calculatedProfit;
    og.totalOrders++;
    if (hasRefund) {
      og.refundedCount++;
    }

    for (const r of rows) {
      const dateObj = r.createdAt;
      if (dateObj) {
        if (!og.firstAt || dateObj < og.firstAt) og.firstAt = dateObj;
        if (!og.lastAt || dateObj > og.lastAt) og.lastAt = dateObj;
      }
    }
  }

  // 4. Combine the Union of all countries
  const allCountryCodes = Array.from(new Set([
    ...Object.keys(countryBreakdownGroup),
    ...Object.keys(orderCountryGroup)
  ]));

  // Convert map to final rows with formula metrics
  const mergedRows: MergedCountryRow[] = filterNonZeroCountryRows(
    allCountryCodes.map(countryCode => {
      const g = countryBreakdownGroup[countryCode];
      const og = orderCountryGroup[countryCode];
      const countryName = COUNTRY_NAME_MAP[countryCode] || countryCode;

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
      const refundRate = og && og.totalOrders > 0 ? (og.refundedCount / og.totalOrders) : null;
      const paidOrderCount = og ? og.totalOrders : null;
      const averageOrderValue = og && og.totalOrders > 0 ? (og.revenue / og.totalOrders) : null;
      const orderFirstAt = og && og.firstAt ? og.firstAt.toISOString() : null;
      const orderLastAt = og && og.lastAt ? og.lastAt.toISOString() : null;

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
        dataSourceExplain: `Prisma Unified Country Aggregate (Order-resolved + Meta action-insights). resolved via Order.${og?.totalOrders ? "shippingCountryCode/billingCountryCode" : "none"}`
      };
    })
  )
    // Filter out rows by minSpend or minOrders parameter
    .filter(row => {
      const spendOk = row.metaSpend >= minSpend;
      const ordersOk = (row.orderCount || 0) >= minOrders;
      return spendOk && ordersOk;
    });

  // Sort rows by metaSpend or orderRevenue descending
  mergedRows.sort((a, b) => {
    const spendDiff = b.metaSpend - a.metaSpend;
    if (Math.abs(spendDiff) > 0.01) return spendDiff;
    return (b.orderRevenue || 0) - (a.orderRevenue || 0);
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
  if (unmappedSpendRate > 0.05) {
    warnings.push(`High share of unmapped Meta Ad Account Spend: ${(unmappedSpendRate * 100).toFixed(1)}% of spend is associated with unmapped accounts.`);
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
      totalMetaSpend: totalMetaSpendOverall,
      totalMetaPurchases: totalMetaPurchasesOverall,
      totalMetaPurchaseValue: totalMetaPurchaseValueOverall,
      unmappedMetaSpend: unmappedMetaSpendOverall,
      unmappedMetaSpendRate: unmappedSpendRate
    },
    dataHealth: {
      orderCountryAvailable,
      metaCountryAvailable: rawBreakdowns.length > 0,
      unmappedAccountsCount: uniqueUnmappedAccountIds.size,
      unmappedSpendRate,
      warnings
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
