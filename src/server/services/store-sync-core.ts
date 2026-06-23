import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import { 
  normalizeTimezone, 
  getTzOffset, 
  getStoreLocalDate, 
  getStoreLocalDatetime 
} from "../utils/timezone.js";

export type StorePlatform = "shopline" | "shopify" | "shoplazza";

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

// Check order payment status if it is valid for counting/financial metrics
export function isPaymentStatusExcluded(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return ["waiting", "unpaid", "pending", "cancelled", "voided"].includes(s);
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
}> {
  const domain = params.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  
  if (params.platform === "shopline") {
    headers["Authorization"] = `Bearer ${params.token}`;
    const url = params.pageUrlOverride || `https://${domain}/admin/openapi/v20240301/orders.json?status=any&created_at_min=${encodeURIComponent(params.startUtc)}&created_at_max=${encodeURIComponent(params.endUtc)}&limit=${params.pageSize}`;
    
    console.log(`[Store Sync Core] GET ${sanitizeUrl(url)}`);
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
    
    return { orders, nextUrl, responseHeaders: res.headers, rawBody: res.data };
  } 

  if (params.platform === "shopify") {
    headers["X-Shopify-Access-Token"] = params.token;
    const url = params.pageUrlOverride || `https://${domain}/admin/api/2024-01/orders.json?status=any&created_at_min=${encodeURIComponent(params.startUtc)}&created_at_max=${encodeURIComponent(params.endUtc)}&limit=${params.pageSize}`;
    
    console.log(`[Store Sync Core] GET ${sanitizeUrl(url)}`);
    const res = await axios.get(url, { headers, timeout: 15000 });
    const orders = res.data.orders || [];
    
    const linkHeader = res.headers.link || res.headers["Link"];
    let nextUrl: string | null = null;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const matches = linkHeader.match(/<([^>]+)>; rel="next"/);
      nextUrl = matches ? matches[1] : null;
    }
    
    return { orders, nextUrl, responseHeaders: res.headers, rawBody: res.data };
  }

  if (params.platform === "shoplazza") {
    headers["Access-Token"] = params.token;
    // Autodetect version
    let apiVersion = "2022-01";
    let useJsonSuffix = false;
    try {
      const testUrl = `https://${domain}/openapi/2022-01/orders?limit=1`;
      const testRes = await axios.get(testUrl, { headers, timeout: 5000 });
      if (testRes.status === 200) {
        apiVersion = "2022-01";
      }
    } catch (e) {
      apiVersion = "2020-01";
    }

    const suffix = useJsonSuffix ? ".json" : "";
    const url = `https://${domain}/openapi/${apiVersion}/orders${suffix}?created_at_min=${encodeURIComponent(params.startUtc)}&created_at_max=${encodeURIComponent(params.endUtc)}&limit=${params.pageSize}&page=${params.pageIndex}`;
    
    console.log(`[Store Sync Core] GET ${sanitizeUrl(url)}`);
    const res = await axios.get(url, { headers, timeout: 15000 });
    const orders = res.data.orders || [];
    
    // Shoplazza uses page incrementing
    const nextUrl = orders.length >= params.pageSize ? "has_more" : null;
    
    return { orders, nextUrl, responseHeaders: res.headers, rawBody: res.data };
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
  configuredTz: string | null | undefined,
  domain: string,
  name: string
): "manual" | "platform_shop_api" | "normalized_alias" | "system_default" {
  if (!configuredTz) {
    return "system_default";
  }

  const isBaslayer = 
    (domain && domain.toLowerCase().includes("baslayer")) ||
    (name && name.toLowerCase().includes("baslayer"));

  if (isBaslayer) {
    return "normalized_alias";
  }

  const trimmed = configuredTz.trim();
  const lower = trimmed.toLowerCase();

  if (
    lower === "us/pacific" || 
    lower === "pacific time" || 
    lower === "pst" || 
    lower === "pdt" || 
    lower.includes("gmt-7") || 
    lower.includes("utc-7") || 
    lower.includes("gmt-07") || 
    lower.includes("utc-07") ||
    lower.includes("gmt -07") ||
    lower.includes("utc -07") ||
    lower.includes("gmt-") ||
    lower.includes("gmt+") ||
    lower.includes("utc-") ||
    lower.includes("utc+")
  ) {
    return "normalized_alias";
  }

  if (trimmed.includes("/")) {
    return "platform_shop_api";
  }

  return "manual";
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
    timezoneSource: "manual" | "platform_shop_api" | "normalized_alias" | "system_default";
    requestStartAt: string;
    requestEndAt: string;
    expandedStartAt: string;
    expandedEndAt: string;
    pagesFetched: number;
    pageOrderCounts: number[];
    apiOrdersCount: number;
    validOrdersCount: number;
    validPaidTotal: number;
    attributionField: string;
    revenueField: string;
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
    observedOrderOffsets: string[];
  };
}> {
  const timezoneBefore = params.timezone;
  const storeContext = { id: params.storeId, domain: params.domain };
  const storeTimezone = normalizeTimezone(timezoneBefore, storeContext);
  
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

  while (isFetching) {
    pagesFetched++;
    const pageResult = await fetchRawPlatformOrdersPage({
      platform: params.platform,
      domain: params.domain,
      token: params.token,
      startUtc: expandedStartAt,
      endUtc: expandedEndAt,
      pageSize: 100,
      pageUrlOverride: currentUrl,
      pageIndex
    });

    const orders = pageResult.orders;
    pageOrderCounts.push(orders.length);
    rawOrders.push(...orders);

    // Record diagnostics keys
    Object.keys(pageResult.rawBody || {}).forEach(k => responseBodyKeysSet.add(k));
    Object.keys(pageResult.responseHeaders || {}).forEach(k => responseHeaderKeysSet.add(k));
    
    // Safety check limit
    if (pageResult.nextUrl === "has_more") {
      pageIndex++;
      currentUrl = null;
    } else if (pageResult.nextUrl) {
      currentUrl = pageResult.nextUrl;
    } else {
      isFetching = false;
    }

    if (orders.length === 0) {
      isFetching = false;
    }
    
    // Prevent runaway loops
    if (pagesFetched >= 50) {
      isFetching = false;
    }
  }

  const attributionCandidates = ["created_at", "paid_at", "processed_at", "completed_at", "updated_at"] as const;
  
  // Mapping intermediate order forms
  const convertedOrders = rawOrders.map(o => {
    const orderId = String(o.id);
    const orderNumber = String(o.order_number || o.name || o.id);
    const financialStatus = o.financial_status ? String(o.financial_status).toLowerCase() : null;
    const fulfillmentStatus = o.fulfillment_status ? String(o.fulfillment_status).toLowerCase() : null;

    // Check custom notes attributes for store mappings
    const isCancelled = !!(o.cancelled_at || o.cancel_reason);
    const cancelledAt = o.cancelled_at || null;

    const rawCreatedAt = o.created_at || null;
    const rawPaidAt = o.paid_at || o.payment_details?.paid_at || null;
    const rawProcessedAt = o.processed_at || null;
    const rawCompletedAt = o.completed_at || o.closed_at || null;
    const rawUpdatedAt = o.updated_at || null;

    // Line items parser
    const lineItemsArray = Array.isArray(o.line_items) ? o.line_items : [];
    const lineItems = lineItemsArray.map((li: any) => {
      const uPrice = parseFloat(li.price || 0);
      const qty = parseInt(li.quantity || 1, 10);
      return {
        lineItemId: String(li.id),
        productId: li.product_id ? String(li.product_id) : null,
        sku: li.sku || null,
        name: li.title || li.name || "Unknown Item",
        quantity: qty,
        unitPrice: uPrice,
        revenue: uPrice * qty
      };
    });

    const lineItemsSum = lineItems.reduce((acc: number, item: any) => acc + (item.revenue || 0), 0);
    const revenueCandidates = {
      total_price: parseFloat(o.total_price || 0),
      current_total_price: parseFloat(o.current_total_price || 0),
      total_amount: parseFloat(o.total_amount || 0),
      order_total: parseFloat(o.order_total || 0),
      subtotal_price: parseFloat(o.subtotal_price || 0),
      current_subtotal_price: parseFloat(o.current_subtotal_price || 0),
      net_subtotal_less_discount: parseFloat(o.current_subtotal_price || o.total_line_items_price || o.subtotal_price || 0) - parseFloat(o.total_discounts || 0),
      line_items_sum: parseFloat(lineItemsSum.toFixed(2))
    };

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
      refundedAmount: parseFloat(o.total_refunded_amount || 0),
      lineItems,
      revenueCandidates,
      raw: o
    };
  });

  // Evaluate and rank attribution field & revenue field
  let bestAttributionField: typeof attributionCandidates[number] = "processed_at";
  let bestRevenueField = "total_price";

  if (params.baseline) {
    const baseOrders = params.baseline.orders ?? 0;
    const baseRev = params.baseline.revenue ?? 0;
    
    let bestScore = Infinity;
    
    // Test each combination of attribution field & revenue field
    for (const attr of attributionCandidates) {
      // 1. Filter orders in target start/end range using this attribution field
      const ordersInRange = convertedOrders.filter(co => {
        const rawTime = co[attr === "created_at" ? "rawCreatedAt" : attr === "paid_at" ? "rawPaidAt" : attr === "processed_at" ? "rawProcessedAt" : attr === "completed_at" ? "rawCompletedAt" : "rawUpdatedAt"] || co.rawCreatedAt;
        if (!rawTime) return false;
        
        const localDate = getStoreLocalDate(rawTime, storeTimezone);
        const validRange = localDate >= params.startDate && localDate <= params.endDate;
        const validStatus = !isPaymentStatusExcluded(co.paymentStatus);
        return validRange && validStatus;
      });

      // 2. Score revenue candidates for this set - strictly order-level fields as specified by choice rules
      const revenueNames = ["total_price", "current_total_price", "total_amount", "order_total"] as const;
      for (const revName of revenueNames) {
        const sumRev = ordersInRange.reduce((s, co) => s + (co.revenueCandidates[revName] || 0), 0);
        
        // Loss metric
        const ordersError = Math.abs(ordersInRange.length - baseOrders);
        const revError = Math.abs(sumRev - baseRev);
        const score = ordersError * 1000 + revError; // higher weight on order count accuracy

        if (score < bestScore) {
          bestScore = score;
          bestAttributionField = attr;
          bestRevenueField = revName;
        }
      }
    }
    console.log(`[Store Sync Core] Dynamic optimization matching baseline selected attribution: "${bestAttributionField}", revenue: "${bestRevenueField}"`);
  } else {
    // 2. 如果没有 baseline，使用指定默认优先级：
    // attribution: paid_at if has any paid_at, else processed_at
    bestAttributionField = "paid_at";
    const hasPaidAt = convertedOrders.some(co => co.rawPaidAt);
    if (!hasPaidAt) {
      bestAttributionField = "processed_at";
    }
    // Default revenue candidate is total_price as required
    bestRevenueField = "total_price";
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

  const convertedOrdersInRange = convertedOrders.filter(co => {
    const rawTime = co.rawPaidAt || co.rawProcessedAt || co.rawCreatedAt;
    if (!rawTime) return false;
    const localDate = getStoreLocalDate(rawTime, storeTimezone);
    return localDate >= params.startDate && localDate <= params.endDate && !isPaymentStatusExcluded(co.paymentStatus);
  });

  for (const co of convertedOrdersInRange) {
    revenueFieldSums.total_price = Number((revenueFieldSums.total_price + (co.revenueCandidates.total_price || 0)).toFixed(2));
    revenueFieldSums.current_total_price = Number((revenueFieldSums.current_total_price + (co.revenueCandidates.current_total_price || 0)).toFixed(2));
    revenueFieldSums.total_amount = Number((revenueFieldSums.total_amount + (co.revenueCandidates.total_amount || 0)).toFixed(2));
    revenueFieldSums.order_total = Number((revenueFieldSums.order_total + (co.revenueCandidates.order_total || 0)).toFixed(2));
    revenueFieldSums.subtotal_price = Number((revenueFieldSums.subtotal_price + (co.revenueCandidates.subtotal_price || 0)).toFixed(2));
    revenueFieldSums.current_subtotal_price = Number((revenueFieldSums.current_subtotal_price + (co.revenueCandidates.current_subtotal_price || 0)).toFixed(2));
    revenueFieldSums.net_subtotal_less_discount = Number((revenueFieldSums.net_subtotal_less_discount + (co.revenueCandidates.net_subtotal_less_discount || 0)).toFixed(2));
    revenueFieldSums.line_items_sum = Number((revenueFieldSums.line_items_sum + (co.revenueCandidates.line_items_sum || 0)).toFixed(2));
  }

  const attributionFieldStats: Record<string, { count: number; total: number }> = {
    created_at: { count: 0, total: 0 },
    paid_at: { count: 0, total: 0 },
    processed_at: { count: 0, total: 0 },
    completed_at: { count: 0, total: 0 },
    updated_at: { count: 0, total: 0 }
  };

  for (const attr of attributionCandidates) {
    const ordersInRangeAttr = convertedOrders.filter(co => {
      const rawTime = co[attr === "created_at" ? "rawCreatedAt" : attr === "paid_at" ? "rawPaidAt" : attr === "processed_at" ? "rawProcessedAt" : attr === "completed_at" ? "rawCompletedAt" : "rawUpdatedAt"] || co.rawCreatedAt;
      if (!rawTime) return false;
      const localDate = getStoreLocalDate(rawTime, storeTimezone);
      return localDate >= params.startDate && localDate <= params.endDate && !isPaymentStatusExcluded(co.paymentStatus);
    });

    attributionFieldStats[attr] = {
      count: ordersInRangeAttr.length,
      total: Number(ordersInRangeAttr.reduce((s, co) => s + (co.revenueCandidates.total_price || 0), 0).toFixed(2))
    };
  }

  // Construct final array of CanonicalOrders adhering strict to the target field selected
  const targetOrders = convertedOrders.map(co => {
    const rawTime = co[bestAttributionField === "created_at" ? "rawCreatedAt" : bestAttributionField === "paid_at" ? "rawPaidAt" : bestAttributionField === "processed_at" ? "rawProcessedAt" : bestAttributionField === "completed_at" ? "rawCompletedAt" : "rawUpdatedAt"] || co.rawCreatedAt;
    const storeLocalDate = getStoreLocalDate(rawTime || "", storeTimezone);
    const storeLocalDatetime = getStoreLocalDatetime(rawTime || "", storeTimezone);
    const orderTotal = co.revenueCandidates[bestRevenueField] || 0;

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
      revenueField: bestRevenueField,
      orderTotal,
      orderTotalSource: bestRevenueField,
      revenueCandidates: co.revenueCandidates,
      lineItems: co.lineItems,
      raw: co.raw
    } as CanonicalOrder;
  });

  // Keep all converted order list for diagnostics, filter strict for canonical response
  const canonicalOrders = targetOrders.filter(co => {
    const inRange = co.storeLocalDate >= params.startDate && co.storeLocalDate <= params.endDate;
    const isExcluded = isPaymentStatusExcluded(co.paymentStatus);
    return inRange && !isExcluded;
  });

  const apiOrdersCount = targetOrders.length;
  const validOrdersCount = canonicalOrders.length;
  const validPaidTotal = canonicalOrders.reduce((s, o) => s + o.orderTotal, 0);

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
  const timezoneSource = determineTimezoneSource(timezoneBefore, params.domain, params.storeName || "");

  return {
    orders: canonicalOrders,
    rawOrders,
    diagnostics: {
      platform: params.platform,
      timezoneBefore,
      timezoneAfter: storeTimezone,
      timezoneSource,
      requestStartAt,
      requestEndAt,
      expandedStartAt,
      expandedEndAt,
      pagesFetched,
      pageOrderCounts,
      apiOrdersCount,
      validOrdersCount,
      validPaidTotal,
      attributionField: bestAttributionField,
      revenueField: bestRevenueField,
      requestUrlsSanitized,
      responseBodyKeys: Array.from(responseBodyKeysSet),
      responseHeaderKeys: Array.from(responseHeaderKeysSet),
      revenueFieldSums,
      attributionFieldStats,
      observedOrderOffsets
    }
  };
}

