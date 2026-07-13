export type CountryAnalyticsWarningCode =
  | "STORE_REVENUE_WITHOUT_ORDER_COUNT"
  | "PROFIT_UNAVAILABLE"
  | "ORDER_DEDUP_FALLBACK_USED"
  | "REFUND_AMOUNT_UNAVAILABLE"
  | "ORDER_BUSINESS_TIME_UNAVAILABLE";

export type CountryAnalyticsLikeRow = {
  orderCount?: number | null;
  orderRevenue?: number | null;
  orderProfit?: number | null;
  orderFirstAt?: string | null;
  orderLastAt?: string | null;
  metaSpend?: number | null;
  metaPurchases?: number | null;
  metaPurchaseValue?: number | null;
};

export type CountrySummary = {
  countriesCount: number;
  countryCount: number;
  orderCountriesCount: number;
  metaCountriesCount: number;
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  totalOrderRevenue: number;
  totalOrderCount: number;
  totalMetaSpend: number;
  totalMetaPurchases: number;
  totalMetaPurchaseValue: number;
  orderProfit: number | null;
};

function numberOrZero(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function hasStoreCountryFacts(row: CountryAnalyticsLikeRow): boolean {
  return numberOrZero(row.orderCount) > 0 || numberOrZero(row.orderRevenue) > 0;
}

export function filterStoreOrderCountryRows<T extends CountryAnalyticsLikeRow>(rows: T[]): T[] {
  return rows.filter(hasStoreCountryFacts);
}

export function collectCountryRowWarnings(rows: CountryAnalyticsLikeRow[]): CountryAnalyticsWarningCode[] {
  const warnings = new Set<CountryAnalyticsWarningCode>();

  for (const row of rows) {
    if (numberOrZero(row.orderRevenue) > 0 && numberOrZero(row.orderCount) === 0) {
      warnings.add("STORE_REVENUE_WITHOUT_ORDER_COUNT");
    }

    if (hasStoreCountryFacts(row) && row.orderProfit === null) {
      warnings.add("PROFIT_UNAVAILABLE");
    }

    if (hasStoreCountryFacts(row) && (!row.orderFirstAt || !row.orderLastAt)) {
      warnings.add("ORDER_BUSINESS_TIME_UNAVAILABLE");
    }
  }

  return Array.from(warnings);
}

export function applyMinOrdersFilter<T extends CountryAnalyticsLikeRow>(rows: T[], minOrders = 0) {
  const threshold = Number.isFinite(Number(minOrders)) ? Number(minOrders) : 0;
  if (threshold <= 0) {
    return {
      rows,
      warnings: collectCountryRowWarnings(rows)
    };
  }

  const removedRows = rows.filter(row => numberOrZero(row.orderCount) < threshold);
  const filteredRows = rows.filter(row => numberOrZero(row.orderCount) >= threshold);
  const warnings = collectCountryRowWarnings(rows);

  if (removedRows.some(row => numberOrZero(row.orderRevenue) > 0 && numberOrZero(row.orderCount) === 0)) {
    warnings.push("STORE_REVENUE_WITHOUT_ORDER_COUNT");
  }

  return {
    rows: filteredRows,
    warnings: Array.from(new Set(warnings))
  };
}

export function summarizeCountryRows(rows: CountryAnalyticsLikeRow[]): CountrySummary {
  const orderCount = rows.reduce((sum, row) => sum + numberOrZero(row.orderCount), 0);
  const revenue = rows.reduce((sum, row) => sum + numberOrZero(row.orderRevenue), 0);
  const totalMetaSpend = rows.reduce((sum, row) => sum + numberOrZero(row.metaSpend), 0);
  const totalMetaPurchases = rows.reduce((sum, row) => sum + numberOrZero(row.metaPurchases), 0);
  const totalMetaPurchaseValue = rows.reduce((sum, row) => sum + numberOrZero(row.metaPurchaseValue), 0);
  const hasUnavailableProfit = rows.some(row => hasStoreCountryFacts(row) && row.orderProfit === null);
  const orderProfit = hasUnavailableProfit
    ? null
    : rows.reduce((sum, row) => sum + numberOrZero(row.orderProfit), 0);

  return {
    countriesCount: rows.length,
    countryCount: rows.length,
    orderCountriesCount: rows.filter(row => numberOrZero(row.orderCount) > 0).length,
    metaCountriesCount: rows.filter(row => numberOrZero(row.metaSpend) > 0).length,
    orderCount,
    revenue,
    averageOrderValue: orderCount > 0 ? revenue / orderCount : 0,
    totalOrderRevenue: revenue,
    totalOrderCount: orderCount,
    totalMetaSpend,
    totalMetaPurchases,
    totalMetaPurchaseValue,
    orderProfit
  };
}
