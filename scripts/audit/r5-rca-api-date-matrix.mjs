const BASE_URL = process.env.RCA_BASE_URL || "http://127.0.0.1:3000";
const TIMEZONE = "America/Los_Angeles";

function laDate(offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const base = new Date(`${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}-${parts.find(part => part.type === "day").value}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

const today = laDate();
const ranges = {
  today: [today, today],
  yesterday: [laDate(-1), laDate(-1)],
  past_7: [laDate(-6), today],
  past_14: [laDate(-13), today],
  past_30: [laDate(-29), today]
};

const endpoints = [
  { name: "detail", path: "/api/data-center/detail", splitCoverage: true },
  { name: "accounts-performance", path: "/api/data-center/accounts-performance" },
  { name: "ad-hierarchy", path: "/api/data-center/ad-hierarchy/accounts", extra: { includeZeroSpend: "true" } },
  { name: "audience", path: "/api/data-center/audience", extra: { dimensionType: "country", includeZeroSpend: "true" }, splitCoverage: true },
  { name: "creative-insights", path: "/api/data-center/creative-insights", extra: { includeZeroSpend: "true", export: "true" } },
  { name: "products", path: "/api/data-center/products" },
  { name: "countries", path: "/api/data-center/countries", splitCoverage: true },
  { name: "stores", path: "/api/data-center/stores", splitCoverage: true },
  { name: "source-freshness", path: "/api/data-center/max-date", freshness: true }
];

const scopeVariants = [
  { name: "all-stores", extra: {} },
  { name: "store-1", extra: { storeId: "1" } },
  { name: "unmapped-store", extra: { storeId: "999999999" } },
  { name: "account", extra: { accountId: "act_audit_placeholder" } },
  { name: "campaign", extra: { accountId: "act_audit_placeholder", campaignId: "audit_campaign" } },
  { name: "adset", extra: { accountId: "act_audit_placeholder", campaignId: "audit_campaign", adsetId: "audit_adset" } },
  { name: "ad", extra: { accountId: "act_audit_placeholder", campaignId: "audit_campaign", adsetId: "audit_adset", adId: "audit_ad" } }
];

function rowsOf(payload) {
  for (const candidate of [payload?.performanceRows, payload?.data, payload?.rows, payload?.items, payload?.accounts, payload?.products, payload?.stores]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function rangeOf(payload) {
  const range = payload?.dateRange || payload?.appliedFilters || payload?.dataHealth?.dateRange || payload?.health?.dateRange || {};
  return {
    startDate: range.startDate || payload?.requestedStartDate || payload?.startDate || null,
    endDate: range.endDate || payload?.requestedEndDate || payload?.endDate || null
  };
}

function coverageOf(payload) {
  return payload?.coverage || payload?.sourceCoverage || payload?.dataHealth?.coverage || null;
}

function metricSum(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
}

function hasBusinessZero(value) {
  return typeof value === "number" && value === 0;
}

function numericZeroPaths(value, prefix = "summary") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${prefix}.${key}`;
    if (typeof child === "number" && child === 0) return [path];
    return child && typeof child === "object" ? numericZeroPaths(child, path) : [];
  });
}

