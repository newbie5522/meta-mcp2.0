import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.RCA_BASE_URL || "http://127.0.0.1:3000";
const today = new Date().toISOString().slice(0, 10);
const DEFAULT_PARAMS = {
  startDate: process.env.RCA_START_DATE || today,
  endDate: process.env.RCA_END_DATE || today,
  storeId: process.env.RCA_STORE_ID || "all"
};
const OUTPUT_FILE = path.join("docs", "r5-data-scope-consistency-output.md");

async function getJson(routePath, params) {
  const url = new URL(routePath, BASE_URL);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  try {
    const res = await fetch(url);
    const text = await res.text();
    try {
      return {
        ok: res.ok,
        status: res.status,
        url: url.toString(),
        payload: JSON.parse(text)
      };
    } catch {
      return {
        ok: false,
        status: res.status,
        url: url.toString(),
        payload: { raw: text.slice(0, 500) }
      };
    }
  } catch (error) {
    return {
      ok: false,
      status: "FETCH_ERROR",
      url: url.toString(),
      payload: { error: error?.message || String(error) }
    };
  }
}

function asRows(payload) {
  const value = payload?.payload || payload;
  const rows = value?.rows || value?.data?.rows || value?.data || [];
  return Array.isArray(rows) ? rows : [];
}

function pickOrderCount(payload) {
  const value = payload?.payload || payload;
  return Number(
    value?.summary?.store?.orderCount ??
      value?.summary?.orderCount ??
      value?.summary?.totalOrderCount ??
      value?.summary?.orders ??
      value?.totals?.orderCount ??
      value?.data?.summary?.orderCount ??
      value?.data?.summary?.totalOrderCount ??
      0
  );
}

function pickRevenue(payload) {
  const value = payload?.payload || payload;
  return Number(
    value?.summary?.store?.revenue ??
      value?.summary?.revenue ??
      value?.summary?.totalOrderRevenue ??
      value?.summary?.sales ??
      value?.totals?.revenue ??
      value?.data?.summary?.revenue ??
      value?.data?.summary?.totalOrderRevenue ??
      0
  );
}

function sumCountryOrders(payload) {
  return asRows(payload).reduce((sum, row) => (
    sum + Number(row.orderCount || row.orders || row.totalOrders || 0)
  ), 0);
}

function sumCountryRevenue(payload) {
  return asRows(payload).reduce((sum, row) => (
    sum + Number(row.revenue || row.totalRevenue || row.orderRevenue || 0)
  ), 0);
}

function pickStorePageOrderCount(payload) {
  const value = payload?.payload || payload;
  const direct = pickOrderCount(payload);
  if (direct > 0) return direct;

  return asRows(value).reduce((sum, row) => (
    sum + Number(row.orderCount || row.orders || row.totalOrders || row.ordersCount || 0)
  ), 0);
}

function diffOrNull(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (left === 0 || right === 0) return null;
  return left - right;
}

async function runCase(label, params) {
  const requestParams = { ...DEFAULT_PARAMS, ...params };
  const audience = await getJson("/api/data-center/audience", requestParams);
  const countries = await getJson("/api/data-center/countries", requestParams);
  const stores = await getJson("/api/data-center/stores", requestParams);
  const products = await getJson("/api/data-center/products", requestParams);
  const creatives = await getJson("/api/data-center/creative-insights", requestParams);

  const audienceStoreOrders = pickOrderCount(audience);
  const countriesSummaryOrders = pickOrderCount(countries);
  const countriesRowOrders = sumCountryOrders(countries);
  const storePageOrders = pickStorePageOrderCount(stores);
  const productPageOrders = pickOrderCount(products);

  return {
    label,
    params: requestParams,
    endpoints: { audience, countries, stores, products, creatives },
    metrics: {
      audienceStoreOrders,
      countriesSummaryOrders,
      countriesRowOrders,
      storePageOrders,
      productPageOrders,
      audienceRevenue: pickRevenue(audience),
      countriesSummaryRevenue: pickRevenue(countries),
      countriesRowRevenue: sumCountryRevenue(countries),
      storeVsAudience: diffOrNull(storePageOrders, audienceStoreOrders),
      audienceVsCountries: diffOrNull(audienceStoreOrders, countriesSummaryOrders),
      countriesSummaryVsRows: countriesSummaryOrders - countriesRowOrders,
      productVsStore: diffOrNull(productPageOrders, storePageOrders)
    }
  };
}

function endpointCell(result, key) {
  const item = result.endpoints[key];
  return item.ok ? `OK ${item.status}` : `${item.status}`;
}

function boolCell(value) {
  if (value === null) return "N/A";
  return value === 0 ? "PASS" : `DIFF ${value}`;
}

function toMarkdown(results) {
  const lines = [
    "# R5 Data Scope Consistency Output",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Base URL: ${BASE_URL}`,
    "",
    "This script is read-only. It calls local HTTP APIs and writes this Markdown report only.",
    "",
    "| Case | Date range | Store | Audience store orders | Countries summary orders | Countries row orders | Store page orders | Product orders | Audience vs countries | Countries summary vs rows | Store vs audience | Product vs store | API status |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |"
  ];

  for (const result of results) {
    const m = result.metrics;
    const p = result.params;
    lines.push([
      result.label,
      `${p.startDate} ~ ${p.endDate}`,
      p.storeId,
      m.audienceStoreOrders,
      m.countriesSummaryOrders,
      m.countriesRowOrders,
      m.storePageOrders,
      m.productPageOrders,
      boolCell(m.audienceVsCountries),
      boolCell(m.countriesSummaryVsRows),
      boolCell(m.storeVsAudience),
      boolCell(m.productVsStore),
      [
        `audience ${endpointCell(result, "audience")}`,
        `countries ${endpointCell(result, "countries")}`,
        `stores ${endpointCell(result, "stores")}`,
        `products ${endpointCell(result, "products")}`,
        `creatives ${endpointCell(result, "creatives")}`
      ].join("<br>")
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `N/A` means at least one compared side was zero or unavailable, so the script does not assert consistency.");
  lines.push("- API failures are reported as status values and must be re-run during the unified verification pass.");
  lines.push("- Creative metrics are called for scope coverage; creative purchases are Meta purchases and are not compared to store orders.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const results = [
    await runCase("default", DEFAULT_PARAMS)
  ];
  const markdown = toMarkdown(results);
  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, markdown, "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error("[r5-data-scope-consistency] failed", error);
  process.exitCode = 1;
});
