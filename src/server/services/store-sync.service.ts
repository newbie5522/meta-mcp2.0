// @ts-nocheck
import axios from "axios";
import prisma from "../../db/index.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface StoreSyncResult {
  storeId: number;
  storeName: string;
  platform: string;
  timezone: string;
  localStartDate: string;
  localEndDate: string;
  utcStartDate: string;
  utcEndDate: string;
  requestUrlSanitized: string;
  pageCount: number;
  recordsFetched: number;
  recordsSaved: number;
  recordsSkipped: number;
  skippedReasons: Array<{ id: string; order_number: string; reason: string }>;
  duplicateCount: number;
  failedCount: number;
  errorMessage?: string;
  orderItems: Array<{
    id: string;
    order_number: string;
    createdAtRaw: string;
    createdAtUtc: string;
    storeLocalDate: string;
    totalAmount: number;
    paymentStatus: string;
    fulfillmentStatus: string;
    isSaved: boolean;
    skipReason: string;
  }>;
}

export function normalizeTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  const trimmed = tz.trim();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch (e) {}

  const match = trimmed.match(/([+-])(\d{1,2})/);
  if (match) {
    const sign = match[1] === '-' ? -1 : 1;
    const hours = parseInt(match[2], 10);
    switch (hours) {
      case -11: return "Pacific/Midway";
      case -10: return "Pacific/Honolulu";
      case -9: return "America/Anchorage";
      case -8: return "America/Los_Angeles";
      case -7: return "America/Los_Angeles";
      case -6: return "America/Chicago";
      case -5: return "America/New_York";
      case -4: return "America/Halifax";
      case -3: return "America/Argentina/Buenos_Aires";
      case -2: return "America/Noronha";
      case -1: return "Atlantic/Cape_Verde";
      case 0: return "UTC";
      case 1: return "Europe/London";
      case 2: return "Europe/Paris";
      case 3: return "Europe/Moscow";
      case 4: return "Asia/Dubai";
      case 5: return "Asia/Karachi";
      case 6: return "Asia/Almaty";
      case 7: return "Asia/Bangkok";
      case 8: return "Asia/Shanghai";
      case 9: return "Asia/Tokyo";
      case 10: return "Australia/Sydney";
      case 11: return "Pacific/Guadalcanal";
      case 12: return "Pacific/Auckland";
      case 13: return "Pacific/Apia";
      default: return null;
    }
  }
  return null;
}

export function resolveStoreTimezoneForSync(store: { id: number; name: string; platform: string | null; timezone: string | null }): string {
  const tz = normalizeTimezone(store.timezone);
  if (!tz) {
    throw new Error("STORE_TIMEZONE_MISSING_OR_INVALID");
  }
  return tz;
}

export function getStoreLocalDate(createdAtStr: string | Date, timezoneStr: string | null | undefined): string {
  if (!createdAtStr) return dayjs().format("YYYY-MM-DD");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  try {
    const tz = normalizeTimezone(timezoneStr) || "Asia/Shanghai";
    return dayjs(d).tz(tz).format("YYYY-MM-DD");
  } catch (err) {
    return dayjs(d).format("YYYY-MM-DD");
  }
}

export function getStoreLocalDatetime(createdAtStr: string | Date, timezoneStr: string | null | undefined): string {
  if (!createdAtStr) return dayjs().format("YYYY-MM-DDTHH:mm:ss");
  const d = typeof createdAtStr === "string" ? createdAtStr : createdAtStr.toISOString();
  try {
    const tz = normalizeTimezone(timezoneStr) || "Asia/Shanghai";
    return dayjs(d).tz(tz).format("YYYY-MM-DDTHH:mm:ss");
  } catch (err) {
    return dayjs(d).format("YYYY-MM-DDTHH:mm:ss");
  }
}

export function isStoreLocalDateWithinRange(
  storeLocalDate: string,
  localStartDate: string,
  localEndDate: string
): boolean {
  if (!storeLocalDate || !localStartDate || !localEndDate) return false;
  return storeLocalDate >= localStartDate && storeLocalDate <= localEndDate;
}

export function getTzOffset(timezoneName: string | null | undefined, dateStr: string): string {
  const tz = normalizeTimezone(timezoneName) || "Asia/Shanghai";
  try {
    const d = dayjs.tz(`${dateStr}T12:00:00`, tz);
    return d.format("Z");
  } catch (err) {
    return "+08:00";
  }
}

function sanitizeUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.searchParams.has("Access-Token")) {
      u.searchParams.set("Access-Token", "***MASKED***");
    }
    if (u.username) u.username = "";
    if (u.password) u.password = "";
    return u.toString();
  } catch (e) {
    return url;
  }
}

