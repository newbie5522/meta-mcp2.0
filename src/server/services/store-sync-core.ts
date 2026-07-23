import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { 
  normalizeTimezone, 
  getTzOffset, 
  getStoreLocalDate, 
  getStoreLocalDatetime,
  requireVerifiedIanaTimezone
} from "../utils/timezone.js";
import { extractOrderLedgerAmount } from "./store-ledger.service.js";
import type { StoreTimezoneSource } from "./store-timezone.service.js";
import { fetchShoplazzaOrderSlices } from "./shoplazza-order-adapter.js";

export type StorePlatform = "shopline" | "shopify" | "shoplazza";

export type PlatformOrderValidity = {
  valid: boolean;
  reason: string | null;
};

const PLATFORM_ALLOWED_PAYMENT_STATUSES: Record<StorePlatform, ReadonlySet<string>> = {
  shopline: new Set([
    "paid",
    "pending",
    "authorized",
    "partially_paid",
    "partially_refunded",
    "refunded"
  ]),
  shopify: new Set([
    "paid",
    "authorized",
    "partially_paid",
    "partially_refunded",
    "refunded"
  ]),
  shoplazza: new Set([
    "paid",
    "authorized",
    "partially_paid",
    "partially_refunded",
    "refunded"
  ])
};

const EXCLUDED_PAYMENT_STATUSES = new Set([
  "waiting",
  "paying",
  "unpaid",
  "failed",
  "opened",
  "cancelled",
  "canceled",
  "voided"
]);

export function classifyPlatformOrderValidity(input: {
  platform: StorePlatform;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  cancelledAt?: unknown;
}): PlatformOrderValidity {
  const paymentStatus = String(input.paymentStatus || "").trim().toLowerCase();
  const fulfillmentStatus = String(input.fulfillmentStatus || "").trim().toLowerCase();
  const allowedStatuses = PLATFORM_ALLOWED_PAYMENT_STATUSES[input.platform];

  if (!allowedStatuses) {
    return { valid: false, reason: "PLATFORM_ORDER_RULE_UNAVAILABLE" };
  }
  if (!paymentStatus) {
    return { valid: false, reason: "PAYMENT_STATUS_UNAVAILABLE" };
  }
  if (
    input.cancelledAt !== null &&
    input.cancelledAt !== undefined &&
    input.cancelledAt !== ""
  ) {
    return { valid: false, reason: "ORDER_CANCELLED" };
  }
  if (fulfillmentStatus === "cancelled" || fulfillmentStatus === "canceled") {
    return { valid: false, reason: "FULFILLMENT_CANCELLED" };
  }
  if (allowedStatuses.has(paymentStatus)) {
    return { valid: true, reason: null };
  }
  if (
    EXCLUDED_PAYMENT_STATUSES.has(paymentStatus) ||
    (paymentStatus === "pending" && input.platform !== "shopline")
  ) {
    return { valid: false, reason: "PAYMENT_STATUS_EXCLUDED" };
  }
  return { valid: false, reason: "PAYMENT_STATUS_UNRECOGNIZED" };
}

export type CanonicalOrder = {
  platform: StorePlatform;
  storeId: number;
  orderId: string;
  orderNumber: string | null;
  currency: string | null;

  rawCreatedAt: string | null;
  rawPaidAt: string | null;
  rawProcessedAt: string | null;
  rawCompletedAt: string | null;
  rawUpdatedAt: string | null;

  attributionField: "created_at" | "paid_at" | "processed_at" | "completed_at" | "updated_at";
  attributionTimeRaw: string;
  storeTimezone: string;
  storeLocalDate: string;
  storeLocalDatetime: string;

  financialStatus: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  refundedAmount: number;

  revenueField: string;
  orderTotal: number;
  orderTotalSource: string;
  revenueCandidates: {
    total_price: number;
    current_total_price: number;
    total_amount: number;
    order_total: number;
    subtotal_price: number;
    current_subtotal_price: number;
    net_subtotal_less_discount: number;
    line_items_sum: number;
  };

  lineItems: Array<{
    lineItemId: string;
    productId: string | null;
    sku: string | null;
    name: string | null;
    quantity: number;
    unitPrice: number;
    revenue: number;
  }>;

  raw: any;
};

function sanitizeUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.searchParams.has("Access-Token")) {
      u.searchParams.set("Access-Token", "***MASKED***");
    }
    if (u.searchParams.has("Authorization")) {
      u.searchParams.set("Authorization", "***MASKED***");
    }
    if (u.username) u.username = "";
    if (u.password) u.password = "";
    return u.toString();
  } catch (e) {
    return url;
  }
}

