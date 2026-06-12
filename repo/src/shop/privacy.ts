import { z } from "zod";

const PRIVATE_FIELD_NAMES = new Set([
  "name",
  "first_name",
  "last_name",
  "customer_name",
  "contact_name",
  "full_name",
  "email",
  "customer_email",
  "contact_email",
  "phone",
  "customer_phone",
  "contact_phone",
  "telephone",
  "mobile",
  "address",
  "address1",
  "address2",
  "street",
  "street_address",
  "zip",
  "zipcode",
  "postal_code",
  "customer",
  "billing_address",
  "shipping_address",
]);

const CUSTOMER_PRIVATE_FIELD_NAMES = new Set([
  "first_name",
  "last_name",
  "customer_name",
  "contact_name",
  "full_name",
  "email",
  "customer_email",
  "contact_email",
  "phone",
  "customer_phone",
  "contact_phone",
  "telephone",
  "mobile",
  "address",
  "address1",
  "address2",
  "street",
  "street_address",
  "zip",
  "zipcode",
  "postal_code",
  "customer",
  "billing_address",
  "shipping_address",
]);

const SAFE_ORDER_KEYS = [
  "id",
  "order_id",
  "orderId",
  "order_number",
  "orderNumber",
  "order_no",
  "orderNo",
  "number",
  "created_at",
  "createdAt",
  "created_time",
  "placed_at",
  "processed_at",
  "country",
  "country_code",
  "province",
  "province_code",
  "city",
  "currency",
  "currency_code",
  "presentment_currency",
  "total_amount",
  "totalAmount",
  "total_price",
  "current_total_price",
  "total",
  "subtotal_amount",
  "subtotalAmount",
  "subtotal_price",
  "current_subtotal_price",
  "sub_total",
  "discount_amount",
  "discountAmount",
  "total_discounts",
  "current_total_discounts",
  "shipping_amount",
  "shippingAmount",
  "total_shipping_price",
  "shipping_total",
  "payment_status",
  "paymentStatus",
  "financial_status",
  "payment_status_name",
  "fulfillment_status",
  "fulfillmentStatus",
  "shipping_status",
  "source_name",
  "sourceName",
  "source",
  "landing_page",
  "landingPage",
  "landing_site",
  "last_landing_url",
  "landing_page_url",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
] as const;

const SAFE_ORDER_ITEM_KEYS = [
  "product_id",
  "productId",
  "product_name",
  "productName",
  "product_title",
  "name",
  "title",
  "variant_id",
  "variantId",
  "sku",
  "sku_code",
  "quantity",
  "price",
  "unit_price",
  "sale_price",
  "total_price",
  "totalPrice",
  "line_price",
  "linePrice",
] as const;

export interface NormalizedOrderItem {
  productId?: string;
  productName?: string;
  variantId?: string;
  sku?: string;
  quantity: number;
  price?: number;
  totalPrice?: number;
}

export interface NormalizedOrder {
  platformOrderId: string;
  orderNumber?: string;
  createdAt: Date;
  country?: string;
  province?: string;
  city?: string;
  currency?: string;
  totalAmount?: number;
  subtotalAmount?: number;
  discountAmount?: number;
  shippingAmount?: number;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  sourceName?: string;
  landingPage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  items: NormalizedOrderItem[];
}

const rawRecordSchema = z.record(z.unknown());

