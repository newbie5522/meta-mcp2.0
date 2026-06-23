// @ts-nocheck
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezonePlugin from "dayjs/plugin/timezone.js";
import prisma from "../../db/index.js";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

function money(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function normalizeStoreTimezone(input?: string | null, store?: any): string {
  const raw = String(input || "").trim();

  const lowerDomain = String(store?.domain || "").toLowerCase();
  const lowerName = String(store?.name || "").toLowerCase();

  if (lowerDomain.includes("baslayer") || lowerName.includes("baslayer")) {
    return "America/Los_Angeles";
  }

  const aliases: Record<string, string> = {
    "US/Pacific": "America/Los_Angeles",
    "Pacific Time": "America/Los_Angeles",
    "PST": "America/Los_Angeles",
    "PDT": "America/Los_Angeles",
    "GMT-7": "America/Los_Angeles",
    "UTC-7": "America/Los_Angeles",
    "GMT-07:00": "America/Los_Angeles",
    "UTC-07:00": "America/Los_Angeles"
  };

  if (aliases[raw]) return aliases[raw];

  try {
    if (raw) {
      Intl.DateTimeFormat(undefined, { timeZone: raw });
      return raw;
    }
  } catch {}

  return "America/Los_Angeles";
}

function buildStoreWindow(date: string, timezone: string) {
  const noon = dayjs.tz(`${date}T12:00:00`, timezone);
  const offset = noon.format("Z");

  return {
    startAt: `${date}T00:00:00${offset}`,
    endAt: `${date}T23:59:59${offset}`,
    offset
  };
}

function toStoreDate(rawTime: string, timezone: string) {
  return dayjs(rawTime).tz(timezone).format("YYYY-MM-DD");
}

function extractShoplineOrderAmount(order: any) {
  const candidates = {
    total_price: money(order.total_price),
    total_amount: money(order.total_amount),
    order_total: money(order.order_total),
    payment_total: money(order.payment_total),
    paid_total: money(order.paid_total),
    current_total_price: money(order.current_total_price),
    subtotal_price: money(order.subtotal_price),
    current_subtotal_price: money(order.current_subtotal_price),
    line_items_sum: money(
      (Array.isArray(order.line_items) ? order.line_items : []).reduce((s: number, li: any) => {
        return s + money(li.price ?? li.unit_price) * money(li.quantity || 1);
      }, 0)
    )
  };

  const priority = [
    "total_price",
    "total_amount",
    "order_total",
    "payment_total",
    "paid_total",
    "current_total_price"
  ];

  for (const field of priority) {
    if (candidates[field] > 0) {
      return {
        amount: candidates[field],
        source: field,
        candidates
      };
    }
  }

  return {
    amount: candidates.line_items_sum,
    source: "LINE_ITEM_FALLBACK",
    candidates
  };
}

function isPaidOrder(order: any) {
  const status = String(order.financial_status || order.payment_status || "").toLowerCase();

  if (order.cancelled_at || order.cancel_reason) return false;
  if (["cancelled", "voided", "unpaid", "waiting", "pending"].includes(status)) return false;

  return ["paid", "partially_paid", "partially_refunded", "fulfilled"].includes(status) || status === "";
}

async function fetchShoplineOrders(params: {
  domain: string;
  token: string;
  startAt: string;
  endAt: string;
}) {
  const domain = params.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");

  let url = `https://${domain}/admin/openapi/v20240301/orders.json?status=any&created_at_min=${encodeURIComponent(params.startAt)}&created_at_max=${encodeURIComponent(params.endAt)}&limit=100`;

  const headers = {
    Authorization: `Bearer ${params.token}`,
    "Content-Type": "application/json"
  };

  const orders: any[] = [];
  const pageOrderCounts: number[] = [];
  const responseBodyKeys = new Set<string>();
  const responseHeaderKeys = new Set<string>();
  const urls: string[] = [];

  let pagesFetched = 0;
  let safety = 0;

  while (url && safety < 100) {
    safety++;
    pagesFetched++;
    urls.push(url.replace(params.token, "***"));

    const res = await axios.get(url, { headers, timeout: 20000 });

    Object.keys(res.data || {}).forEach(k => responseBodyKeys.add(k));
    Object.keys(res.headers || {}).forEach(k => responseHeaderKeys.add(k));

    const pageOrders = Array.isArray(res.data?.orders)
      ? res.data.orders
      : Array.isArray(res.data?.data)
        ? res.data.data
        : [];

    pageOrderCounts.push(pageOrders.length);
    orders.push(...pageOrders);

    const link = res.headers?.link || res.headers?.Link;
    let nextUrl: string | null = null;

    if (link && String(link).includes('rel="next"')) {
      const m = String(link).match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = m?.[1] || null;
    }

    if (!nextUrl) {
      const cursor =
        res.data?.next_page_info ||
        res.data?.page_info ||
        res.data?.next ||
        res.data?.pagination?.next ||
        res.data?.cursor ||
        res.data?.next_cursor ||
        res.data?.meta?.next;

      if (cursor) {
        if (String(cursor).startsWith("http")) {
          nextUrl = String(cursor);
        } else {
          const u = new URL(url);
          u.searchParams.set("page_info", String(cursor));
          nextUrl = u.toString();
        }
      }
    }

    url = nextUrl || "";
  }

  return {
    orders,
    diagnostics: {
      pagesFetched,
      pageOrderCounts,
      responseBodyKeys: Array.from(responseBodyKeys),
      responseHeaderKeys: Array.from(responseHeaderKeys),
      urls
    }
  };
}

export async function refreshStoreDataCenterLedger(params: {
  storeId: number;
  startDate: string;
  endDate: string;
}) {
  const store = await prisma.store.findUnique({
    where: { id: Number(params.storeId) }
  });

  if (!store) throw new Error(`STORE_NOT_FOUND:${params.storeId}`);

  const platform = String(store.platform || "shopline").toLowerCase();

  const token =
    platform === "shopify"
      ? store.shopify_token
      : platform === "shoplazza"
        ? store.shoplazza_token
        : store.shopline_token;

  if (!token) throw new Error(`STORE_TOKEN_MISSING:${store.id}`);

  const timezone = normalizeStoreTimezone(store.timezone, store);

  if (store.timezone !== timezone) {
    await prisma.store.update({
      where: { id: store.id },
      data: { timezone }
    });
  }

  const start = dayjs(params.startDate);
  const end = dayjs(params.endDate);

  const allDaily: any[] = [];
  let totalFetched = 0;

  for (let d = start; d.isBefore(end) || d.isSame(end, "day"); d = d.add(1, "day")) {
    const date = d.format("YYYY-MM-DD");
    const win = buildStoreWindow(date, timezone);

    let fetched: any;

    if (platform === "shopline") {
      fetched = await fetchShoplineOrders({
        domain: store.domain,
        token,
        startAt: win.startAt,
        endAt: win.endAt
      });
    } else {
      throw new Error(`PLATFORM_NOT_IMPLEMENTED_IN_DATACENTER_LEDGER:${platform}`);
    }

    totalFetched += fetched.orders.length;

    const byOrder = new Map<string, any>();

    for (const order of fetched.orders) {
      const rawTime = order.paid_at || order.processed_at || order.completed_at || order.created_at || order.updated_at;
      if (!rawTime) continue;

      const localDate = toStoreDate(rawTime, timezone);
      if (localDate !== date) continue;
      if (!isPaidOrder(order)) continue;

      const orderId = String(order.id || order.order_id || order.name);
      if (!orderId) continue;

      const amount = extractShoplineOrderAmount(order);

      byOrder.set(orderId, {
        orderId,
        amount: amount.amount,
        source: amount.source,
        candidates: amount.candidates,
        rawTime,
        status: order.financial_status || order.payment_status || ""
      });
    }

    const orders = Array.from(byOrder.values());
    const grossSales = Number(orders.reduce((s, o) => s + Number(o.amount || 0), 0).toFixed(2));
    const orderCount = orders.length;
    const aov = orderCount > 0 ? Number((grossSales / orderCount).toFixed(2)) : 0;

    const sourceCounts = orders.reduce((acc: any, o: any) => {
      acc[o.source] = (acc[o.source] || 0) + 1;
      return acc;
    }, {});

    const digestObj = {
      orders: orders.map(o => ({
        orderId: o.orderId,
        amount: o.amount,
        source: o.source,
        rawTime: o.rawTime,
        status: o.status
      }))
    };

    const snapshot = await prisma.dataCenterStoreDaily.upsert({
      where: {
        storeId_date: {
          storeId: store.id,
          date
        }
      },
      update: {
        storeName: store.name,
        platform: store.platform,
        domain: store.domain,
        timezone,
        currency: "USD",
        orderCount,
        grossSales,
        netSales: grossSales,
        aov,
        amountSource: JSON.stringify(sourceCounts),
        orderIdsJson: JSON.stringify(orders.map(o => o.orderId)),
        rawDigestJson: JSON.stringify(digestObj),
        apiRawDigestJson: JSON.stringify(digestObj),
        diagnosticsJson: JSON.stringify({
          window: win,
          fetched: fetched.diagnostics,
          sourceCounts
        }),
        apiFetchedAt: new Date()
      },
      create: {
        storeId: store.id,
        storeName: store.name,
        platform: store.platform,
        domain: store.domain,
        date,
        timezone,
        currency: "USD",
        orderCount,
        grossSales,
        netSales: grossSales,
        aov,
        amountSource: JSON.stringify(sourceCounts),
        orderIdsJson: JSON.stringify(orders.map(o => o.orderId)),
        rawDigestJson: JSON.stringify(digestObj),
        apiRawDigestJson: JSON.stringify(digestObj),
        diagnosticsJson: JSON.stringify({
          window: win,
          fetched: fetched.diagnostics,
          sourceCounts
        }),
        apiFetchedAt: new Date()
      }
    });

    allDaily.push(snapshot);
  }

  return {
    storeId: store.id,
    storeName: store.name,
    platform,
    timezone,
    totalFetched,
    snapshots: allDaily
  };
}
