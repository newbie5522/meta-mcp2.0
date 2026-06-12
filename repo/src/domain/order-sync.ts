import axios, { type AxiosResponse } from "axios";
import { prisma } from "../db/prisma.js";
import type { Prisma } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { decryptStoreToken } from "./stores.js";
import { assertNoCustomerPrivateFields, normalizeShopOrder, sanitizeShopOrderPayload } from "../shop/privacy.js";
import { invalidateStoreAnalysisCaches } from "./cache-invalidation.js";
import { syncStoreProfile } from "./store-profile.js";
import {
  convertToStoreLocalTime,
  dateOnlyString,
  getStoreLocalDate,
  getUtcRangeForStoreLocalDateRange,
  localDateStringToUtcDate,
  normalizeTimezone,
  SYSTEM_DEFAULT_TIMEZONE,
} from "../shared/date-time.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export interface SyncStoreOrdersInput {
  storeId: string;
  rangeStart?: Date;
  rangeEnd?: Date;
  limit?: number;
  maxPages?: number;
  shoplineTimeOffset?: string;
}

type StorePlatform = "shopline" | "shoplazza" | "shopify";

interface StoreConnection {
  id: string;
  platform: StorePlatform;
  domain: string;
  apiBaseUrl: string;
  timezone?: string | null;
  timezoneSource?: string | null;
}

export interface StoreConnectionTestInput {
  platform: StorePlatform;
  domain: string;
  token: string;
}

interface ProbeResult {
  ok: true;
  stage: "products" | "orders";
  message: string;
  endpoint: string;
  attemptedPaths: string[];
  requestId?: string;
  sampleProducts: number;
  sampleOrders: number;
  products?: Array<Record<string, unknown>>;
  productProbeError?: string;
}