function money(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function sumMoney(values: number[]): number {
  return Number(values.reduce((s, v) => s + money(v), 0).toFixed(2));
}

function extractShoplazzaLedgerAmount(raw: any) {
  const lineItems = Array.isArray(raw?.line_items) ? raw.line_items : [];
  const lineItemsSum = money(lineItems.reduce((sum: number, li: any) => {
    const qty = money(li.quantity || 1);
    const unitPrice = money(li.price ?? li.unit_price);
    const lineTotal = li.total_price !== null && li.total_price !== undefined && li.total_price !== ""
      ? money(li.total_price)
      : money(qty * unitPrice);
    return sum + lineTotal;
  }, 0));

  const revenueCandidates = {
    total_price: money(raw.total_price),
    current_total_price: money(raw.current_total_price),
    total_amount: money(raw.total_amount),
    order_total: money(raw.order_total),
    subtotal_price: money(raw.subtotal_price),
    current_subtotal_price: money(raw.current_subtotal_price),
    net_subtotal_less_discount: money(raw.net_subtotal_less_discount),
    line_items_sum: lineItemsSum
  };

  const priority = [
    { field: "total_price", value: revenueCandidates.total_price },
    { field: "current_total_price", value: revenueCandidates.current_total_price },
    { field: "total_amount", value: revenueCandidates.total_amount },
    { field: "order_total", value: revenueCandidates.order_total },
    { field: "line_items_sum", value: revenueCandidates.line_items_sum }
  ];
  const selected = priority.find(candidate => candidate.value > 0) || { field: "ZERO", value: 0 };

  return {
    orderTotal: selected.value,
    orderTotalSource: selected.field,
    revenueCandidates,
    lineItemsSum
  };
}

function getRawTimeByAttribution(co: any, attr: string): string | null {
  if (attr === "created_at") return co.rawCreatedAt || null;
  if (attr === "paid_at") return co.rawPaidAt || null;
  if (attr === "processed_at") return co.rawProcessedAt || null;
  if (attr === "completed_at") return co.rawCompletedAt || null;
  if (attr === "updated_at") return co.rawUpdatedAt || null;
  return null;
}

/**
 * Normalizes an API response to standard arrays of orders and returns next url details.
 */
async function fetchRawPlatformOrdersPage(params: {
  platform: StorePlatform;
  domain: string;
  token: string;
  startUtc: string;
  endUtc: string;
  pageSize: number;
  pageUrlOverride?: string | null;
  pageIndex: number; // for page parameters
}): Promise<{
  orders: any[];
  nextUrl: string | null;
  responseHeaders: any;
  rawBody: any;
  requestUrlSanitized: string;
}> {
  const domain = params.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  
  if (params.platform === "shopline") {
    headers["Authorization"] = `Bearer ${params.token}`;
    const url = params.pageUrlOverride || `https://${domain}/admin/openapi/v20240301/orders.json?status=any&created_at_min=${encodeURIComponent(params.startUtc)}&created_at_max=${encodeURIComponent(params.endUtc)}&limit=${params.pageSize}`;
    
    const requestUrlSanitized = sanitizeUrl(url);
    console.log(`[Store Sync Core] GET ${requestUrlSanitized}`);
    const res = await axios.get(url, { headers, timeout: 15000 });
    const orders = res.data.data || res.data.orders || [];
    
    // Parse Link Header
    const linkHeader = res.headers.link || res.headers["Link"];
    let nextUrl: string | null = null;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const matches = linkHeader.match(/<([^>]+)>; rel="next"/);
      nextUrl = matches ? matches[1] : null;
    }
    
    // Fallback body based pagination
    if (!nextUrl) {
      let pageToken: string | null = null;
      if (res.data.page_info) pageToken = res.data.page_info;
      else if (res.data.next_page_info) pageToken = res.data.next_page_info;
      else if (res.data.next) pageToken = res.data.next;
      else if (res.data.cursor) pageToken = res.data.cursor;
      else if (res.data.next_cursor) pageToken = res.data.next_cursor;
      else if (res.data.pagination?.next) pageToken = res.data.pagination.next;

      if (pageToken && typeof pageToken === "string") {
        if (pageToken.startsWith("http")) {
          nextUrl = pageToken;
        } else {
          const parsedUrl = new URL(url);
          parsedUrl.searchParams.set("page_info", pageToken);
          nextUrl = parsedUrl.toString();
        }
      }
    }
    
    return { orders, nextUrl, responseHeaders: res.headers, rawBody: res.data, requestUrlSanitized };
  } 

  if (params.platform === "shopify") {
    headers["X-Shopify-Access-Token"] = params.token;
    const url = params.pageUrlOverride || `https://${domain}/admin/api/2024-01/orders.json?status=any&created_at_min=${encodeURIComponent(params.startUtc)}&created_at_max=${encodeURIComponent(params.endUtc)}&limit=${params.pageSize}`;
    
    const requestUrlSanitized = sanitizeUrl(url);
    console.log(`[Store Sync Core] GET ${requestUrlSanitized}`);
    const res = await axios.get(url, { headers, timeout: 15000 });
    const orders = res.data.orders || [];
    
    const linkHeader = res.headers.link || res.headers["Link"];
    let nextUrl: string | null = null;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const matches = linkHeader.match(/<([^>]+)>; rel="next"/);
      nextUrl = matches ? matches[1] : null;
    }
    
    return { orders, nextUrl, responseHeaders: res.headers, rawBody: res.data, requestUrlSanitized };
  }

  if (params.platform === "shoplazza") {
    throw new Error("SHOPLAZZA_ADAPTER_REQUIRED");
  }

  throw new Error(`Unsupported platform: ${params.platform}`);
}

