import axios from "axios";

export type ShoplazzaPaginationTermination = "NATURAL_END" | "EMPTY_PAGE" | "PAGE_LIMIT" | "ERROR";
export type ShoplazzaDateFilter = "created_at" | "placed_at";

export type ShoplazzaOrderExtraction = {
  orders: any[] | null;
  path: string | null;
};

export type ShoplazzaCursorExtraction = {
  cursor: string | null;
  path: string | null;
};

export type ShoplazzaOrderEndpoint = {
  apiVersion: string;
  path: string;
  mode: "cursor" | "legacy_page";
};

export type ShoplazzaOrderPagesResult = {
  dateFilter: ShoplazzaDateFilter;
  rawOrders: any[];
  pagesFetched: number;
  pageOrderCounts: number[];
  requestUrlsSanitized: string[];
  responseBodyKeys: string[];
  responseHeaderKeys: string[];
  selectedApiVersion: string | null;
  selectedEndpointPath: string | null;
  responseOrderPath: string | null;
  paginationMode: "cursor" | "legacy_page" | "unrecognized";
  cursorPages: number;
  coverageComplete: boolean;
  truncated: boolean;
  paginationTermination: ShoplazzaPaginationTermination;
  failedSlices: any[];
};

export type ShoplazzaOrderSlicesResult = ShoplazzaOrderPagesResult & {
  queryDateFields: ShoplazzaDateFilter[];
  createdAtSlice: ShoplazzaOrderPagesResult;
  placedAtSlice: ShoplazzaOrderPagesResult;
  deduplicatedOrderCount: number;
  duplicateAcrossSlicesCount: number;
};

export const SHOPLAZZA_ORDER_ENDPOINTS: ShoplazzaOrderEndpoint[] = [
  { apiVersion: "2026-01", path: "/openapi/2026-01/orders", mode: "cursor" },
  { apiVersion: "2025-06", path: "/openapi/2025-06/orders", mode: "cursor" },
  { apiVersion: "2022-01", path: "/openapi/2022-01/orders", mode: "legacy_page" },
  { apiVersion: "2022-01", path: "/openapi/2022-01/orders.json", mode: "legacy_page" },
  { apiVersion: "2020-01", path: "/openapi/2020-01/orders", mode: "legacy_page" },
  { apiVersion: "2020-01", path: "/openapi/2020-01/orders.json", mode: "legacy_page" }
];

function keysOf(value: any): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

function readPath(payload: any, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], payload);
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("access-token");
    parsed.searchParams.delete("Access-Token");
    parsed.searchParams.delete("token");
    return parsed.toString();
  } catch {
    return url.split("?")[0] || url;
  }
}

function safeErrorCode(error: any): string {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return "SHOPLAZZA_ORDER_PERMISSION_DENIED";
  if (status) return `HTTP_${status}`;
  return error?.code || "SHOPLAZZA_ORDER_REQUEST_FAILED";
}

export function extractShoplazzaOrders(payload: any): ShoplazzaOrderExtraction {
  const candidates = [
    { path: "orders", value: payload?.orders },
    { path: "data.orders", value: payload?.data?.orders },
    { path: "data.data.orders", value: payload?.data?.data?.orders },
    { path: "data", value: payload?.data },
    { path: "data.data", value: payload?.data?.data }
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate.value)) {
      return { orders: candidate.value, path: candidate.path };
    }
  }

  return { orders: null, path: null };
}

export function extractShoplazzaCursor(payload: any): ShoplazzaCursorExtraction {
  const paths = [
    "cursor",
    "data.cursor",
    "data.data.cursor",
    "next_cursor",
    "data.next_cursor",
    "pagination.next",
    "data.pagination.next"
  ];

  for (const path of paths) {
    const value = readPath(payload, path);
    if (value !== null && value !== undefined && String(value).trim()) {
      return { cursor: String(value).trim(), path };
    }
  }

  return { cursor: null, path: null };
}

function hasLegacyNextPage(payload: any, page: number): boolean {
  const pagination = payload?.pagination || payload?.data?.pagination || payload?.meta?.pagination || {};
  const totalPages = Number(
    pagination.total_pages ??
    pagination.totalPages ??
    payload?.total_pages ??
    payload?.data?.total_pages
  );
  const currentPage = Number(
    pagination.current_page ??
    pagination.currentPage ??
    payload?.current_page ??
    payload?.data?.current_page ??
    page
  );
  if (Number.isFinite(totalPages) && totalPages > 0) {
    return currentPage < totalPages;
  }
  const hasMore = pagination.has_more ?? pagination.hasMore ?? payload?.has_more ?? payload?.data?.has_more;
  return hasMore === true;
}

