import axios from "axios";

const BASE_URL = "http://localhost:3000/api/ai/deep-diagnosis/context";

async function runTest(name: string, payload: any) {
  console.log(`\n======================================================`);
  console.log(`TEST: ${name}`);
  console.log(`Payload:`, JSON.stringify(payload, null, 2));
  console.log(`======================================================`);
  try {
    const res = await axios.post(BASE_URL, payload);
    console.log(`STATUS: ${res.status}`);
    console.log(`RESPONSE:`, JSON.stringify(res.data, null, 2));
    return { success: true, data: res.data };
  } catch (err: any) {
    console.log(`STATUS: ${err.response?.status}`);
    console.log(`ERROR:`, JSON.stringify(err.response?.data || err.message, null, 2));
    return { success: false, data: err.response?.data };
  }
}

async function main() {
  console.log("🚀 Starting AI Deep Diagnosis Context Smoke Tests...");

  // Test A: Missing mode
  await runTest("A. Missing mode parameter", {
    scope: { storeId: "1" },
    startDate: "2026-05-01",
    endDate: "2026-05-15"
  });

  // Test B: startDate after endDate
  await runTest("B. Date Range Inversion (startDate > endDate)", {
    mode: "account_overview",
    scope: { adAccountId: "act_12345678" },
    startDate: "2026-05-15",
    endDate: "2026-05-01"
  });

  // Test C: account_overview success test
  await runTest("C. account_overview success", {
    mode: "account_overview",
    scope: { adAccountId: "act_12345678" },
    startDate: "2026-05-01",
    endDate: "2026-05-15"
  });

  // Test D: store_overview success test
  await runTest("D. store_overview success", {
    mode: "store_overview",
    scope: { storeId: "1" },
    startDate: "2026-05-01",
    endDate: "2026-05-15"
  });

  // Test E: creative_fatigue success test
  await runTest("E. creative_fatigue success", {
    mode: "creative_fatigue",
    scope: { storeId: "1", adAccountId: "act_12345678" },
    startDate: "2026-05-01",
    endDate: "2026-05-15"
  });

  console.log("\n🏁 Done with Smoke Tests!");
}

main().catch(console.error);
