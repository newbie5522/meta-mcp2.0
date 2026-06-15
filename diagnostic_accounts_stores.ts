import prisma from "./src/db/index.js";

async function main() {
  const rows = await prisma.factMetaPerformance.findMany({
    where: {
      level: "account",
      date: {
        gte: "2026-05-16",
        lte: "2026-06-14"
      }
    }
  });

  const aggMap = new Map<string, number>();
  for (const r of rows) {
    if (!r.account_id) continue;
    aggMap.set(r.account_id, (aggMap.get(r.account_id) || 0) + (r.spend || 0));
  }

  console.log("--- Account Spend & Store Details ---");
  for (const [accId, spend] of aggMap.entries()) {
    const adAcc = await prisma.adAccount.findFirst({
      where: { fb_account_id: accId },
      include: { store: true }
    });
    
    const mapping = await prisma.accountMapping.findFirst({
      where: { fbAccountId: accId },
      include: { store: true }
    });

    console.log(`Account: ${accId} | Spend: $${spend.toFixed(2)}`);
    if (adAcc) {
      console.log(`  AdAccount Name: ${adAcc.fb_account_name}`);
      console.log(`  AdAccount Store: ID: ${adAcc.store?.id}, Name: ${adAcc.store?.name}, Mode: ${adAcc.store?.mode}`);
    } else {
      console.log("  No AdAccount in DB");
    }
    if (mapping) {
      console.log(`  Mapping Store: ID: ${mapping.store?.id}, Name: ${mapping.store?.name}, Mode: ${mapping.store?.mode}`);
    } else {
      console.log("  No Mapping in DB");
    }
  }
}

main().catch(console.error);