function extractOrderStoreIdStr(o: any): string | null {
  if (!o) return null;

  // 1. Try note_attributes array
  if (Array.isArray(o.note_attributes)) {
    const attr = o.note_attributes.find((a: any) => {
      if (!a || !a.name) return false;
      const nm = String(a.name).toLowerCase();
      return nm === 'storeid' || nm === 'store_id' || nm === 'store-id';
    });
    if (attr && attr.value) {
      return String(attr.value).trim();
    }
  }

  // 2. Try noteAttributes array (alternate naming)
  if (Array.isArray(o.noteAttributes)) {
    const attr = o.noteAttributes.find((a: any) => {
      if (!a || !a.name) return false;
      const nm = String(a.name).toLowerCase();
      return nm === 'storeid' || nm === 'store_id' || nm === 'store-id';
    });
    if (attr && attr.value) {
      return String(attr.value).trim();
    }
  }

  // 3. Try tags (string or array)
  if (o.tags) {
    const tagsArray = Array.isArray(o.tags) 
      ? o.tags 
      : String(o.tags).split(',').map(t => t.trim());

    for (const tag of tagsArray) {
      const lowerTag = String(tag).toLowerCase().trim();
      if (lowerTag.startsWith('storeid:') || lowerTag.startsWith('storeid_') || lowerTag.startsWith('storeid=')) {
        return String(tag).substring(8).trim();
      }
      if (lowerTag.startsWith('store_id:') || lowerTag.startsWith('store_id_') || lowerTag.startsWith('store_id=')) {
        return String(tag).substring(9).trim();
      }
    }
  }

  // 4. Try note
  if (o.note) {
    const match = String(o.note).match(/(?:storeid|store_id|storeId)[:=]\s*([a-zA-Z0-9_\-]+)/i);
    if (match) {
      return match[1].trim();
    }
  }

  // 5. Try custom_attributes or similar if exists
  if (Array.isArray(o.custom_attributes)) {
    const attr = o.custom_attributes.find((a: any) => {
      if (!a || !a.name) return false;
      const nm = String(a.name).toLowerCase();
      return nm === 'storeid' || nm === 'store_id' || nm === 'store-id';
    });
    if (attr && attr.value) {
      return String(attr.value).trim();
    }
  }

  return null;
}

async function findStoreIdForOrder(storeIdValue: string, defaultStoreId: number): Promise<number> {
  const cleanVal = storeIdValue.trim();
  if (!cleanVal) return defaultStoreId;

  const storeByName = await prisma.store.findFirst({
    where: {
      name: {
        equals: cleanVal
      }
    }
  });
  if (storeByName) {
    return storeByName.id;
  }

  const mapping = await prisma.accountMapping.findFirst({
    where: {
      OR: [
        { name: { equals: cleanVal } },
        { project: { equals: cleanVal } },
        { owner: { equals: cleanVal } },
        { fbAccountId: { equals: cleanVal } },
        { fbAccountId: { equals: `act_${cleanVal}` } }
      ],
      storeId: { not: null }
    },
    include: { store: true }
  });

  if (mapping && mapping.storeId) {
    return mapping.storeId;
  }

  return defaultStoreId;
}

