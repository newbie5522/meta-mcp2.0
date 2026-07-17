export function accountMetric(row: any, key: string): number | null {
  if (row?.hasPerformanceFacts !== true) return null;
  const value = row?.[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildAccountPerformanceTotals(rows: any[]) {
  const facts = rows.filter(row => row?.hasPerformanceFacts === true);

  if (facts.length === 0) {
    return {
      factAccountCount: 0,
      spend: null,
      impressions: null,
      clicks: null,
      purchases: null,
      purchaseValue: null,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      roas: null
    };
  }

  const spend = facts.reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
  const impressions = facts.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const clicks = facts.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const purchases = facts.reduce((sum, row) => sum + Number(row.purchases ?? 0), 0);
  const purchaseValue = facts.reduce((sum, row) => sum + Number(row.purchaseValue ?? row.purchase_value ?? 0), 0);

  return {
    factAccountCount: facts.length,
    spend,
    impressions,
    clicks,
    purchases,
    purchaseValue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpa: purchases > 0 ? spend / purchases : null,
    roas: spend > 0 ? purchaseValue / spend : 0
  };
}

export function displayAccountTotal(
  coverageStatus: string,
  value: number | null
) {
  const status = String(coverageStatus || "").toUpperCase();
  if (status === "TRUE_EMPTY") return 0;
  if (status === "READY" || status === "PARTIAL_COVERAGE") return value;
  return null;
}

export function compareAccountPerformanceValues(a: any, b: any, sortOrder: "asc" | "desc") {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === "string" || typeof b === "string") {
    const left = String(a);
    const right = String(b);
    return sortOrder === "asc" ? left.localeCompare(right) : right.localeCompare(left);
  }
  return sortOrder === "asc" ? Number(a) - Number(b) : Number(b) - Number(a);
}