export function extractOffset(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/([+-]\d{2}:?\d{2}|Z)$/);
  if (match) {
    let raw = match[1];
    if (raw === "Z") return "+00:00";
    if (raw.indexOf(":") === -1) {
      return raw.substring(0, 3) + ":" + raw.substring(3);
    }
    return raw;
  }
  return null;
}

export function determineTimezoneSource(
  configuredTz: string | null | undefined
): StoreTimezoneSource {
  requireVerifiedIanaTimezone(configuredTz);
  return "persisted_verified";
}

/**
 * High quality Canonical Store synchronization Core.
 */
export async function fetchStoreOrdersCanonical(params: {
  platform: StorePlatform;
  storeId: number;
  domain: string;
  token: string;
  startDate: string;
  endDate: string;
  timezone: string;
  timezoneSource?: StoreTimezoneSource;
  timezoneVerifiedAt?: string;
  platformTimezoneRaw?: string | null;
  storeName?: string;
  baseline?: {
    orders?: number;
    revenue?: number;
  };
}): Promise<{
  orders: CanonicalOrder[];
  rawOrders: any[];
  diagnostics: {
    platform: StorePlatform;
    timezoneBefore: string;
    timezoneAfter: string;
    timezoneSource: StoreTimezoneSource;
    timezoneVerifiedAt?: string;
    platformTimezoneRaw?: string | null;
    requestStartAt: string;
    requestEndAt: string;
    expandedStartAt: string;
    expandedEndAt: string;
    pagesFetched: number;
    pageOrderCounts: number[];
    apiOrdersCount: number;
    validOrdersCount: number;
    validPaidTotal: number;
    selectedApiVersion?: string | null;
    selectedEndpointPath?: string | null;
    responseOrderPath?: string | null;
    paginationMode?: string | null;
    cursorPages?: number;
    queryDateFields?: string[];
    createdAtSlice?: any;
    placedAtSlice?: any;
    deduplicatedOrderCount?: number;
    duplicateAcrossSlicesCount?: number;
    attributionField: string;
    revenueField: string;
    orderTotalSource?: string | null;
    ledgerAmountPolicy: string;
    lineItemRevenueIsSales: boolean;
    requestUrlsSanitized: string[];
    responseBodyKeys: string[];
    responseHeaderKeys: string[];
    revenueFieldSums: {
      total_price: number;
      current_total_price: number;
      total_amount: number;
      order_total: number;
      subtotal_price: number;
      current_subtotal_price: number;
      net_subtotal_less_discount: number;
    };
    attributionFieldStats: Record<string, { count: number; total: number }>;
    paymentStatusCounts?: Record<string, number>;
    observedOrderOffsets: string[];
    coverageComplete: boolean;
    truncated: boolean;
    paginationTermination: "NATURAL_END" | "EMPTY_PAGE" | "PAGE_LIMIT" | "ERROR";
    failedSlices: any[];
    failedSlicesCount?: number;
  };
  coverageComplete: boolean;
  truncated: boolean;
  failedSlices: any[];
}> {
  const timezoneBefore = params.timezone;
  const storeTimezone = requireVerifiedIanaTimezone(timezoneBefore);
  
  const offset = getTzOffset(storeTimezone, params.startDate);
  
  // Safety margined expansion to handle timezone boundaries. We query wider in API, then filter strict in-memory.
  const queryStartLocalDate = dayjs(params.startDate).subtract(1, "day").format("YYYY-MM-DD");
  const queryEndLocalDate = dayjs(params.endDate).add(1, "day").format("YYYY-MM-DD");
  const expandedStartAt = `${queryStartLocalDate}T00:00:00${offset}`;
  const expandedEndAt = `${queryEndLocalDate}T23:59:59${offset}`;

  const requestStartAt = `${params.startDate}T00:00:00${offset}`;
  const requestEndAt = `${params.endDate}T23:59:59${offset}`;

  let pageIndex = 1;
  let currentUrl: string | null = null;
  let isFetching = true;
  
  const rawOrders: any[] = [];
  const requestUrlsSanitized: string[] = [];
  const responseBodyKeysSet = new Set<string>();
  const responseHeaderKeysSet = new Set<string>();
  const pageOrderCounts: number[] = [];
  let pagesFetched = 0;
  let truncated = false;
  let paginationTermination: "NATURAL_END" | "EMPTY_PAGE" | "PAGE_LIMIT" | "ERROR" = "NATURAL_END";
  const failedSlices: any[] = [];
  let selectedApiVersion: string | null = null;
  let selectedEndpointPath: string | null = null;
  let responseOrderPath: string | null = null;
  let paginationMode: string | null = null;
  let cursorPages = 0;
  let queryDateFields: string[] | undefined;
  let createdAtSlice: any;
  let placedAtSlice: any;
  let deduplicatedOrderCount: number | undefined;
  let duplicateAcrossSlicesCount: number | undefined;

  if (params.platform === "shoplazza") {
    const shoplazzaPages = await fetchShoplazzaOrderSlices({
      domain: params.domain,
      token: params.token,
      startUtc: expandedStartAt,
      endUtc: expandedEndAt,
      pageSize: 250,
      maxPages: 50
    });
    rawOrders.push(...shoplazzaPages.rawOrders);
    requestUrlsSanitized.push(...shoplazzaPages.requestUrlsSanitized);
    shoplazzaPages.responseBodyKeys.forEach(k => responseBodyKeysSet.add(k));
    shoplazzaPages.responseHeaderKeys.forEach(k => responseHeaderKeysSet.add(k));
    pageOrderCounts.push(...shoplazzaPages.pageOrderCounts);
    pagesFetched = shoplazzaPages.pagesFetched;
    truncated = shoplazzaPages.truncated;
    paginationTermination = shoplazzaPages.paginationTermination;
    failedSlices.push(...shoplazzaPages.failedSlices);
    selectedApiVersion = shoplazzaPages.selectedApiVersion;
    selectedEndpointPath = shoplazzaPages.selectedEndpointPath;
    responseOrderPath = shoplazzaPages.responseOrderPath;
    paginationMode = shoplazzaPages.paginationMode;
    cursorPages = shoplazzaPages.cursorPages;
    queryDateFields = shoplazzaPages.queryDateFields;
    createdAtSlice = {
      selectedApiVersion: shoplazzaPages.createdAtSlice.selectedApiVersion,
      selectedEndpointPath: shoplazzaPages.createdAtSlice.selectedEndpointPath,
      responseOrderPath: shoplazzaPages.createdAtSlice.responseOrderPath,
      paginationMode: shoplazzaPages.createdAtSlice.paginationMode,
      rawOrdersCount: shoplazzaPages.createdAtSlice.rawOrders.length,
      coverageComplete: shoplazzaPages.createdAtSlice.coverageComplete,
      truncated: shoplazzaPages.createdAtSlice.truncated,
      failedSlicesCount: shoplazzaPages.createdAtSlice.failedSlices.length
    };
    placedAtSlice = {
      selectedApiVersion: shoplazzaPages.placedAtSlice.selectedApiVersion,
      selectedEndpointPath: shoplazzaPages.placedAtSlice.selectedEndpointPath,
      responseOrderPath: shoplazzaPages.placedAtSlice.responseOrderPath,
      paginationMode: shoplazzaPages.placedAtSlice.paginationMode,
      rawOrdersCount: shoplazzaPages.placedAtSlice.rawOrders.length,
      coverageComplete: shoplazzaPages.placedAtSlice.coverageComplete,
      truncated: shoplazzaPages.placedAtSlice.truncated,
      failedSlicesCount: shoplazzaPages.placedAtSlice.failedSlices.length
    };
    deduplicatedOrderCount = shoplazzaPages.deduplicatedOrderCount;
    duplicateAcrossSlicesCount = shoplazzaPages.duplicateAcrossSlicesCount;
  } else {
  while (isFetching) {
    pagesFetched++;
    let pageResult;
    try {
      pageResult = await fetchRawPlatformOrdersPage({
        platform: params.platform,
        domain: params.domain,
        token: params.token,
        startUtc: expandedStartAt,
        endUtc: expandedEndAt,
        pageSize: 100,
        pageUrlOverride: currentUrl,
        pageIndex
      });
    } catch (error: any) {
      paginationTermination = "ERROR";
      failedSlices.push({
        storeId: params.storeId,
        platform: params.platform,
        pageIndex,
        message: error?.message || String(error)
      });
      throw error;
    }

    const orders = pageResult.orders;
    pageOrderCounts.push(orders.length);
    rawOrders.push(...orders);
    requestUrlsSanitized.push(pageResult.requestUrlSanitized);

    // Record diagnostics keys
    Object.keys(pageResult.rawBody || {}).forEach(k => responseBodyKeysSet.add(k));
    Object.keys(pageResult.responseHeaders || {}).forEach(k => responseHeaderKeysSet.add(k));
    
    // Safety check limit
    const hasNextPage = Boolean(pageResult.nextUrl);
    if (pagesFetched >= 50 && hasNextPage) {
      truncated = true;
      paginationTermination = "PAGE_LIMIT";
      failedSlices.push({
        storeId: params.storeId,
        platform: params.platform,
        pageIndex,
        truncated: true,
        reason: "PAGE_LIMIT"
      });
      isFetching = false;
    } else if (pageResult.nextUrl === "has_more") {
      pageIndex++;
      currentUrl = null;
    } else if (pageResult.nextUrl) {
      currentUrl = pageResult.nextUrl;
    } else {
      isFetching = false;
      paginationTermination = "NATURAL_END";
    }

    if (orders.length === 0) {
      isFetching = false;
      paginationTermination = "EMPTY_PAGE";
    }
  }
  }

  const attributionCandidates = ["created_at", "paid_at", "processed_at", "completed_at", "updated_at"] as const;
  
  // Mapping intermediate order forms
  const convertedOrders = rawOrders.map(o => {
    const orderId = String(o.id);
    const orderNumber = String(o.number || o.order_number || o.name || o.id);
    const financialStatus = (o.financial_status || o.payment_status) ? String(o.financial_status || o.payment_status).toLowerCase() : null;
    const fulfillmentStatus = o.fulfillment_status ? String(o.fulfillment_status).toLowerCase() : null;

    // Check custom notes attributes for store mappings
    const isCancelled = !!(o.cancelled_at || o.cancel_reason || String(o.status || "").toLowerCase() === "cancelled" || String(o.status || "").toLowerCase() === "canceled");
    const cancelledAt = o.cancelled_at || (isCancelled ? (o.updated_at || o.created_at || "STATUS_CANCELLED") : null);

    const rawCreatedAt = o.created_at || null;
    const rawPaidAt = o.placed_at || o.paid_at || o.payment_details?.paid_at || null;
    const rawProcessedAt = o.processed_at || null;
    const rawCompletedAt = o.finished_at || o.completed_at || o.closed_at || null;
    const rawUpdatedAt = o.updated_at || null;

    // Line items parser
    const lineItemsArray = Array.isArray(o.line_items) ? o.line_items : [];
    const lineItems = lineItemsArray.map((li: any) => {
      const uPrice = money(li.price ?? li.unit_price);
      const qty = parseInt(li.quantity || 1, 10);
      return {
        lineItemId: String(li.id),
        productId: li.product_id ? String(li.product_id) : null,
        sku: li.sku || null,
        name: li.product_title || li.title || li.name || "Unknown Item",
        quantity: qty,
        unitPrice: uPrice,
        revenue: li.total_price !== null && li.total_price !== undefined && li.total_price !== ""
          ? money(li.total_price)
          : money(uPrice * qty)
      };
    });

    const ledgerAmount = params.platform === "shoplazza"
      ? extractShoplazzaLedgerAmount(o)
      : extractOrderLedgerAmount(params.platform, o);
    const revenueCandidates = ledgerAmount.revenueCandidates;

    return {
      orderId,
      orderNumber,
      currency: o.currency || "USD",
      rawCreatedAt,
      rawPaidAt,
      rawProcessedAt,
      rawCompletedAt,
      rawUpdatedAt,
      financialStatus,
      paymentStatus: financialStatus,
      fulfillmentStatus,
      cancelledAt,
      refundedAmount: money(o.total_refunded_amount || 0),
      lineItems,
      revenueCandidates,
      orderTotal: ledgerAmount.orderTotal,
      orderTotalSource: ledgerAmount.orderTotalSource,
      raw: o
    };
  });

  // Evaluate and rank attribution field & revenue field
  let bestAttributionField: typeof attributionCandidates[number] = "processed_at";
  let bestRevenueField = "current_total_price";

  // Unified priority: attribution defaults to created_at/processed_at
  bestAttributionField = "created_at";
  const hasProcessedAt = convertedOrders.some(co => co.rawProcessedAt);
  if (hasProcessedAt) {
    bestAttributionField = "processed_at";
  }
  const hasPaidAt = convertedOrders.some(co => co.rawPaidAt);
  if (hasPaidAt) {
    bestAttributionField = "paid_at";
  }

  // 3.3 and 3.4 calculations for sums & stats across target range
  const revenueFieldSums = {
    total_price: 0,
    current_total_price: 0,
    total_amount: 0,
    order_total: 0,
    subtotal_price: 0,
    current_subtotal_price: 0,
    net_subtotal_less_discount: 0,
    line_items_sum: 0
  };

  const convertedOrdersInSelectedRange = convertedOrders.filter(co => {
    const rawTime = getRawTimeByAttribution(co, bestAttributionField);
    if (!rawTime) return false;
    const localDate = getStoreLocalDate(rawTime, storeTimezone);
    return localDate >= params.startDate && localDate <= params.endDate && classifyPlatformOrderValidity({
      platform: params.platform,
      paymentStatus: co.paymentStatus,
      fulfillmentStatus: co.fulfillmentStatus,
      cancelledAt: co.cancelledAt
    }).valid;
  });

  for (const co of convertedOrdersInSelectedRange) {
    revenueFieldSums.total_price = Number((revenueFieldSums.total_price + (co.revenueCandidates.total_price || 0)).toFixed(2));
    revenueFieldSums.current_total_price = Number((revenueFieldSums.current_total_price + (co.revenueCandidates.current_total_price || 0)).toFixed(2));
    revenueFieldSums.total_amount = Number((revenueFieldSums.total_amount + (co.revenueCandidates.total_amount || 0)).toFixed(2));
    revenueFieldSums.order_total = Number((revenueFieldSums.order_total + (co.revenueCandidates.order_total || 0)).toFixed(2));
    revenueFieldSums.subtotal_price = Number((revenueFieldSums.subtotal_price + (co.revenueCandidates.subtotal_price || 0)).toFixed(2));
    revenueFieldSums.current_subtotal_price = Number((revenueFieldSums.current_subtotal_price + (co.revenueCandidates.current_subtotal_price || 0)).toFixed(2));
    revenueFieldSums.net_subtotal_less_discount = Number((revenueFieldSums.net_subtotal_less_discount + (co.revenueCandidates.net_subtotal_less_discount || 0)).toFixed(2));
    revenueFieldSums.line_items_sum = Number((revenueFieldSums.line_items_sum + (co.revenueCandidates.line_items_sum || 0)).toFixed(2));
  }

  const attributionFieldStats: Record<string, any> = {
    created_at: {},
    paid_at: {},
    processed_at: {},
    completed_at: {},
    updated_at: {}
  };

  for (const attr of attributionCandidates) {
    const ordersInRangeAttr = convertedOrders.filter(co => {
      const rawTime = getRawTimeByAttribution(co, attr) || co.rawCreatedAt;
      if (!rawTime) return false;
      const localDate = getStoreLocalDate(rawTime, storeTimezone);
      return localDate >= params.startDate && localDate <= params.endDate && classifyPlatformOrderValidity({
        platform: params.platform,
        paymentStatus: co.paymentStatus,
        fulfillmentStatus: co.fulfillmentStatus,
        cancelledAt: co.cancelledAt
      }).valid;
    });

    attributionFieldStats[attr] = {
      count: ordersInRangeAttr.length,
      total_price: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.total_price)),
      current_total_price: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.current_total_price)),
      total_amount: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.total_amount)),
      order_total: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.order_total)),
      subtotal_price: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.subtotal_price)),
      current_subtotal_price: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.current_subtotal_price)),
      net_subtotal_less_discount: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.net_subtotal_less_discount)),
      line_items_sum: sumMoney(ordersInRangeAttr.map(co => co.revenueCandidates.line_items_sum))
    };
  }

  // Construct final array of CanonicalOrders adhering strict to the target field selected
  const targetOrders = convertedOrders.map(co => {
    const rawTime = co[bestAttributionField === "created_at" ? "rawCreatedAt" : bestAttributionField === "paid_at" ? "rawPaidAt" : bestAttributionField === "processed_at" ? "rawProcessedAt" : bestAttributionField === "completed_at" ? "rawCompletedAt" : "rawUpdatedAt"] || co.rawCreatedAt;
    const storeLocalDate = getStoreLocalDate(rawTime || "", storeTimezone);
    const storeLocalDatetime = getStoreLocalDatetime(rawTime || "", storeTimezone);
    const orderTotal = co.orderTotal || 0;

    return {
      platform: params.platform,
      storeId: params.storeId,
      orderId: co.orderId,
      orderNumber: co.orderNumber,
      currency: co.currency,
      rawCreatedAt: co.rawCreatedAt,
      rawPaidAt: co.rawPaidAt,
      rawProcessedAt: co.rawProcessedAt,
      rawCompletedAt: co.rawCompletedAt,
      rawUpdatedAt: co.rawUpdatedAt,
      attributionField: bestAttributionField,
      attributionTimeRaw: rawTime || "",
      storeTimezone,
      storeLocalDate,
      storeLocalDatetime,
      financialStatus: co.financialStatus,
      paymentStatus: co.paymentStatus,
      fulfillmentStatus: co.fulfillmentStatus,
      cancelledAt: co.cancelledAt,
      refundedAmount: co.refundedAmount,
      revenueField: co.orderTotalSource,
      orderTotal,
      orderTotalSource: co.orderTotalSource,
      revenueCandidates: co.revenueCandidates,
      lineItems: co.lineItems,
      raw: co.raw
    } as CanonicalOrder;
  });

  // Keep all converted order list for diagnostics, filter strict for canonical response
  const canonicalOrders = targetOrders.filter(co => {
    const inRange = co.storeLocalDate >= params.startDate && co.storeLocalDate <= params.endDate;
    const validity = classifyPlatformOrderValidity({
      platform: co.platform,
      paymentStatus: co.paymentStatus,
      fulfillmentStatus: co.fulfillmentStatus,
      cancelledAt: co.cancelledAt
    });
    return inRange && validity.valid;
  });

  const apiOrdersCount = targetOrders.length;
  const validOrdersCount = canonicalOrders.length;
  const validPaidTotal = canonicalOrders.reduce((s, o) => s + o.orderTotal, 0);
  const paymentStatusCounts = targetOrders.reduce<Record<string, number>>((acc, order) => {
    const status = String(order.paymentStatus || order.financialStatus || "unknown").toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const orderTotalSource = canonicalOrders[0]?.orderTotalSource || targetOrders[0]?.orderTotalSource || null;

  const observedOrderOffsetsSet = new Set<string>();
  for (const co of canonicalOrders) {
    const rawTimes = [co.rawCreatedAt, co.rawProcessedAt, co.rawPaidAt, co.rawCompletedAt, co.rawUpdatedAt];
    for (const rt of rawTimes) {
      const offsetStr = extractOffset(rt);
      if (offsetStr) {
        observedOrderOffsetsSet.add(offsetStr);
      }
    }
  }
  const observedOrderOffsets = Array.from(observedOrderOffsetsSet);
  const timezoneSource = params.timezoneSource || "persisted_verified";
  const coverageComplete = !truncated && failedSlices.length === 0;

  return {
    orders: canonicalOrders,
    rawOrders,
    coverageComplete,
    truncated,
    failedSlices,
    diagnostics: {
      platform: params.platform,
      timezoneBefore,
      timezoneAfter: storeTimezone,
      timezoneSource,
      timezoneVerifiedAt: params.timezoneVerifiedAt,
      platformTimezoneRaw: params.platformTimezoneRaw ?? null,
      requestStartAt,
      requestEndAt,
      expandedStartAt,
      expandedEndAt,
      pagesFetched,
      pageOrderCounts,
      apiOrdersCount,
      validOrdersCount,
      validPaidTotal,
      selectedApiVersion,
      selectedEndpointPath,
      responseOrderPath,
      paginationMode,
      cursorPages,
      queryDateFields,
      createdAtSlice,
      placedAtSlice,
      deduplicatedOrderCount,
      duplicateAcrossSlicesCount,
      attributionField: bestAttributionField,
      revenueField: "extracted_order_total",
      orderTotalSource,
      ledgerAmountPolicy: "platform_priority_order_total_not_baseline",
      lineItemRevenueIsSales: false,
      requestUrlsSanitized,
      responseBodyKeys: Array.from(responseBodyKeysSet),
      responseHeaderKeys: Array.from(responseHeaderKeysSet),
      revenueFieldSums,
      attributionFieldStats,
      paymentStatusCounts,
      observedOrderOffsets,
      coverageComplete,
      truncated,
      paginationTermination,
      failedSlices,
      failedSlicesCount: failedSlices.length
    }
  };
}

export interface CountryFields {
  shippingCountryCode: string | null;
  shippingCountryName: string | null;
  billingCountryCode: string | null;
  billingCountryName: string | null;
  countrySource: string;
}

export function parseOrderCountryFields(rawPayload: any): CountryFields {
  if (!rawPayload) {
    return {
      shippingCountryCode: null,
      shippingCountryName: null,
      billingCountryCode: null,
      billingCountryName: null,
      countrySource: "unknown"
    };
  }

  // Support typical Shopify / Shopline / Shoplazza keys (shipping_address / billing_address)
  // Check both underscored and camel case format
  const shipping = rawPayload.shipping_address || rawPayload.shippingAddress || {};
  const billing = rawPayload.billing_address || rawPayload.billingAddress || {};

  const shippingCountryCodeRaw = shipping.country_code || shipping.countryCode || null;
  const shippingCountryNameRaw = shipping.country || shipping.countryName || null;
  const billingCountryCodeRaw = billing.country_code || billing.countryCode || null;
  const billingCountryNameRaw = billing.country || billing.countryName || null;

  // Standardise country codes to uppercase 2 letters
  const shippingCountryCode = typeof shippingCountryCodeRaw === "string" ? shippingCountryCodeRaw.trim().toUpperCase() : null;
  const billingCountryCode = typeof billingCountryCodeRaw === "string" ? billingCountryCodeRaw.trim().toUpperCase() : null;

  const shippingCountryName = typeof shippingCountryNameRaw === "string" ? shippingCountryNameRaw.trim() : null;
  const billingCountryName = typeof billingCountryNameRaw === "string" ? billingCountryNameRaw.trim() : null;

  let countrySource = "unknown";
  if (shippingCountryCode || shippingCountryName) {
    countrySource = "shipping";
  } else if (billingCountryCode || billingCountryName) {
    countrySource = "billing";
  }

  return {
    shippingCountryCode,
    shippingCountryName,
    billingCountryCode,
    billingCountryName,
    countrySource
  };
}

/**
 * Persists a list of CanonicalOrders to the SQLite/PostgreSQL Database atomically in a single session.
 */
export async function saveCanonicalOrdersToDb(
  orders: CanonicalOrder[],
  options?: {
    rebuild?: boolean;
    storeId?: number;
    startDate?: string;
    endDate?: string;
  }
): Promise<{
  fetched: number;
  saved: number;
  updated: number;
  orderRowsWritten: number;
  deletedRows: number;
}> {
  let uniqueOrdersInserted = 0;
  let uniqueOrdersUpdated = 0;
  let orderRowsWritten = 0;
  let deletedRows = 0;

  for (const o of orders) {
    if (!o.lineItems || o.lineItems.length === 0) continue;

    const targetStoreId = o.storeId;

    const existingOrderInDb = await prisma.order.findFirst({
      where: {
        storeId: targetStoreId,
        orderId: o.orderId
      }
    });

    if (existingOrderInDb) uniqueOrdersUpdated++;
    else uniqueOrdersInserted++;

    const countries = parseOrderCountryFields(o.raw);
    const currentLineIds = o.lineItems.map(item => `${o.orderId}-${item.lineItemId}`);
    const transactionResult = await prisma.$transaction(async tx => {
      for (const item of o.lineItems) {
        const productId = item.productId || `product-${o.orderId}`;
        const orderLineId = `${o.orderId}-${item.lineItemId}`;
        const refunded = o.financialStatus === "refunded" || o.financialStatus === "partially_refunded";
        const refundedAt = refunded ? new Date(o.rawUpdatedAt || o.attributionTimeRaw) : null;

        await tx.product.upsert({
          where: { id: productId },
          update: {
            storeId: targetStoreId,
            name: item.name || "Unknown Product",
            sku: item.sku || "",
          },
          create: {
            id: productId,
            storeId: targetStoreId,
            name: item.name || "Unknown Product",
            sku: item.sku || "",
            category: "Uncategorized",
            inventory: 0
          }
        });

        // Storage sentinel only. Profit is unavailable until real cost provenance exists.
        // Read services must expose null + PROFIT_UNAVAILABLE.
        await tx.order.upsert({
          where: { id: orderLineId },
          update: {
            storeId: targetStoreId,
            productId,
            revenue: item.revenue,
            profit: 0,
            refunded,
            refundedAt,
            orderId: o.orderId,
            orderTotal: o.orderTotal,
            store_local_date: o.storeLocalDate,
            paymentStatus: o.paymentStatus || "unknown",
            fulfillmentStatus: o.fulfillmentStatus || "unfulfilled",
            created_at_utc: new Date(o.rawCreatedAt || o.attributionTimeRaw),
            store_timezone: o.storeTimezone,
            store_local_datetime: o.storeLocalDatetime,
            shippingCountryCode: countries.shippingCountryCode,
            shippingCountryName: countries.shippingCountryName,
            billingCountryCode: countries.billingCountryCode,
            billingCountryName: countries.billingCountryName,
            countrySource: countries.countrySource
          },
          create: {
            id: orderLineId,
            storeId: targetStoreId,
            productId,
            revenue: item.revenue,
            profit: 0,
            refunded,
            refundedAt,
            orderId: o.orderId,
            orderTotal: o.orderTotal,
            createdAt: new Date(o.rawCreatedAt || o.attributionTimeRaw),
            store_local_date: o.storeLocalDate,
            paymentStatus: o.paymentStatus || "unknown",
            fulfillmentStatus: o.fulfillmentStatus || "unfulfilled",
            created_at_utc: new Date(o.rawCreatedAt || o.attributionTimeRaw),
            store_timezone: o.storeTimezone,
            store_local_datetime: o.storeLocalDatetime,
            shippingCountryCode: countries.shippingCountryCode,
            shippingCountryName: countries.shippingCountryName,
            billingCountryCode: countries.billingCountryCode,
            billingCountryName: countries.billingCountryName,
            countrySource: countries.countrySource
          }
        });
      }

      const staleLines = await tx.order.deleteMany({
        where: {
          storeId: o.storeId,
          orderId: o.orderId,
          id: { notIn: currentLineIds }
        }
      });

      return { rowsWritten: currentLineIds.length, deletedRows: staleLines.count };
    });

    orderRowsWritten += transactionResult.rowsWritten;
    deletedRows += transactionResult.deletedRows;
  }

  return {
    fetched: orders.length,
    saved: uniqueOrdersInserted,
    updated: uniqueOrdersUpdated,
    orderRowsWritten,
    deletedRows
  };
}
