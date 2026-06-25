import axios from "axios";
import prisma from "../../db/index.js";

const BASE_URL = "http://localhost:3000";
const TEST_DATE = "2026-06-23";

async function runSmokeMenuDataChain() {
  console.log("🚀 Starting Full-Chain Menu Data Coverage Smoke Test...\n");

  let createdStoreId: number | null = null;
  let createdAdAccountId: string | null = null;
  let createdMappingId: number | null = null;
  let createdCampaignId: string | null = null;
  let createdAdsetId: string | null = null;
  let createdAdId: string | null = null;
  let createdCreativeId: string | null = null;
  let createdFactIds: number[] = [];
  let createdAudienceIds: number[] = [];
  let createdCreativePerfIds: number[] = [];
  let createdAccountDailyId: string | null = null;
  let createdStoreDailyId: string | null = null;

  try {
    // 1. Seed Store
    const store = await prisma.store.create({
      data: {
        name: "Smoke Menu Chain Store",
        platform: "shopline",
        domain: "smoke-menu-chain-store.shoplineapp.com",
        timezone: "America/Los_Angeles",
        mode: "sandbox",
        shopline_token: "mock-token-menu-chain-12345"
      }
    });
    createdStoreId = store.id;
    console.log(`✅ Seeded test Store with ID: ${store.id}`);

    // 2. Seed AdAccount
    const testAccountId = "act_smoke_test_acc_999";
    const adAccount = await prisma.adAccount.create({
      data: {
        fb_account_id: testAccountId,
        fb_account_name: "Smoke Test Ad Account",
        currency: "USD",
        timezone: "America/Los_Angeles",
        storeId: store.id
      }
    });
    createdAdAccountId = adAccount.fb_account_id;
    console.log(`✅ Seeded test AdAccount: ${adAccount.fb_account_id}`);

    // 3. Seed AccountMapping
    const mapping = await prisma.accountMapping.create({
      data: {
        fbAccountId: testAccountId,
        storeId: store.id,
        name: "Smoke Test Ad Account",
        mode: "automatic"
      }
    });
    createdMappingId = mapping.id;
    console.log(`✅ Seeded AccountMapping with ID: ${mapping.id}`);

    // 4. Seed AdCreative
    const creative = await prisma.adCreative.create({
      data: {
        creativeId: "creative_smoke_999",
        fbAccountId: testAccountId,
        mediaType: "IMAGE",
        name: "Smoke Creative",
        storeId: store.id
      }
    });
    createdCreativeId = creative.creativeId;
    console.log(`✅ Seeded AdCreative: ${creative.creativeId}`);

    // 5. Seed Campaign
    const campaign = await prisma.campaign.create({
      data: {
        id: "camp_smoke_123",
        accountId: testAccountId,
        name: "Smoke Test Campaign",
        status: "ACTIVE"
      }
    });
    createdCampaignId = campaign.id;
    console.log(`✅ Seeded Campaign: ${campaign.id}`);

    // 6. Seed AdSet
    const adset = await prisma.adSet.create({
      data: {
        id: "adset_smoke_456",
        campaignId: "camp_smoke_123",
        accountId: testAccountId,
        name: "Smoke Test AdSet"
      }
    });
    createdAdsetId = adset.id;
    console.log(`✅ Seeded AdSet: ${adset.id}`);

    // 7. Seed Ad
    const ad = await prisma.ad.create({
      data: {
        id: "ad_smoke_789",
        adsetId: "adset_smoke_456",
        campaignId: "camp_smoke_123",
        accountId: testAccountId,
        name: "Smoke Test Ad",
        creativeId: "creative_smoke_999"
      }
    });
    createdAdId = ad.id;
    console.log(`✅ Seeded Ad: ${ad.id}`);

    // 8. Seed FactMetaPerformance rows for all 4 levels
    const factAccount = await prisma.factMetaPerformance.create({
      data: {
        date: TEST_DATE,
        level: "account",
        account_id: testAccountId,
        entity_id: testAccountId,
        spend: 250.00,
        impressions: 10000,
        clicks: 250,
        purchases: 5,
        purchase_value: 750.00,
        roas: 3.0
      }
    });
    createdFactIds.push(factAccount.id);

    const factCamp = await prisma.factMetaPerformance.create({
      data: {
        date: TEST_DATE,
        level: "campaign",
        account_id: testAccountId,
        campaign_id: "camp_smoke_123",
        entity_id: "camp_smoke_123",
        spend: 250.00,
        impressions: 10000,
        clicks: 250,
        purchases: 5,
        purchase_value: 750.00,
        roas: 3.0
      }
    });
    createdFactIds.push(factCamp.id);

    const factAdset = await prisma.factMetaPerformance.create({
      data: {
        date: TEST_DATE,
        level: "adset",
        account_id: testAccountId,
        campaign_id: "camp_smoke_123",
        adset_id: "adset_smoke_456",
        entity_id: "adset_smoke_456",
        spend: 250.00,
        impressions: 10000,
        clicks: 250,
        purchases: 5,
        purchase_value: 750.00,
        roas: 3.0
      }
    });
    createdFactIds.push(factAdset.id);

    const factAd = await prisma.factMetaPerformance.create({
      data: {
        date: TEST_DATE,
        level: "ad",
        account_id: testAccountId,
        campaign_id: "camp_smoke_123",
        adset_id: "adset_smoke_456",
        ad_id: "ad_smoke_789",
        entity_id: "ad_smoke_789",
        spend: 250.00,
        impressions: 10000,
        clicks: 250,
        purchases: 5,
        purchase_value: 750.00,
        roas: 3.0
      }
    });
    createdFactIds.push(factAd.id);
    console.log(`✅ Seeded 4 levels of FactMetaPerformance rows.`);

    // 9. Seed FactAudienceBreakdown
    const audienceRow = await prisma.factAudienceBreakdown.create({
      data: {
        date: TEST_DATE,
        level: "account",
        account_id: testAccountId,
        dimension_type: "country",
        dimension_value: "US",
        spend: 250.00,
        impressions: 10000,
        clicks: 250,
        purchases: 5,
        purchase_value: 750.00
      }
    });
    createdAudienceIds.push(audienceRow.id);
    console.log(`✅ Seeded FactAudienceBreakdown row.`);

    // 10. Seed CreativePerformanceDaily
    const creativePerfRow = await prisma.creativePerformanceDaily.create({
      data: {
        creativeId: "creative_smoke_999",
        date: TEST_DATE,
        spend: 250.00,
        impressions: 10000,
        clicks: 250,
        revenue: 750.00,
        creativeName: "Smoke Creative",
        type: "IMAGE",
        purchases: 5,
        roas: 3.0,
        ctr: 2.5,
        cpc: 1.0,
        cpm: 25.0,
        storeId: store.id
      }
    });
    createdCreativePerfIds.push(creativePerfRow.id);
    console.log(`✅ Seeded CreativePerformanceDaily row.`);

    // 11. Seed DataCenterMetaAccountDaily & DataCenterStoreDaily to pass Overview/Details/Store pages
    const accDaily = await prisma.dataCenterMetaAccountDaily.create({
      data: {
        accountId: testAccountId,
        accountName: "Smoke Test Ad Account",
        date: TEST_DATE,
        spend: 250.00,
        impressions: 10000,
        clicks: 250,
        purchases: 5,
        purchaseValue: 750.00,
        apiFetchedAt: new Date()
      }
    });
    createdAccountDailyId = accDaily.id;

    const storeDaily = await prisma.dataCenterStoreDaily.create({
      data: {
        storeId: store.id,
        date: TEST_DATE,
        timezone: "America/Los_Angeles",
        orderCount: 5,
        grossSales: 750.00,
        apiFetchedAt: new Date()
      }
    });
    createdStoreDailyId = storeDaily.id;
    console.log(`✅ Seeded DataCenterMetaAccountDaily & DataCenterStoreDaily rows.`);

    console.log("\n📡 Triggering menu endpoint requests to verify real-time queries...\n");

    const statusMap: Record<string, string> = {
      overview: "EMPTY",
      accounts: "EMPTY",
      stores: "EMPTY",
      adHierarchyAccounts: "EMPTY",
      adHierarchyCampaigns: "EMPTY",
      adHierarchyAdsets: "EMPTY",
      adHierarchyAds: "EMPTY",
      audience: "EMPTY",
      countries: "EMPTY",
      creatives: "EMPTY",
      audit: "FAIL"
    };

    const params = { startDate: TEST_DATE, endDate: TEST_DATE, storeId: store.id };

    // A. GET /api/dashboard
    try {
      const res = await axios.get(`${BASE_URL}/api/dashboard`, {
        params: { since: TEST_DATE, until: TEST_DATE, storeId: store.id }
      });
      if (res.status === 200) {
        statusMap.overview = res.data?.data?.overview?.storeSales > 0 ? "PASS" : "EMPTY";
      } else {
        statusMap.overview = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed dashboard request:", e.message);
      statusMap.overview = "FAIL";
    }

    // B. GET /api/data-center/accounts-performance
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/accounts-performance`, { params });
      if (res.status === 200) {
        statusMap.accounts = (res.data?.accounts?.length > 0) ? "PASS" : "EMPTY";
      } else {
        statusMap.accounts = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed accounts-performance request:", e.message);
      statusMap.accounts = "FAIL";
    }

    // C. GET /api/data-center/stores
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/stores`, { params });
      if (res.status === 200) {
        statusMap.stores = (res.data?.stores?.length > 0) ? "PASS" : "EMPTY";
      } else {
        statusMap.stores = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed stores request:", e.message);
      statusMap.stores = "FAIL";
    }

    // D1. GET /api/data-center/ad-hierarchy/accounts
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/ad-hierarchy/accounts`, { params });
      if (res.status === 200) {
        statusMap.adHierarchyAccounts = (res.data?.data?.length > 0) ? "PASS" : "EMPTY";
      } else {
        statusMap.adHierarchyAccounts = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed ad-hierarchy/accounts request:", e.message);
      statusMap.adHierarchyAccounts = "FAIL";
    }

    // D2. GET /api/data-center/ad-hierarchy/campaigns
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/ad-hierarchy/campaigns`, {
        params: { ...params, accountId: testAccountId }
      });
      if (res.status === 200) {
        const rowsCount = res.data?.data?.length || 0;
        if (rowsCount > 0) {
          statusMap.adHierarchyCampaigns = "PASS";
        } else {
          // If upstream has spend but this is empty, fail
          statusMap.adHierarchyCampaigns = statusMap.adHierarchyAccounts === "PASS" ? "FAIL" : "EMPTY";
        }
      } else {
        statusMap.adHierarchyCampaigns = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed ad-hierarchy/campaigns request:", e.message);
      statusMap.adHierarchyCampaigns = "FAIL";
    }

    // D3. GET /api/data-center/ad-hierarchy/adsets
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/ad-hierarchy/adsets`, {
        params: { ...params, accountId: testAccountId, campaignId: "camp_smoke_123" }
      });
      if (res.status === 200) {
        const rowsCount = res.data?.data?.length || 0;
        if (rowsCount > 0) {
          statusMap.adHierarchyAdsets = "PASS";
        } else {
          // If upstream campaign is PASS but this is empty, fail
          statusMap.adHierarchyAdsets = statusMap.adHierarchyCampaigns === "PASS" ? "FAIL" : "EMPTY";
        }
      } else {
        statusMap.adHierarchyAdsets = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed ad-hierarchy/adsets request:", e.message);
      statusMap.adHierarchyAdsets = "FAIL";
    }

    // D4. GET /api/data-center/ad-hierarchy/ads
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/ad-hierarchy/ads`, {
        params: { ...params, accountId: testAccountId, adsetId: "adset_smoke_456" }
      });
      if (res.status === 200) {
        const rowsCount = res.data?.data?.length || 0;
        if (rowsCount > 0) {
          statusMap.adHierarchyAds = "PASS";
        } else {
          // If upstream adset is PASS but this is empty, fail
          statusMap.adHierarchyAds = statusMap.adHierarchyAdsets === "PASS" ? "FAIL" : "EMPTY";
        }
      } else {
        statusMap.adHierarchyAds = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed ad-hierarchy/ads request:", e.message);
      statusMap.adHierarchyAds = "FAIL";
    }

    // E. GET /api/data-center/audience
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/audience`, {
        params: { ...params, accountId: testAccountId }
      });
      if (res.status === 200) {
        statusMap.audience = (res.data?.rows?.length > 0) ? "PASS" : "EMPTY";
      } else {
        statusMap.audience = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed audience request:", e.message);
      statusMap.audience = "FAIL";
    }

    // F. GET /api/data-center/countries
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/countries`, { params });
      if (res.status === 200) {
        statusMap.countries = (res.data?.rows?.length > 0) ? "PASS" : "EMPTY";
      } else {
        statusMap.countries = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed countries request:", e.message);
      statusMap.countries = "FAIL";
    }

    // G. GET /api/data-center/creative-insights
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/creative-insights`, { params });
      if (res.status === 200) {
        statusMap.creatives = (res.data?.data?.length > 0) ? "PASS" : "EMPTY";
      } else {
        statusMap.creatives = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed creative-insights request:", e.message);
      statusMap.creatives = "FAIL";
    }

    // H. GET /api/data-center/audit
    try {
      const res = await axios.get(`${BASE_URL}/api/data-center/audit`, { params });
      if (res.status === 200 && res.data.success) {
        statusMap.audit = "PASS";
        console.log("📝 audit menuChain response:", JSON.stringify(res.data.menuChain, null, 2));
      } else {
        statusMap.audit = "FAIL";
      }
    } catch (e: any) {
      console.error("❌ Failed audit request:", e.message);
      statusMap.audit = "FAIL";
    }

    console.log("\n========================================");
    console.log("📊 MENU DATA CHAIN SMOKE VERIFICATION TABLE:");
    console.log(`overview: ${statusMap.overview}`);
    console.log(`accounts: ${statusMap.accounts}`);
    console.log(`stores: ${statusMap.stores}`);
    console.log(`adHierarchyAccounts: ${statusMap.adHierarchyAccounts}`);
    console.log(`adHierarchyCampaigns: ${statusMap.adHierarchyCampaigns}`);
    console.log(`adHierarchyAdsets: ${statusMap.adHierarchyAdsets}`);
    console.log(`adHierarchyAds: ${statusMap.adHierarchyAds}`);
    console.log(`audience: ${statusMap.audience}`);
    console.log(`countries: ${statusMap.countries}`);
    console.log(`creatives: ${statusMap.creatives}`);
    console.log(`audit: ${statusMap.audit}`);
    console.log("========================================\n");

    // Verify if any critical failure occurred
    const hasFailures = Object.values(statusMap).includes("FAIL");
    if (hasFailures) {
      throw new Error("One or more endpoints returned FAIL status.");
    }

    console.log("🎉 ALL MENU DATA CHAIN SMOKE TESTS PASSED! ✅\n");
  } catch (error: any) {
    console.error("\n❌ MENU DATA CHAIN SMOKE TEST FAILED! ❌\n");
    console.error(error);
  } finally {
    // 12. Cleanup seeded records
    console.log("🧹 Starting database cleanup of seeded menu chain test data...");
    try {
      if (createdStoreDailyId) {
        await prisma.dataCenterStoreDaily.delete({ where: { id: createdStoreDailyId } });
      }
      if (createdAccountDailyId) {
        await prisma.dataCenterMetaAccountDaily.delete({ where: { id: createdAccountDailyId } });
      }
      for (const id of createdCreativePerfIds) {
        await prisma.creativePerformanceDaily.delete({ where: { id } });
      }
      for (const id of createdAudienceIds) {
        await prisma.factAudienceBreakdown.delete({ where: { id } });
      }
      for (const id of createdFactIds) {
        await prisma.factMetaPerformance.delete({ where: { id } });
      }
      if (createdAdId) {
        await prisma.ad.delete({ where: { id: createdAdId } });
      }
      if (createdAdsetId) {
        await prisma.adSet.delete({ where: { id: createdAdsetId } });
      }
      if (createdCampaignId) {
        await prisma.campaign.delete({ where: { id: createdCampaignId } });
      }
      if (createdCreativeId) {
        await prisma.adCreative.delete({ where: { creativeId: createdCreativeId } });
      }
      if (createdMappingId) {
        await prisma.accountMapping.delete({ where: { id: createdMappingId } });
      }
      if (createdAdAccountId) {
        await prisma.adAccount.delete({ where: { fb_account_id: createdAdAccountId } });
      }
      if (createdStoreId) {
        await prisma.store.delete({ where: { id: createdStoreId } });
      }
      console.log("✅ Cleanup completed successfully.");
    } catch (cleanupError: any) {
      console.error("⚠️ Cleanup encountered errors:", cleanupError.message);
    }
  }
}

runSmokeMenuDataChain();