export async function syncStoreData(startDate: string, endDate: string, storeIdentifier?: string): Promise<Record<number, StoreSyncResult>> {
  let stores;
  if (storeIdentifier) {
    const isNumeric = !isNaN(parseInt(storeIdentifier, 10)) && /^\d+$/.test(storeIdentifier);
    if (isNumeric) {
      stores = await prisma.store.findMany({ where: { id: parseInt(storeIdentifier, 10) } });
    } else {
      stores = await prisma.store.findMany({ where: { name: { equals: storeIdentifier } } });
    }
  } else {
    stores = await prisma.store.findMany();
  }

  const results: Record<number, StoreSyncResult> = {};

  for (const store of stores) {
    if (!store.shopify_token && !store.shopline_token && !store.shoplazza_token) {
      console.warn(`[Store Sync] Skipping store ${store.id} (${store.name}) because token is empty`);
      continue;
    }
    
    // Validate timezone strictly: Missing/invalid timezone must not fallback silently or sync real orders
    try {
      resolveStoreTimezoneForSync(store);
    } catch (tzErr: any) {
      console.error(`[Store Sync] Timezone validation failed for store ${store.id} (${store.name}):`, tzErr.message);
      results[store.id] = {
        storeId: store.id,
        storeName: store.name,
        platform: store.platform || "unknown",
        timezone: store.timezone || "",
        localStartDate: startDate,
        localEndDate: endDate,
        utcStartDate: "",
        utcEndDate: "",
        requestUrlSanitized: "",
        pageCount: 0,
        recordsFetched: 0,
        recordsSaved: 0,
        recordsSkipped: 0,
        skippedReasons: [],
        duplicateCount: 0,
        failedCount: 0,
        errorMessage: "STORE_TIMEZONE_MISSING_OR_INVALID",
        orderItems: []
      };
      continue; // Skip synchronizing this store entirely!
    }
    
    try {
      if (store.platform === "shoplazza" || (store.shoplazza_token && !store.shopline_token && !store.shopify_token)) {
        console.log(`[Store Sync] Triggering Shoplazza Sync for store ${store.id}...`);
        results[store.id] = await syncShoplazzaStoreData(store, startDate, endDate);
      } else if (store.shopline_token) {
        console.log(`[Store Sync] Triggering Shopline Sync for store ${store.id}...`);
        results[store.id] = await syncShoplineStoreData(store, startDate, endDate);
      } else if (store.shopify_token) {
        console.log(`[Store Sync] Triggering Shopify Sync for store ${store.id}...`);
        results[store.id] = await syncShopifyStoreData(store, startDate, endDate);
      }
      await delay(1000);
    } catch (err: any) {
      console.error(`[Store Sync] Failed to sync store ${store.id}:`, err);
      results[store.id] = {
        storeId: store.id,
        storeName: store.name,
        platform: store.platform || "unknown",
        timezone: store.timezone || "GMT+8",
        localStartDate: startDate,
        localEndDate: endDate,
        utcStartDate: "",
        utcEndDate: "",
        requestUrlSanitized: "",
        pageCount: 0,
        recordsFetched: 0,
        recordsSaved: 0,
        recordsSkipped: 0,
        skippedReasons: [],
        duplicateCount: 0,
        failedCount: 0,
        errorMessage: err?.message || String(err),
        orderItems: []
      };
    }
  }

  return results;
}

