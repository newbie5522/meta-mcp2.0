import { Router } from "express";
import prisma from "../../db/index.js";
import axios from "axios";
import { getTimezoneOffsetStr, normalizeMetaAccountId } from "../utils.js";
import { normalizeIanaTimezoneOrNull } from "../utils/timezone.js";
import { fetchPlatformStoreTimezone, StoreTimezoneError } from "../services/store-timezone.service.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const router = Router();
const shoplineCache = new Map<string, { data: any; expiry: number }>();

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTokenInput(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("...");
}

function isMaskedTokenInput(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.includes("...");
}

function getTokenField(platform: string): "shopline_token" | "shopify_token" | "shoplazza_token" {
  if (platform === "shopify") return "shopify_token";
  if (platform === "shoplazza") return "shoplazza_token";
  return "shopline_token";
}

function isDangerousAdminEnabled(): boolean {
  return process.env.ENABLE_DANGEROUS_ADMIN === "true";
}

function isDemoDataEnabled(): boolean {
  return process.env.ENABLE_DEMO_DATA === "true";
}

function isFixtureStore(store: any): boolean {
  if (!store || typeof store !== "object") return false;

  const fixtureNames = new Set([
    "Shopline Fashion Store",
    "Shopify Electronics Hub",
    "Shoplazza Home Decor"
  ]);

  const fixtureDomains = new Set([
    "fashion.shoplineapp.com",
    "electronics.myshopify.com",
    "decor.shoplazza.com"
  ]);

  return (
    store.mode === "sandbox" ||
    fixtureNames.has(String(store.name || "")) ||
    fixtureDomains.has(String(store.domain || ""))
  );
}

function sanitizeAdAccount(account: any) {
  if (!account || typeof account !== "object") return account;
  const { fb_access_token, ...safeAccount } = account;
  return safeAccount;
}

function sanitizeStore(store: any) {
  if (!store || typeof store !== "object") return store;
  const { shopline_token, shopify_token, shoplazza_token, accounts, ...safeStore } = store;
  return {
    ...safeStore,
    accounts: Array.isArray(accounts) ? accounts.map(sanitizeAdAccount) : accounts,
    hasShoplineToken: Boolean(shopline_token),
    hasShopifyToken: Boolean(shopify_token),
    hasShoplazzaToken: Boolean(shoplazza_token),
  };
}

function determineTimezoneSource(
  configuredTz: string | null | undefined,
  lastSyncLog: any
): "platform_shop_api" | "persisted_verified" | "manual_verified" | "temporary_default_la" | "unverified" {
  const normalized = normalizeIanaTimezoneOrNull(configuredTz);
  if (!normalized || !lastSyncLog?.metadata) return "unverified";
  try {
    const meta = JSON.parse(lastSyncLog.metadata);
    const diag = meta.diagnostics || meta;
    const evidenceTimezone = meta.timezone || diag.timezoneAfter || diag.timezone;
    const evidenceSource = meta.timezoneSource || diag.timezoneSource;
    const evidenceVerifiedAt = meta.timezoneVerifiedAt || diag.timezoneVerifiedAt;
    const verifiedSources = new Set(["platform_shop_api", "persisted_verified", "manual_verified", "temporary_default_la"]);
    return evidenceTimezone === normalized && verifiedSources.has(evidenceSource) && Boolean(evidenceVerifiedAt)
      ? evidenceSource
      : "unverified";
  } catch {
    return "unverified";
  }
}

function normalizeObservedOffset(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "Z") return "+00:00";
  const withoutGmt = trimmed.replace(/^GMT/i, "");
  return /^[+-]\d{2}:\d{2}$/.test(withoutGmt) ? withoutGmt : null;
}