export function buildShoplazzaNextPage(input: {
  currentUrl: string;
  endpoint: ShoplazzaOrderEndpoint;
  payload: any;
  page: number;
}): { nextUrl: string | null; cursor: string | null; cursorPath: string | null; mode: "cursor" | "legacy_page" } {
  const cursor = extractShoplazzaCursor(input.payload);
  if (cursor.cursor) {
    const parsed = new URL(input.currentUrl);
    parsed.searchParams.set("cursor", cursor.cursor);
    return { nextUrl: parsed.toString(), cursor: cursor.cursor, cursorPath: cursor.path, mode: "cursor" };
  }

  if (input.endpoint.mode === "legacy_page" && hasLegacyNextPage(input.payload, input.page)) {
    const parsed = new URL(input.currentUrl);
    parsed.searchParams.set("page", String(input.page + 1));
    return { nextUrl: parsed.toString(), cursor: null, cursorPath: null, mode: "legacy_page" };
  }

  return { nextUrl: null, cursor: null, cursorPath: null, mode: input.endpoint.mode };
}

function buildInitialUrl(input: {
  domain: string;
  endpoint: ShoplazzaOrderEndpoint;
  startUtc: string;
  endUtc: string;
  pageSize: number;
  dateFilter: ShoplazzaDateFilter;
}): string {
  const url = new URL(`https://${input.domain}${input.endpoint.path}`);
  url.searchParams.set(input.endpoint.mode === "cursor" ? "page_size" : "limit", String(input.pageSize));
  if (input.endpoint.mode === "legacy_page") {
    url.searchParams.set("page", "1");
  }
  url.searchParams.set(`${input.dateFilter}_min`, input.startUtc);
  url.searchParams.set(`${input.dateFilter}_max`, input.endUtc);
  return url.toString();
}

function orderPageSignature(orders: any[]): string {
  return orders.map(order => String(order?.id ?? order?.order_number ?? order?.number ?? "")).join("|");
}

