import axios from "axios";

async function main() {
  console.log("=== TRIGGERING HTTP REBUILD ===");

  const payload = {
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    includeMetaAccounts: true,
    includeMetaStructure: true,
    includeMetaRawFacts: true,
    includeMetaLedger: true,
    includeAudience: true,
    includeStoreOrders: true,
    includeStoreLedger: true,
    rebuildStoreOrders: false
  };

  try {
    console.log("Sending POST to http://127.0.0.1:3000/api/data-center/rebuild...");
    const rebuildRes = await axios.post("http://127.0.0.1:3000/api/data-center/rebuild", payload, {
      timeout: 30000
    });
    console.log("\n--- REBUILD RESPONSE ---");
    console.log(JSON.stringify(rebuildRes.data, null, 2));
  } catch (err: any) {
    console.error("Failed to POST rebuild:", err.response?.data || err.message);
  }

  try {
    console.log("\nSending GET to http://127.0.0.1:3000/api/data-center/accounts-performance?startDate=2026-06-01&endDate=2026-06-30&storeId=all...");
    const performanceRes = await axios.get("http://127.0.0.1:3000/api/data-center/accounts-performance?startDate=2026-06-01&endDate=2026-06-30&storeId=all");
    console.log("\n--- PERFORMANCE RESPONSE ---");
    
    const data = performanceRes.data;
    console.log(JSON.stringify({
      source: data.source || "None",
      mode: data.mode || "None",
      accounts_length: Array.isArray(data.accounts) ? data.accounts.length : (data.length || 0),
      accountsWithSpendCount: Array.isArray(data.accounts) ? data.accounts.filter((a: any) => (a.spend || 0) > 0).length : 0,
      totalSpend: Array.isArray(data.accounts) ? data.accounts.reduce((sum: number, a: any) => sum + (a.spend || 0), 0) : 0,
      metaFreshness: data.metaFreshness || "None",
      health: data.health || "None",
      summary: data.summary || "None"
    }, null, 2));
  } catch (err: any) {
    console.error("Failed to GET accounts-performance:", err.response?.data || err.message);
  }

  try {
    console.log("\nSending GET to http://127.0.0.1:3000/api/data-center/audit?startDate=2026-06-01&endDate=2026-06-30...");
    const auditRes = await axios.get("http://127.0.0.1:3000/api/data-center/audit?startDate=2026-06-01&endDate=2026-06-30");
    console.log("\n--- AUDIT RESPONSE ---");
    const audit = auditRes.data;
    console.log(JSON.stringify({
      diagnosis: {
        status: audit.diagnosis?.status,
        blockers: audit.diagnosis?.blockers,
        warnings: audit.diagnosis?.warnings,
        nextActions: audit.diagnosis?.nextActions
      },
      meta: {
        factMetaPerformance: {
          rows: audit.meta?.factMetaPerformance?.rows,
          spend: audit.meta?.factMetaPerformance?.spend
        },
        dataCenterMetaAccountDaily: {
          rows: audit.meta?.dataCenterMetaAccountDaily?.rows,
          spend: audit.meta?.dataCenterMetaAccountDaily?.spend
        }
      },
      store: {
        order: {
          rows: audit.store?.order?.rows,
          uniqueOrders: audit.store?.order?.uniqueOrders
        },
        dataCenterStoreDaily: {
          rows: audit.store?.dataCenterStoreDaily?.rows,
          grossSales: audit.store?.dataCenterStoreDaily?.grossSales
        }
      }
    }, null, 2));
  } catch (err: any) {
    console.error("Failed to GET audit:", err.response?.data || err.message);
  }
}

main().catch(console.error);