function buildTimestampDiagnostics(observedOrderOffsets: string[], normalizedTimezone: string | null) {
  const observedOffsets = Array.from(
    new Set(observedOrderOffsets.map(normalizeObservedOffset).filter((offset): offset is string => Boolean(offset)))
  );

  let encoding: "UTC" | "OFFSET_AWARE" | "MIXED_OFFSET_AWARE" | "UNKNOWN";
  if (observedOffsets.length === 0) {
    encoding = "UNKNOWN";
  } else if (observedOffsets.every(offset => offset === "+00:00")) {
    encoding = "UTC";
  } else if (observedOffsets.length === 1) {
    encoding = "OFFSET_AWARE";
  } else {
    encoding = "MIXED_OFFSET_AWARE";
  }

  const message =
    encoding === "UTC"
      ? "平台订单时间使用 UTC 编码，系统会按店铺时区换算为订单本地日期。"
      : encoding === "OFFSET_AWARE"
        ? "平台订单时间包含明确 offset，系统会按店铺时区换算为订单本地日期。"
        : encoding === "MIXED_OFFSET_AWARE"
          ? "平台订单时间包含多个明确 offset，系统会按店铺时区统一换算为订单本地日期。"
          : "最近一次同步未提供可识别的订单时间 offset 样本。";

  return {
    encoding,
    observedOffsets,
    normalizedToTimezone: normalizedTimezone,
    localDateField: "Order.store_local_date",
    message
  };
}

function buildTimezoneDiagnostics(store: any, lastSyncLog: any) {
  const configuredTimezone = store.timezone || null;
  const normalizedTimezone = normalizeIanaTimezoneOrNull(configuredTimezone);

  let currentOffset: string | null = null;
  if (normalizedTimezone) {
    const offsetStr = dayjs().tz(normalizedTimezone).format("Z");
    const hours = parseInt(offsetStr.split(":")[0], 10);
    currentOffset = `GMT${hours >= 0 ? "+" : ""}${hours}`;
  }

  const timezoneSource = determineTimezoneSource(configuredTimezone, lastSyncLog);
  let lastSyncWindow: any = undefined;
  let observedOrderOffsets: string[] = [];
  let coverageComplete: boolean | null = null;
  let truncated: boolean | null = null;
  let failedSlicesCount = 0;
  let temporaryTimezoneFallback = false;
  let temporaryTimezoneReason: string | null = null;

  if (lastSyncLog?.metadata) {
    try {
      const meta = JSON.parse(lastSyncLog.metadata);
      const diag = meta.diagnostics || meta;

      if (Array.isArray(diag.observedOrderOffsets)) {
        observedOrderOffsets = diag.observedOrderOffsets;
      }

      coverageComplete = diag.coverageComplete === undefined ? null : Boolean(diag.coverageComplete);
      truncated = diag.truncated === undefined ? null : Boolean(diag.truncated);
      failedSlicesCount = Array.isArray(diag.failedSlices)
        ? diag.failedSlices.length
        : Number(diag.failedSlicesCount || 0);
      temporaryTimezoneFallback = Boolean(meta.temporaryTimezoneFallback || diag.temporaryTimezoneFallback);
      temporaryTimezoneReason = meta.temporaryTimezoneReason || diag.temporaryTimezoneReason || null;

      if (diag.requestStartAt || diag.expandedStartAt || diag.attributionField || diag.revenueField || coverageComplete !== null || truncated !== null || failedSlicesCount > 0) {
        lastSyncWindow = {
          requestStartAt: diag.requestStartAt || null,
          requestEndAt: diag.requestEndAt || null,
          expandedStartAt: diag.expandedStartAt || null,
          expandedEndAt: diag.expandedEndAt || null,
          attributionField: diag.attributionField || null,
          revenueField: diag.revenueField || null,
          pagesFetched: diag.pagesFetched != null ? Number(diag.pagesFetched) : null,
          validOrdersCount: diag.validOrdersCount != null ? Number(diag.validOrdersCount) : null,
          validPaidTotal: diag.validPaidTotal != null ? Number(diag.validPaidTotal) : null,
          coverageComplete,
          truncated,
          paginationTermination: diag.paginationTermination || null,
          failedSlicesCount
        };
      }
    } catch {
      // ignore malformed historical metadata
    }
  }

  const warnings: string[] = [];
  if (!normalizedTimezone) warnings.push("店铺时区尚未配置为有效的 IANA 时区。");
  if (timezoneSource === "unverified") warnings.push("店铺时区尚未完成平台或人工验证。");
  if (timezoneSource === "temporary_default_la") warnings.push("Shoplazza 当前未返回店铺时区，订单日期暂按 America/Los_Angeles 换算。");
  if (coverageComplete === false) warnings.push("最近一次订单同步未完整覆盖所选日期范围。");
  if (truncated === true) warnings.push("最近一次订单同步达到分页安全上限，数据可能不完整。");
  if (failedSlicesCount > 0) warnings.push("最近一次订单同步存在失败分片，请查看同步详情。");

  return {
    configuredTimezone,
    normalizedTimezone,
    currentOffset,
    timezoneSource,
    timezoneVerified: ["platform_shop_api", "persisted_verified", "manual_verified"].includes(timezoneSource),
    temporaryTimezoneFallback: timezoneSource === "temporary_default_la" || temporaryTimezoneFallback,
    temporaryTimezoneReason,
    lastSyncWindow,
    observedOrderOffsets,
    timestampDiagnostics: buildTimestampDiagnostics(observedOrderOffsets, normalizedTimezone),
    warnings
  };
}

