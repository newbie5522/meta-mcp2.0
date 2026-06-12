import prisma from "../db/index.js";
import dayjs from "dayjs";

async function verify() {
  console.log("📊 QUERYING FACT_META_PERFORMANCE FOR VERIFICATION...");

  // 1. Total count
  const totalRecords = await prisma.factMetaPerformance.count();

  // 2. Counts per level
  const levelAccountRecords = await prisma.factMetaPerformance.count({ where: { level: "account" } });
  const levelCampaignRecords = await prisma.factMetaPerformance.count({ where: { level: "campaign" } });
  const levelAdsetRecords = await prisma.factMetaPerformance.count({ where: { level: "adset" } });
  const levelAdRecords = await prisma.factMetaPerformance.count({ where: { level: "ad" } });

  // 3. Recently 7 days spend > 0 count.
  // Since our system relies on static historic records, we offset 7 days from the maximum actual date in the table OR from today (2026-06-11).
  // Let's use 2026-06-11 as today and calculate [2026-06-05, 2026-06-11] inclusive. Let's check both or run a dynamic range of last 7 days.
  const today = dayjs("2026-06-11");
  const sevenDaysAgo = today.subtract(6, "day").format("YYYY-MM-DD");
  const todayStr = today.format("YYYY-MM-DD");
  
  console.log(`Analyzing for date range [${sevenDaysAgo} to ${todayStr}] ...`);

  // Active accounts count in last 7 days with spend > 0
  const activeAccountsGroup = await prisma.factMetaPerformance.groupBy({
    by: ["account_id"],
    where: {
      level: "account",
      date: { gte: sevenDaysAgo, lte: todayStr },
      spend: { gt: 0 }
    }
  });
  const activeAccountsCount = activeAccountsGroup.length;

  // Active campaigns count in last 7 days with spend > 0
  const activeCampaignsGroup = await prisma.factMetaPerformance.groupBy({
    by: ["entity_id"],
    where: {
      level: "campaign",
      date: { gte: sevenDaysAgo, lte: todayStr },
      spend: { gt: 0 }
    }
  });
  const activeCampaignsCount = activeCampaignsGroup.length;

  // Active adsets count in last 7 days with spend > 0
  const activeAdsetsGroup = await prisma.factMetaPerformance.groupBy({
    by: ["entity_id"],
    where: {
      level: "adset",
      date: { gte: sevenDaysAgo, lte: todayStr },
      spend: { gt: 0 }
    }
  });
  const activeAdsetsCount = activeAdsetsGroup.length;

  // Active ads count in last 7 days with spend > 0
  const activeAdsGroup = await prisma.factMetaPerformance.groupBy({
    by: ["entity_id"],
    where: {
      level: "ad",
      date: { gte: sevenDaysAgo, lte: todayStr },
      spend: { gt: 0 }
    }
  });
  const activeAdsCount = activeAdsGroup.length;

  // 10. Check if any mock/sandbox/fallback accounts are in the table
  const sandboxAccounts = ["act_439281903", "act_583920194", "act_204928103"];
  const sandboxRecordsCount = await prisma.factMetaPerformance.count({
    where: {
      account_id: { in: sandboxAccounts }
    }
  });
  const hasMockOrSandboxData = sandboxRecordsCount > 0 ? "YES (Warning)" : "NO";

  console.log("\n=================== VERIFICATION REPORT ===================");
  console.log(`1. fact_meta_performance 总记录数: ${totalRecords}`);
  console.log(`2. level=account 记录数: ${levelAccountRecords}`);
  console.log(`3. level=campaign 记录数: ${levelCampaignRecords}`);
  console.log(`4. level=adset 记录数: ${levelAdsetRecords}`);
  console.log(`5. level=ad 记录数: ${levelAdRecords}`);
  console.log(`6. 最近 7 天 spend > 0 的账户数: ${activeAccountsCount}`);
  console.log(`7. 最近 7 天 spend > 0 的 campaign 数: ${activeCampaignsCount}`);
  console.log(`8. 最近 7 天 spend > 0 的 adset 数: ${activeAdsetsCount}`);
  console.log(`9. 最近 7 天 spend > 0 的 ad 数: ${activeAdsCount}`);
  console.log(`10. 是否存在 mock / sandbox / fallback 数据进入事实表: ${hasMockOrSandboxData} (Sandbox records found: ${sandboxRecordsCount})`);
  console.log("===========================================================\n");
}

verify().catch(console.error);
