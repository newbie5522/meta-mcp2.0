import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { 
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

export type SuccessfulPaymentResolution = {
  paid: boolean;
  paidAt: string | null;
  paidAmount: number | null;
  statusSourcePath: string | null;
  timeSourcePath: string | null;
  amountSourcePath: string | null;
  reason: string | null;
};

type AttributionField =
  | "successful_payment"
  | "created_at"
  | "placed_at"
  | "paid_at"
  | "processed_at"
  | "completed_at"
  | "updated_at";

type PlatformCandidateDateFilter = "created_at" | "updated_at";

type OrderAttributionSelection =
  | {
      field: AttributionField;
      rawTime: string;
      error: null;
    }
  | {
      field: null;
      rawTime: null;
      error: "ATTRIBUTION_TIME_UNAVAILABLE";
    };

const PLATFORM_ALLOWED_PAYMENT_STATUSES: Record<StorePlatform, ReadonlySet<string>> = {
  shopline: new Set([
    "paid",
    "partially_refunded",
    "refunded"
  ]),
  shopify: new Set([
    "paid",
    "partially_refunded",
    "refunded"
  ]),
  shoplazza: new Set([
    "paid",
    "partially_refunded",
    "refunded"
  ])
};

const EXCLUDED_PAYMENT_STATUSES = new Set([
  "waiting",
  "paying",
  "pending",
  "authorized",
  "partially_paid",
  "unpaid",
  "failed",
  "opened",
  "cancelled",
  "canceled",
  "voided",
  "付款中",
  "支付中",
  "支付处理中",
  "未付款",
  "支付失败",
  "支付取消"
]);

function hasSuccessfulPaymentTime(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return !Number.isNaN(parsed.getTime());
}

export function classifyPlatformOrderValidity(input: {
  platform: StorePlatform;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  cancelledAt?: unknown;
  paidAt?: unknown;
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
    if (!hasSuccessfulPaymentTime(input.paidAt)) {
      return { valid: false, reason: "PAYMENT_SUCCESS_TIME_UNAVAILABLE" };
    }
    return { valid: true, reason: null };
  }
  if (EXCLUDED_PAYMENT_STATUSES.has(paymentStatus)) {
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
  rawPlacedAt: string | null;
  rawPaidAt: string | null;
  rawProcessedAt: string | null;
  rawCompletedAt: string | null;
  rawUpdatedAt: string | null;

  attributionField: AttributionField;
  attributionTimeRaw: string;
  storeTimezone: string;
  storeLocalDate: string;
  storeLocalDatetime: string;

  financialStatus: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  refundedAmount: number;
  successfulPayment?: SuccessfulPaymentResolution;

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
  if (attr === "successful_payment") return co.rawPaidAt || null;
  if (attr === "created_at") return co.rawCreatedAt || null;
  if (attr === "placed_at") return co.rawPlacedAt || null;
  if (attr === "paid_at") return co.rawPaidAt || null;
  if (attr === "processed_at") return co.rawProcessedAt || null;
  if (attr === "completed_at") return co.rawCompletedAt || null;
  if (attr === "updated_at") return co.rawUpdatedAt || null;
  return null;
}

function unpaidResolution(reason: string): SuccessfulPaymentResolution {
  return {
    paid: false,
    paidAt: null,
    paidAmount: null,
    statusSourcePath: null,
    timeSourcePath: null,
    amountSourcePath: null,
    reason
  };
}

function validTimeOrNull(value: unknown): string | null {
  return hasSuccessfulPaymentTime(value) ? String(value) : null;
}

function amountOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(4)) : null;
}

