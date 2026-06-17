import { runDataPipelineAudit } from "../services/data-pipeline-audit.service.js";
import dayjs from "dayjs";

async function main() {
  const startDate = dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const endDate = dayjs().format("YYYY-MM-DD");

  console.log(`[Audit Data Pipeline] Launching SOT Audit from ${startDate} to ${endDate}...`);
  try {
    const report = await runDataPipelineAudit({ startDate, endDate });
    console.log("\n=================== SOT AUDIT REPORT ===================");
    console.log(`Audit Status: ${report.status}`);
    console.log(`Calculated At: ${new Date().toISOString()}`);
    console.log(`Date Range Checked: ${report.dateRange.startDate} to ${report.dateRange.endDate}`);
    
    console.log("\nSummary Metrics & Counts:");
    console.log(`- Stores Count: ${report.counts.storesTotal}`);
    console.log(`- Orders by store_local_date: ${report.counts.ordersByStoreLocalDate}`);
    console.log(`- Orders missing store_local_date: ${report.counts.ordersMissingStoreLocalDate}`);
    console.log(`- Legacy Fallback (createdAt) Used Count: ${report.counts.legacyCreatedAtFallbackOrders}`);
    console.log(`- Inventory Total Ad Accounts: ${report.counts.adAccountsInventoryTotal}`);
    console.log(`- Active Spend Accounts in Range: ${report.counts.spendAccountsInRange}`);
    console.log(`- Unmapped Spend Accounts in Range (Alert): ${report.counts.unmappedSpendAccountsInRange}`);

    if (report.violations.length > 0) {
      console.log(`\nViolations Detected (${report.violations.length}):`);
      report.violations.forEach((v, idx) => {
        console.log(`  ${idx + 1}. [VIOLATION] ${v}`);
      });
    } else {
      console.log("\n[✓] Excellent! No SOT data pipeline violations detected.");
    }

    if (report.warnings.length > 0) {
      console.log(`\nWarnings & Observations (${report.warnings.length}):`);
      report.warnings.forEach((w, idx) => {
        console.log(`  ${idx + 1}. [WARNING] ${w}`);
      });
    }
    console.log("\n========================================================\n");
  } catch (err: any) {
    console.error("Failed to execute data pipeline audit runner:", err);
    process.exit(1);
  }
}

main();