interface FetchResult {
  orders: unknown[];
  pages: number;
  endpoint: string;
  attemptedPaths: string[];
  requestId?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SHOPLINE_API_VERSION = "v20240301";
const SHOPIFY_API_VERSION = "2024-01";
const DEFAULT_TIME_OFFSET = process.env.SHOP_ORDER_TIME_OFFSET?.trim() || "-08:00";

const SHOPLAZZA_PRODUCT_CANDIDATES = [
  { version: "2022-01", json: false, path: "/openapi/2022-01/products" },
  { version: "2020-01", json: false, path: "/openapi/2020-01/products" },
  { version: "2022-01", json: true, path: "/openapi/2022-01/products.json" },
  { version: "2020-01", json: true, path: "/openapi/2020-01/products.json" },
];

const SHOPLAZZA_ORDER_CANDIDATES = [
  { version: "2022-01", json: false, path: "/openapi/2022-01/orders" },
  { version: "2020-01", json: false, path: "/openapi/2020-01/orders" },
  { version: "2022-01", json: true, path: "/openapi/2022-01/orders.json" },
  { version: "2020-01", json: true, path: "/openapi/2020-01/orders.json" },
];

const SHOPLINE_PRODUCT_CANDIDATES = [
  "/admin/openapi/v20240401/products/list.json",
  "/admin/openapi/v20240301/products/list.json",
  "/admin/openapi/v20230901/products/list.json",
  "/admin/openapi/v20230301/products/list.json",
  "/admin/openapi/v20240301/products.json",
  "/admin/openapi/v20240301/products",
  "/admin/openapi/v20230901/products.json",
  "/admin/openapi/v20230901/products",
  "/admin/openapi/v20230301/products.json",
  "/admin/openapi/v20230301/products",
  "/admin/openapi/v20220301/products.json",
  "/admin/openapi/v20220301/products",
  "/admin/openapi/v20201201/products.json",
  "/admin/openapi/v20201201/products",
  "/admin/openapi/products.json",
  "/admin/openapi/products",
  "/admin/api/v20200901/products.json",
  "/admin/api/products.json",
];

const SHOPLINE_ORDER_CANDIDATES = [
  "/admin/openapi/v20240401/orders/list.json",
  "/admin/openapi/v20240301/orders/list.json",
  "/admin/openapi/v20230901/orders/list.json",
  "/admin/openapi/v20240301/orders.json",
  "/admin/openapi/v20240301/orders",
  "/admin/openapi/v20230901/orders.json",
  "/admin/openapi/v20230901/orders",
  "/admin/openapi/v20230301/orders.json",
  "/admin/openapi/v20230301/orders",
  "/admin/openapi/v20220301/orders.json",
  "/admin/openapi/v20220301/orders",
  "/admin/openapi/v20201201/orders.json",
  "/admin/openapi/v20201201/orders",
  "/admin/openapi/orders.json",
  "/admin/openapi/orders",
  "/admin/api/v20200901/orders.json",
  "/admin/api/orders.json",
];

function cleanDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/admin(?:\/.*)?$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function resolveOrderRange(input: SyncStoreOrdersInput): { rangeStart: Date; rangeEnd: Date; startDate: string; endDate: string } {
  const rangeEnd = dateOnly(input.rangeEnd ?? new Date());
  const rangeStart = dateOnly(input.rangeStart ?? addDays(rangeEnd, -29));
  return {
    rangeStart,
    rangeEnd,
    startDate: rangeStart.toISOString().slice(0, 10),
    endDate: rangeEnd.toISOString().slice(0, 10),
  };
}

function localDateRange(input: SyncStoreOrdersInput) {
  const range = resolveOrderRange(input);
  return {
    ...range,
    startDate: dateOnlyString(range.rangeStart),
    endDate: dateOnlyString(range.rangeEnd),
  };
}

function formatStoreLocalBoundary(date: string, endOfDay: boolean, timezone?: string | null): string {
  const time = endOfDay ? "23:59:59" : "00:00:00";
  return dayjs.tz(`${date}T${time}`, normalizeTimezone(timezone)).format();
}

function getTimezoneOffsetStr(timezone?: string | null): string {
  if (!timezone) return DEFAULT_TIME_OFFSET;
  const value = timezone.trim();
  if (/^[+-]\d{2}:\d{2}$/.test(value) || value === "Z") return value;
  const match = value.match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return DEFAULT_TIME_OFFSET;
  const hour = Math.abs(Number(match[1])).toString().padStart(2, "0");
  const minute = match[2] ?? "00";
  return `${match[1].startsWith("-") ? "-" : "+"}${hour}:${minute}`;
}

function headersFor(platform: StorePlatform, token: string): Record<string, string> {
  if (platform === "shopline") {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }
  if (platform === "shopify") {
    return {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    };
  }
  return {
    "Access-Token": token,
    "Content-Type": "application/json",
  };
}

function buildUrl(store: StoreConnection, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `https://${cleanDomain(store.apiBaseUrl || store.domain)}${path}`;
}

function safeErrorPayload(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/(access[-_ ]?token|authorization|token)[=: ]+[^,\s"}]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function formatHttpError(error: unknown, url: string): Error {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error : new Error(String(error));
  const status = error.response?.status;
  const requestId = error.response?.headers?.["x-shopline-request-id"] ?? error.response?.headers?.["x-request-id"];
  const data = error.response?.data;
  const isCloudflare = typeof data === "string" && (data.includes("Just a moment...") || data.includes("<title>Just a moment...</title>"));
  const message = isCloudflare
    ? "检测到 Cloudflare/自定义域名拦截，请改用平台后台内部域名。"
    : status === 401
      ? "Token 无效或已过期。"
      : status === 403
        ? "权限不足，请确认私有应用已授权读取商品/订单。"
        : error.message;
  return new Error(`${message} URL: ${url}${status ? ` HTTP ${status}` : ""}${requestId ? ` Request ID: ${requestId}` : ""}${data ? ` Detail: ${safeErrorPayload(data)}` : ""}`);
}

async function axiosGet(store: StoreConnection, token: string, pathOrUrl: string, timeout = 20_000): Promise<AxiosResponse<unknown>> {
  const url = buildUrl(store, pathOrUrl);
  try {
    return await axios.get(url, {
      headers: headersFor(store.platform, token),
      timeout,
    });
  } catch (error) {
    throw formatHttpError(error, url);
  }
}

function extractArrayFromPayload(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  for (const key of ["data", "items", "result", "results"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (typeof value === "object" && value !== null) {
      const nested = extractArrayFromPayload(value, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export function extractOrders(payload: unknown): unknown[] {
  return extractArrayFromPayload(payload, ["orders"]);
}

export function extractProducts(payload: unknown): unknown[] {
  return extractArrayFromPayload(payload, ["products"]);
}

function productPreview(rawProduct: unknown): Record<string, unknown> {
  const product = typeof rawProduct === "object" && rawProduct !== null ? rawProduct as Record<string, unknown> : {};
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const firstVariant = typeof variants[0] === "object" && variants[0] !== null ? variants[0] as Record<string, unknown> : {};
  const images = Array.isArray(product.images) ? product.images : [];
  const firstImage = typeof images[0] === "object" && images[0] !== null ? images[0] as Record<string, unknown> : {};
  return {
    id: product.id,
    title: product.title ?? product.name,
    vendor: product.vendor ?? "",
    product_type: product.product_type ?? product.category ?? "Uncategorized",
    sku: firstVariant.sku ?? product.sku ?? "",
    price: firstVariant.price ?? product.price ?? "0.00",
    inventory: firstVariant.inventory_quantity ?? firstVariant.inventory ?? product.inventory_quantity ?? 0,
    image: firstImage.src ?? firstImage.url ?? product.image ?? null,
    created_at: product.created_at ?? product.createdAt,
  };
}

function productPreviewsFromOrders(orders: unknown[]): Array<Record<string, unknown>> {
  const previews: Array<Record<string, unknown>> = [];
  const seenProductIds = new Set<string>();
  for (const rawOrder of orders) {
    if (typeof rawOrder !== "object" || rawOrder === null) continue;
    const order = rawOrder as Record<string, unknown>;
    const items = Array.isArray(order.line_items) ? order.line_items : Array.isArray(order.items) ? order.items : [];
    for (const rawItem of items) {
      if (typeof rawItem !== "object" || rawItem === null) continue;
      const item = rawItem as Record<string, unknown>;
      const productId = item.product_id ?? item.productId ?? item.id;
      if (!productId) continue;
      const id = String(productId);
      if (seenProductIds.has(id)) continue;
      seenProductIds.add(id);
      previews.push({
        id,
        title: item.title ?? item.name ?? item.product_name ?? "Unknown Product",
        vendor: "",
        product_type: "订单销售商品",
        sku: item.sku ?? "",
        price: item.price ?? "0.00",
        inventory: item.quantity ?? 1,
        image: null,
        created_at: order.created_at ?? order.createdAt,
      });
    }
  }
  return previews;
}

export function orderQueryForPlatform(
  platform: StorePlatform,
  input: SyncStoreOrdersInput,
): Record<string, string | number | undefined> {
  const range = resolveOrderRange(input);
  if (platform === "shoplazza") {
    return {
      updated_at_min: dayjs.tz(`${range.startDate}T00:00:00`, "America/Los_Angeles").format(),
      updated_at_max: dayjs.tz(`${range.endDate}T23:59:59`, "America/Los_Angeles").format(),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 50),
      page: 1,
    };
  }
  const limit = platform === "shopline"
    ? Math.min(Math.max(input.limit ?? 100, 1), 100)
    : Math.min(Math.max(input.limit ?? 250, 1), 250);
  return {
    status: "any",
    created_at_min: `${range.startDate}T00:00:00${input.shoplineTimeOffset || DEFAULT_TIME_OFFSET}`,
    created_at_max: `${range.endDate}T23:59:59${input.shoplineTimeOffset || DEFAULT_TIME_OFFSET}`,
    limit,
  };
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return `${path}?${query.toString()}`;
}

export function nextOrderPageLink(headers: Headers | Record<string, unknown>): string | undefined {
  const raw = headers instanceof Headers ? headers.get("link") : headers.link;
  const link = Array.isArray(raw) ? raw.join(",") : typeof raw === "string" ? raw : undefined;
  if (!link) return undefined;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1];
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
}

function shouldSyncReferenceOrder(rawOrder: unknown): boolean {
  if (typeof rawOrder !== "object" || rawOrder === null) return true;
  const order = rawOrder as Record<string, unknown>;
  const rawStatus = order.financial_status ?? order.payment_status ?? order.paymentStatus ?? order.payment_status_name;
  if (typeof rawStatus !== "string" || !rawStatus.trim()) return true;
  const status = rawStatus.trim().toLowerCase();
  return ["paid", "pending", "authorized", "partially_paid", "partially_refunded", "refunded"].includes(status);
}

export function nextOrderCursor(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.next_cursor,
    record.nextCursor,
    record.cursor,
    nestedRecord(record, "pagination")?.next_cursor,
    nestedRecord(record, "pagination")?.nextCursor,
    nestedRecord(record, "data")?.next_cursor,
    nestedRecord(record, "data")?.nextCursor,
    nestedRecord(nestedRecord(record, "data"), "pagination")?.next_cursor,
    nestedRecord(nestedRecord(record, "data"), "pagination")?.nextCursor,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

async function firstSuccessfulGet(
  store: StoreConnection,
  token: string,
  paths: string[],
): Promise<{ response: AxiosResponse<unknown>; endpoint: string; attemptedPaths: string[] }> {
  const attemptedPaths: string[] = [];
  let lastError: unknown;
  for (const path of paths) {
    attemptedPaths.push(path);
    try {
      return { response: await axiosGet(store, token, path, 8_000), endpoint: path, attemptedPaths };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`全部接口探测失败。已尝试：${attemptedPaths.join(", ")}。最后错误：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function detectShoplazzaFormat(store: StoreConnection, token: string, stage: "products" | "orders" = "products") {
  let lastError: unknown;
  const attemptedPaths: string[] = [];
  const candidates = stage === "orders" ? SHOPLAZZA_ORDER_CANDIDATES : SHOPLAZZA_PRODUCT_CANDIDATES;
  for (const candidate of candidates) {
    const path = `${candidate.path}?limit=1`;
    attemptedPaths.push(path);
    try {
      const response = await axiosGet(store, token, path, 8_000);
      if (response.status === 200) {
        return {
          version: candidate.version,
          suffix: candidate.json ? ".json" : "",
          endpoint: path,
          attemptedPaths,
          response,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Shoplazza 产品接口探测失败。已尝试：${attemptedPaths.join(", ")}。最后错误：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function probeStoreConnection(store: StoreConnection, token: string): Promise<ProbeResult> {
  if (store.platform === "shoplazza") {
    try {
      const detected = await detectShoplazzaFormat(store, token, "products");
      const products = extractProducts(detected.response.data).map(productPreview);
      return {
        ok: true,
        stage: "products",
        message: `Shoplazza OpenAPI 已联通，使用 ${detected.endpoint}`,
        endpoint: detected.endpoint,
        attemptedPaths: detected.attemptedPaths,
        sampleProducts: products.length,
        sampleOrders: 0,
        products,
      };
    } catch (productError) {
      const detected = await detectShoplazzaFormat(store, token, "orders");
      const orders = extractOrders(detected.response.data);
      return {
        ok: true,
        stage: "orders",
        message: `Shoplazza 商品接口不可用，已通过订单接口 ${detected.endpoint} 验证连接。`,
        endpoint: detected.endpoint,
        attemptedPaths: detected.attemptedPaths,
        sampleProducts: 0,
        sampleOrders: orders.length,
        products: productPreviewsFromOrders(orders),
        productProbeError: productError instanceof Error ? productError.message : String(productError),
      };
    }
  }

  if (store.platform === "shopify") {
    const endpoint = `/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=10`;
    const response = await axiosGet(store, token, endpoint, 8_000);
    const products = extractProducts(response.data).map(productPreview);
    return {
      ok: true,
      stage: "products",
      message: `Shopify Admin API 已联通，使用 ${endpoint}`,
      endpoint,
      attemptedPaths: [endpoint],
      sampleProducts: products.length,
      sampleOrders: 0,
      products,
    };
  }

  try {
    const productProbe = await firstSuccessfulGet(
      store,
      token,
      SHOPLINE_PRODUCT_CANDIDATES.map((path) => `${path}?limit=10`),
    );
    const products = extractProducts(productProbe.response.data).map(productPreview);
    return {
      ok: true,
      stage: "products",
      message: `SHOPLINE 商品接口已联通，使用 ${productProbe.endpoint}`,
      endpoint: productProbe.endpoint,
      attemptedPaths: productProbe.attemptedPaths,
      requestId: productProbe.response.headers["x-shopline-request-id"] as string | undefined,
      sampleProducts: products.length,
      sampleOrders: 0,
      products,
    };
  } catch (productError) {
    const orderProbe = await firstSuccessfulGet(
      store,
      token,
      SHOPLINE_ORDER_CANDIDATES.map((path) => `${path}?limit=10`),
    );
    const orders = extractOrders(orderProbe.response.data);
    return {
      ok: true,
      stage: "orders",
      message: `SHOPLINE 商品接口不可用，已通过订单接口 ${orderProbe.endpoint} 验证连接。`,
      endpoint: orderProbe.endpoint,
      attemptedPaths: [...SHOPLINE_PRODUCT_CANDIDATES, ...orderProbe.attemptedPaths],
      requestId: orderProbe.response.headers["x-shopline-request-id"] as string | undefined,
      sampleProducts: 0,
      sampleOrders: orders.length,
      products: productPreviewsFromOrders(orders),
      productProbeError: productError instanceof Error ? productError.message : String(productError),
    };
  }
}

async function fetchDirectOrders(
  store: StoreConnection,
  token: string,
  firstUrl: string,
  maxPages: number,
): Promise<{ orders: unknown[]; pages: number; requestId?: string }> {
  let url = firstUrl;
  let pages = 0;
  const orders: unknown[] = [];
  const seen = new Set<string>();
  let requestId: string | undefined;

  while (url && pages < maxPages && !seen.has(url)) {
    seen.add(url);
    const response = await axiosGet(store, token, url);
    requestId ||= response.headers["x-shopline-request-id"] as string | undefined;
    orders.push(...extractOrders(response.data));
    pages++;
    const nextUrl = nextOrderPageLink(response.headers as Record<string, unknown>);
    const cursor = nextOrderCursor(response.data);
    if (nextUrl) {
      url = nextUrl;
    } else if (cursor) {
      const parsed = new URL(url);
      parsed.searchParams.set("page_info", cursor);
      parsed.searchParams.set("cursor", cursor);
      url = parsed.toString();
    } else {
      url = "";
    }
    if (url) await delay(500);
  }

  return { orders, pages, requestId };
}

async function fetchShoplineOrders(store: StoreConnection, token: string, input: SyncStoreOrdersInput): Promise<FetchResult> {
  const range = localDateRange(input);
  const startAt = input.shoplineTimeOffset ? `${range.startDate}T00:00:00${input.shoplineTimeOffset}` : formatStoreLocalBoundary(range.startDate, false, store.timezone);
  const endAt = input.shoplineTimeOffset ? `${range.endDate}T23:59:59${input.shoplineTimeOffset}` : formatStoreLocalBoundary(range.endDate, true, store.timezone);
  const endpoint = `/admin/openapi/${SHOPLINE_API_VERSION}/orders.json`;
  const firstUrl = buildUrl(store, withQuery(endpoint, {
    status: "any",
    created_at_min: startAt,
    created_at_max: endAt,
    limit: Math.min(Math.max(input.limit ?? 100, 1), 100),
  }));
  const result = await fetchDirectOrders(store, token, firstUrl, Math.min(Math.max(input.maxPages ?? 100, 1), 100));
  return { ...result, endpoint, attemptedPaths: [endpoint] };
}

async function fetchShopifyOrders(store: StoreConnection, token: string, input: SyncStoreOrdersInput): Promise<FetchResult> {
  const range = localDateRange(input);
  const startAt = input.shoplineTimeOffset ? `${range.startDate}T00:00:00${input.shoplineTimeOffset}` : formatStoreLocalBoundary(range.startDate, false, store.timezone);
  const endAt = input.shoplineTimeOffset ? `${range.endDate}T23:59:59${input.shoplineTimeOffset}` : formatStoreLocalBoundary(range.endDate, true, store.timezone);
  const endpoint = `/admin/api/${SHOPIFY_API_VERSION}/orders.json`;
  const firstUrl = buildUrl(store, withQuery(endpoint, {
    status: "any",
    created_at_min: startAt,
    created_at_max: endAt,
    limit: Math.min(Math.max(input.limit ?? 250, 1), 250),
  }));
  const result = await fetchDirectOrders(store, token, firstUrl, Math.min(Math.max(input.maxPages ?? 100, 1), 100));
  return { ...result, endpoint, attemptedPaths: [endpoint] };
}

async function fetchShoplazzaOrders(store: StoreConnection, token: string, input: SyncStoreOrdersInput): Promise<FetchResult> {
  const detected = await detectShoplazzaFormat(store, token, "orders");
  const range = localDateRange(input);
  const endpoint = `/openapi/${detected.version}/orders${detected.suffix}`;

  // Keep this aligned with the verified reference project:
  // Shoplazza order sync uses updated_at_min/updated_at_max, LA timezone formatting,
  // limit=50, and page-based pagination.
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
  const maxPages = Math.min(Math.max(input.maxPages ?? 100, 1), 100);
  const formattedMin = formatStoreLocalBoundary(range.startDate, false, store.timezone);
  const formattedMax = formatStoreLocalBoundary(range.endDate, true, store.timezone);
  const orders: unknown[] = [];
  const attemptedPaths = [...detected.attemptedPaths];
  let requestId: string | undefined;
  let pages = 0;

  for (let page = 1; page <= maxPages; page++) {
    const path = withQuery(endpoint, {
      updated_at_min: formattedMin,
      updated_at_max: formattedMax,
      limit,
      page,
    });
    attemptedPaths.push(path);
    const response = await axiosGet(store, token, path);
    requestId ||= response.headers["x-request-id"] as string | undefined;
    const pageOrders = extractOrders(response.data);
    orders.push(...pageOrders);
    pages = page;
    if (pageOrders.length < limit) break;
    await delay(500);
  }

  return {
    orders,
    pages,
    endpoint,
    attemptedPaths,
    requestId,
  };
}

async function fetchOrdersWithReferenceFlow(store: StoreConnection, token: string, input: SyncStoreOrdersInput): Promise<FetchResult> {
  if (store.platform === "shoplazza") return fetchShoplazzaOrders(store, token, input);
  if (store.platform === "shopify") return fetchShopifyOrders(store, token, input);
  return fetchShoplineOrders(store, token, input);
}

export async function testStoreOrderAccess(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const token = decryptStoreToken(store);
  return probeStoreConnection(store as StoreConnection, token);
}

export async function testStoreConnectionByCredentials(input: StoreConnectionTestInput) {
  const store: StoreConnection = {
    id: "connection-test",
    platform: input.platform,
    domain: cleanDomain(input.domain),
    apiBaseUrl: cleanDomain(input.domain),
  };
  return probeStoreConnection(store, input.token);
}

export async function syncStoreOrders(input: SyncStoreOrdersInput) {
  let store = await prisma.store.findUniqueOrThrow({ where: { id: input.storeId } });
  let timezoneWarning: string | undefined;
  if (!store.timezone) {
    try {
      const profile = await syncStoreProfile(store.id);
      store = profile.store;
    } catch (error) {
      timezoneWarning = error instanceof Error ? error.message : String(error);
      store = await prisma.store.update({
        where: { id: store.id },
        data: {
          timezone: SYSTEM_DEFAULT_TIMEZONE,
          timezoneSource: "default",
          timezoneVerifiedAt: new Date(),
        },
      });
    }
  }
  const storeTimezone = normalizeTimezone(store.timezone);
  const range = localDateRange(input);
  const utcRange = getUtcRangeForStoreLocalDateRange(range.startDate, range.endDate, storeTimezone);
  const log = await prisma.syncLog.create({
    data: {
      type: "orders",
      status: "running",
      storeId: store.id,
      rangeStart: localDateStringToUtcDate(range.startDate),
      rangeEnd: localDateStringToUtcDate(range.endDate),
      metadata: {
        storeTimezone,
        timezoneSource: store.timezoneSource || "default",
        localDateRange: { startDate: range.startDate, endDate: range.endDate },
        utcQueryRange: { startUtc: utcRange.startUtcIso, endUtc: utcRange.endUtcIso },
        ...(timezoneWarning ? { warning: timezoneWarning } : {}),
      },
    },
  });

  try {
    const token = decryptStoreToken(store);
    const fetched = await fetchOrdersWithReferenceFlow(store as StoreConnection, token, {
      ...input,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
    });
    const rawOrders = fetched.orders.filter(shouldSyncReferenceOrder);
    const sanitizedOrders = rawOrders.map((order) => sanitizeShopOrderPayload(order, store.platform));
    for (const order of sanitizedOrders) assertNoCustomerPrivateFields(order);
    const normalizedOrders = sanitizedOrders.map(normalizeShopOrder);
    let saved = 0;

    for (const order of normalizedOrders) {
      const storeLocalDate = getStoreLocalDate(order.createdAt, storeTimezone);
      const orderTimeFields = {
        createdAtUtc: order.createdAt,
        storeTimezone,
        storeLocalDatetime: convertToStoreLocalTime(order.createdAt, storeTimezone),
        storeLocalDate: localDateStringToUtcDate(storeLocalDate),
      };
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const savedOrder = await tx.order.upsert({
          where: {
            storeId_platformOrderId: {
              storeId: store.id,
              platformOrderId: order.platformOrderId,
            },
          },
          update: {
            orderNumber: order.orderNumber,
            createdAt: order.createdAt,
            ...orderTimeFields,
            country: order.country,
            province: order.province,
            city: order.city,
            currency: order.currency,
            totalAmount: order.totalAmount,
            subtotalAmount: order.subtotalAmount,
            discountAmount: order.discountAmount,
            shippingAmount: order.shippingAmount,
            paymentStatus: order.paymentStatus,
            fulfillmentStatus: order.fulfillmentStatus,
            sourceName: order.sourceName,
            landingPage: order.landingPage,
            utmSource: order.utmSource,
            utmMedium: order.utmMedium,
            utmCampaign: order.utmCampaign,
            utmContent: order.utmContent,
          },
          create: {
            platformOrderId: order.platformOrderId,
            storeId: store.id,
            orderNumber: order.orderNumber,
            createdAt: order.createdAt,
            ...orderTimeFields,
            country: order.country,
            province: order.province,
            city: order.city,
            currency: order.currency,
            totalAmount: order.totalAmount,
            subtotalAmount: order.subtotalAmount,
            discountAmount: order.discountAmount,
            shippingAmount: order.shippingAmount,
            paymentStatus: order.paymentStatus,
            fulfillmentStatus: order.fulfillmentStatus,
            sourceName: order.sourceName,
            landingPage: order.landingPage,
            utmSource: order.utmSource,
            utmMedium: order.utmMedium,
            utmCampaign: order.utmCampaign,
            utmContent: order.utmContent,
          },
        });

        await tx.orderItem.deleteMany({ where: { orderId: savedOrder.id } });
        if (order.items.length > 0) {
          await tx.orderItem.createMany({
            data: order.items.map((item) => ({
              orderId: savedOrder.id,
              productId: item.productId,
              productName: item.productName,
              variantId: item.variantId,
              sku: item.sku,
              quantity: item.quantity,
              price: item.price,
              totalPrice: item.totalPrice,
            })),
          });
        }
      });
      saved++;
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFetched: rawOrders.length,
        recordsSaved: saved,
        metadata: {
          pages: fetched.pages,
          endpoint: fetched.endpoint,
          attemptedPaths: fetched.attemptedPaths,
          storeTimezone,
          timezoneSource: store.timezoneSource || "default",
          localDateRange: { startDate: range.startDate, endDate: range.endDate },
          utcQueryRange: { startUtc: utcRange.startUtcIso, endUtc: utcRange.endUtcIso },
          ...(timezoneWarning ? { warning: timezoneWarning } : {}),
          ...(fetched.requestId ? { requestId: fetched.requestId } : {}),
        },
      },
    });

    await invalidateStoreAnalysisCaches({ storeId: store.id, since: range.rangeStart, until: range.rangeEnd });

    return {
      fetched: rawOrders.length,
      saved,
      pages: fetched.pages,
      endpoint: fetched.endpoint,
      attemptedPaths: fetched.attemptedPaths,
      requestId: fetched.requestId,
      message: rawOrders.length === 0
        ? "订单接口连接成功，但当前同步范围没有返回订单。"
        : "订单接口连接成功，并已完成分页同步。",
    };
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function syncAllStoreOrders(input: Omit<SyncStoreOrdersInput, "storeId"> & { storeId?: string } = {}) {
  const stores = await prisma.store.findMany({
    where: {
      ...(input.storeId ? { id: input.storeId } : {}),
      status: "active",
    },
    orderBy: { createdAt: "asc" },
  });
  const results = [];
  for (const store of stores) {
    try {
      results.push({
        storeId: store.id,
        storeName: store.name,
        success: true,
        result: await syncStoreOrders({
          storeId: store.id,
          rangeStart: input.rangeStart,
          rangeEnd: input.rangeEnd,
          limit: input.limit,
          maxPages: input.maxPages,
          shoplineTimeOffset: input.shoplineTimeOffset,
        }),
      });
      await delay(1000);
    } catch (error) {
      results.push({
        storeId: store.id,
        storeName: store.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    success: results.every((item) => item.success),
    stores: results.length,
    fetched: results.reduce((sum, item) => sum + (item.result?.fetched ?? 0), 0),
    saved: results.reduce((sum, item) => sum + (item.result?.saved ?? 0), 0),
    results,
  };
}
