import { assertSafePublicUrl } from "../utils/url-guard.js";

export type ShopPlatform = "shopline" | "shoplazza" | "shopify";

export interface ShopApiRequest {
  platform: ShopPlatform;
  apiBaseUrl: string;
  token: string;
  path: string;
  query?: Record<string, string | number | undefined>;
}

export interface ShopApiResponse<T> {
  data: T;
  headers: Headers;
  requestId?: string;
  url: string;
}

export class ShopApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ShopApiError";
  }
}

function tokenHeaderName(platform: ShopPlatform): string {
  const envName = platform === "shopline"
    ? process.env.SHOPLINE_TOKEN_HEADER
    : platform === "shopify"
      ? process.env.SHOPIFY_TOKEN_HEADER
      : process.env.SHOPLAZZA_TOKEN_HEADER;
  if (envName?.trim()) return envName.trim();
  if (platform === "shopline") return "Authorization";
  if (platform === "shopify") return "X-Shopify-Access-Token";
  return "Access-Token";
}

function tokenHeaderValue(platform: ShopPlatform, token: string): string {
  const template = platform === "shopline"
    ? process.env.SHOPLINE_TOKEN_HEADER_VALUE
    : platform === "shopify"
      ? process.env.SHOPIFY_TOKEN_HEADER_VALUE
      : process.env.SHOPLAZZA_TOKEN_HEADER_VALUE;
  if (template?.includes("{token}")) {
    return template.replace("{token}", token);
  }
  return platform === "shopline" ? `Bearer ${token}` : token;
}

function apiVersion(platform: ShopPlatform): string {
  const configured = platform === "shopline"
    ? process.env.SHOPLINE_API_VERSION
    : platform === "shopify"
      ? process.env.SHOPIFY_API_VERSION
      : process.env.SHOPLAZZA_API_VERSION;
  if (configured?.trim()) return configured.trim();
  if (platform === "shopline") return "v20240301";
  if (platform === "shopify") return "2024-01";
  return "2022-01";
}

export function shopApiHeaders(request: Pick<ShopApiRequest, "platform" | "token">): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    [tokenHeaderName(request.platform)]: tokenHeaderValue(request.platform, request.token),
  };
  return headers;
}

function safeErrorMessage(text: string): string {
  if (!text.trim()) return "";
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["errors", "error", "message", "msg", "code"]) {
      const value = payload[key];
      if (typeof value === "string" || typeof value === "number") {
        return String(value).slice(0, 300);
      }
    }
  } catch {
    // Non-JSON platform errors are handled below.
  }
  return text
    .replace(/(access[-_ ]?token|authorization|token)[=: ]+[^,\s"}]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

export function validateShopApiBaseUrl(platform: ShopPlatform, apiBaseUrl: string): URL {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== "https:") {
    const example = platform === "shopline"
      ? "https://your-handle.myshopline.com"
      : platform === "shopify"
        ? "https://your-store.myshopify.com"
        : "https://your-subdomain.myshoplaza.com";
    throw new Error(`${platform} API Base URL must use HTTPS, for example ${example}.`);
  }
  return url;
}

export async function requestShopApiPage<T>(request: ShopApiRequest): Promise<ShopApiResponse<T>> {
  validateShopApiBaseUrl(request.platform, request.apiBaseUrl);
  const baseUrl = await assertSafePublicUrl(request.apiBaseUrl);
  const url = new URL(request.path, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error("Store API path must use the configured API Base URL origin.");
  }
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: shopApiHeaders(request),
    redirect: "error",
  });

  const requestId = response.headers.get("x-shopline-request-id") ?? response.headers.get("x-request-id") ?? undefined;
  if (!response.ok || response.status === 204) {
    const details = safeErrorMessage(await response.text());
    throw new ShopApiError(
      `Store API HTTP ${response.status} ${response.statusText || "No Content"}${details ? `: ${details}` : ""}${requestId ? ` (requestId: ${requestId})` : ""}`.trim(),
      response.status,
      requestId,
    );
  }
  const text = await response.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new ShopApiError(
      `Store API returned a non-JSON response${requestId ? ` (requestId: ${requestId})` : ""}. Check that the platform internal domain is configured instead of a storefront custom domain.`,
      response.status,
      requestId,
    );
  }
  return {
    data,
    headers: response.headers,
    requestId,
    url: url.toString(),
  };
}

export async function requestShopApiJson<T>(request: ShopApiRequest): Promise<T> {
  return (await requestShopApiPage<T>(request)).data;
}

