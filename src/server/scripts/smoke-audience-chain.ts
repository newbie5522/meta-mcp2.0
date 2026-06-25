import axios from "axios";
import prisma from "../../db/index.js";

const BASE_URL = "http://localhost:3000";
const TEST_START_DATE = "2026-06-20";
const TEST_END_DATE = "2026-06-25";

async function runSmokeAudienceChain() {
  console.log("🚀 Starting Audience & Country Data Chain Smoke Test...\n");

  try {
    // 1. Read existing store
    const store = await prisma.store.findFirst();
    if (!store) {
      console.log("PARTIAL_NO_EXISTING_DATA");
      return;
    }

    const storeId = store.id;

    // Read existing order
    const order = await prisma.order.findFirst({
      where: { storeId }
    });
    if (!order) {
      console.log("PARTIAL_NO_EXISTING_DATA");
      return;
    }

    console.log(`✅ Found existing store ID: ${storeId}`);
    console.log(`✅ Found existing order ID: ${order.orderId}`);

    // 2. Trigger the audience sync API
    console.log("📡 Triggering audience breakdown sync via POST /api/sync/meta-audience-breakdown...");
    const syncRes = await axios.post(`${BASE_URL}/api/sync/meta-audience-breakdown`, {
      startDate: TEST_START_DATE,
      endDate: TEST_END_DATE,
      storeId,
      dimensions: ["country", "age", "gender", "publisher_platform"],
      includeUnmapped: true
    });

    console.log("📝 [Sync Response]");
    console.log(`- Success: ${syncRes.data.success}`);
    console.log(`- Status: ${syncRes.data.status}`);
    console.log(`- Records Fetched: ${syncRes.data.recordsFetched}`);
    console.log(`- Failed Accounts Count: ${syncRes.data.failedAccounts?.length ?? 0}`);

    // 3. Query Audience insights
    console.log("\n📡 Querying audience insights via GET /api/data-center/audience...");
    const audRes = await axios.get(`${BASE_URL}/api/data-center/audience`, {
      params: {
        startDate: TEST_START_DATE,
        endDate: TEST_END_DATE,
        storeId,
        dimensionType: "country"
      }
    });

    console.log("📝 [Audience Insights Response]");
    console.log(`- Success: ${audRes.data.success}`);
    console.log(`- Rows Count: ${audRes.data.rows?.length ?? 0}`);
    if (audRes.data.dataHealth) {
      console.log(`- Data Health Status: ${audRes.data.dataHealth.status}`);
      console.log(`- Data Health Reason: ${audRes.data.dataHealth.reason}`);
    }

    // 4. Query Country analytics
    console.log("\n📡 Querying country analytics via GET /api/data-center/countries...");
    const countryRes = await axios.get(`${BASE_URL}/api/data-center/countries`, {
      params: {
        startDate: TEST_START_DATE,
        endDate: TEST_END_DATE,
        storeId
      }
    });

    console.log("📝 [Country Analytics Response]");
    console.log(`- Success: ${countryRes.data.success}`);
    console.log(`- Rows Count: ${countryRes.data.rows?.length ?? 0}`);
    if (countryRes.data.dataHealth) {
      console.log(`- Data Health Status: ${countryRes.data.dataHealth.status}`);
      console.log(`- Data Health Reason: ${countryRes.data.dataHealth.reason}`);
    }

    // 5. Query Audit endpoint
    console.log("\n📡 Querying Audit endpoint via GET /api/data-center/audit...");
    const auditRes = await axios.get(`${BASE_URL}/api/data-center/audit`, {
      params: {
        startDate: TEST_START_DATE,
        endDate: TEST_END_DATE,
        storeId
      }
    });

    console.log("📝 [Audit Report Response Highlights]");
    const auditData = auditRes.data;
    if (auditData.audience) {
      console.log(`- audience.factRows: ${auditData.audience.factRows}`);
      console.log(`- audience.countryRows: ${auditData.audience.countryRows}`);
      console.log(`- audience.ageRows: ${auditData.audience.ageRows}`);
      console.log(`- audience.genderRows: ${auditData.audience.genderRows}`);
      console.log(`- audience.publisherPlatformRows: ${auditData.audience.publisherPlatformRows}`);
      console.log(`- audience.status: ${auditData.audience.status}`);
    } else {
      console.log("⚠️ - Missing audience section in audit report!");
    }

    if (auditData.country) {
      console.log(`- country.orderKnownCountryOrders: ${auditData.country.orderKnownCountryOrders}`);
      console.log(`- country.orderUnknownCountryOrders: ${auditData.country.orderUnknownCountryOrders}`);
      console.log(`- country.knownCountryRate: ${auditData.country.knownCountryRate}`);
      console.log(`- country.status: ${auditData.country.status}`);
    } else {
      console.log("⚠️ - Missing country section in audit report!");
    }

    console.log("\n✅ Smoke Test Finished Successfully!");
  } catch (err: any) {
    console.error("\n❌ Smoke Test Failed!");
    console.error(err.response?.data || err.message || err);
    process.exit(1);
  }
}

runSmokeAudienceChain();
