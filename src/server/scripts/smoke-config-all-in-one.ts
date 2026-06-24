import axios from "axios";
import prisma from "../../db/index.js";
import { getMetaToken } from "../utils.js";

const BASE_URL = "http://localhost:3000";

async function runSmoke() {
  console.log("🚀 Starting Config All-In-One Smoke Test...\n");

  let originalToken: string | null = null;
  let originalUpdatedAt: string | null = null;

  try {
    // 1. Backup META_ACCESS_TOKEN
    const dbToken = await prisma.setting.findUnique({ where: { key: "META_ACCESS_TOKEN" } });
    if (dbToken) originalToken = dbToken.value;
    const dbUpdated = await prisma.setting.findUnique({ where: { key: "META_TOKEN_UPDATED_AT" } });
    if (dbUpdated) originalUpdatedAt = dbUpdated.value;

    console.log("📦 Backup successful.");

    // 2. POST /api/settings with mock token
    const testToken = "EAA_test_token_value_longer_than_20_chars";
    console.log(`📡 Saving mock META_ACCESS_TOKEN via POST /api/settings...`);
    const postRes = await axios.post(`${BASE_URL}/api/settings`, {
      key: "META_ACCESS_TOKEN",
      value: testToken
    });

    if (!postRes.data?.success || !postRes.data?.hasMetaAccessToken) {
      throw new Error(`Failed to save META_ACCESS_TOKEN: ${JSON.stringify(postRes.data)}`);
    }
    console.log("✅ Saved successfully.");

    // 3. GET /api/settings verify omission and masking
    console.log(`📡 Fetching settings via GET /api/settings...`);
    const getRes = await axios.get(`${BASE_URL}/api/settings`);
    const config = getRes.data;

    if (config.META_ACCESS_TOKEN || config.meta_token) {
      throw new Error(`CRITICAL: GET /api/settings returned raw tokens! Keys: ${Object.keys(config).join(", ")}`);
    }

    if (!config.hasMetaAccessToken || !config.metaTokenMasked) {
      throw new Error(`CRITICAL: hasMetaAccessToken or metaTokenMasked missing from GET response!`);
    }

    console.log(`✅ Raw tokens completely hidden. Status attributes are correct.`);

    // 4. Test getMetaToken()
    const readToken = await getMetaToken();
    if (readToken !== testToken) {
      throw new Error(`CRITICAL: getMetaToken() readback mismatched! Got: ${readToken}, Expected: ${testToken}`);
    }
    console.log(`✅ getMetaToken() successfully read back correct raw token.`);

    // 5. Restore original META_ACCESS_TOKEN
    if (originalToken) {
      await prisma.setting.upsert({
        where: { key: "META_ACCESS_TOKEN" },
        update: { value: originalToken },
        create: { key: "META_ACCESS_TOKEN", value: originalToken }
      });
    } else {
      await prisma.setting.deleteMany({ where: { key: "META_ACCESS_TOKEN" } });
    }

    if (originalUpdatedAt) {
      await prisma.setting.upsert({
        where: { key: "META_TOKEN_UPDATED_AT" },
        update: { value: originalUpdatedAt },
        create: { key: "META_TOKEN_UPDATED_AT", value: originalUpdatedAt }
      });
    } else {
      await prisma.setting.deleteMany({ where: { key: "META_TOKEN_UPDATED_AT" } });
    }
    console.log("📦 Restored original META_ACCESS_TOKEN.");

    // 6. POST /api/stores: Add test store
    console.log(`📡 Creating test store via POST /api/stores...`);
    const storePayload = {
      name: "Smoke Test Store",
      platform: "shopline",
      domain: "smoke-test.shoplineapp.com",
      timezone: "America/Los_Angeles",
      mode: "sandbox",
      shopline_token: "shopline_token_secret_value_not_masked"
    };

    const storeCreateRes = await axios.post(`${BASE_URL}/api/stores`, storePayload);
    if (!storeCreateRes.data?.success || !storeCreateRes.data?.store?.id) {
      throw new Error(`Store creation failed: ${JSON.stringify(storeCreateRes.data)}`);
    }

    const testStoreId = Number(storeCreateRes.data.store.id);
    console.log(`✅ Store created with ID: ${testStoreId}`);

    // 7. GET /api/stores/:id readback
    console.log(`📡 Reading back store via GET /api/stores/${testStoreId}...`);
    const readStoreRes = await axios.get(`${BASE_URL}/api/stores/${testStoreId}`);
    const readStore = readStoreRes.data;

    if (readStore.id !== testStoreId || readStore.name !== "Smoke Test Store" || readStore.platform !== "shopline") {
      throw new Error(`Readback data mismatch: ${JSON.stringify(readStore)}`);
    }
    console.log(`✅ Store readback successful.`);

    // 8. POST /api/stores update test store
    console.log(`📡 Updating store via POST /api/stores...`);
    const updatePayload = {
      id: testStoreId,
      name: "Smoke Test Store",
      platform: "shopline",
      domain: "smoke-test.shoplineapp.com",
      timezone: "America/Los_Angeles",
      mode: "production",
    };

    const updateRes = await axios.post(`${BASE_URL}/api/stores`, updatePayload);
    if (!updateRes.data?.success) {
      throw new Error(`Store update failed: ${JSON.stringify(updateRes.data)}`);
    }

    // Read back database directly to check token preservation
    const dbStoreAfterUpdate = await prisma.store.findUnique({ where: { id: testStoreId } });
    if (!dbStoreAfterUpdate?.shopline_token || dbStoreAfterUpdate.shopline_token !== "shopline_token_secret_value_not_masked") {
      throw new Error(`CRITICAL: Token was cleared or overwritten by empty input! Current value: ${dbStoreAfterUpdate?.shopline_token}`);
    }
    if (dbStoreAfterUpdate.mode !== "production") {
      throw new Error(`CRITICAL: Mode update failed to apply! Mode is: ${dbStoreAfterUpdate.mode}`);
    }
    console.log(`✅ Store update token preservation & mode update passed.`);

    // 10. Test Mapping
    const firstAdAccount = await prisma.adAccount.findFirst();
    if (firstAdAccount) {
      const fbAccId = firstAdAccount.fb_account_id;
      console.log(`📡 Testing account mappings for Account: ${fbAccId} with Store ID: ${testStoreId}...`);

      const mapPayload = {
        mappings: [
          {
            accountId: fbAccId,
            storeId: testStoreId,
            fbPageId: "mock-page-123",
            project: "Smoke Project",
            owner: "Smoke Owner"
          }
        ]
      };

      const mapRes = await axios.post(`${BASE_URL}/api/mappings/batch`, mapPayload);
      if (!mapRes.data?.success) {
        throw new Error(`Batch mappings save failed: ${JSON.stringify(mapRes.data)}`);
      }

      const getMappingsRes = await axios.get(`${BASE_URL}/api/mappings`);
      const allMappings = getMappingsRes.data;
      const verifiedMap = allMappings.find((m: any) => m.accountId === fbAccId);

      if (!verifiedMap || Number(verifiedMap.storeId) !== testStoreId) {
        throw new Error(`CRITICAL: Mapping readback failed or storeId mismatch: ${JSON.stringify(verifiedMap)}`);
      }
      console.log(`✅ Mapping test passed with storeId.`);
    } else {
      console.log("ℹ️ SKIPPED_NO_ACCOUNT: No AdAccounts in DB to run mapping batch tests.");
    }

    // 11. Cleanup test store
    console.log(`🧹 Cleaning up test store ID: ${testStoreId}...`);
    if (firstAdAccount) {
      await prisma.adAccount.update({
        where: { fb_account_id: firstAdAccount.fb_account_id },
        data: { storeId: null }
      });
      await prisma.accountMapping.deleteMany({
        where: { fbAccountId: firstAdAccount.fb_account_id }
      });
    }
    await prisma.store.delete({ where: { id: testStoreId } });
    console.log("✅ Cleanup complete.");

    console.log("\n🎉 ALL SMOKE TESTS PASSED SUCCESSFULLY! ✅\n");
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ SMOKE TEST FAILED! ❌\n");
    console.error(error);
    process.exit(1);
  }
}

runSmoke();