function validate(payload, response, endpoint, startDate, endDate) {
  const failures = [];
  if (!response.ok) failures.push(`HTTP_${response.status}`);
  const responseRange = rangeOf(payload);
  if (responseRange.startDate !== startDate || responseRange.endDate !== endDate) {
    failures.push(`DATE_RANGE_MISMATCH:${responseRange.startDate}..${responseRange.endDate}`);
  }
  if (response.ok && String(payload?.status || payload?.dataHealth?.status || "").toUpperCase() === "ERROR") {
    failures.push("HTTP_200_ERROR_PAYLOAD");
  }

  const coverage = coverageOf(payload);
  if (coverage?.status === "READY" && coverage.latestAvailableDate && endDate > coverage.latestAvailableDate) {
    failures.push("READY_BEYOND_LATEST_AVAILABLE_DATE");
  }
  if (coverage?.status === "NOT_SYNCED" && numericZeroPaths(payload?.summary).length) {
    failures.push(`NOT_SYNCED_SUMMARY_ZERO:${numericZeroPaths(payload.summary).join(",")}`);
  }
  if (coverage?.status === "NOT_SYNCED") {
    const zeroRows = rowsOf(payload).filter(row =>
      ["spend", "impressions", "clicks", "purchases", "purchaseValue", "roas"].some(key => hasBusinessZero(row?.[key]))
    );
    if (zeroRows.length) failures.push("NOT_SYNCED_ROW_BUSINESS_ZERO");
  }
  if (endpoint.splitCoverage && (!payload?.storeCoverage || !payload?.metaCoverage)) {
    failures.push("STORE_META_COVERAGE_NOT_SEPARATED");
  }
  for (const row of rowsOf(payload)) {
    if ((row?.level === "adset" || row?.level === "ad") && row?.status === "ACTIVE") failures.push("FABRICATED_ACTIVE_STATUS");
    if (row?.hasPerformanceFacts === false) {
      for (const key of ["spend", "impressions", "clicks", "purchases", "purchaseValue", "ctr", "cpc", "cpm", "cpa", "roas"]) {
        if (row?.[key] !== null) failures.push(`STRUCTURE_ONLY_METRIC_NOT_NULL:${key}`);
      }
    }
    for (const key of ["reach", "frequency", "addToCart", "initiateCheckout", "budget"]) {
      const availableKey = `${key}Available`;
      if (row?.[availableKey] === false && row?.[key] !== null && row?.[key] !== undefined) {
        failures.push(`UNAVAILABLE_METRIC_NOT_NULL:${key}`);
      }
    }
  }
  if (endpoint.name === "creative-insights") {
    const rows = rowsOf(payload);
    if (rows.length === 0 && Number(payload?.bucketSummary?.watching || 0) > 0) failures.push("EMPTY_CREATIVE_HAS_WATCHING_BUCKET");
    if (payload?.summary?.spend !== null && Math.abs(Number(payload?.summary?.spend || 0) - metricSum(rows, "spend")) > 0.01) failures.push("CREATIVE_SUMMARY_ROW_SPEND_MISMATCH");
    if (payload?.filteredTotalCount !== undefined && payload?.pageRowCount !== undefined && Number(payload.pageRowCount) > Number(payload.filteredTotalCount)) failures.push("CREATIVE_PAGE_COUNT_GT_FILTERED_TOTAL");
    if (endpoint.extra?.export === "true" && Number(payload?.pageRowCount || 0) !== rows.length) failures.push("CREATIVE_EXPORT_PAGE_ROW_COUNT_MISMATCH");
  }
  if (endpoint.name === "stores-reconciliation") {
    if (payload?.ledgerRefresh?.readOnly !== true || payload?.ledgerRefresh?.success !== true) failures.push("RECONCILIATION_GET_NOT_MARKED_READ_ONLY");
    if (!payload?.reconciliation?.readOnly) failures.push("RECONCILIATION_SUMMARY_NOT_READ_ONLY");
    if (typeof payload?.reconciliation?.match !== "boolean") failures.push("RECONCILIATION_MATCH_NOT_COMPUTED");
  }
  if (coverage?.currentDayInProgress && !coverage?.asOfTime) {
    failures.push("CURRENT_DAY_MISSING_AS_OF_TIME");
  }
  if (endpoint.freshness) {
    const required = ["metaAccount", "metaAudience", "metaCreative", "storeOrder", "storeLedger", "productOrder"];
    const missing = required.filter(source => !payload?.sources?.[source]);
    if (missing.length) failures.push(`FRESHNESS_SOURCES_MISSING:${missing.join(",")}`);
    for (const [source, sourceCoverage] of Object.entries(payload?.sources || {})) {
      if (sourceCoverage?.status === "READY" && sourceCoverage.latestAvailableDate && endDate > sourceCoverage.latestAvailableDate) failures.push(`${source}:READY_BEYOND_LATEST`);
    }
  }
  return failures;
}

