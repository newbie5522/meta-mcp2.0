import axios from "axios";
import prisma from "../../db/index.js";

const BASE_URL = "http://localhost:3000";
const TEST_DATE = "2026-06-23";

async function runSmokeLedgerRefresh() {
  console.log("🚀 Starting Ledger Refresh and Active Accounts Smoke Test...\n");

  let createdStoreId: number | null = null;
  let createdOrderId: string | null = null;
  let createdMappingId: string | null = null;
  let createdAccountDailyId: string | null = null;

  try {
    // 1. Ensure a store exists for testing
    let store = await prisma.store.findFirst();
    if (!store) {
      console.log("⚠️ No stores found in database, creating a test store...");
      store = await prisma.store.create({
        data: {
          name: "Smoke Test Store",
          platform: "shopline",
          domain: "smoke-test-store.shoplineapp.com",
          timezone: "America/Los_Angeles",
          mode: "sandbox",
          shopline_token: "mock-shopline-token-for-smoke-test-12345"
        }
      });
      createdStoreId = store.id;
      console.log(`✅ Created test store with ID: ${store.id}`);
    }

    const storeId = store.id;

    // 2. Clear any existing DataCenterStoreDaily for this store and date
    await prisma.dataCenterStoreDaily.deleteMany({
      where: {
        storeId,
        date: TEST_DATE
      }
    });

    // 3. Ensure we have at least one valid completed Order for this store and date to simulate platforms having orders
    const testOrderId = "smoke-order-9999";
    let order = await prisma.order.findFirst({ where: { orderId: testOrderId } });
    if (!order) {
      order = await prisma.order.create({
        data: {
          id: testOrderId,
          orderId: testOrderId,
          storeId,
          productId: "smoke-product-id",
          orderTotal: 125.50,
          store_local_date: TEST_DATE,
          paymentStatus: "paid"
        }
      });
      createdOrderId = order.id;
      console.log(`✅ Created test order: ${order.orderId} with amount: ${order.orderTotal}`);
    }

    // 4. Query /api/data-center/stores before reconciliation
    console.log(`📡 Fetching stores before reconciliation for ${TEST_DATE}...`);
    const beforeRes = await axios.get(`${BASE_URL}/api/data-center/stores`, {
      params: { startDate: TEST_DATE, endDate: TEST_DATE, storeId }
    });

    const beforeStore = beforeRes.data.stores?.find((s: any) => s.id === storeId);
    if (!beforeStore) {
      throw new Error(`Test store ${storeId} not found in /api/data-center/stores response`);
    }

    console.log("📊 [Before Reconciliation Metrics]");
    console.log(`- ordersCount: ${beforeStore.ordersCount}`);
    console.log(`- totalSales: ${beforeStore.totalSales}`);
    console.log(`- syncStatus: ${beforeStore.syncStatus}`);
    console.log(`- snapshotRows: ${beforeStore.snapshotRows}`);

    // 5. Execute reconciliation and verify that ledger is refreshed in-flight
    console.log(`📡 Triggering reconciliation via GET /api/data-center/stores/${storeId}/reconciliation...`);
    const reconRes = await axios.get(`${BASE_URL}/api/data-center/stores/${storeId}/reconciliation`, {
      params: { startDate: TEST_DATE, endDate: TEST_DATE }
    });

    const reconData = reconRes.data;
    console.log("📝 [Reconciliation Response]");
    console.log(`- systemOrdersCount: ${reconData.systemOrdersCount}`);
    console.log(`- systemSalesAmount: ${reconData.systemSalesAmount}`);
    console.log(`- ledgerRefresh:`, JSON.stringify(reconData.ledgerRefresh));

    if (reconData.systemOrdersCount <= 0) {
      throw new Error("CRITICAL: systemOrdersCount must be greater than 0 since we added a paid test order.");
    }
    if (!reconData.ledgerRefresh || reconData.ledgerRefresh.success !== true) {
      throw new Error(`CRITICAL: ledgerRefresh was not successful: ${JSON.stringify(reconData.ledgerRefresh)}`);
    }

    // 6. Query /api/data-center/stores after reconciliation
    console.log(`📡 Fetching stores after reconciliation for ${TEST_DATE}...`);
    const afterRes = await axios.get(`${BASE_URL}/api/data-center/stores`, {
      params: { startDate: TEST_DATE, endDate: TEST_DATE, storeId }
    });

    const afterStore = afterRes.data.stores?.find((s: any) => s.id === storeId);
    if (!afterStore) {
      throw new Error(`Test store ${storeId} not found in after stores response`);
    }

    console.log("📊 [After Reconciliation Metrics]");
    console.log(`- ordersCount: ${afterStore.ordersCount}`);
    console.log(`- totalSales: ${afterStore.totalSales}`);
    console.log(`- syncStatus: ${afterStore.syncStatus}`);
    console.log(`- snapshotRows: ${afterStore.snapshotRows}`);

    if (afterStore.ordersCount <= 0) {
      throw new Error("CRITICAL: ordersCount must be greater than 0 after reconciliation ledger refresh!");
    }
    if (afterStore.totalSales <= 0) {
      throw new Error("CRITICAL: totalSales must be greater than 0 after reconciliation ledger refresh!");
    }
    if (afterStore.syncStatus !== "READY") {
      throw new Error(`CRITICAL: syncStatus must be READY after ledger is successfully populated! Current: ${afterStore.syncStatus}`);
    }
    if (afterStore.snapshotRows <= 0) {
      throw new Error(`CRITICAL: snapshotRows must be greater than 0! Current: ${afterStore.snapshotRows}`);
    }

    console.log("✅ Store ledger automatic refresh verified successfully.");

    // 7. Verify accounts-performance active accounts counting
    console.log("📡 Adding mock Meta performance rows and mappings to test active account counts...");
    // Ensure we have a mock AdAccount with spend
    const testAccountId = "act_smoke_test_acc_999";
    let adAccount = await prisma.adAccount.findUnique({ where: { fb_account_id: testAccountId } });
    if (!adAccount) {
      adAccount = await prisma.adAccount.create({
        data: {
          fb_account_id: testAccountId,
          fb_account_name: "Smoke Test Ad Account",
          currency: "USD",
          timezone: "America/Los_Angeles"
        }
      });
      console.log(`✅ Created test ad account: ${adAccount.fb_account_id}`);
    }

    // Create a daily record with spend for this account
    await prisma.dataCenterMetaAccountDaily.deleteMany({
      where: { accountId: testAccountId, date: TEST_DATE }
    });
    const accountDaily = await prisma.dataCenterMetaAccountDaily.create({
      data: {
        accountId: testAccountId,
        accountName: "Smoke Test Ad Account",
        date: TEST_DATE,
        spend: 150.00,
        impressions: 5000,
        clicks: 120,
        purchases: 2,
        purchaseValue: 250.00,
        apiFetchedAt: new Date()
      }
    });
    createdAccountDailyId = accountDaily.id;

    console.log(`📡 Fetching accounts-performance for ${TEST_DATE}...`);
    const performanceRes = await axios.get(`${BASE_URL}/api/data-center/accounts-performance`, {
      params: { startDate: TEST_DATE, endDate: TEST_DATE, storeId: "all" }
    });

    const perfData = performanceRes.data;
    console.log("📊 [Meta Accounts Performance Summary]");
    console.log(`- totalAccounts: ${perfData.summary?.totalAccounts}`);
    console.log(`- activeAccounts: ${perfData.summary?.activeAccounts}`);
    console.log(`- spendAccounts: ${perfData.summary?.spendAccounts}`);
    console.log(`- accountsWithSpendCount: ${perfData.accountsWithSpendCount}`);

    const targetAccount = perfData.accounts?.find((a: any) => a.accountId === testAccountId);
    if (!targetAccount) {
      throw new Error(`CRITICAL: Mock ad account ${testAccountId} not found in performance results.`);
    }

    if (perfData.summary?.activeAccounts !== perfData.summary?.spendAccounts) {
      throw new Error(`CRITICAL: activeAccounts (${perfData.summary?.activeAccounts}) does not equal spendAccounts (${perfData.summary?.spendAccounts})!`);
    }
    if (perfData.accountsWithSpendCount !== perfData.summary?.spendAccounts) {
      throw new Error(`CRITICAL: accountsWithSpendCount (${perfData.accountsWithSpendCount}) does not match spendAccounts (${perfData.summary?.spendAccounts})!`);
    }

    console.log("✅ Meta active accounts and counts verified successfully.");

    // 8. Cleanup created test resources
    console.log("🧹 Cleaning up created resources...");
    if (createdAccountDailyId) {
      await prisma.dataCenterMetaAccountDaily.delete({ where: { id: createdAccountDailyId } });
    }
    if (testAccountId) {
      await prisma.adAccount.deleteMany({ where: { fb_account_id: testAccountId } });
    }
    if (createdOrderId) {
      await prisma.order.delete({ where: { id: createdOrderId } });
    }
    if (createdStoreId) {
      await prisma.store.delete({ where: { id: createdStoreId } });
    }
    await prisma.dataCenterStoreDaily.deleteMany({
      where: {
        storeId,
        date: TEST_DATE
      }
    });

    console.log("\n🎉 ALL LEDGER REFRESH AND ACTIVE ACCOUNTS SMOKE TESTS PASSED! ✅\n");
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ SMOKE TEST FAILED! ❌\n");
    console.error(error);
    process.exit(1);
  }
}

runSmokeLedgerRefresh();
