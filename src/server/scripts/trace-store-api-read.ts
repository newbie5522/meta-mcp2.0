import prisma from "../../db/index.js";
import axios from "axios";
import dayjs from "dayjs";

async function main() {
  console.log("=================== TRACE STORE API READ ===================");

  // 1. Fetch stores
  const stores = await prisma.store.findMany();
  console.log(`Matched ${stores.length} stores in database.`);

  const prodStores = stores.filter(s => s.mode === "production" || s.mode === "生产");
  console.log(`Production stores: ${prodStores.length}`);

  for (const store of prodStores) {
    const hasToken = !!(store.shopify_token || store.shopline_token || store.shoplazza_token);
    console.log(`\nTesting Store ID: ${store.id} | Name: ${store.name}`);
    console.log(`  Platform: ${store.platform} | Mode: ${store.mode} | Domain: ${store.domain} | Timezone: ${store.timezone}`);
    console.log(`  Token Present: ${hasToken ? "YES" : "NO"}`);

    if (!hasToken) {
      console.log("  No token configured for this production store. Skipping API fetch test.");
      continue;
    }

    const token = store.shopline_token || store.shopify_token || store.shoplazza_token || "";

    // Build URL for Shopline openapi v20240301/orders.json (as used in core code)
    const cleanDomain = store.domain;
    const url = `https://${cleanDomain}/admin/openapi/v20240301/orders.json`;
    const sanitizedUrl = `https://${cleanDomain}/admin/openapi/v20240301/orders.json?limit=5`;

    console.log(`  Attempting Fetch: ${sanitizedUrl}`);
    try {
      const response = await axios.get(url, {
        params: { limit: 5 },
        headers: {
          "X-SHOPLINE-Access-Token": token,
          "Authorization": `Bearer ${token}` // try both depending on Shopline/others auth patterns
        },
        timeout: 10000
      });

      console.log(`  HTTP status: ${response.status}`);
      const responseKeys = Object.keys(response.data || {});
      console.log(`  Response keys: [${responseKeys.join(", ")}]`);

      const orders = response.data?.orders || response.data?.data || [];
      console.log(`  Orders returned: ${Array.isArray(orders) ? orders.length : "Not an array"}`);

      if (Array.isArray(orders) && orders.length > 0) {
        const first = orders[0];
        console.log(`  First order sample:`, {
          id: first.id || first.order_id,
          order_number: first.order_number || first.orderNumber,
          created_at: first.created_at || first.createdAt,
          financial_status: first.financial_status || first.paymentStatus,
          total_price: first.total_price || first.totalPrice || first.revenue
        });
      }
    } catch (err: any) {
      console.log(`  Fetch error occurred!`);
      if (err.response) {
        console.log(`  HTTP status: ${err.response.status}`);
        console.log(`  Error entity body:`, JSON.stringify(err.response.data).slice(0, 500));
      } else {
        console.log(`  Error Message: ${err.message}`);
      }
    }
  }

  console.log("==========================================================");
}

main()
  .catch((e) => {
    console.error("Main execution failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