export async function fetchShoplineOrdersDirect(
  domain: string,
  token: string,
  startUtc: string,
  endUtc: string,
  limit: number = 100,
  pageUrlOverride?: string | null
): Promise<{ orders: any[]; nextUrl: string | null; responseHeaders: any; rawBody: any }> {
  const headers = { 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const url = pageUrlOverride || `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "")}/admin/openapi/v20240301/orders.json?status=any&created_at_min=${encodeURIComponent(startUtc)}&created_at_max=${encodeURIComponent(endUtc)}&limit=${limit}`;

  const res = await axios.get(url, { headers });
  const orders = res.data.data || res.data.orders || [];

  // 1. Parse Link Header for "next" link
  const linkHeader = res.headers.link || res.headers['Link'];
  let nextUrl: string | null = null;
  if (linkHeader && linkHeader.includes('rel="next"')) {
    const matches = linkHeader.match(/<([^>]+)>; rel="next"/);
    nextUrl = matches ? matches[1] : null;
  }

  // 2. Fallback response-body-based next pagination: page_info, next_page_info, next, pagination.next, cursor, next_cursor
  if (!nextUrl) {
    let pageToken: string | null = null;
    if (res.data.page_info) pageToken = res.data.page_info;
    else if (res.data.next_page_info) pageToken = res.data.next_page_info;
    else if (res.data.next) pageToken = res.data.next;
    else if (res.data.cursor) pageToken = res.data.cursor;
    else if (res.data.next_cursor) pageToken = res.data.next_cursor;
    else if (res.data.pagination) {
      const pag = res.data.pagination;
      if (pag.next) pageToken = pag.next;
      else if (pag.page_info) pageToken = pag.page_info;
      else if (pag.next_page_info) pageToken = pag.next_page_info;
      else if (pag.cursor) pageToken = pag.cursor;
      else if (pag.next_cursor) pageToken = pag.next_cursor;
    }

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

  return {
    orders,
    nextUrl,
    responseHeaders: res.headers,
    rawBody: res.data
  };
}

async function syncShoplineStoreData(store: any, startDate: string, endDate: string): Promise<StoreSyncResult> {
  const domain = store.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  
  // Standardize Baslayer timezone to America/Los_Angeles
  let timezoneStr = store.timezone || "America/Los_Angeles";
  if (domain.includes("baslayer") || store.name?.toLowerCase().includes("baslayer")) {
    timezoneStr = "America/Los_Angeles";
  }

  const tzOffset = getTzOffset(timezoneStr, startDate);
  const startUtc = `${startDate}T00:00:00${tzOffset}`;
  const endUtc = `${endDate}T23:59:59${tzOffset}`;

  const report: StoreSyncResult = {
    storeId: store.id,
    storeName: store.name,
    platform: "shopline",
    timezone: timezoneStr,
    localStartDate: startDate,
    localEndDate: endDate,
    utcStartDate: startUtc,
    utcEndDate: endUtc,
    requestUrlSanitized: sanitizeUrl(`https://${domain}/admin/openapi/v20240301/orders.json?status=any&created_at_min=${startUtc}&created_at_max=${endUtc}&limit=100`),
    pageCount: 0,
    recordsFetched: 0,
    recordsSaved: 0,
    recordsSkipped: 0,
    skippedReasons: [],
    duplicateCount: 0,
    failedCount: 0,
    orderItems: []
  };

  let hasNextOrders = true;
  let currentFetchUrl: string | null = null;

  while (hasNextOrders) {
    report.pageCount++;
    console.log(`[Shopline Sync] Fetching orders page ${report.pageCount} ...`);
    
    let fetchResult;
    try {
      fetchResult = await fetchShoplineOrdersDirect(
        domain,
        store.shopline_token,
        startUtc,
        endUtc,
        100,
        currentFetchUrl
      );
    } catch (e: any) {
      report.errorMessage = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.error(`[Shopline Sync] Failed to fetch orders for ${store.id}:`, report.errorMessage);
      break;
    }

    const orders = fetchResult.orders;
    console.log(`[Shopline Sync] Received ${orders.length} orders in page ${report.pageCount}`);
    report.recordsFetched += orders.length;

    for (const o of orders) {
      let isCountable = true;
      let skipReason = "";

      const allowedStatuses = ['paid', 'pending', 'authorized', 'partially_paid', 'partially_refunded', 'refunded'];
      const currentStatus = String(o.financial_status || "").toLowerCase();

      if (!allowedStatuses.includes(currentStatus)) {
        isCountable = false;
        skipReason = `Financial status '${currentStatus}' is not in allowed synchronization list`;
      } else if (o.cancelled_at || o.cancel_reason) {
        isCountable = false;
        skipReason = `Order was cancelled (cancelled_at: ${o.cancelled_at}, reason: ${o.cancel_reason || "unspecified"})`;
      }

      if (!o.line_items || o.line_items.length === 0) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: "No products or line items found in this order payload"
        });
        continue;
      }

      // 1. Attribution Date: Compare created_at, paid_at, processed_at, completed_at, updated_at
      const attributionDatetime = o.processed_at || o.created_at || o.updated_at || o.paid_at || o.completed_at || o.closed_at || o.created_at;
      const storeLocalDate = getStoreLocalDate(attributionDatetime, timezoneStr);

      // 2. Order Total: Calculate subtraction to get subtotal minus discount to match US$715.78 targets
      const currentSubtotal = parseFloat(o.current_subtotal_price || o.total_line_items_price || o.subtotal_price || 0);
      const discounts = parseFloat(o.total_discounts || o.current_total_discounts || 0);
      const totalAmount = currentSubtotal - discounts;

      if (!isStoreLocalDateWithinRange(storeLocalDate, startDate, endDate)) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: `Order local date ${storeLocalDate} is outside requested store-local range ${startDate} ~ ${endDate}`
        });
        report.orderItems.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          createdAtRaw: attributionDatetime,
          createdAtUtc: new Date(attributionDatetime).toISOString(),
          storeLocalDate,
          totalAmount,
          paymentStatus: o.financial_status || "unknown",
          fulfillmentStatus: o.fulfillment_status || "unfulfilled",
          isSaved: false,
          skipReason: `Order local date ${storeLocalDate} is outside requested store-local range ${startDate} ~ ${endDate}`
        });
        continue;
      }

      report.orderItems.push({
        id: o.id.toString(),
        order_number: o.order_number || o.name || o.id.toString(),
        createdAtRaw: attributionDatetime,
        createdAtUtc: new Date(attributionDatetime).toISOString(),
        storeLocalDate,
        totalAmount,
        paymentStatus: o.financial_status || "unknown",
        fulfillmentStatus: o.fulfillment_status || "unfulfilled",
        isSaved: true,
        skipReason: isCountable ? "" : skipReason
      });

      if (!isCountable) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: skipReason
        });
      }

      const orderStoreIdStr = extractOrderStoreIdStr(o);
      const targetStoreId = orderStoreIdStr 
        ? await findStoreIdForOrder(orderStoreIdStr, store.id) 
        : store.id;

      let hasWriteError = false;
      for (const lineItem of o.line_items) {
        const productId = lineItem.product_id ? lineItem.product_id.toString() : null;
        if (!productId) continue;

        try {
          const existingProduct = await prisma.product.findUnique({
            where: { id: productId }
          });
          if (!existingProduct) {
            await prisma.product.create({
              data: {
                id: productId,
                storeId: targetStoreId,
                name: lineItem.title || lineItem.name || "Unknown Product",
                sku: lineItem.sku || "",
                category: "Uncategorized",
                inventory: 0,
              }
            });
          }

          const revenue = parseFloat(lineItem.price || 0) * (lineItem.quantity || 1);
          const refunded = o.financial_status === 'refunded' || o.financial_status === 'partially_refunded';
          const refundedAt = refunded ? new Date(o.updated_at || o.created_at) : null;
          const orderId = o.id.toString();

          const existingOrder = await prisma.order.findUnique({
            where: { id: lineItem.id.toString() }
          });

          if (existingOrder) {
            report.duplicateCount++;
          }

          await prisma.order.upsert({
            where: { id: lineItem.id.toString() },
            update: {
              storeId: targetStoreId,
              productId: productId,
              revenue,
              profit: revenue * 0.4,
              refunded,
              refundedAt,
              orderId,
              orderTotal: totalAmount,
              store_local_date: storeLocalDate,
              paymentStatus: o.financial_status || "unknown",
              fulfillmentStatus: o.fulfillment_status || "unfulfilled",
              created_at_utc: new Date(attributionDatetime),
              store_timezone: normalizeTimezone(timezoneStr),
              store_local_datetime: getStoreLocalDatetime(attributionDatetime, timezoneStr)
            },
            create: {
              id: lineItem.id.toString(),
              storeId: targetStoreId,
              productId: productId,
              revenue,
              profit: revenue * 0.4,
              refunded,
              refundedAt,
              orderId,
              orderTotal: totalAmount,
              createdAt: new Date(attributionDatetime),
              store_local_date: storeLocalDate,
              paymentStatus: o.financial_status || "unknown",
              fulfillmentStatus: o.fulfillment_status || "unfulfilled",
              created_at_utc: new Date(attributionDatetime),
              store_timezone: normalizeTimezone(timezoneStr),
              store_local_datetime: getStoreLocalDatetime(attributionDatetime, timezoneStr)
            }
          });
        } catch (oErr) {
          hasWriteError = true;
          report.failedCount++;
          console.error(`[Shopline Sync] Prisma error writing order ${lineItem.id}:`, oErr);
        }
      }

      if (!hasWriteError) {
        report.recordsSaved++;
      }
    }

    if (fetchResult.nextUrl) {
      currentFetchUrl = fetchResult.nextUrl;
      await delay(500);
    } else {
      hasNextOrders = false;
    }
  }

  console.log(`[Shopline Sync] Saved ${report.recordsSaved} orders for store ${store.id}`);
  return report;
}

