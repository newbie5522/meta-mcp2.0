import prisma from "../db/index.js";
import dayjs from "dayjs";

async function main() {
  try {
    const startStr = "2026-05-13";
    const endStr = "2026-06-11";

    const accountsWithStore = await prisma.adAccount.findMany({
      include: { store: true }
    });

    const rawInsights = await prisma.adInsight.findMany({
      where: {
        date: { gte: startStr, lte: endStr }
      }
    });

    console.log("MATCH_AUDIT_START");
    console.log("Total accounts in DB:", accountsWithStore.length);
    console.log("Total Insights in this period:", rawInsights.length);

    let matchCount = 0;
    const matchedAccountIds: string[] = [];

    accountsWithStore.forEach((acc) => {
      const accIdClean = acc.fb_account_id.replace(/^act_/, "").trim();
      const matched = rawInsights.filter(ins => {
        const insIdClean = ins.accountId.replace(/^act_/, "").trim();
        return insIdClean === accIdClean;
      });

      const spend = matched.reduce((sum, item) => sum + (item.spend || 0), 0);
      if (matched.length > 0) {
        matchCount++;
        matchedAccountIds.push(acc.fb_account_id);
        console.log(`Matched Account ${acc.fb_account_id} ("${acc.fb_account_name}"): ${matched.length} insights, spend: ${spend}`);
      }
    });

    console.log("Matched Accounts Total:", matchCount);
    console.log("MATCH_AUDIT_END");

  } catch (error) {
    console.error("Match audit error:", error);
  }
}

main();