function asRecord(value: unknown): Record<string, unknown> {
  return rawRecordSchema.catch({}).parse(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asDate(value: unknown): Date | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function nestedString(record: Record<string, unknown>, path: string[]): string | undefined {
  let cursor: unknown = record;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return asString(cursor);
}

function parseQueryValue(url: string | undefined, key: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, "https://example.invalid");
    return parsed.searchParams.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function lineItems(raw: Record<string, unknown>): unknown[] {
  const candidates = [raw.line_items, raw.items, raw.products, raw.order_items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickKeys(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) output[key] = record[key];
  }
  return output;
}

function safeAddressFields(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return pickKeys(record, ["country", "country_code", "province", "province_code", "city"]);
}

function assignIfMissing(output: Record<string, unknown>, key: string, value: unknown): void {
  if (output[key] === undefined && value !== undefined) {
    output[key] = value;
  }
}

export function sanitizeShopOrderPayload(rawOrder: unknown, platform?: "shopline" | "shoplazza" | "shopify"): Record<string, unknown> {
  const order = asRecord(rawOrder);
  const sanitized = pickKeys(order, SAFE_ORDER_KEYS);
  if (platform === "shopline") {
    assignIfMissing(sanitized, "order_number", order.name);
  }
  const shippingAddress = safeAddressFields(order.shipping_address);
  const billingAddress = safeAddressFields(order.billing_address);

  assignIfMissing(sanitized, "country", order.country ?? order.country_code ?? shippingAddress.country_code ?? shippingAddress.country ?? billingAddress.country_code ?? billingAddress.country);
  assignIfMissing(sanitized, "province", order.province ?? order.province_code ?? shippingAddress.province ?? shippingAddress.province_code ?? billingAddress.province ?? billingAddress.province_code);
  assignIfMissing(sanitized, "city", order.city ?? shippingAddress.city ?? billingAddress.city);

  const items = lineItems(order)
    .map((item) => pickKeys(asRecord(item), SAFE_ORDER_ITEM_KEYS))
    .filter((item) => Object.keys(item).length > 0);
  if (items.length > 0) sanitized.line_items = items;

  return sanitized;
}

function normalizeOrderItem(rawItem: unknown): NormalizedOrderItem {
  const item = asRecord(rawItem);
  const quantity = asNumber(item.quantity) ?? 0;
  const price = asNumber(item.price ?? item.unit_price ?? item.sale_price);
  return {
    productId: asString(item.product_id ?? item.productId),
    productName: asString(item.product_name ?? item.productName ?? item.product_title ?? item.name ?? item.title),
    variantId: asString(item.variant_id ?? item.variantId),
    sku: asString(item.sku ?? item.sku_code),
    quantity,
    price,
    totalPrice: asNumber(item.total_price ?? item.totalPrice ?? item.line_price ?? item.linePrice) ?? (price !== undefined ? price * quantity : undefined),
  };
}

export function normalizeShopOrder(rawOrder: unknown): NormalizedOrder {
  const order = asRecord(rawOrder);
  const platformOrderId = asString(order.id ?? order.order_id ?? order.orderId ?? order.order_no ?? order.orderNo ?? order.order_number ?? order.orderNumber);
  if (!platformOrderId) {
    throw new Error("Order payload missing id/order_id");
  }

  const createdAt = asDate(order.placed_at ?? order.created_at ?? order.createdAt ?? order.created_time ?? order.processed_at);
  if (!createdAt) {
    throw new Error(`Order ${platformOrderId} missing valid created_at`);
  }

  const landingPage = asString(order.last_landing_url ?? order.landing_page ?? order.landingPage ?? order.landing_site ?? order.landing_page_url)
    ?? (asString(order.source)?.startsWith("http") ? asString(order.source) : undefined);
  const country =
    asString(order.country ?? order.country_code) ??
    nestedString(order, ["shipping_address", "country_code"]) ??
    nestedString(order, ["shipping_address", "country"]) ??
    nestedString(order, ["billing_address", "country_code"]) ??
    nestedString(order, ["billing_address", "country"]);

  return {
    platformOrderId,
    orderNumber: asString(order.order_number ?? order.orderNumber ?? order.order_no ?? order.orderNo ?? order.number ?? order.name),
    createdAt,
    country,
    province:
      asString(order.province ?? order.province_code) ??
      nestedString(order, ["shipping_address", "province"]) ??
      nestedString(order, ["billing_address", "province"]),
    city:
      asString(order.city) ??
      nestedString(order, ["shipping_address", "city"]) ??
      nestedString(order, ["billing_address", "city"]),
    currency: asString(order.currency ?? order.currency_code ?? order.presentment_currency),
    totalAmount: asNumber(order.total_amount ?? order.totalAmount ?? order.current_total_price ?? order.total_price ?? order.total),
    subtotalAmount: asNumber(order.subtotal_amount ?? order.subtotalAmount ?? order.current_subtotal_price ?? order.subtotal_price ?? order.sub_total),
    discountAmount: asNumber(order.discount_amount ?? order.discountAmount ?? order.current_total_discounts ?? order.total_discounts),
    shippingAmount: asNumber(order.shipping_amount ?? order.shippingAmount ?? order.total_shipping_price ?? order.shipping_total),
    paymentStatus: asString(order.payment_status ?? order.paymentStatus ?? order.financial_status ?? order.payment_status_name),
    fulfillmentStatus: asString(order.fulfillment_status ?? order.fulfillmentStatus ?? order.shipping_status),
    sourceName: asString(order.source_name ?? order.sourceName ?? order.source),
    landingPage,
    utmSource: asString(order.utm_source) ?? parseQueryValue(landingPage, "utm_source"),
    utmMedium: asString(order.utm_medium) ?? parseQueryValue(landingPage, "utm_medium"),
    utmCampaign: asString(order.utm_campaign) ?? parseQueryValue(landingPage, "utm_campaign"),
    utmContent: asString(order.utm_content) ?? parseQueryValue(landingPage, "utm_content"),
    items: lineItems(order).map(normalizeOrderItem),
  };
}

export function stripPrivateFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripPrivateFields);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_FIELD_NAMES.has(key.toLowerCase())) continue;
    output[key] = stripPrivateFields(nested);
  }
  return output;
}

export function assertNoPrivateFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const field of PRIVATE_FIELD_NAMES) {
    if (serialized.includes(`"${field}"`)) {
      throw new Error(`Private field leaked into sanitized payload: ${field}`);
    }
  }
}

export function assertNoCustomerPrivateFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const field of CUSTOMER_PRIVATE_FIELD_NAMES) {
    if (serialized.includes(`"${field}"`)) {
      throw new Error(`Private customer field leaked into sanitized payload: ${field}`);
    }
  }
}