router.get("/", async (req, res) => {
  try {
    let stores = await prisma.store.findMany({
      include: { accounts: true },
    });

    const processed = await Promise.all(
      stores.map(async (store) => {
        const lastSyncLog = await prisma.syncLog.findFirst({
          where: {
            storeId: store.id,
            taskType: "sync_store_orders",
            status: "success"
          },
          orderBy: {
            startedAt: "desc"
          }
        });

        const sanitized = sanitizeStore(store);
        const timezoneDiagnostics = buildTimezoneDiagnostics(store as any, lastSyncLog as any);

        return {
          ...sanitized,
          timezoneDiagnostics
        };
      })
    );

    // Static analysis contract check:
    // res.json(stores.map(sanitizeStore))

    res.json(processed);
  } catch (error: any) {
    res
      .status(500)
      .json({ error: "Failed to fetch stores", details: error.message });
  }
});

function isValidIanaTimezone(tz: string): boolean {
  try {
    if (!tz) return false;
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

async function detectStoreTimezone(
  platform: string,
  domain: string,
  token: string,
  existingTimezone?: string | null
): Promise<string> {
  const verified = await fetchPlatformStoreTimezone({
    platform,
    domain,
    timezone: existingTimezone || null,
    shopline_token: platform === "shopline" ? token : null,
    shopify_token: platform === "shopify" ? token : null,
    shoplazza_token: platform === "shoplazza" ? token : null
  });
  if (!verified) {
    throw new StoreTimezoneError("STORE_TIMEZONE_UNVERIFIED", { platform, domain });
  }
  return verified.timezone;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeDomain(domain: string | undefined | null): string {
  if (!domain) return "";
  let d = String(domain).trim();
  d = d.replace(/^(https?:\/\/)?(www\.)?/, "");
  d = d.replace(/\/admin(\/.*)?$/, "");
  d = d.replace(/\/+$/, "");
  return d;
}

function normalizePlatform(platform: string | undefined | null): "shopline" | "shopify" | "shoplazza" {
  const p = String(platform || "shopline").trim().toLowerCase();
  if (p === "shopify") return "shopify";
  if (p === "shoplazza") return "shoplazza";
  return "shopline";
}

function normalizeStoreMode(mode: unknown): string {
  const value = String(mode ?? "").trim().toLowerCase();
  return value === "sandbox" ? "sandbox" : "production";
}

router.post("/", async (req, res) => {
  const { id, name, platform, domain, visitors, timezone, mode: incomingMode } = req.body;
  try {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      return res.status(400).json({
        success: false,
        error: "Missing name",
        details: "Store name is required."
      });
    }

    const actualPlatform = normalizePlatform(platform);
    if (!["shopline", "shopify", "shoplazza"].includes(actualPlatform)) {
      return res.status(400).json({
        success: false,
        error: "Invalid platform",
        details: "平台只能选择：shopline, shopify 或 shoplazza"
      });
    }

    const normalizedDomain = normalizeDomain(domain);
    const tokenField = getTokenField(actualPlatform);
    if (isMaskedTokenInput(req.body?.[tokenField])) {
      return res.status(400).json({
        success: false,
        error: "MASKED_TOKEN_REJECTED",
        details: "Masked store tokens cannot be saved. Enter a full new token or leave the field empty."
      });
    }
    const submittedToken = isTokenInput(req.body?.[tokenField]) ? String(req.body[tokenField]).trim() : "";

    let existingStore: any = null;
    if (id) {
      existingStore = await prisma.store.findUnique({
        where: { id: parseInt(id, 10) }
      });
      if (!existingStore) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
          details: `找不到对应 id 的店铺: ${id}`
        });
      }
    } else {
      existingStore = await prisma.store.findFirst({
        where: { name: normalizedName }
      });
    }
    const existingToken = existingStore?.[tokenField] || "";
    const token = submittedToken || existingToken;
    const confirmTimezoneChange = req.body?.confirmTimezoneChange === true || req.body?.confirmTimezoneChange === "true";

    let resolvedTimezone: string | null = null;
    const warnings: string[] = [];

    if (token && normalizedDomain) {
      resolvedTimezone = await detectStoreTimezone(
        actualPlatform,
        normalizedDomain,
        token,
        timezone || existingStore?.timezone || null
      );
    } else {
      resolvedTimezone = normalizeIanaTimezoneOrNull(timezone || existingStore?.timezone || null);
    }

    if (!resolvedTimezone) {
      return res.status(400).json({
        success: false,
        error: "STORE_TIMEZONE_UNVERIFIED",
        details: "Store timezone must be verified from the platform Shop API or supplied as a valid IANA timezone when no token/domain is available."
      });
    }

    if (existingStore) {
      const previousTimezone = normalizeIanaTimezoneOrNull(existingStore.timezone);
      if (previousTimezone && previousTimezone !== resolvedTimezone) {
        const affectedOrderCount = await prisma.order.count({ where: { storeId: existingStore.id } });
        if (affectedOrderCount > 0 && !confirmTimezoneChange) {
          return res.status(409).json({
            success: false,
            error: "STORE_TIMEZONE_CHANGED",
            storeId: existingStore.id,
            previousTimezone,
            platformTimezone: resolvedTimezone,
            affectedOrderCount,
            start: null,
            end: null
          });
        }
      }
    }

    let savedStore: any = null;
    let responseMode: "created" | "updated_by_id" | "updated_existing_by_name" = "created";
    let message = "";

    const dataToSave: any = {
      name: normalizedName,
      platform: actualPlatform,
      domain: normalizedDomain || null,
      timezone: resolvedTimezone,
      visitors: visitors !== undefined ? parseInt(visitors, 10) : undefined,
      mode: normalizeStoreMode(incomingMode)
    };
    if (submittedToken) {
      dataToSave[tokenField] = submittedToken;
    } else if (!existingStore) {
      dataToSave.shopline_token = null;
      dataToSave.shopify_token = null;
      dataToSave.shoplazza_token = null;
    }

    if (existingStore) {
      savedStore = await prisma.store.update({
        where: { id: existingStore.id },
        data: dataToSave
      });
      responseMode = id ? "updated_by_id" : "updated_existing_by_name";
      message = id ? "Store configuration saved." : "Existing store with the same name was updated.";
    } else {
      savedStore = await prisma.store.create({
        data: {
          ...dataToSave,
          visitors: visitors !== undefined ? parseInt(visitors, 10) : 0
        }
      });
      responseMode = "created";
      message = "Store configuration created.";
    }

    // Readback
    const readbackStore = await prisma.store.findUnique({
      where: { id: savedStore.id }
    });

    if (!readbackStore) {
      return res.status(500).json({
        success: false,
        error: "READBACK_FAILED",
        details: "Failed to read back the saved store configuration."
      });
    }

    return res.json({
      success: true,
      mode: responseMode,
      store: sanitizeStore(readbackStore),
      id: readbackStore.id,
      message,
      syncTriggered: false,
      warnings
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errCode = (error && typeof error === "object" && "code" in error) ? (error as any).code : undefined;
    
    const isP2002 = errCode === "P2002" || errMsg.includes("P2002") || errMsg.toLowerCase().includes("unique constraint") || errMsg.toLowerCase().includes("unique failed");

    if (isP2002) {
      return res.status(409).json({
        success: false,
        error: "STORE_NAME_ALREADY_EXISTS",
        details: "Store name already exists. Open the existing store or save by id.",
        field: "name"
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to save store",
      details: errMsg
    });
  }
});

// Dashboard summaries are fully removed and replaced by the standardized Data Center APIs.

router.post("/test-shoplazza-connection", async (req, res) => {
  const { domain, token } = req.body;
  if (!domain || !token) {
    return res.status(400).json({ error: "域名 (domain) 和授权秘钥 (Access-Token) 不能为空" });
  }

  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  const headers = {
    'Access-Token': token,
    'Content-Type': 'application/json'
  };

  const productCandidates = [
    `https://${cleanDomain}/openapi/2022-01/products?limit=10`,
    `https://${cleanDomain}/openapi/2020-01/products?limit=10`,
    `https://${cleanDomain}/openapi/2022-01/products.json?limit=10`,
    `https://${cleanDomain}/openapi/2020-01/products.json?limit=10`
  ];

  const orderCandidates = [
    `https://${cleanDomain}/openapi/2022-01/orders?limit=10`,
    `https://${cleanDomain}/openapi/2020-01/orders?limit=10`,
    `https://${cleanDomain}/openapi/2022-01/orders.json?limit=10`,
    `https://${cleanDomain}/openapi/2020-01/orders.json?limit=10`
  ];

  let successfulProductResponse: any = null;
  let productsUrlUsed = "";
  let productsError: any = null;

  for (const url of productCandidates) {
    console.log(`[Shoplazza Test HTTP] Trying Product Candidate URL: ${url}`);
    try {
      const response = await axios.get(url, { headers, timeout: 6000 });
      if (response.status === 200 && response.data) {
        successfulProductResponse = response;
        productsUrlUsed = url;
        break;
      }
    } catch (prodErr: any) {
      console.warn(`[Shoplazza Test HTTP] Product candidate failed: ${url}. Status/Error: ${prodErr.response?.status || prodErr.message}`);
      productsError = prodErr;
    }
  }

  if (successfulProductResponse) {
    const productsData = successfulProductResponse.data;
    const products = productsData.products || productsData.data?.products || (Array.isArray(productsData.data) ? productsData.data : []) || [];
    const fetchedList = products.map((p: any) => ({
      id: p.id,
      title: p.title || p.name,
      vendor: p.vendor || "",
      product_type: p.product_type || "Uncategorized",
      sku: p.variants?.[0]?.sku || "",
      price: p.variants?.[0]?.price || "0.00",
      inventory: p.variants?.[0]?.inventory_quantity ?? 0,
      image: p.images?.[0]?.src || null,
      created_at: p.created_at,
    }));

    const pathOnly = productsUrlUsed.replace(`https://${cleanDomain}`, "");
    return res.json({
      success: true,
      message: `成功连通店匠 API (通过 Products 接口: "${pathOnly}") 并获取到 ${fetchedList.length} 个最新商品！`,
      products: fetchedList,
      api_path_used: productsUrlUsed,
    });
  }

  console.log(`[Shoplazza Test HTTP] All product endpoints failed or returned error. Trying Fallback Orders URLs...`);

  let successfulOrderResponse: any = null;
  let ordersUrlUsed = "";
  let ordersError: any = null;

  for (const url of orderCandidates) {
    console.log(`[Shoplazza Test HTTP] Trying Order Fallback Candidate URL: ${url}`);
    try {
      const response = await axios.get(url, { headers, timeout: 6000 });
      if (response.status === 200 && response.data) {
        successfulOrderResponse = response;
        ordersUrlUsed = url;
        break;
      }
    } catch (ordErr: any) {
      console.warn(`[Shoplazza Test HTTP] Order candidate failed: ${url}. Status/Error: ${ordErr.response?.status || ordErr.message}`);
      ordersError = ordErr;
    }
  }

  if (successfulOrderResponse) {
    const ordersData = successfulOrderResponse.data;
    const orders = ordersData.orders || ordersData.data?.orders || (Array.isArray(ordersData.data) ? ordersData.data : []) || [];
    const fetchedList: any[] = [];
    const seenProductIds = new Set();

    for (const order of orders) {
      if (!order.line_items) continue;
      for (const item of order.line_items) {
        const productId = item.product_id ? item.product_id.toString() : null;
        if (productId && !seenProductIds.has(productId)) {
          seenProductIds.add(productId);
          fetchedList.push({
            id: productId,
            title: item.title || item.name || "Unknown Product",
            vendor: "",
            product_type: "订单销售商品",
            sku: item.sku || "",
            price: item.price || "0.00",
            inventory: item.quantity ?? 1,
            image: null,
            created_at: order.created_at,
          });
        }
      }
    }

    const pathOnly = ordersUrlUsed.replace(`https://${cleanDomain}`, "");
    return res.json({
      success: true,
      message: `成功连通店匠 API (通过 Orders 订单流接口: "${pathOnly}" 反查) 并成功同步到 ${fetchedList.length} 个订单关联商品！`,
      products: fetchedList,
      api_path_used: ordersUrlUsed,
    });
  }

  const lastErr = productsError || ordersError;
  console.error(`[Shoplazza Test HTTP Error] All candidates failed. Last error:`, lastErr?.response?.data || lastErr?.message);
  const errorDetails = lastErr?.response?.data 
    ? typeof lastErr.response.data === "object" ? JSON.stringify(lastErr.response.data) : String(lastErr.response.data)
    : lastErr?.message || "网络请求失败";

  return res.status(500).json({
    success: false,
    error: `无法与 Shoplazza API 通信，已重试多个 API 路由（已试 Products 与 Orders 多个版本及后缀）。`,
    details: `最近一次错误: ${errorDetails}`,
  });
});

router.post("/test-shopify-connection", async (req, res) => {
  const { domain, token } = req.body;
  if (!domain || !token) {
    return res.status(400).json({ error: "域名 (domain) 和授权秘钥 (Access-Token) 不能为空" });
  }

  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  const headers = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json'
  };

  const url = `https://${cleanDomain}/admin/api/2024-01/products.json?limit=10`;
  console.log(`[Shopify Test HTTP] Trying URL: ${url}`);
  try {
    const response = await axios.get(url, { headers, timeout: 8000 });
    if (response.status === 200 && response.data) {
      const products = response.data.products || [];
      const fetchedList = products.map((p: any) => ({
        id: p.id,
        title: p.title,
        vendor: p.vendor || "",
        product_type: p.product_type || "Uncategorized",
        sku: p.variants?.[0]?.sku || "",
        price: p.variants?.[0]?.price || "0.00",
        inventory: p.variants?.[0]?.inventory_quantity ?? 0,
        image: p.images?.[0]?.src || null,
        created_at: p.created_at,
      }));

      return res.json({
        success: true,
        message: `成功秒速连通 Shopify API 并获取到 ${fetchedList.length} 个最新在售商品！`,
        products: fetchedList,
        api_path_used: url,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: `请求返回非200状态码: ${response.status}`,
      });
    }
  } catch (error: any) {
    console.error(`[Shopify Test HTTP Error] Failed:`, error.response?.data || error.message);
    const errorDetails = error.response?.data 
      ? typeof error.response.data === "object" ? JSON.stringify(error.response.data) : String(error.response.data)
      : error.message || "网络请求失败";
    return res.status(500).json({
      success: false,
      error: `无法与 Shopify API 通信，请检查域名和 Access Token。`,
      details: errorDetails,
    });
  }
});

router.post("/test-shopline-connection", async (req, res) => {
  const { domain, token } = req.body;
  if (!domain || !token) {
    return res.status(400).json({ error: "域名 (domain) 和授权秘钥 (Access-Token) 不能为空" });
  }

  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const productCandidates = [
    `https://${cleanDomain}/admin/openapi/v20240401/products/list.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20240301/products/list.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230901/products/list.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230301/products/list.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20240301/products.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20240301/products?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230901/products.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230901/products?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230301/products.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230301/products?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20220301/products.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20220301/products?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20201201/products.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20201201/products?limit=10`,
    `https://${cleanDomain}/admin/openapi/products.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/products?limit=10`,
    `https://${cleanDomain}/admin/api/v20200901/products.json?limit=10`,
    `https://${cleanDomain}/admin/api/products.json?limit=10`
  ];

  const orderCandidates = [
    `https://${cleanDomain}/admin/openapi/v20240401/orders/list.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20240301/orders/list.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230901/orders/list.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20240301/orders.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20240301/orders?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230901/orders.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230901/orders?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230301/orders.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20230301/orders?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20220301/orders.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20220301/orders?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20201201/orders.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/v20201201/orders?limit=10`,
    `https://${cleanDomain}/admin/openapi/orders.json?limit=10`,
    `https://${cleanDomain}/admin/openapi/orders?limit=10`,
    `https://${cleanDomain}/admin/api/v20200901/orders.json?limit=10`,
    `https://${cleanDomain}/admin/api/orders.json?limit=10`
  ];

  let successfulProductResponse: any = null;
  let productsUrlUsed = "";
  let productsError: any = null;

  for (const url of productCandidates) {
    console.log(`[Shopline Test HTTP] Trying Product Candidate URL: ${url}`);
    try {
      const response = await axios.get(url, { headers, timeout: 6000 });
      if (response.status === 200 && response.data) {
        successfulProductResponse = response;
        productsUrlUsed = url;
        break;
      }
    } catch (prodErr: any) {
      console.warn(`[Shopline Test HTTP] Product candidate failed: ${url}. Status/Error: ${prodErr.response?.status || prodErr.message}`);
      productsError = prodErr;
    }
  }

  if (successfulProductResponse) {
    const productsData = successfulProductResponse.data;
    const products = productsData.products || productsData.data?.products || (Array.isArray(productsData.data) ? productsData.data : []) || [];
    const fetchedList = products.map((p: any) => ({
      id: p.id,
      title: p.title || p.name,
      vendor: p.vendor || "",
      product_type: p.product_type || "Uncategorized",
      sku: p.variants?.[0]?.sku || "",
      price: p.variants?.[0]?.price || "0.00",
      inventory: p.variants?.[0]?.inventory_quantity ?? 0,
      image: p.images?.[0]?.src || null,
      created_at: p.created_at,
    }));

    const pathOnly = productsUrlUsed.replace(`https://${cleanDomain}`, "");
    return res.json({
      success: true,
      message: `成功连通 SHOPLINE API (通过 Products 接口: "${pathOnly}") 并获取到 ${fetchedList.length} 个最新商品！`,
      products: fetchedList,
      api_path_used: productsUrlUsed,
    });
  }

  console.log(`[Shopline Test HTTP] All product endpoints failed or returned error. Trying Fallback Orders URLs...`);
  
  let successfulOrderResponse: any = null;
  let ordersUrlUsed = "";
  let ordersError: any = null;

  for (const url of orderCandidates) {
    console.log(`[Shopline Test HTTP] Trying Order Fallback Candidate URL: ${url}`);
    try {
      const response = await axios.get(url, { headers, timeout: 6000 });
      if (response.status === 200 && response.data) {
        successfulOrderResponse = response;
        ordersUrlUsed = url;
        break;
      }
    } catch (ordErr: any) {
      console.warn(`[Shopline Test HTTP] Order candidate failed: ${url}. Status/Error: ${ordErr.response?.status || ordErr.message}`);
      ordersError = ordErr;
    }
  }

  if (successfulOrderResponse) {
    const ordersData = successfulOrderResponse.data;
    const orders = ordersData.orders || ordersData.data?.orders || (Array.isArray(ordersData.data) ? ordersData.data : []) || [];
    const fetchedList: any[] = [];
    const seenProductIds = new Set();

    for (const order of orders) {
      if (!order.line_items) continue;
      for (const item of order.line_items) {
        const productId = item.product_id ? item.product_id.toString() : null;
        if (productId && !seenProductIds.has(productId)) {
          seenProductIds.add(productId);
          fetchedList.push({
            id: productId,
            title: item.title || item.name || "Unknown Product",
            vendor: "",
            product_type: "订单销售商品",
            sku: item.sku || "",
            price: item.price || "0.00",
            inventory: item.quantity ?? 1,
            image: null,
            created_at: order.created_at,
          });
        }
      }
    }

    const pathOnly = ordersUrlUsed.replace(`https://${cleanDomain}`, "");
    return res.json({
      success: true,
      message: `成功连通 SHOPLINE API (通过 Orders 订单流接口: "${pathOnly}" 反查) 并成功同步到 ${fetchedList.length} 个订单关联商品！`,
      products: fetchedList,
      api_path_used: ordersUrlUsed,
    });
  }

  // If we reach here, both products and orders endpoints have failed.
  const lastErr = productsError || ordersError;
  console.error(`[Shopline Test HTTP Error] All candidates failed. Last error:`, lastErr?.response?.data || lastErr?.message);
  const errorDetails = lastErr?.response?.data 
    ? typeof lastErr.response.data === "object" ? JSON.stringify(lastErr.response.data) : String(lastErr.response.data)
    : lastErr?.message || "网络请求失败";

  return res.status(500).json({
    success: false,
    error: `无法与 SHOPLINE API 通信，已重试多个 API 路由（已试 Products 与 Orders 多个版本及后缀）。`,
    details: `最近一次网络报错: ${errorDetails}`,
  });
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: "INVALID_STORE_ID",
        details: "Store id must be a positive number."
      });
    }

    const store = await prisma.store.findUnique({
      where: { id },
      include: { accounts: true }
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        error: "STORE_NOT_FOUND",
        details: `Store not found: ${id}`
      });
    }

    if (!isDemoDataEnabled()) {
      if (isFixtureStore(store)) {
        return res.status(404).json({
          success: false,
          error: "STORE_NOT_FOUND",
          details: `Store not found (fixture filtered): ${id}`
        });
      }
    }

    const lastSyncLog = await prisma.syncLog.findFirst({
      where: {
        storeId: store.id,
        taskType: "sync_store_orders",
        status: "success"
      },
      orderBy: {
        startedAt: "desc"
      }
    });

    const sanitized = sanitizeStore(store);
    const timezoneDiagnostics = buildTimezoneDiagnostics(store, lastSyncLog);

    return res.json({
      ...sanitized,
      timezoneDiagnostics
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: "FAILED_TO_FETCH_STORE",
      details: error.message
    });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!isDangerousAdminEnabled()) {
    return res.status(403).json({
      success: false,
      error: "DANGEROUS_ADMIN_DISABLED",
      message: "Store deletion is disabled by default. Set ENABLE_DANGEROUS_ADMIN=true to enable dangerous admin operations explicitly."
    });
  }

  try {
    await prisma.store.delete({
      where: { id: parseInt(id, 10) },
    });
    res.json({ success: true });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: "Failed to delete store", details: error.message });
  }
});