function resolveShoplineSuccessfulPayment(order: any): SuccessfulPaymentResolution {
  const details = Array.isArray(order?.payment_details) ? order.payment_details : [];
  if (details.length === 0) return unpaidResolution("SHOPLINE_PAYMENT_DETAILS_UNAVAILABLE");

  const successful = details
    .map((detail: any, index: number) => ({ detail, index }))
    .filter(({ detail }) => String(detail?.pay_status || "").trim().toLowerCase() === "paid");

  if (successful.length === 0) return unpaidResolution("SHOPLINE_PAYMENT_NOT_SUCCESSFUL");
  if (successful.length > 1) return unpaidResolution("SHOPLINE_MULTIPLE_SUCCESSFUL_PAYMENT_RECORDS_UNVERIFIED");

  const { detail, index } = successful[0];
  const paidAt = validTimeOrNull(detail?.processed_at);
  if (!paidAt) return unpaidResolution("SHOPLINE_PAYMENT_PROCESSED_AT_UNAVAILABLE");

  return {
    paid: true,
    paidAt,
    paidAmount: amountOrNull(detail?.pay_amount),
    statusSourcePath: `payment_details[${index}].pay_status`,
    timeSourcePath: `payment_details[${index}].processed_at`,
    amountSourcePath: `payment_details[${index}].pay_amount`,
    reason: null
  };
}

function resolveShopifySuccessfulPayment(order: any): SuccessfulPaymentResolution {
  const transactions = Array.isArray(order?.transactions) ? order.transactions : [];
  if (transactions.length === 0) return unpaidResolution("SHOPIFY_TRANSACTIONS_UNAVAILABLE");

  const successful = transactions
    .map((transaction: any, index: number) => ({ transaction, index }))
    .filter(({ transaction }) => {
      const kind = String(transaction?.kind || "").trim().toLowerCase();
      const status = String(transaction?.status || "").trim().toLowerCase();
      return (kind === "sale" || kind === "capture") && status === "success";
    });

  if (successful.length === 0) return unpaidResolution("SHOPIFY_PAYMENT_NOT_SUCCESSFUL");
  if (successful.length > 1) return unpaidResolution("SHOPIFY_MULTIPLE_SUCCESSFUL_TRANSACTIONS_UNVERIFIED");

  const { transaction, index } = successful[0];
  const paidAt = validTimeOrNull(transaction?.processedAt ?? transaction?.processed_at);
  if (!paidAt) return unpaidResolution("SHOPIFY_TRANSACTION_PROCESSED_AT_UNAVAILABLE");

  return {
    paid: true,
    paidAt,
    paidAmount: amountOrNull(transaction?.amount ?? transaction?.amountSet?.shopMoney?.amount),
    statusSourcePath: `transactions[${index}].status`,
    timeSourcePath: transaction?.processedAt !== undefined ? `transactions[${index}].processedAt` : `transactions[${index}].processed_at`,
    amountSourcePath: transaction?.amount !== undefined ? `transactions[${index}].amount` : `transactions[${index}].amountSet.shopMoney.amount`,
    reason: null
  };
}

function resolveShoplazzaSuccessfulPayment(order: any): SuccessfulPaymentResolution {
  const financialStatus = String(order?.financial_status || order?.payment_status || "").trim().toLowerCase();
  if (financialStatus !== "paid" && financialStatus !== "partially_refunded" && financialStatus !== "refunded") {
    return unpaidResolution("SHOPLAZZA_PAYMENT_NOT_SUCCESSFUL");
  }

  const directPaidAt = validTimeOrNull(order?.paid_at);
  if (directPaidAt) {
    return {
      paid: true,
      paidAt: directPaidAt,
      paidAmount: amountOrNull(order?.total_paid ?? order?.total_price),
      statusSourcePath: order?.financial_status !== undefined ? "financial_status" : "payment_status",
      timeSourcePath: "paid_at",
      amountSourcePath: order?.total_paid !== undefined ? "total_paid" : "total_price",
      reason: null
    };
  }

  const camelPaidAt = validTimeOrNull(order?.paidAt);
  if (camelPaidAt) {
    return {
      paid: true,
      paidAt: camelPaidAt,
      paidAmount: amountOrNull(order?.total_paid ?? order?.total_price),
      statusSourcePath: order?.financial_status !== undefined ? "financial_status" : "payment_status",
      timeSourcePath: "paidAt",
      amountSourcePath: order?.total_paid !== undefined ? "total_paid" : "total_price",
      reason: null
    };
  }

  const placedAt = validTimeOrNull(order?.placed_at);
  if (placedAt) {
    return {
      paid: true,
      paidAt: placedAt,
      paidAmount: amountOrNull(order?.total_paid ?? order?.total_price),
      statusSourcePath: order?.financial_status !== undefined ? "financial_status" : "payment_status",
      timeSourcePath: "placed_at",
      amountSourcePath: order?.total_paid !== undefined ? "total_paid" : "total_price",
      reason: null
    };
  }

  return unpaidResolution("SHOPLAZZA_PAYMENT_TIME_UNVERIFIED");
}

