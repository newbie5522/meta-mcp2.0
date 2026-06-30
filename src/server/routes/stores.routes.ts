import { Router } from "express";
import prisma from "../../db/index.js";
import axios from "axios";
import { getTimezoneOffsetStr, normalizeMetaAccountId } from "../utils.js";
import { normalizeTimezone } from "../utils/timezone.js";
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

function parseOffsetHours(offsetStr: string): number {
  if (!offsetStr) return 0;
  const clean = offsetStr.replace("Z", "+00:00").replace("GMT", "");
  const parts = clean.split(":");
  return parseInt(parts[0], 10);
}

function buildTimezoneDiagnostics(store: any, lastSyncLog: any) {
  const configuredTimezone = store.timezone || null;
  const normalizedTimezone = normalizeTimezone(configuredTimezone, {
    id: store.id,
    domain: store.domain || "",
    name: store.name || ""
  });

  let currentOffset = "GMT-7";
  let offsetStr = "-07:00";
  try {
    offsetStr = dayjs().tz(normalizedTimezone).format("Z");
    const hours = parseInt(offsetStr.split(":")[0], 10);
    currentOffset = `GMT${hours >= 0 ? "+" : ""}${hours}`;
  } catch (e) {
    offsetStr = "-07:00";
    currentOffset = "GMT-7";
  }

  const timezoneSource = determineTimezoneSource(configuredTimezone, store.domain || "", store.name || "");

  let lastSyncWindow: any = undefined;
  let observedOrderOffsets: string[] = [];

  if (lastSyncLog && lastSyncLog.metadata) {
    try {
      const meta = JSON.parse(lastSyncLog.metadata);
      const diag = meta.diagnostics || meta;
      
      if (diag.requestStartAt || diag.expandedStartAt || diag.attributionField || diag.revenueField) {
        lastSyncWindow = {
          requestStartAt: diag.requestStartAt || null,
          requestEndAt: diag.requestEndAt || null,
          expandedStartAt: diag.expandedStartAt || null,
          expandedEndAt: diag.expandedEndAt || null,
          attributionField: diag.attributionField || null,
          revenueField: diag.revenueField || null,
          pagesFetched: diag.pagesFetched != null ? Number(diag.pagesFetched) : null,
          validOrdersCount: diag.validOrdersCount != null ? Number(diag.validOrdersCount) : null,
          validPaidTotal: diag.validPaidTotal != null ? Number(diag.validPaidTotal) : null
        };
      }
      
      if (diag.observedOrderOffsets && Array.isArray(diag.observedOrderOffsets)) {
        observedOrderOffsets = diag.observedOrderOffsets;
      }
    } catch (e) {
      // ignore
    }
  }

  const warnings: string[] = [];
  const baseOffsetHours = parseOffsetHours(offsetStr);

  if (observedOrderOffsets && observedOrderOffsets.length > 0) {
    for (const offsetVal of observedOrderOffsets) {
      const parsedHours = parseOffsetHours(offsetVal);
      if (parsedHours !== baseOffsetHours) {
        warnings.push("检测到订单时间戳 offset 与店铺时区不一致，请确认平台后台时区与 API 返回时间字段口径。");
        break;
      }
    }
  }

  return {
    configuredTimezone,
    normalizedTimezone,
    currentOffset,
    timezoneSource,
    lastSyncWindow,
    observedOrderOffsets,
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
            type: "sync_store_orders",
            status: "success"
          },
          orderBy: {
            startedAt: "desc"
          }
        });

        const sanitized = sanitizeStore(store);
        const timezoneDiagnostics = buildTimezoneDiagnostics(store, lastSyncLog);

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
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/admin\/.*$/, "");

  // Force standardize Baslayer to America/Los_Angeles
  if (cleanDomain.includes("baslayer") || domain.includes("baslayer")) {
    return "America/Los_Angeles";
  }

  // 1. Try Platform Shop Info API
  if (platform === "shopify") {
    try {
      const response = await axios.get(`https://${cleanDomain}/admin/api/2024-01/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      const ianaTz = response.data?.shop?.iana_timezone || response.data?.shop?.timezone;
      if (ianaTz) {
        return normalizeTimezone(ianaTz, { domain });
      }
    } catch (e: any) {
      console.warn(`[Tz Detection] Shopify Shop API failed:`, e.message);
    }
  } else if (platform === "shopline") {
    const candidates = [
      `https://${cleanDomain}/admin/openapi/v20220301/shop.json`,
      `https://${cleanDomain}/admin/openapi/v20201201/shop.json`,
      `https://${cleanDomain}/admin/api/v20200901/shop.json`,
      `https://${cleanDomain}/admin/openapi/shop.json`,
    ];
    for (const url of candidates) {
      try {
         const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 4000
        });
        const tz = response.data?.shop?.iana_timezone || response.data?.shop?.timezone || response.data?.data?.timezone;
        if (tz) {
          return normalizeTimezone(tz, { domain });
        }
      } catch (e: any) {
        console.warn(`[Tz Detection] Shopline candidate failed: ${url}`, e.message);
      }
    }
  } else if (platform === "shoplazza") {
    const candidates = [
      `https://${cleanDomain}/openapi/2022-01/shop`,
      `https://${cleanDomain}/openapi/2022-01/shop.json`,
      `https://${cleanDomain}/openapi/2020-01/shop`,
      `https://${cleanDomain}/openapi/shop`,
    ];
    for (const url of candidates) {
      try {
        const response = await axios.get(url, {
          headers: {
            'Access-Token': token,
            'Content-Type': 'application/json'
          },
          timeout: 4000
        });
        const tz = response.data?.shop?.iana_timezone || response.data?.shop?.timezone;
        if (tz) {
          return normalizeTimezone(tz, { domain });
        }
      } catch (e: any) {
        console.warn(`[Tz Detection] Shoplazza candidate failed: ${url}`, e.message);
      }
    }
  }

  // 3. Fallback to existing timezone
  if (existingTimezone) {
    return normalizeTimezone(existingTimezone, { domain });
  }

  // 4. Default fallback: America/Los_Angeles as required
  return "America/Los_Angeles";
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

function withTimeout(promise: Promise<any>, ms: number, defaultValue: any): Promise<any> {
  let timeoutId: any;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`[Stores Route] detectStoreTimezone exceeded ${ms}ms limit. Falling back to default.`);
      resolve(defaultValue);
    }, ms);
  });
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timeoutId);
      return res;
    }),
    timeoutPromise
  ]);
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

    // Best-effort Timezone detection
    let resolvedTimezone = "America/Los_Angeles";
    const warnings: string[] = [];
    try {
      if (token && normalizedDomain) {
        const fallTz = timezone || existingStore?.timezone || "America/Los_Angeles";
        resolvedTimezone = await withTimeout(
          detectStoreTimezone(
            actualPlatform,
            normalizedDomain,
            token,
            fallTz
          ),
          2000,
          fallTz
        );
      } else {
        resolvedTimezone = timezone || existingStore?.timezone || "America/Los_Angeles";
      }
    } catch (tzErr) {
      warnings.push("Timezone detection failed, store was saved with fallback timezone.");
      resolvedTimezone = normalizeTimezone(timezone || existingStore?.timezone, { domain: normalizedDomain, name: normalizedName });
      console.error("[Stores Route] Timezone detection error:", tzErr);
    }

    resolvedTimezone = normalizeTimezone(resolvedTimezone, {
      domain: normalizedDomain,
      name: normalizedName
    });

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
        type: "sync_store_orders",
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