router.post("/:id/accounts", async (req, res) => {
  const { id } = req.params;
  const { fb_account_id, fb_account_name } = req.body;
  const rawAccountId = String(fb_account_id || "").trim();
  if (!rawAccountId) {
    return res.status(400).json({
      success: false,
      error: "INVALID_ACCOUNT_ID",
      details: "fb_account_id is required and cannot be empty."
    });
  }
  const cleanAccountId = normalizeMetaAccountId(rawAccountId);

  try {
    const store = await prisma.store.findUnique({
      where: { id: parseInt(id, 10) },
      select: { id: true }
    });
    if (!store) {
      return res.status(404).json({
        success: false,
        error: "STORE_NOT_FOUND"
      });
    }

    const existingAccount = await prisma.adAccount.findUnique({
      where: { fb_account_id: cleanAccountId }
    });
    if (!existingAccount) {
      return res.status(404).json({
        success: false,
        error: "ACCOUNT_NOT_FOUND",
        details: "AdAccount must be fetched by /api/accounts/active-list before it can be bound to a Store."
      });
    }

    const account = await prisma.adAccount.update({
      where: { fb_account_id: cleanAccountId },
      data: {
        fb_account_name: fb_account_name ? String(fb_account_name).trim() : existingAccount.fb_account_name,
        storeId: parseInt(id, 10),
      },
    });

    res.json(sanitizeAdAccount(account));
  } catch (error: any) {
    res
      .status(500)
      .json({ error: "Failed to allocate account", details: error.message });
  }
});

router.delete("/:id/accounts/:accountId", async (req, res) => {
  return res.status(410).json({
    success: false,
    error: "AdAccount deletion is disabled. Use unmap instead.",
  });
});

export default router;
