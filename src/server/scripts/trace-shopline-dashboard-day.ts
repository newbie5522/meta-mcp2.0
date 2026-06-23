import prisma from "../../db/index.js";
import { fetchShoplineOrdersDirect } from "../services/store-sync.service.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

async function main() {
  console.log("==========================================================================");
  console.log("             TRACE SHOPLINE DASHBOARD DAY: 2026-06-21                     ");
  console.log("==========================================================================");

  // 1. Fetch baslayer store
  const store = await prisma.store.findUnique({ where: { id: 1 } });
  if (!store) {
    console.error("Error: Store ID=1 (Baslayer) not found in database.");
    process.exit(1);
  }

  // Standardization enforce
  let timezoneStr = store.timezone || "America/Los_Angeles";
  if (store.domain.includes("baslayer") || store.name?.toLowerCase().includes("baslayer")) {
    timezoneStr = "America/Los_Angeles";
  }

  const startDate = "2026-06-21";
  const endDate = "2026-06-21";

  // Compute timezone offset for 2026-06-21 in America/Los_Angeles (normally -07:00 due to DST)
  const dummyLocalDate = dayjs.tz(`${startDate} 12:00:00`, timezoneStr);
  const tzOffset = dummyLocalDate.format("Z"); // e.g. "-07:00"

  const startUtc = `${startDate}T00:00:00${tzOffset}`;
  const endUtc = `${endDate}T23:59:59${tzOffset}`;

  console.log(`Store: ${store.name} (${store.domain})`);
  console.log(`Standardized Timezone: ${timezoneStr} (determined offset: ${tzOffset})`);
  console.log(`Requested Data Day: ${startDate}`);
  console.log(`UTCDatetime Request Window: ${startUtc} to ${endUtc}`);

  let hasNextOrders = true;
  let currentFetchUrl: string | null = null;
  let pageCount = 0;
  let totalFetched = 0;
  let ordersList: any[] = [];

  while (hasNextOrders) {
    pageCount++;
    console.log(`\n--- Fetching Page ${pageCount} ---`);
    if (currentFetchUrl) {
      console.log(`Pagination URL: ${currentFetchUrl}`);
    }

    try {
      const result = await fetchShoplineOrdersDirect(
        store.domain,
        store.shopline_token,
        startUtc,
        endUtc,
        100,
        currentFetchUrl
      );

      console.log(`SUCCESS: Status 200. Orders on this page: ${result.orders.length}`);
      console.log(`Next Page NextUrl: ${result.nextUrl || "NONE"}`);
      
      const link = result.responseHeaders.link || result.responseHeaders["Link"] || "";
      console.log(`Response Link Header: ${link || "NONE"}`);
      
      // Print fallbacks if body has them
      const bObj = result.rawBody;
      const bKeys = Object.keys(bObj);
      console.log(`Response body keys: [${bKeys.join(", ")}]`);
      if (bObj.pagination) {
        console.log(`Body pagination property matches:`, JSON.stringify(bObj.pagination));
      }

      ordersList.push(...result.orders);
      totalFetched += result.orders.length;

      if (result.nextUrl) {
        currentFetchUrl = result.nextUrl;
        // Anti-rate limit backoff
        await new Promise(r => setTimeout(r, 300));
      } else {
        hasNextOrders = false;
      }
    } catch (err: any) {
      console.error(`ERROR: Failed on page ${pageCount}:`, err.message);
      if (err.response) {
        console.error(`Response data:`, JSON.stringify(err.response.data));
      }
      break;
    }
  }

  console.log("\n==========================================================================");
  console.log(`FETCH SUMMARY: Pages=${pageCount} | Total Fetched=${totalFetched}`);
  console.log("==========================================================================");

  // Filter and compute attribution
  const allowedStatuses = ['paid', 'pending', 'authorized', 'partially_paid', 'partially_refunded', 'refunded'];
  const matchedOrders: any[] = [];

  for (const o of ordersList) {
    const status = String(o.financial_status || "").toLowerCase();
    const isCancelled = !!(o.cancelled_at || o.cancel_reason);
    const inAllowed = allowedStatuses.includes(status);

    if (!inAllowed || isCancelled) {
      continue;
    }

    // 1. Attribution Date selection
    const attributionDatetime = o.processed_at || o.created_at || o.updated_at || o.paid_at || o.completed_at || o.closed_at || o.created_at;
    const localDate = dayjs(attributionDatetime).tz(timezoneStr).format("YYYY-MM-DD");

    if (localDate === startDate) {
      const currentSubtotal = parseFloat(o.current_subtotal_price || o.total_line_items_price || o.subtotal_price || 0);
      const discounts = parseFloat(o.total_discounts || o.current_total_discounts || 0);
      const totalAmount = currentSubtotal - discounts;

      matchedOrders.push({
        id: o.id,
        order_number: o.order_number,
        financial_status: o.financial_status,
        attributionDatetime,
        localDate,
        totalAmount
      });
    }
  }

  console.log(`Matched orders on ${startDate} in ${timezoneStr} timezone: ${matchedOrders.length}`);
  const totalRevenue = matchedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  matchedOrders.forEach((o, i) => {
    console.log(`Order ${i+1}: ID=${o.id} | Financial=${o.financial_status} | AttribTime=${o.attributionDatetime} | LocalDate=${o.localDate} | revenueTotal=${o.totalAmount.toFixed(2)}`);
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log(`FINAL METRICS:`);
  console.log(`- Hard acceptance date: ${startDate}`);
  console.log(`- Standardized timezone: ${timezoneStr}`);
  console.log(`- Countable order count: ${matchedOrders.length}`);
  console.log(`- Summed total revenue:  US$${totalRevenue.toFixed(2)}`);
  console.log("--------------------------------------------------------------------------");
  console.log("PASS VALIDATION: " + (matchedOrders.length === 17 ? "YES" : "NO"));
  console.log("==========================================================================");
}

main()
  .catch((err) => {
    console.error("Trace execution failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
