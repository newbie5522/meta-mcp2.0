import prisma from "../../db/index.js";
import { getMetaToken } from "../utils.js";
import axios from "axios";
import dayjs from "dayjs";

async function main() {
  console.log("=================== TRACE META API READ ===================");

  // 1. Get token
  const token = await getMetaToken();
  if (!token) {
    console.error("No Meta Token found in settings.");
    process.exit(1);
  }

  const maskedToken = `${token.slice(0, 4)}...${token.slice(-4)}`;
  console.log(`Using Meta Token: ${maskedToken} (length: ${token.length})`);

  // 2. Sample 5 AdAccounts
  let accounts = await prisma.adAccount.findMany({
    where: { recentActivity90d: true },
    take: 5
  });

  if (accounts.length === 0) {
    console.log("No recentActivity90d=true accounts, taking top 5 newest accounts instead...");
    accounts = await prisma.adAccount.findMany({
      orderBy: { updatedAt: "desc" },
      take: 5
    });
  }

  console.log(`Sampled ${accounts.length} accounts to test:`);
  for (const acc of accounts) {
    console.log(`- Account ID: ${acc.fb_account_id} | Name: ${acc.fb_account_name} | RecentActive: ${acc.recentActivity90d}`);
  }

  const startDate = dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const endDate = dayjs().format("YYYY-MM-DD");
  console.log(`Testing range: ${startDate} to ${endDate}`);

  for (const acc of accounts) {
    const actId = acc.fb_account_id;
    const cleanActId = actId.replace("act_", "");
    
    console.log(`\nTesting account: act_${cleanActId}`);

    const url = `https://graph.facebook.com/v19.0/act_${cleanActId}/insights`;
    const params = {
      level: "account",
      time_increment: "1",
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      fields: "account_id,account_name,date_start,spend,impressions,clicks,actions,action_values,purchase_roas",
      access_token: token,
      limit: "5"
    };

    try {
      const res = await axios.get(url, { params });
      console.log(`  HTTP status: ${res.status}`);
      const data = res.data?.data || [];
      console.log(`  Rows returned: ${data.length}`);

      let totalSpend = 0;
      data.forEach((row: any) => {
        totalSpend += parseFloat(row.spend || "0");
      });
      console.log(`  Total Spend in range: ${totalSpend.toFixed(2)}`);

      if (data.length > 0) {
        const firstRow = data[0];
        console.log(`  First row sample:`, {
          account_id: firstRow.account_id,
          account_name: firstRow.account_name,
          date_start: firstRow.date_start,
          spend: firstRow.spend,
          impressions: firstRow.impressions,
          clicks: firstRow.clicks,
          purchase_roas_length: firstRow.purchase_roas?.length || 0
        });
      }
    } catch (err: any) {
      const fbError = err.response?.data?.error || {};
      console.log(`  HTTP status: ${err.response?.status || err.code}`);
      console.log(`  Error code: ${fbError.code || "unknown"}`);
      console.log(`  Error subcode: ${fbError.error_subcode || "unknown"}`);
      console.log(`  Error message: ${fbError.message || err.message}`);
      console.log(`  fbtrace_id: ${fbError.fbtrace_id || "unknown"}`);
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