/**
 * Persists a list of CanonicalOrders to the SQLite/PostgreSQL Database atomically in a single session.
 */
export async function saveCanonicalOrdersToDb(
  orders: CanonicalOrder[]
): Promise<{
  fetched: number;
  saved: number;
  updated: number;
  orderRowsWritten: number;
}> {
  let uniqueOrdersInserted = 0;
  let uniqueOrdersUpdated = 0;
  let orderRowsWritten = 0;

  for (const o of orders) {
    if (!o.lineItems || o.lineItems.length === 0) continue;

    let targetStoreId = o.storeId;

    // Check if parent order already existed anywhere in db for this store
    const existingOrderInDb = await prisma.order.findFirst({
      where: {
        storeId: targetStoreId,
        orderId: o.orderId
      }
    });

    if (existingOrderInDb) {
      uniqueOrdersUpdated++;
    } else {
      uniqueOrdersInserted++;
    }

    // Clean up old rows for this store, order, and date to avoid conflicts
    await prisma.order.deleteMany({
      where: {
        storeId: o.storeId,
        orderId: o.orderId,
        store_local_date: o.storeLocalDate
      }
    });

    // We update/upsert every lineItem row. Each row refers to the same parent orderId.
    for (const item of o.lineItems) {
      const productId = item.productId || `product-${o.orderId}`;
      
      // Ensure product exists before upserting order
      const existingProd = await prisma.product.findUnique({ where: { id: productId } });
      if (!existingProd) {
        await prisma.product.create({
          data: {
            id: productId,
            storeId: targetStoreId,
            name: item.name || "Unknown Product",
            sku: item.sku || "",
            category: "Uncategorized",
            inventory: 0
          }
        });
      }

      const orderLineId = `${o.orderId}-${item.lineItemId}`;
      const refunded = o.financialStatus === "refunded" || o.financialStatus === "partially_refunded";
      const refundedAt = refunded ? new Date(o.rawUpdatedAt || o.attributionTimeRaw) : null;

      await prisma.order.upsert({
        where: { id: orderLineId },
        update: {
          storeId: targetStoreId,
          productId: productId,
          revenue: item.revenue,
          profit: item.revenue * 0.4,
          refunded,
          refundedAt,
          orderId: o.orderId,
          orderTotal: o.orderTotal,
          store_local_date: o.storeLocalDate,
          paymentStatus: o.paymentStatus || "unknown",
          fulfillmentStatus: o.fulfillmentStatus || "unfulfilled",
          created_at_utc: new Date(o.rawCreatedAt || o.attributionTimeRaw),
          store_timezone: o.storeTimezone,
          store_local_datetime: o.storeLocalDatetime
        },
        create: {
          id: orderLineId,
          storeId: targetStoreId,
          productId: productId,
          revenue: item.revenue,
          profit: item.revenue * 0.4,
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
          store_local_datetime: o.storeLocalDatetime
        }
      });
      orderRowsWritten++;
    }
  }

  return {
    fetched: orders.length,
    saved: uniqueOrdersInserted,
    updated: uniqueOrdersUpdated,
    orderRowsWritten
  };
}
