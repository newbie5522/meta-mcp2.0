import { Socket } from "node:net";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheSetOptions {
  ttlSeconds: number;
}

export class TtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, options: CacheSetOptions): void {
    if (options.ttlSeconds <= 0) {
      throw new Error("cache ttlSeconds must be positive");
    }
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + options.ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clearExpired(now = Date.now()): number {
    let deleted = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}

type RedisValue = string | number | null;

export class RedisTtlCache {
  private readonly url: URL;
  private readonly timeoutMs: number;

  constructor(redisUrl: string, timeoutMs = 500) {
    this.url = new URL(redisUrl);
    this.timeoutMs = timeoutMs;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.command(["GET", key]);
    if (typeof value !== "string") return undefined;
    return JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    if (options.ttlSeconds <= 0) {
      throw new Error("cache ttlSeconds must be positive");
    }
    await this.command(["SET", key, JSON.stringify(value), "EX", String(options.ttlSeconds)]);
  }

  async delete(key: string): Promise<void> {
    await this.command(["DEL", key]);
  }

  async ping(): Promise<boolean> {
    const result = await this.command(["PING"]);
    return result === "PONG";
  }

  private command(args: string[]): Promise<RedisValue> {
    const host = this.url.hostname || "127.0.0.1";
    const port = Number(this.url.port || 6379);
    const payload = encodeResp(args);

    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;
      const timeout = setTimeout(() => {
        settle(new Error("Redis command timed out"));
      }, this.timeoutMs);

      function settle(error: Error): void;
      function settle(error: null, value: RedisValue): void;
      function settle(error: Error | null, value?: RedisValue): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else resolve(value ?? null);
      }

      socket.once("error", (error) => settle(error));
      socket.connect(port, host, () => {
        socket.write(payload);
      });
      socket.on("data", (chunk) => {
        chunks.push(chunk);
        try {
          const parsed = parseResp(Buffer.concat(chunks));
          if (parsed.complete) {
            settle(null, parsed.value);
          }
        } catch (error) {
          settle(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}

function encodeResp(args: string[]): string {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")}`;
}

function parseResp(buffer: Buffer): { complete: false } | { complete: true; value: RedisValue } {
  const prefix = String.fromCharCode(buffer[0]);
  const lineEnd = buffer.indexOf("\r\n");
  if (lineEnd === -1) return { complete: false };
  const line = buffer.subarray(1, lineEnd).toString("utf8");

  if (prefix === "+") return { complete: true, value: line };
  if (prefix === ":") return { complete: true, value: Number(line) };
  if (prefix === "-") throw new Error(`Redis error: ${line}`);
  if (prefix !== "$") throw new Error(`Unsupported Redis response prefix: ${prefix}`);

  const length = Number(line);
  if (length === -1) return { complete: true, value: null };
  const start = lineEnd + 2;
  const end = start + length;
  if (buffer.length < end + 2) return { complete: false };
  return { complete: true, value: buffer.subarray(start, end).toString("utf8") };
}

export const cacheKey = {
  dashboard: (scope = "all") => `dashboard:v1:${scope}`,
  storeSummary: (storeId: string, range: string) => `store-summary:v1:${storeId}:${range}`,
  accountSummary: (accountId: string, range: string) => `account-summary:v1:${accountId}:${range}`,
  countryAnalysis: (storeId: string, range: string) => `country-analysis:v1:${storeId}:${range}`,
  productAnalysis: (storeId: string, range: string) => `product-analysis:v1:${storeId}:${range}`,
  creativeAnalysis: (storeId: string, range: string) => `creative-analysis:v1:${storeId}:${range}`,
  trendAnalysis: (storeId: string, until: string) => `trend-analysis:v1:${storeId}:${until}`,
  aiContext: (conversationId: string) => `ai-context:v1:${conversationId}`,
  aiReport: (entityType: string, entityId: string, range: string) =>
    `ai-report:v1:${entityType}:${entityId}:${range}`,
} as const;

export const defaultTtlSeconds = {
  dashboard: 30,
  summary: 30,
  breakdown: 60,
  aiContext: 1800,
  aiReport: 3600,
} as const;

export const memoryCache = new TtlCache();
export const redisCache = process.env.REDIS_URL && process.env.CACHE_DRIVER !== "memory"
  ? new RedisTtlCache(process.env.REDIS_URL)
  : null;

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  if (redisCache) {
    try {
      const value = await redisCache.get<T>(key);
      if (value !== undefined) return value;
    } catch {
      // Fall back to memory cache when Redis is unavailable.
    }
  }
  return memoryCache.get<T>(key);
}

export async function cacheSet<T>(key: string, value: T, options: CacheSetOptions): Promise<T> {
  memoryCache.set(key, value, options);
  if (redisCache) {
    try {
      await redisCache.set(key, value, options);
    } catch {
      // Memory cache remains available if Redis is temporarily down.
    }
  }
  return value;
}

export async function cacheDelete(key: string): Promise<void> {
  memoryCache.delete(key);
  if (redisCache) {
    try {
      await redisCache.delete(key);
    } catch {
      // Ignore Redis delete failures; TTL still bounds staleness.
    }
  }
}

export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const fresh = await loader();
  return cacheSet(key, fresh, { ttlSeconds });
}
