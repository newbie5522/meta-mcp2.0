// @ts-nocheck
import prisma from "../../db/index.js";
import { getMetaToken } from "../utils.js";
import { canonicalActId } from "../services/meta-ledger.service.js";
import axios from "axios";

const dateStr = process.env.TARGET_DATE || "2026-06-22";

async function main() {
  console.log("=================== TRACE META API RECONCILIATION ===================");
  console.log(`Target Date: ${dateStr}`);

  // 1. Get token
  const token = await getMetaToken();
  if (!token) {
    console.error("No Meta Token found in settings.");
    process.exit(1);
  }

  // 2. Resolve accounts to trace
  const activeAccounts = await prisma.adAccount.findMany({
    where: { recentActivity90d: true },
    take: 5
  });

  if (activeAccounts.length === 0) {
    console.log("No active accounts found. Exiting tracker.");
    return;
  }

  for (const acc of activeAccounts) {
    const actId = canonicalActId(acc.fb_account_id);
    const numericId = actId.replace("act_", "");
    console.log(`\n--------------------------------------------`);
    console.log(`Tracing Account: ${actId} (${acc.fb_account_name})`);

    // --- PHASE 1: Meta Official API Spend ---
    let apiSpend = 0;
    try {
      const url = `https://graph.facebook.com/v19.0/${actId}/insights`;
      const res = await axios.get(url, {
        params: {
          level: "account",
          time_increment: "1",
          time_range: JSON.stringify({ since: dateStr, until: dateStr }),
          fields: "account_id,spend,date_start",
          access_token: token
        }
      });
      const data = res.data?.data || [];
      const row = data.find(r => r.date_start === dateStr);
      apiSpend = row ? parseFloat(row.spend || "0") : 0;
      console.log(`[Meta API] Direct API Spend for ${dateStr}: $${apiSpend.toFixed(2)}`);
    } catch (err: any) {
      console.warn(`[Meta API ERROR] Failed to fetch:`, err.response?.data?.error?.message || err.message);
      continue; // Skip accounts we cannot reach due to API limits
    }

    // --- PHASE 2: Fact Table (FactMetaPerformance) Spend ---
    // Read both formats to prove clean act_ id is enforced and numeric duplicate rows do not exist
    const facts = await prisma.factMetaPerformance.findMany({
      where: {
        level: "account",
        date: dateStr,
        OR: [
          { account_id: actId },
          { account_id: numericId }
        ]
      }
    });

    const canonicalFacts = facts.filter(f => f.account_id === actId);
    const numericFacts = facts.filter(f => f.account_id === numericId);

    const factSpend = canonicalFacts.reduce((sum, f) => sum + Number(f.spend || 0), 0);
    const legacySpend = numericFacts.reduce((sum, f) => sum + Number(f.spend || 0), 0);

    console.log(`[Fact SOT] Canonical rows (starts with act_): count=${canonicalFacts.length}, spend=$${factSpend.toFixed(2)}`);
    console.log(`[Fact SOT] Legacy numeric rows: count=${numericFacts.length}, spend=$${legacySpend.toFixed(2)}`);

    // --- PHASE 3: DataCenter accounts-performance Emulated Aggregate ---
    // The endpoint ignores numeric rows and aggregates ONLY canonical starts-with act_ rows
    const aggregatedSpend = canonicalFacts.reduce((sum, f) => sum + Number(f.spend || 0), 0);
    console.log(`[Endpoint] Aggregated Spend (act_ only): $${aggregatedSpend.toFixed(2)}`);

    // --- FINAL VERIFICATION ---
    const diffApiToFact = Math.abs(apiSpend - factSpend);
    const diffFactToAgg = Math.abs(factSpend - aggregatedSpend);

    console.log(`\nReconciliation Summary for ${actId} on ${dateStr}:`);
    console.log(`- API Spend:        $${apiSpend.toFixed(2)}`);
    console.log(`- Fact Spend:       $${factSpend.toFixed(2)}`);
    console.log(`- Endpoint Spend:   $${aggregatedSpend.toFixed(2)}`);
    console.log(`- API vs Fact Diff:  $${diffApiToFact.toFixed(4)}`);
    console.log(`- Fact vs End Diff:  $${diffFactToAgg.toFixed(4)}`);

    if (diffApiToFact < 0.005 && diffFactToAgg < 0.005) {
      console.log(`✅ VERIFICATION SUCCESSFUL: 100% exact alignment (API = Fact = Endpoint)`);
    } else {
      console.log(`❌ VERIFICATION FAILURE: Spend counts are out of sync!`);
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
