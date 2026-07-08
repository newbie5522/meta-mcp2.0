const BASE_URL = process.env.RCA_BASE_URL || "http://127.0.0.1:3000";
const TIMEZONE = "America/Los_Angeles";

function laDate(offsetDays = 0) {
  const now = new Date();
  const la = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  la.setDate(la.getDate() + offsetDays);
  return la.toISOString().slice(0, 10);
}

const today = laDate(0);
const yesterday = laDate(-1);

const ranges = {
  today: [today, today],
  yesterday: [yesterday, yesterday],
  past_7: [laDate(-6), today],
  past_14: [laDate(-13), today],
  past_30: [laDate(-29), today]
};

const endpoints = [
  { name: "detail", path: "/api/data-center/detail" },
  { name: "accounts-performance", path: "/api/data-center/accounts-performance" },
  { name: "ad-hierarchy-accounts", path: "/api/data-center/ad-hierarchy/accounts", extra: { includeZeroSpend: "true" } },
  { name: "audience-country", path: "/api/data-center/audience", extra: { dimensionType: "country", dimension: "country", includeZeroSpend: "true" } },
  { name: "creative-insights", path: "/api/data-center/creative-insights", extra: { pageSize: "5", includeZeroSpend: "true" } },
  { name: "products", path: "/api/data-center/products" },
  { name: "countries", path: "/api/data-center/countries" }
];

function pickRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.accounts)) return payload.accounts;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.stores)) return payload.stores;
  return [];
}

function pickDateRange(payload) {
  const range = payload?.dateRange || payload?.appliedFilters || payload?.dataHealth?.dateRange || payload?.health?.dateRange || {};
  const start = range.startDate || payload?.startDate || "";
  const end = range.endDate || payload?.endDate || "";
  return start || end ? `${start}..${end}` : "";
}

function pickMetric(payload, rows, key) {
  const value =
    payload?.summary?.[key] ??
    payload?.totals?.[key] ??
    payload?.dataHealth?.[key] ??
    payload?.health?.[key] ??
    payload?.metaReconciliation?.[key] ??
    null;

  if (value !== null && value !== undefined) return Number(value) || 0;

  return rows.reduce((sum, row) => {
    const candidates = [
      key,
      key === "purchaseValue" ? "purchase_value" : key,
      key === "purchaseValue" ? "metaPurchaseValue" : key,
      key === "purchases" ? "metaPurchases" : key,
      key === "spend" ? "metaSpend" : key
    ];
    const found = candidates.find(candidate => row?.[candidate] !== undefined && row?.[candidate] !== null);
    return sum + Number(found ? row[found] : 0);
  }, 0);
}

function pickFactRows(payload) {
  return (
    payload?.dataHealth?.factRows ??
    payload?.health?.factRows ??
    payload?.metaReconciliation?.canonicalFactRows ??
    payload?.total ??
    null
  );
}

async function requestEndpoint(endpoint, rangeName, startDate, endDate) {
  const url = new URL(endpoint.path, BASE_URL);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  for (const [key, value] of Object.entries(endpoint.extra || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { parseError: text.slice(0, 200) };
  }

  const rows = pickRows(payload);
  return {
    endpoint: endpoint.name,
    range: rangeName,
    request: `${startDate}..${endDate}`,
    response: pickDateRange(payload),
    status: response.status,
    rowCount: rows.length,
    factRows: pickFactRows(payload),
    spend: pickMetric(payload, rows, "spend"),
    impressions: pickMetric(payload, rows, "impressions"),
    clicks: pickMetric(payload, rows, "clicks"),
    purchases: pickMetric(payload, rows, "purchases")
  };
}

function printTable(rows) {
  console.log("| endpoint | range | request start/end | response dateRange | http | rowCount | factRows | spend | impressions | clicks | purchases |");
  console.log("|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    console.log(
      `| ${row.endpoint} | ${row.range} | ${row.request} | ${row.response} | ${row.status} | ${row.rowCount} | ${row.factRows ?? ""} | ${Number(row.spend || 0).toFixed(2)} | ${Math.round(Number(row.impressions || 0))} | ${Math.round(Number(row.clicks || 0))} | ${Math.round(Number(row.purchases || 0))} |`
    );
  }
}

async function main() {
  const rows = [];
  for (const [rangeName, [startDate, endDate]] of Object.entries(ranges)) {
    for (const endpoint of endpoints) {
      try {
        rows.push(await requestEndpoint(endpoint, rangeName, startDate, endDate));
      } catch (error) {
        rows.push({
          endpoint: endpoint.name,
          range: rangeName,
          request: `${startDate}..${endDate}`,
          response: "REQUEST_FAILED",
          status: "ERR",
          rowCount: 0,
          factRows: "",
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          error: error?.message || String(error)
        });
      }
    }
  }

  printTable(rows);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