export function resolveSuccessfulPayment(order: any, platform: StorePlatform): SuccessfulPaymentResolution {
  if (platform === "shopline") return resolveShoplineSuccessfulPayment(order);
  if (platform === "shopify") return resolveShopifySuccessfulPayment(order);
  if (platform === "shoplazza") return resolveShoplazzaSuccessfulPayment(order);
  return unpaidResolution("PLATFORM_PAYMENT_RESOLVER_UNAVAILABLE");
}

function selectAttributionForOrder(co: any): OrderAttributionSelection {
  if (co.rawPaidAt) {
    return { field: "successful_payment", rawTime: co.rawPaidAt, error: null };
  }
  return { field: null, rawTime: null, error: "ATTRIBUTION_TIME_UNAVAILABLE" };
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
  dateFilter?: PlatformCandidateDateFilter;
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
  const dateFilter = params.dateFilter ?? "created_at";
  
  if (params.platform === "shopline") {
    headers["Authorization"] = `Bearer ${params.token}`;
    const url = params.pageUrlOverride || `https://${domain}/admin/openapi/v20240301/orders.json?status=any&${dateFilter}_min=${encodeURIComponent(params.startUtc)}&${dateFilter}_max=${encodeURIComponent(params.endUtc)}&limit=${params.pageSize}`;
    
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
    const url = params.pageUrlOverride || `https://${domain}/admin/api/2024-01/orders.json?status=any&${dateFilter}_min=${encodeURIComponent(params.startUtc)}&${dateFilter}_max=${encodeURIComponent(params.endUtc)}&limit=${params.pageSize}`;
    
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

async function fetchRawPlatformOrdersSlice(params: {
  platform: Exclude<StorePlatform, "shoplazza">;
  storeId: number;
  domain: string;
  token: string;
  startUtc: string;
  endUtc: string;
  pageSize: number;
  dateFilter: PlatformCandidateDateFilter;
}): Promise<{
  rawOrders: any[];
  requestUrlsSanitized: string[];
  responseBodyKeys: string[];
  responseHeaderKeys: string[];
  pageOrderCounts: number[];
  pagesFetched: number;
  truncated: boolean;
  paginationTermination: "NATURAL_END" | "EMPTY_PAGE" | "PAGE_LIMIT" | "ERROR";
  failedSlices: any[];
}> {
  let pageIndex = 1;
  let currentUrl: string | null = null;
  let isFetching = true;

  const rawOrders: any[] = [];
  const requestUrlsSanitized: string[] = [];
  const responseBodyKeysSet = new Set<string>();
  const responseHeaderKeysSet = new Set<string>();
  const pageOrderCounts: number[] = [];
  const failedSlices: any[] = [];
  let pagesFetched = 0;
  let truncated = false;
  let paginationTermination: "NATURAL_END" | "EMPTY_PAGE" | "PAGE_LIMIT" | "ERROR" = "NATURAL_END";

  while (isFetching) {
    pagesFetched++;
    let pageResult;
    try {
      pageResult = await fetchRawPlatformOrdersPage({
        platform: params.platform,
        domain: params.domain,
        token: params.token,
        startUtc: params.startUtc,
        endUtc: params.endUtc,
        pageSize: params.pageSize,
        dateFilter: params.dateFilter,
        pageUrlOverride: currentUrl,
        pageIndex
      });
    } catch (error: any) {
      paginationTermination = "ERROR";
      failedSlices.push({
        storeId: params.storeId,
        platform: params.platform,
        dateFilter: params.dateFilter,
        pageIndex,
        reason: "CANDIDATE_ORDER_SLICE_ERROR",
        message: error?.message || String(error)
      });
      throw error;
    }

    const orders = pageResult.orders;
    pageOrderCounts.push(orders.length);
    rawOrders.push(...orders);
    requestUrlsSanitized.push(pageResult.requestUrlSanitized);
    Object.keys(pageResult.rawBody || {}).forEach(k => responseBodyKeysSet.add(k));
    Object.keys(pageResult.responseHeaders || {}).forEach(k => responseHeaderKeysSet.add(k));

    const hasNextPage = Boolean(pageResult.nextUrl);
    if (pagesFetched >= 50 && hasNextPage) {
      truncated = true;
      paginationTermination = "PAGE_LIMIT";
      failedSlices.push({
        storeId: params.storeId,
        platform: params.platform,
        dateFilter: params.dateFilter,
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

  return {
    rawOrders,
    requestUrlsSanitized,
    responseBodyKeys: Array.from(responseBodyKeysSet),
    responseHeaderKeys: Array.from(responseHeaderKeysSet),
    pageOrderCounts,
    pagesFetched,
    truncated,
    paginationTermination,
    failedSlices
  };
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

function canonicalStoreTimezone(value: string | null | undefined): string {
  const normalized = requireVerifiedIanaTimezone(value);
  if (normalized === "US/Pacific") return "America/Los_Angeles";
  return normalized;
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
    updatedAtSlice?: any;
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
  const storeTimezone = canonicalStoreTimezone(timezoneBefore);
  
  // Safety margined expansion to handle timezone boundaries. We query wider in API, then filter strict in-memory.
  const queryStartLocalDate = dayjs(params.startDate).subtract(1, "day").format("YYYY-MM-DD");
  const queryEndLocalDate = dayjs(params.endDate).add(1, "day").format("YYYY-MM-DD");
  const queryStartOffset = getTzOffset(storeTimezone, queryStartLocalDate);
  const queryEndOffset = getTzOffset(storeTimezone, queryEndLocalDate);
  const requestStartOffset = getTzOffset(storeTimezone, params.startDate);
  const requestEndOffset = getTzOffset(storeTimezone, params.endDate);
  const expandedStartAt = `${queryStartLocalDate}T00:00:00${queryStartOffset}`;
  const expandedEndAt = `${queryEndLocalDate}T23:59:59${queryEndOffset}`;

  const requestStartAt = `${params.startDate}T00:00:00${requestStartOffset}`;
  const requestEndAt = `${params.endDate}T23:59:59${requestEndOffset}`;
  const nowAt = dayjs();
  const updatedCoverageEndAt = nowAt.isAfter(dayjs(expandedEndAt)) ? nowAt.toISOString() : expandedEndAt;

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
  let updatedAtSlice: any;
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
    const createdSlice = await fetchRawPlatformOrdersSlice({
      platform: params.platform,
      storeId: params.storeId,
      domain: params.domain,
      token: params.token,
      startUtc: expandedStartAt,
      endUtc: expandedEndAt,
      pageSize: 100,
      dateFilter: "created_at"
    });
    const updatedSlice = await fetchRawPlatformOrdersSlice({
      platform: params.platform,
      storeId: params.storeId,
      domain: params.domain,
      token: params.token,
      startUtc: expandedStartAt,
      endUtc: updatedCoverageEndAt,
      pageSize: 100,
      dateFilter: "updated_at"
    });

    const deduped = new Map<string, any>();
    for (const order of [...createdSlice.rawOrders, ...updatedSlice.rawOrders]) {
      const key = String(order?.id ?? order?.order_id ?? order?.name ?? JSON.stringify(order));
      if (!deduped.has(key)) deduped.set(key, order);
    }

    rawOrders.push(...deduped.values());
    requestUrlsSanitized.push(...createdSlice.requestUrlsSanitized, ...updatedSlice.requestUrlsSanitized);
    [...createdSlice.responseBodyKeys, ...updatedSlice.responseBodyKeys].forEach(k => responseBodyKeysSet.add(k));
    [...createdSlice.responseHeaderKeys, ...updatedSlice.responseHeaderKeys].forEach(k => responseHeaderKeysSet.add(k));
    pageOrderCounts.push(...createdSlice.pageOrderCounts, ...updatedSlice.pageOrderCounts);
    pagesFetched = createdSlice.pagesFetched + updatedSlice.pagesFetched;
    truncated = createdSlice.truncated || updatedSlice.truncated;
    failedSlices.push(...createdSlice.failedSlices, ...updatedSlice.failedSlices);
    paginationTermination = truncated
      ? "PAGE_LIMIT"
      : failedSlices.length > 0
        ? "ERROR"
        : "NATURAL_END";
    queryDateFields = ["created_at", "updated_at"];
    createdAtSlice = {
      dateFilter: "created_at",
      rawOrdersCount: createdSlice.rawOrders.length,
      coverageComplete: createdSlice.truncated !== true && createdSlice.failedSlices.length === 0,
      truncated: createdSlice.truncated,
      failedSlicesCount: createdSlice.failedSlices.length,
      paginationTermination: createdSlice.paginationTermination
    };
    updatedAtSlice = {
      dateFilter: "updated_at",
      rawOrdersCount: updatedSlice.rawOrders.length,
      coverageComplete: updatedSlice.truncated !== true && updatedSlice.failedSlices.length === 0,
      truncated: updatedSlice.truncated,
      failedSlicesCount: updatedSlice.failedSlices.length,
      paginationTermination: updatedSlice.paginationTermination,
      expandedEndAt: updatedCoverageEndAt
    };
    deduplicatedOrderCount = rawOrders.length;
    duplicateAcrossSlicesCount = createdSlice.rawOrders.length + updatedSlice.rawOrders.length - rawOrders.length;
  }

  const attributionCandidates = ["successful_payment", "created_at", "placed_at", "paid_at", "processed_at", "completed_at", "updated_at"] as const;
  
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
    const rawPlacedAt = o.placed_at || null;
    const successfulPayment = resolveSuccessfulPayment(o, params.platform);
    const rawPaidAt = successfulPayment.paidAt;
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
      rawPlacedAt,
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
      successfulPayment,
      raw: o
    };
  });

  // Evaluate and rank attribution field & revenue field
  let bestAttributionField: AttributionField = "successful_payment";

  // Sales facts must be attributed to the final confirmed payment timestamp.
  bestAttributionField = "successful_payment";

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
    const { rawTime } = selectAttributionForOrder(co);
    if (!rawTime) return false;
    const localDate = getStoreLocalDate(rawTime, storeTimezone);
    return localDate >= params.startDate && localDate <= params.endDate && classifyPlatformOrderValidity({
      platform: params.platform,
      paymentStatus: co.paymentStatus,
      fulfillmentStatus: co.fulfillmentStatus,
      cancelledAt: co.cancelledAt,
      paidAt: co.rawPaidAt
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
    successful_payment: {},
    created_at: {},
    placed_at: {},
    paid_at: {},
    processed_at: {},
    completed_at: {},
    updated_at: {}
  };

  for (const attr of attributionCandidates) {
    const ordersInRangeAttr = convertedOrders.filter(co => {
      const rawTime = getRawTimeByAttribution(co, attr);
      if (!rawTime) return false;
      const localDate = getStoreLocalDate(rawTime, storeTimezone);
      return localDate >= params.startDate && localDate <= params.endDate && classifyPlatformOrderValidity({
        platform: params.platform,
        paymentStatus: co.paymentStatus,
        fulfillmentStatus: co.fulfillmentStatus,
        cancelledAt: co.cancelledAt,
        paidAt: co.rawPaidAt
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

  const attributionFailures: any[] = [];
  const statusesRequiringPaymentTime = new Set(["paid", "partially_refunded", "refunded"]);

  // Construct final array of CanonicalOrders adhering strict to the target field selected
  const targetOrders = convertedOrders.flatMap(co => {
    const attribution = selectAttributionForOrder(co);
    if (attribution.error || !attribution.field || !attribution.rawTime) {
      const normalizedStatus = String(co.paymentStatus || co.financialStatus || "").trim().toLowerCase();
      if (statusesRequiringPaymentTime.has(normalizedStatus)) {
        attributionFailures.push({
          storeId: params.storeId,
          platform: params.platform,
          orderId: co.orderId,
          paymentStatus: normalizedStatus,
          reason: "ATTRIBUTION_TIME_UNAVAILABLE"
        });
      }
      return [];
    }

    const storeLocalDate = getStoreLocalDate(attribution.rawTime, storeTimezone);
    const storeLocalDatetime = getStoreLocalDatetime(attribution.rawTime, storeTimezone);
    const orderTotal = co.orderTotal || 0;

    return [{
      platform: params.platform,
      storeId: params.storeId,
      orderId: co.orderId,
      orderNumber: co.orderNumber,
      currency: co.currency,
      rawCreatedAt: co.rawCreatedAt,
      rawPlacedAt: co.rawPlacedAt,
      rawPaidAt: co.rawPaidAt,
      rawProcessedAt: co.rawProcessedAt,
      rawCompletedAt: co.rawCompletedAt,
      rawUpdatedAt: co.rawUpdatedAt,
      attributionField: attribution.field,
      attributionTimeRaw: attribution.rawTime,
      storeTimezone,
      storeLocalDate,
      storeLocalDatetime,
      financialStatus: co.financialStatus,
      paymentStatus: co.paymentStatus,
      fulfillmentStatus: co.fulfillmentStatus,
      cancelledAt: co.cancelledAt,
      refundedAmount: co.refundedAmount,
      successfulPayment: co.successfulPayment,
      revenueField: co.orderTotalSource,
      orderTotal,
      orderTotalSource: co.orderTotalSource,
      revenueCandidates: co.revenueCandidates,
      lineItems: co.lineItems,
      raw: co.raw
    } as CanonicalOrder];
  });
  failedSlices.push(...attributionFailures);

  // Keep all converted order list for diagnostics, filter strict for canonical response
  const canonicalOrders = targetOrders.filter(co => {
    const inRange = co.storeLocalDate >= params.startDate && co.storeLocalDate <= params.endDate;
    const validity = classifyPlatformOrderValidity({
      platform: co.platform,
      paymentStatus: co.paymentStatus,
      fulfillmentStatus: co.fulfillmentStatus,
      cancelledAt: co.cancelledAt,
      paidAt: co.rawPaidAt || co.attributionTimeRaw
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
    const rawTimes = [co.rawCreatedAt, co.rawPlacedAt, co.rawProcessedAt, co.rawPaidAt, co.rawCompletedAt, co.rawUpdatedAt];
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
      updatedAtSlice,
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
            created_at_utc: new Date(o.attributionTimeRaw),
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
            created_at_utc: new Date(o.attributionTimeRaw),
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