async function requestEndpoint(endpoint, rangeName, startDate, endDate) {
  const url = new URL(endpoint.path, BASE_URL);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  for (const [key, value] of Object.entries(endpoint.extra || {})) url.searchParams.set(key, value);
  const response = await fetch(url);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { parseError: text.slice(0, 200) }; }
  const rows = rowsOf(payload);
  const coverage = coverageOf(payload) || {};
  const failures = validate(payload, response, endpoint, startDate, endDate);
  return {
    endpoint: endpoint.name,
    range: rangeName,
    status: response.status,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    coverageStatus: coverage.status || (endpoint.freshness ? "PER_SOURCE" : "MISSING"),
    earliestAvailableDate: coverage.earliestAvailableDate || null,
    latestAvailableDate: coverage.latestAvailableDate || null,
    performanceCount: payload?.summary?.performanceCount ?? rows.length,
    structureOnlyCount: payload?.structureSummary?.structureOnlyCount ?? null,
    failures
  };
}

function printTable(results) {
  console.log("| endpoint | range | http | coverageStatus | earliestAvailableDate | latestAvailableDate | requestedStartDate | requestedEndDate | performanceCount | structureOnlyCount | assertions |");
  console.log("|---|---|---:|---|---|---|---|---|---:|---:|---|");
  for (const row of results) {
    console.log(`| ${row.endpoint} | ${row.range} | ${row.status} | ${row.coverageStatus} | ${row.earliestAvailableDate || ""} | ${row.latestAvailableDate || ""} | ${row.requestedStartDate} | ${row.requestedEndDate} | ${row.performanceCount ?? ""} | ${row.structureOnlyCount ?? ""} | ${row.failures.length ? row.failures.join(";") : "PASS"} |`);
  }
}

async function main() {
  const results = [];
  for (const [rangeName, [startDate, endDate]] of Object.entries(ranges)) {
    for (const endpoint of endpoints) {
      try {
        results.push(await requestEndpoint(endpoint, rangeName, startDate, endDate));
      } catch (error) {
        results.push({ endpoint: endpoint.name, range: rangeName, status: "ERR", requestedStartDate: startDate, requestedEndDate: endDate, coverageStatus: "REQUEST_FAILED", earliestAvailableDate: null, latestAvailableDate: null, performanceCount: null, structureOnlyCount: null, failures: [error?.message || String(error)] });
      }
    }
    for (const variant of scopeVariants) {
      try {
        results.push(await requestEndpoint({
          name: `creative-insights/${variant.name}`,
          path: "/api/data-center/creative-insights",
          extra: { includeZeroSpend: "true", ...variant.extra }
        }, rangeName, startDate, endDate));
      } catch (error) {
        results.push({ endpoint: `creative-insights/${variant.name}`, range: rangeName, status: "ERR", requestedStartDate: startDate, requestedEndDate: endDate, coverageStatus: "REQUEST_FAILED", earliestAvailableDate: null, latestAvailableDate: null, performanceCount: null, structureOnlyCount: null, failures: [error?.message || String(error)] });
      }
    }
    try {
      results.push(await requestEndpoint({
        name: "stores-reconciliation",
        path: "/api/data-center/stores/1/reconciliation",
        extra: {}
      }, rangeName, startDate, endDate));
    } catch (error) {
      results.push({ endpoint: "stores-reconciliation", range: rangeName, status: "ERR", requestedStartDate: startDate, requestedEndDate: endDate, coverageStatus: "REQUEST_FAILED", earliestAvailableDate: null, latestAvailableDate: null, performanceCount: null, structureOnlyCount: null, failures: [error?.message || String(error)] });
    }
  }
  printTable(results);
  const failures = results.flatMap(result => result.failures.map(failure => `${result.endpoint}/${result.range}: ${failure}`));
  if (failures.length) {
    console.error(`R5 API date matrix failed with ${failures.length} assertion(s).`);
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
