// @ts-nocheck
import { getAccessToken, hashToken } from "../auth/token-store.js";
import { logger } from "../utils/logger.js";

const DEFAULT_API_VERSION = "v25.0";
const DEFAULT_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT = 30000;

export interface MetaApiClientConfig {
  apiVersion?: string;
  baseUrl?: string;
  timeout?: number;
}

export class ReadOnlyModeError extends Error {
  constructor(method: string, path: string) {
    super(`READ_ONLY_MODE blocked Meta ${method} request to ${path}`);
    this.name = "ReadOnlyModeError";
  }
}

export function isReadOnlyModeEnabled(): boolean {
  if (process.env.NODE_ENV === "test" && process.env.READ_ONLY_MODE === "false") {
    return false;
  }
  return true;
}

export class MetaApiClient {
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config?: MetaApiClientConfig) {
    this.apiVersion = config?.apiVersion ?? process.env.META_API_VERSION ?? DEFAULT_API_VERSION;
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.execute<T>("GET", url, path);
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    this.assertReadOnlyAllows("POST", path);
    const url = this.buildUrl(path);
    return this.execute<T>("POST", url, path, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async postForm<T>(
    path: string,
    params: Record<string, string | number | boolean>,
  ): Promise<T> {
    this.assertReadOnlyAllows("POST", path);
    const url = this.buildUrl(path);
    const formBody = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      formBody.set(key, String(value));
    }
    return this.execute<T>("POST", url, path, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
  }

  async postMultipart<T>(path: string, formData: FormData): Promise<T> {
    this.assertReadOnlyAllows("POST", path);
    const token = getAccessToken();
    formData.set("access_token", token);
    const url = this.buildUrl(path);
    return this.execute<T>("POST", url, path, { body: formData }, true);
  }

  async delete<T>(path: string): Promise<T> {
    this.assertReadOnlyAllows("DELETE", path);
    const url = this.buildUrl(path);
    return this.execute<T>("DELETE", url, path);
  }

  private assertReadOnlyAllows(method: string, path: string): void {
    if (!isReadOnlyModeEnabled()) return;
    logger.warn({ method, path }, "Blocked non-GET Meta API request in READ_ONLY_MODE");
    throw new ReadOnlyModeError(method, path);
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const base = `${this.baseUrl}/${this.apiVersion}${path.startsWith("/") ? path : `/${path}`}`;
    const url = new URL(base);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async execute<T>(
    method: string,
    url: string,
    path: string,
    options?: RequestInit,
    skipTokenParam = false,
  ): Promise<T> {
    if (method !== "GET") {
      this.assertReadOnlyAllows(method, path);
    }

    const token = getAccessToken();
    const reqUrl = skipTokenParam ? url : this.appendToken(url, token);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(reqUrl, {
        method,
        ...options,
        signal: controller.signal,
      });
      const text = await response.text();

      if (!response.ok) {
        logger.error(
          { method, path, status: response.status, tokenHash: hashToken(token) },
          "Meta API request failed",
        );
        throw new Error(`Meta API HTTP ${response.status} ${response.statusText}`.trim());
      }

      const body = text ? JSON.parse(text) as unknown : {};
      return body as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private appendToken(url: string, token: string): string {
    const u = new URL(url);
    u.searchParams.set("access_token", token);
    return u.toString();
  }
}

export const metaApiClient = new MetaApiClient();