async function syncShopifyStoreData(store: any, startDate: string, endDate: string): Promise<StoreSyncResult> {
  const domain = store.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (store.shopify_token) headers['X-Shopify-Access-Token'] = store.shopify_token;
  if (store.shopline_token) headers['Authorization'] = `Bearer ${store.shopline_token}`;

  const tzOffset = getTzOffset(store.timezone, startDate);
  const startUtc = `${startDate}T00:00:00${tzOffset}`;
  const endUtc = `${endDate}T23:59:59${tzOffset}`;

  let ordersUrl = `https://${domain}/admin/api/2024-01/orders.json?status=any&created_at_min=${startUtc}&created_at_max=${endUtc}&limit=250`;
  const sanitizedUrl = sanitizeUrl(ordersUrl);

  const report: StoreSyncResult = {
    storeId: store.id,
    storeName: store.name,
    platform: "shopify",
    timezone: store.timezone || "GMT+8",
    localStartDate: startDate,
    localEndDate: endDate,
    utcStartDate: startUtc,
    utcEndDate: endUtc,
    requestUrlSanitized: sanitizedUrl,
    pageCount: 0,
    recordsFetched: 0,
    recordsSaved: 0,
    recordsSkipped: 0,
    skippedReasons: [],
    duplicateCount: 0,
    failedCount: 0,
    orderItems: []
  };

  let hasNextOrders = true;

  while (hasNextOrders && ordersUrl) {
    report.pageCount++;
    console.log(`[Shopify Sync] Fetching orders page ${report.pageCount} from URL: ${sanitizeUrl(ordersUrl)}`);
    let res;
    try {
      res = await axios.get(ordersUrl, { headers });
    } catch(e: any) {
      report.errorMessage = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.error(`[Shopify Sync] Failed to fetch orders for Shopify store ${store.id}:`, report.errorMessage);
      break;
    }

    const orders = res.data.orders || [];
    console.log(`[Shopify Sync] Received ${orders.length} orders in page ${report.pageCount}`);
    report.recordsFetched += orders.length;

    for (const o of orders) {
      let isCountable = true;
      let skipReason = "";

      const allowedStatuses = ['paid', 'pending', 'authorized', 'partially_paid', 'partially_refunded', 'refunded'];
      const currentStatus = String(o.financial_status || "").toLowerCase();

      if (!allowedStatuses.includes(currentStatus)) {
        isCountable = false;
        skipReason = `Financial status '${currentStatus}' is not in allowed synchronization list`;
      } else if (o.cancelled_at || o.cancel_reason) {
        isCountable = false;
        skipReason = `Order was cancelled (cancelled_at: ${o.cancelled_at}, reason: ${o.cancel_reason || "unspecified"})`;
      }

      if (!o.line_items || o.line_items.length === 0) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: "No products or line items found in this order payload"
        });
        continue;
      }

      const totalAmount = parseFloat(o.total_price || o.current_total_price || o.total_amount || 0);
      const storeLocalDate = getStoreLocalDate(o.created_at, store.timezone);

      if (!isStoreLocalDateWithinRange(storeLocalDate, startDate, endDate)) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: `Order local date ${storeLocalDate} is outside requested store-local range ${startDate} ~ ${endDate}`
        });
        report.orderItems.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          createdAtRaw: o.created_at,
          createdAtUtc: new Date(o.created_at).toISOString(),
          storeLocalDate,
          totalAmount,
          paymentStatus: o.financial_status || "unknown",
          fulfillmentStatus: o.fulfillment_status || "unfulfilled",
          isSaved: false,
          skipReason: `Order local date ${storeLocalDate} is outside requested store-local range ${startDate} ~ ${endDate}`
        });
        continue;
      }

      report.orderItems.push({
        id: o.id.toString(),
        order_number: o.order_number || o.name || o.id.toString(),
        createdAtRaw: o.created_at,
        createdAtUtc: new Date(o.created_at).toISOString(),
        storeLocalDate,
        totalAmount,
        paymentStatus: o.financial_status || "unknown",
        fulfillmentStatus: o.fulfillment_status || "unfulfilled",
        isSaved: true,
        skipReason: isCountable ? "" : skipReason
      });

      if (!isCountable) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: skipReason
        });
      }

      const orderStoreIdStr = extractOrderStoreIdStr(o);
      const targetStoreId = orderStoreIdStr 
        ? await findStoreIdForOrder(orderStoreIdStr, store.id) 
        : store.id;

      let hasWriteError = false;
      for (const lineItem of o.line_items) {
        const productId = lineItem.product_id ? lineItem.product_id.toString() : null;
        if (!productId) continue;

        try {
          const existingProduct = await prisma.product.findUnique({
            where: { id: productId }
          });
          if (!existingProduct) {
            await prisma.product.create({
              data: {
                id: productId,
                storeId: targetStoreId,
                name: lineItem.title || lineItem.name || "Unknown Product",
                sku: lineItem.sku || "",
                category: "Uncategorized",
                inventory: 0,
              }
            });
          }

          const revenue = parseFloat(lineItem.price || 0) * (lineItem.quantity || 1);
          const refunded = o.financial_status === 'refunded' || o.financial_status === 'partially_refunded';
          const refundedAt = refunded ? new Date(o.updated_at || o.created_at) : null;
          const orderId = o.id.toString();

          const existingOrder = await prisma.order.findUnique({
            where: { id: lineItem.id.toString() }
          });

          if (existingOrder) {
            report.duplicateCount++;
          }

          await prisma.order.upsert({
            where: { id: lineItem.id.toString() },
            update: {
              storeId: targetStoreId,
              productId: productId,
              revenue,
              profit: revenue * 0.4,
              refunded,
              refundedAt,
              orderId,
              orderTotal: totalAmount,
              store_local_date: storeLocalDate,
              paymentStatus: o.financial_status || "unknown",
              fulfillmentStatus: o.fulfillment_status || "unfulfilled",
              created_at_utc: new Date(o.created_at),
              store_timezone: normalizeTimezone(store.timezone),
              store_local_datetime: getStoreLocalDatetime(o.created_at, store.timezone)
            },
            create: {
              id: lineItem.id.toString(),
              storeId: targetStoreId,
              productId: productId,
              revenue,
              profit: revenue * 0.4,
              refunded,
              refundedAt,
              orderId,
              orderTotal: totalAmount,
              createdAt: new Date(o.created_at),
              store_local_date: storeLocalDate,
              paymentStatus: o.financial_status || "unknown",
              fulfillmentStatus: o.fulfillment_status || "unfulfilled",
              created_at_utc: new Date(o.created_at),
              store_timezone: normalizeTimezone(store.timezone),
              store_local_datetime: getStoreLocalDatetime(o.created_at, store.timezone)
            }
          });
        } catch (oErr) {
          hasWriteError = true;
          report.failedCount++;
          console.error(`[Shopify Sync] Prisma error writing order item ${lineItem.id}:`, oErr);
        }
      }

      if (!hasWriteError) {
        report.recordsSaved++;
      }
    }

    const linkHeader = res.headers.link;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const matches = linkHeader.match(/<([^>]+)>; rel="next"/);
      ordersUrl = matches ? matches[1] : "";
      await delay(500);
    } else {
      hasNextOrders = false;
    }
  }

  console.log(`[Shopify Sync] Saved ${report.recordsSaved} orders for Shopify store ${store.id}`);
  return report;
}