export async function fetchShoplazzaOrderPages(input: {
  domain: string;
  token: string;
  startUtc: string;
  endUtc: string;
  dateFilter?: ShoplazzaDateFilter;
  pageSize?: number;
  maxPages?: number;
}): Promise<ShoplazzaOrderPagesResult> {
  const domain = input.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  const pageSize = input.pageSize ?? 250;
  const maxPages = input.maxPages ?? 50;
  const dateFilter = input.dateFilter ?? "created_at";
  const headers = {
    "access-token": input.token,
    "Accept": "application/json",
    "Content-Type": "application/json"
  };

  const failedSlices: any[] = [];
  const responseBodyKeys = new Set<string>();
  const responseHeaderKeys = new Set<string>();

  for (const endpoint of SHOPLAZZA_ORDER_ENDPOINTS) {
    const selectedEndpointFailureStart = failedSlices.length;
    let currentUrl = buildInitialUrl({ domain, endpoint, startUtc: input.startUtc, endUtc: input.endUtc, pageSize, dateFilter });
    let page = 1;
    let cursorPages = 0;
    const rawOrders: any[] = [];
    const pageOrderCounts: number[] = [];
    const requestUrlsSanitized: string[] = [];
    const visitedUrls = new Set<string>();
    const visitedCursors = new Set<string>();
    const visitedPageSignatures = new Set<string>();
    let responseOrderPath: string | null = null;
    let paginationMode: "cursor" | "legacy_page" | "unrecognized" = endpoint.mode;

    while (true) {
      const sanitized = sanitizeUrl(currentUrl);
      if (visitedUrls.has(sanitized)) {
        failedSlices.push({ apiVersion: endpoint.apiVersion, endpointPath: endpoint.path, reason: "SHOPLAZZA_ORDER_DUPLICATE_URL" });
        const selectedEndpointFailures = failedSlices.slice(selectedEndpointFailureStart);
        return {
          dateFilter,
          rawOrders,
          pagesFetched: pageOrderCounts.length,
          pageOrderCounts,
          requestUrlsSanitized,
          responseBodyKeys: Array.from(responseBodyKeys),
          responseHeaderKeys: Array.from(responseHeaderKeys),
          selectedApiVersion: endpoint.apiVersion,
          selectedEndpointPath: endpoint.path,
          responseOrderPath,
          paginationMode,
          cursorPages,
          coverageComplete: false,
          truncated: false,
          paginationTermination: "ERROR",
          failedSlices: selectedEndpointFailures
        };
      }
      visitedUrls.add(sanitized);
      requestUrlsSanitized.push(sanitized);

      let response;
      try {
        response = await axios.get(currentUrl, { headers, timeout: 15000 });
      } catch (error: any) {
        failedSlices.push({
          apiVersion: endpoint.apiVersion,
          endpointPath: endpoint.path,
          httpStatus: error?.response?.status ?? null,
          reason: safeErrorCode(error)
        });
        if (error?.response?.status === 401 || error?.response?.status === 403) {
          throw new Error("SHOPLAZZA_ORDER_PERMISSION_DENIED");
        }
        break;
      }

      keysOf(response.data).forEach(key => responseBodyKeys.add(key));
      keysOf(response.headers).forEach(key => responseHeaderKeys.add(key));
      const extracted = extractShoplazzaOrders(response.data);
      if (!extracted.orders) {
        failedSlices.push({
          apiVersion: endpoint.apiVersion,
          endpointPath: endpoint.path,
          httpStatus: response.status ?? null,
          reason: "SHOPLAZZA_ORDER_RESPONSE_UNRECOGNIZED",
          topLevelKeys: keysOf(response.data),
          dataKeys: keysOf(response.data?.data)
        });
        break;
      }

      responseOrderPath = extracted.path;
      const orders = extracted.orders;
      pageOrderCounts.push(orders.length);
      rawOrders.push(...orders);

      const signature = orderPageSignature(orders);
      if (signature && visitedPageSignatures.has(signature)) {
        failedSlices.push({ apiVersion: endpoint.apiVersion, endpointPath: endpoint.path, reason: "SHOPLAZZA_ORDER_DUPLICATE_ORDER_PAGE" });
        const selectedEndpointFailures = failedSlices.slice(selectedEndpointFailureStart);
        return {
          dateFilter,
          rawOrders,
          pagesFetched: pageOrderCounts.length,
          pageOrderCounts,
          requestUrlsSanitized,
          responseBodyKeys: Array.from(responseBodyKeys),
          responseHeaderKeys: Array.from(responseHeaderKeys),
          selectedApiVersion: endpoint.apiVersion,
          selectedEndpointPath: endpoint.path,
          responseOrderPath,
          paginationMode,
          cursorPages,
          coverageComplete: false,
          truncated: false,
          paginationTermination: "ERROR",
          failedSlices: selectedEndpointFailures
        };
      }
      if (signature) visitedPageSignatures.add(signature);

      const next = buildShoplazzaNextPage({ currentUrl, endpoint, payload: response.data, page });
      paginationMode = next.mode;
      if (next.cursor) {
        if (visitedCursors.has(next.cursor)) {
          failedSlices.push({ apiVersion: endpoint.apiVersion, endpointPath: endpoint.path, reason: "SHOPLAZZA_ORDER_DUPLICATE_CURSOR" });
          const selectedEndpointFailures = failedSlices.slice(selectedEndpointFailureStart);
          return {
            dateFilter,
            rawOrders,
            pagesFetched: pageOrderCounts.length,
            pageOrderCounts,
            requestUrlsSanitized,
            responseBodyKeys: Array.from(responseBodyKeys),
            responseHeaderKeys: Array.from(responseHeaderKeys),
            selectedApiVersion: endpoint.apiVersion,
            selectedEndpointPath: endpoint.path,
            responseOrderPath,
            paginationMode,
            cursorPages,
            coverageComplete: false,
            truncated: false,
            paginationTermination: "ERROR",
            failedSlices: selectedEndpointFailures
          };
        }
        visitedCursors.add(next.cursor);
        cursorPages += 1;
      }

      if (!next.nextUrl) {
        const selectedEndpointFailures = failedSlices.slice(selectedEndpointFailureStart);
        return {
          dateFilter,
          rawOrders,
          pagesFetched: pageOrderCounts.length,
          pageOrderCounts,
          requestUrlsSanitized,
          responseBodyKeys: Array.from(responseBodyKeys),
          responseHeaderKeys: Array.from(responseHeaderKeys),
          selectedApiVersion: endpoint.apiVersion,
          selectedEndpointPath: endpoint.path,
          responseOrderPath,
          paginationMode,
          cursorPages,
          coverageComplete: selectedEndpointFailures.length === 0,
          truncated: false,
          paginationTermination: orders.length === 0 ? "EMPTY_PAGE" : "NATURAL_END",
          failedSlices: selectedEndpointFailures
        };
      }

      if (pageOrderCounts.length >= maxPages) {
        failedSlices.push({ apiVersion: endpoint.apiVersion, endpointPath: endpoint.path, reason: "PAGE_LIMIT", truncated: true });
        const selectedEndpointFailures = failedSlices.slice(selectedEndpointFailureStart);
        return {
          dateFilter,
          rawOrders,
          pagesFetched: pageOrderCounts.length,
          pageOrderCounts,
          requestUrlsSanitized,
          responseBodyKeys: Array.from(responseBodyKeys),
          responseHeaderKeys: Array.from(responseHeaderKeys),
          selectedApiVersion: endpoint.apiVersion,
          selectedEndpointPath: endpoint.path,
          responseOrderPath,
          paginationMode,
          cursorPages,
          coverageComplete: false,
          truncated: true,
          paginationTermination: "PAGE_LIMIT",
          failedSlices: selectedEndpointFailures
        };
      }

      currentUrl = next.nextUrl;
      page += 1;
    }
  }

  return {
    dateFilter,
    rawOrders: [],
    pagesFetched: 0,
    pageOrderCounts: [],
    requestUrlsSanitized: [],
    responseBodyKeys: Array.from(responseBodyKeys),
    responseHeaderKeys: Array.from(responseHeaderKeys),
    selectedApiVersion: null,
    selectedEndpointPath: null,
    responseOrderPath: null,
    paginationMode: "unrecognized",
    cursorPages: 0,
    coverageComplete: false,
    truncated: false,
    paginationTermination: "ERROR",
    failedSlices: failedSlices.length > 0
      ? failedSlices
      : [{ reason: "SHOPLAZZA_ORDER_RESPONSE_UNRECOGNIZED" }]
  };
}