export function ordersPathsForPlatform(platform: ShopPlatform): string[] {
  const value = platform === "shopline"
    ? process.env.SHOPLINE_ORDERS_PATH
    : platform === "shopify"
      ? process.env.SHOPIFY_ORDERS_PATH
      : process.env.SHOPLAZZA_ORDERS_PATH;
  if (platform === "shopline") {
    return [...new Set([
      ...(value?.trim() ? [value.trim()] : []),
      `/admin/openapi/${apiVersion(platform)}/orders.json`,
      "/admin/openapi/v20240301/orders.json",
      "/admin/openapi/v20250601/orders.json",
      "/admin/openapi/v20260901/orders.json",
      "/admin/openapi/v20240901/orders.json",
      "/admin/openapi/v20230601/orders.json",
      "/admin/openapi/orders.json",
      "/admin/openapi/orders",
      "/admin/api/2024-01/orders.json",
      "/admin/api/2023-10/orders.json",
      "/admin/api/2023-07/orders.json",
    ])];
  }
  if (platform === "shopify") {
    return [...new Set([
      ...(value?.trim() ? [value.trim()] : []),
      `/admin/api/${apiVersion(platform)}/orders.json`,
      "/admin/api/2024-01/orders.json",
    ])];
  }
  return [...new Set([
    ...(value?.trim() ? [value.trim()] : []),
    `/openapi/${apiVersion(platform)}/orders`,
    "/openapi/2022-01/orders",
    "/openapi/2020-01/orders",
    "/openapi/2022-01/orders.json",
    "/openapi/2020-01/orders.json",
    "/openapi/2026-01/orders",
    "/openapi/2025-06/orders",
    "/openapi/2026-01/orders.json",
    "/openapi/2025-06/orders.json",
  ])];
}

export function ordersPathForPlatform(platform: ShopPlatform): string {
  return ordersPathsForPlatform(platform)[0];
}

export function productPathsForPlatform(platform: ShopPlatform): string[] {
  const value = platform === "shopline"
    ? process.env.SHOPLINE_PRODUCTS_PATH
    : platform === "shopify"
      ? process.env.SHOPIFY_PRODUCTS_PATH
      : process.env.SHOPLAZZA_PRODUCTS_PATH;
  if (platform === "shopline") {
    return [...new Set([
      ...(value?.trim() ? [value.trim()] : []),
      `/admin/openapi/${apiVersion(platform)}/products.json`,
      "/admin/openapi/v20240301/products.json",
      "/admin/openapi/v20250601/products.json",
      "/admin/openapi/v20260901/products.json",
      "/admin/openapi/v20240901/products.json",
      "/admin/openapi/v20230601/products.json",
      "/admin/openapi/products.json",
      "/admin/openapi/products",
      "/admin/api/2024-01/products.json",
      "/admin/api/2023-10/products.json",
      "/admin/api/2023-07/products.json",
      "/admin/products.json",
      "/admin/products",
      "/openapi/products.json",
      "/openapi/products",
    ])];
  }
  if (platform === "shopify") {
    return [...new Set([
      ...(value?.trim() ? [value.trim()] : []),
      `/admin/api/${apiVersion(platform)}/products.json`,
      "/admin/api/2024-01/products.json",
    ])];
  }
  return [...new Set([
    ...(value?.trim() ? [value.trim()] : []),
    `/openapi/${apiVersion(platform)}/products`,
    "/openapi/2022-01/products",
    "/openapi/2020-01/products",
    "/openapi/2022-01/products.json",
    "/openapi/2020-01/products.json",
    "/openapi/2026-01/products",
    "/openapi/2025-06/products",
    "/openapi/2026-01/products.json",
    "/openapi/2025-06/products.json",
  ])];
}

export function profilePathForPlatform(platform: ShopPlatform): string {
  const value = platform === "shopline"
    ? process.env.SHOPLINE_PROFILE_PATH
    : platform === "shopify"
      ? process.env.SHOPIFY_PROFILE_PATH
      : process.env.SHOPLAZZA_PROFILE_PATH;
  if (value?.trim()) return value.trim();
  if (platform === "shopify") return `/admin/api/${apiVersion(platform)}/shop.json`;
  return platform === "shopline"
    ? `/admin/openapi/${apiVersion(platform)}/merchants/shop.json`
    : `/openapi/${apiVersion(platform)}/shop`;
}
