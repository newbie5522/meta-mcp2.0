import { describe, expect, it } from "vitest";
import { assertNoPrivateFields, normalizeShopOrder, stripPrivateFields } from "../../src/shop/privacy.js";

describe("shop order privacy", () => {
  it("normalizes only non-private order fields", () => {
    const normalized = normalizeShopOrder({
      id: "1001",
      order_number: "S1001",
      created_at: "2026-05-25T00:00:00.000Z",
      currency: "USD",
      total_price: "99.90",
      email: "customer@example.com",
      phone: "+100000000",
      shipping_address: {
        name: "Private Person",
        address1: "Private Street",
        country_code: "US",
        province: "CA",
        city: "Los Angeles",
      },
      landing_page: "/products/a?utm_source=meta&utm_medium=paid&utm_campaign=spring&utm_content=hook1",
      line_items: [
        {
          product_id: "p1",
          name: "Product A",
          variant_id: "v1",
          sku: "SKU-A",
          quantity: 2,
          price: "10",
        },
      ],
    });

    expect(normalized).toMatchObject({
      platformOrderId: "1001",
      orderNumber: "S1001",
      country: "US",
      province: "CA",
      city: "Los Angeles",
      totalAmount: 99.9,
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring",
      utmContent: "hook1",
    });
    expect(JSON.stringify(normalized)).not.toContain("customer@example.com");
    expect(JSON.stringify(normalized)).not.toContain("Private Street");
  });

  it("strips private fields from arbitrary payloads", () => {
    const sanitized = stripPrivateFields({
      id: "1001",
      email: "customer@example.com",
      customer: { phone: "123" },
      shipping_address: { address1: "Private Street" },
      country: "US",
    });

    expect(sanitized).toEqual({ id: "1001", country: "US" });
    expect(() => assertNoPrivateFields(sanitized)).not.toThrow();
  });

  it("normalizes Shopline-like order payloads without private fields", () => {
    const normalized = normalizeShopOrder({
      order_id: "sl-1001",
      name: "SL1001",
      created_at: "2026-05-25T08:00:00.000Z",
      currency_code: "USD",
      total: "120.50",
      sub_total: "100.00",
      shipping_total: "10.50",
      payment_status_name: "paid",
      shipping_status: "fulfilled",
      shipping_address: {
        phone: "+100000000",
        address1: "Private Street",
        country: "United States",
        province: "CA",
        city: "Los Angeles",
      },
      landing_page_url: "/products/a?utm_source=meta&utm_medium=cpc",
      items: [
        {
          product_id: "p100",
          product_title: "Shopline Product",
          variant_id: "v100",
          sku_code: "SL-SKU",
          quantity: "2",
          unit_price: "30",
        },
      ],
    });

    expect(normalized).toMatchObject({
      platformOrderId: "sl-1001",
      orderNumber: "SL1001",
      country: "United States",
      totalAmount: 120.5,
      subtotalAmount: 100,
      shippingAmount: 10.5,
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      utmSource: "meta",
      utmMedium: "cpc",
    });
    expect(normalized.items[0]).toMatchObject({
      productName: "Shopline Product",
      sku: "SL-SKU",
      totalPrice: 60,
    });
    expect(JSON.stringify(normalized)).not.toContain("Private Street");
  });

  it("normalizes Shoplazza-like order payloads without customer data", () => {
    const normalized = normalizeShopOrder({
      id: "lz-2001",
      order_number: "LZ2001",
      placed_at: "2026-05-25T09:00:00.000Z",
      presentment_currency: "EUR",
      total_price: "88.00",
      total_discounts: "5.00",
      financial_status: "paid",
      source: "https://example.com/products/a?utm_source=meta&utm_medium=paid",
      last_landing_url: "https://example.com/products/a?utm_source=meta&utm_medium=paid&utm_campaign=summer",
      billing_address: {
        email: "private@example.com",
        address1: "Private Avenue",
        country_code: "DE",
        province: "BE",
        city: "Berlin",
      },
      order_items: [
        {
          productId: "p200",
          productName: "Shoplazza Product",
          variantId: "v200",
          sku: "LZ-SKU",
          quantity: 1,
          linePrice: "88",
        },
      ],
    });

    expect(normalized).toMatchObject({
      platformOrderId: "lz-2001",
      orderNumber: "LZ2001",
      country: "DE",
      province: "BE",
      city: "Berlin",
      currency: "EUR",
      totalAmount: 88,
      discountAmount: 5,
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "summer",
    });
    expect(normalized.items[0]).toMatchObject({
      productName: "Shoplazza Product",
      variantId: "v200",
      totalPrice: 88,
    });
    expect(JSON.stringify(normalized)).not.toContain("private@example.com");
  });

  it("normalizes current Shopline price fields", () => {
    const normalized = normalizeShopOrder({
      id: "sl-3001",
      name: "SL3001",
      created_at: "2026-05-25T09:00:00.000Z",
      currency: "USD",
      current_total_price: "120.50",
      current_subtotal_price: "100.00",
      current_total_discounts: "9.50",
      line_items: [],
    });

    expect(normalized).toMatchObject({
      platformOrderId: "sl-3001",
      orderNumber: "SL3001",
      totalAmount: 120.5,
      subtotalAmount: 100,
      discountAmount: 9.5,
    });
  });
});