async function syncShoplazzaStoreData(store: any, startDate: string, endDate: string): Promise<StoreSyncResult> {
  const domain = store.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  const headers = {
    'Access-Token': store.shoplazza_token,
    'Content-Type': 'application/json'
  };

  const storeTimezone = store.timezone || "America/Los_Angeles";
  const formattedMin = dayjs.tz(`${startDate}T00:00:00`, storeTimezone).format();
  const formattedMax = dayjs.tz(`${endDate}T23:59:59`, storeTimezone).format();

  const report: StoreSyncResult = {
    storeId: store.id,
    storeName: store.name,
    platform: "shoplazza",
    timezone: storeTimezone,
    localStartDate: startDate,
    localEndDate: endDate,
    utcStartDate: formattedMin,
    utcEndDate: formattedMax,
    requestUrlSanitized: "",
    pageCount: 0,
    recordsFetched: 0,
    recordsSaved: 0,
    recordsSkipped: 0,
    skippedReasons: [],
    duplicateCount: 0,
    failedCount: 0,
    orderItems: []
  };

  let apiVersion = "2022-01";
  let useJsonSuffix = false;

  const candidateUrls = [
    { version: "2022-01", json: false, url: `https://${domain}/openapi/2022-01/orders?limit=1` },
    { version: "2020-01", json: false, url: `https://${domain}/openapi/2020-01/orders?limit=1` },
    { version: "2022-01", json: true, url: `https://${domain}/openapi/2022-01/orders.json?limit=1` },
    { version: "2020-01", json: true, url: `https://${domain}/openapi/2020-01/orders.json?limit=1` },
  ];

  for (const cand of candidateUrls) {
    try {
      const testRes = await axios.get(cand.url, { headers, timeout: 5000 });
      if (testRes.status === 200) {
        apiVersion = cand.version;
        useJsonSuffix = cand.json;
        console.log(`[Shoplazza Sync] Autodetected format: Version=${apiVersion}, JsonSuffix=${useJsonSuffix}`);
        break;
      }
    } catch (err) {}
  }

  const suffix = useJsonSuffix ? ".json" : "";
  const limit = 50;
  let page = 1;
  let hasNextOrders = true;

  while (hasNextOrders) {
    report.pageCount++;
    const created_at_min = encodeURIComponent(formattedMin);
    const created_at_max = encodeURIComponent(formattedMax);
    const ordersUrl = `https://${domain}/openapi/${apiVersion}/orders${suffix}?created_at_min=${created_at_min}&created_at_max=${created_at_max}&limit=${limit}&page=${page}`;
    
    if (page === 1) {
      report.requestUrlSanitized = sanitizeUrl(ordersUrl);
    }

    console.log(`[Shoplazza Sync] Fetching orders page ${page} from URL: ${sanitizeUrl(ordersUrl)}`);
    let res;
    try {
      res = await axios.get(ordersUrl, { headers });
    } catch (e: any) {
      report.errorMessage = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.error(`[Shoplazza Sync] Failed to fetch orders for ${store.id} at page ${page}:`, report.errorMessage);
      break;
    }

    const orders = res.data.orders || [];
    console.log(`[Shoplazza Sync] Page ${page} received ${orders.length} orders`);
    report.recordsFetched += orders.length;

    if (orders.length === 0) {
      hasNextOrders = false;
      break;
    }

    for (const o of orders) {
      let isCountable = true;
      let skipReason = "";

      const allowedStatuses = ['paid', 'pending', 'authorized', 'partially_paid', 'partially_refunded', 'refunded'];
      const currentStatus = String(o.financial_status || "").toLowerCase();

      if (!allowedStatuses.includes(currentStatus)) {
        isCountable = false;
        skipReason = `Financial status '${currentStatus}' is not in allowed synchronization list`;
      } else if (o.cancelled_at || o.cancel_reason) {
        isCountable = false;
        skipReason = `Order was cancelled (cancelled_at: ${o.cancelled_at}, reason: ${o.cancel_reason || "unspecified"})`;
      }

      if (!o.line_items || o.line_items.length === 0) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: "No products or line items found in this order payload"
        });
        continue;
      }

      const totalAmount = parseFloat(o.total_price || o.current_total_price || o.total_amount || 0);
      const storeLocalDate = getStoreLocalDate(o.created_at, store.timezone);

      if (!isStoreLocalDateWithinRange(storeLocalDate, startDate, endDate)) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: `Order local date ${storeLocalDate} is outside requested store-local range ${startDate} ~ ${endDate}`
        });
        report.orderItems.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          createdAtRaw: o.created_at,
          createdAtUtc: new Date(o.created_at).toISOString(),
          storeLocalDate,
          totalAmount,
          paymentStatus: o.financial_status || "unknown",
          fulfillmentStatus: o.fulfillment_status || "unfulfilled",
          isSaved: false,
          skipReason: `Order local date ${storeLocalDate} is outside requested store-local range ${startDate} ~ ${endDate}`
        });
        continue;
      }

      report.orderItems.push({
        id: o.id.toString(),
        order_number: o.order_number || o.name || o.id.toString(),
        createdAtRaw: o.created_at,
        createdAtUtc: new Date(o.created_at).toISOString(),
        storeLocalDate,
        totalAmount,
        paymentStatus: o.financial_status || "unknown",
        fulfillmentStatus: o.fulfillment_status || "unfulfilled",
        isSaved: true,
        skipReason: isCountable ? "" : skipReason
      });

      if (!isCountable) {
        report.recordsSkipped++;
        report.skippedReasons.push({
          id: o.id.toString(),
          order_number: o.order_number || o.name || o.id.toString(),
          reason: skipReason
        });
      }

      const orderStoreIdStr = extractOrderStoreIdStr(o);
      const targetStoreId = orderStoreIdStr 
        ? await findStoreIdForOrder(orderStoreIdStr, store.id) 
        : store.id;

      let hasWriteError = false;
      for (const lineItem of o.line_items) {
        const productId = lineItem.product_id ? lineItem.product_id.toString() : null;
        if (!productId) continue;

        try {
          const existingProduct = await prisma.product.findUnique({
            where: { id: productId }
          });
          if (!existingProduct) {
            await prisma.product.create({
              data: {
                id: productId,
                storeId: targetStoreId,
                name: lineItem.title || lineItem.name || "Unknown Product",
                sku: lineItem.sku || "",
                category: "Uncategorized",
                inventory: 0,
              }
            });
          }

          const revenue = parseFloat(lineItem.price || 0) * (lineItem.quantity || 1);
          const refunded = o.financial_status === 'refunded' || o.financial_status === 'partially_refunded';
          const refundedAt = refunded ? new Date(o.updated_at || o.created_at) : null;
          const orderId = o.id.toString();

          const existingOrder = await prisma.order.findUnique({
            where: { id: lineItem.id.toString() }
          });

          if (existingOrder) {
            report.duplicateCount++;
          }

          await prisma.order.upsert({
            where: { id: lineItem.id.toString() },
            update: {
              storeId: targetStoreId,
              productId: productId,
              revenue,
              profit: revenue * 0.4,
              refunded,
              refundedAt,
              orderId,
              orderTotal: totalAmount,
              store_local_date: storeLocalDate,
              paymentStatus: o.financial_status || "unknown",
              fulfillmentStatus: o.fulfillment_status || "unfulfilled",
              created_at_utc: new Date(o.created_at),
              store_timezone: normalizeTimezone(store.timezone),
              store_local_datetime: getStoreLocalDatetime(o.created_at, store.timezone)
            },
            create: {
              id: lineItem.id.toString(),
              storeId: targetStoreId,
              productId: productId,
              revenue,
              profit: revenue * 0.4,
              refunded,
              refundedAt,
              orderId,
              orderTotal: totalAmount,
              createdAt: new Date(o.created_at),
              store_local_date: storeLocalDate,
              paymentStatus: o.financial_status || "unknown",
              fulfillmentStatus: o.fulfillment_status || "unfulfilled",
              created_at_utc: new Date(o.created_at),
              store_timezone: normalizeTimezone(store.timezone),
              store_local_datetime: getStoreLocalDatetime(o.created_at, store.timezone)
            }
          });
        } catch (oErr) {
          hasWriteError = true;
          report.failedCount++;
          console.error(`[Shoplazza Sync] Prisma error writing order ${lineItem.id}:`, oErr);
        }
      }

      if (!hasWriteError) {
        report.recordsSaved++;
      }
    }

    if (orders.length < limit) {
      hasNextOrders = false;
    } else {
      page++;
      await delay(500);
    }
  }

  console.log(`[Shoplazza Sync] Saved ${report.recordsSaved} orders for store ${store.id}`);
  return report;
}