function orderDedupeKey(order: any): string {
  return String(order?.id ?? order?.order_id ?? order?.order_number ?? order?.number ?? "");
}

export async function fetchShoplazzaOrderSlices(input: {
  domain: string;
  token: string;
  startUtc: string;
  endUtc: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<ShoplazzaOrderSlicesResult> {
  const createdAtSlice = await fetchShoplazzaOrderPages({
    ...input,
    dateFilter: "created_at"
  });
  const placedAtSlice = await fetchShoplazzaOrderPages({
    ...input,
    dateFilter: "placed_at"
  });

  const byOrderId = new Map<string, any>();
  let duplicateAcrossSlicesCount = 0;
  for (const order of [...createdAtSlice.rawOrders, ...placedAtSlice.rawOrders]) {
    const key = orderDedupeKey(order);
    if (key && byOrderId.has(key)) {
      duplicateAcrossSlicesCount += 1;
      continue;
    }
    byOrderId.set(key || `__missing_${byOrderId.size}`, order);
  }

  const failedSlices = [
    ...createdAtSlice.failedSlices.map(slice => ({ ...slice, dateFilter: "created_at" })),
    ...placedAtSlice.failedSlices.map(slice => ({ ...slice, dateFilter: "placed_at" }))
  ];
  if (!createdAtSlice.coverageComplete) {
    failedSlices.push({ dateFilter: "created_at", reason: "SHOPLAZZA_CREATED_AT_SLICE_INCOMPLETE" });
  }
  if (!placedAtSlice.coverageComplete) {
    failedSlices.push({ dateFilter: "placed_at", reason: "SHOPLAZZA_PLACED_AT_SLICE_INCOMPLETE" });
  }

  const rawOrders = Array.from(byOrderId.values());
  const coverageComplete =
    createdAtSlice.coverageComplete === true &&
    placedAtSlice.coverageComplete === true &&
    createdAtSlice.truncated !== true &&
    placedAtSlice.truncated !== true &&
    failedSlices.length === 0;

  return {
    ...createdAtSlice,
    dateFilter: "created_at",
    rawOrders,
    pagesFetched: createdAtSlice.pagesFetched + placedAtSlice.pagesFetched,
    pageOrderCounts: [...createdAtSlice.pageOrderCounts, ...placedAtSlice.pageOrderCounts],
    requestUrlsSanitized: [...createdAtSlice.requestUrlsSanitized, ...placedAtSlice.requestUrlsSanitized],
    responseBodyKeys: Array.from(new Set([...createdAtSlice.responseBodyKeys, ...placedAtSlice.responseBodyKeys])),
    responseHeaderKeys: Array.from(new Set([...createdAtSlice.responseHeaderKeys, ...placedAtSlice.responseHeaderKeys])),
    cursorPages: createdAtSlice.cursorPages + placedAtSlice.cursorPages,
    coverageComplete,
    truncated: createdAtSlice.truncated || placedAtSlice.truncated,
    paginationTermination: coverageComplete ? "NATURAL_END" : "ERROR",
    failedSlices,
    queryDateFields: ["created_at", "placed_at"],
    createdAtSlice,
    placedAtSlice,
    deduplicatedOrderCount: rawOrders.length,
    duplicateAcrossSlicesCount
  };
}
