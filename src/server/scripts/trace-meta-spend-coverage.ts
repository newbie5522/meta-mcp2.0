import prisma from "../../db/index.js";
import { getMetaToken } from "../utils.js";
import axios from "axios";

async function main() {
  console.log("=================== TRACE META SPEND COVERAGE ===================");

  // 1. Get token
  const token = await getMetaToken();
  if (!token) {
    console.error("No Meta Token found in settings.");
    process.exit(1);
  }

  const maskedToken = `${token.slice(0, 4)}...${token.slice(-4)}`;
  console.log(`Using Meta Token: ${maskedToken} (length: ${token.length})`);

  // 2. Fetch all accounts from database
  const allAccounts = await prisma.adAccount.findMany();
  console.log(`Loaded ${allAccounts.length} total accounts from DB.`);

  // 3. Group accounts
  const boundAccounts = allAccounts.filter(a => a.storeId !== null);
  const unboundRecentAccounts = allAccounts.filter(a => a.storeId === null && a.recentActivity90d === true);
  const unboundOtherAccounts = allAccounts.filter(a => a.storeId === null && a.recentActivity90d !== true);

  console.log(`Grouping Summary:\n` +
              `- Bound Accounts: ${boundAccounts.length}\n` +
              `- Unbound Recent Accounts (90d): ${unboundRecentAccounts.length}\n` +
              `- Unbound Other Accounts: ${unboundOtherAccounts.length}\n`);

  // 4. Sample up to 10 accounts from each group
  const sampleBound = boundAccounts.slice(0, 10);
  const sampleUnboundRecent = unboundRecentAccounts.slice(0, 10);
  const sampleUnboundOther = unboundOtherAccounts.slice(0, 10);

  const startDate = "2026-05-24";
  const endDate = "2026-06-22";
  console.log(`Target Date Range: ${startDate} to ${endDate}\n`);

  const groups = [
    { name: "Group A: Bound Accounts", sample: sampleBound },
    { name: "Group B: Unbound Recent Accounts", sample: sampleUnboundRecent },
    { name: "Group C: Unbound Other Accounts", sample: sampleUnboundOther }
  ];

  for (const group of groups) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Running Trace for ${group.name} (Sample size: ${group.sample.length})`);
    console.log(`--------------------------------------------------`);

    let totalFetchedRows = 0;
    let accountsWithSpendCount = 0;
    let totalSpendInGroup = 0;
    const sampledAccountsInfo: any[] = [];
    const accountsSpends: { id: string; name: string; spend: number }[] = [];

    for (const acc of group.sample) {
      const actId = acc.fb_account_id;
      const cleanActId = actId.replace("act_", "");
      const url = `https://graph.facebook.com/v19.0/act_${cleanActId}/insights`;
      const params = {
        level: "account",
        time_increment: "1",
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        fields: "account_id,account_name,date_start,spend,impressions,clicks,actions,action_values,purchase_roas",
        access_token: token,
        limit: "500"
      };

      try {
        const res = await axios.get(url, { params, timeout: 10000 });
        const data = res.data?.data || [];
        totalFetchedRows += data.length;

        let accSpend = 0;
        data.forEach((row: any) => {
          accSpend += parseFloat(row.spend || "0");
        });

        if (accSpend > 0) {
          accountsWithSpendCount++;
          totalSpendInGroup += accSpend;
          accountsSpends.push({ id: actId, name: acc.fb_account_name || "Unknown", spend: accSpend });
        }

        sampledAccountsInfo.push({
          id: actId,
          name: acc.fb_account_name,
          apiRowsCount: data.length,
          spend: accSpend,
          status: "SUCCESS"
        });

      } catch (err: any) {
        const fbError = err.response?.data?.error || {};
        sampledAccountsInfo.push({
          id: actId,
          name: acc.fb_account_name,
          apiRowsCount: 0,
          spend: 0,
          status: "ERROR",
          error: {
            status: err.response?.status,
            code: fbError.code,
            subcode: fbError.error_subcode,
            message: fbError.message || err.message,
            fbtrace_id: fbError.fbtrace_id
          }
        });
      }
    }

    console.log(`Group Summary Results:`);
    console.log(`- Sampled accounts: ${group.sample.length}`);
    console.log(`- API rows fetched across group: ${totalFetchedRows}`);
    console.log(`- Accounts with spend: ${accountsWithSpendCount}`);
    console.log(`- Total spend in sample: ${totalSpendInGroup.toFixed(2)}`);
    console.log(`- Top accounts by spend in sample:`);
    accountsSpends.sort((a, b) => b.spend - a.spend);
    accountsSpends.slice(0, 5).forEach(item => {
      console.log(`  * ${item.id} (${item.name}): $${item.spend.toFixed(2)}`);
    });

    console.log(`- Details per sampled account in group:`);
    sampledAccountsInfo.forEach(info => {
      if (info.status === "SUCCESS") {
        console.log(`  * ${info.id} | Name: ${info.name} | Status: Success | Rows: ${info.apiRowsCount} | Spend: $${info.spend.toFixed(2)}`);
      } else {
        console.log(`  * ${info.id} | Name: ${info.name} | Status: Error | Code: ${info.error.code} | Msg: ${info.error.message}`);
      }
    });
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
