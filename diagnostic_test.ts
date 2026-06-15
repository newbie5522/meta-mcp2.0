import prisma from "./src/db/index.js";

async function main() {
  console.log("--- Performance Rows (2026-05-16 to 2026-06-14) ---");
  const rows = await prisma.factMetaPerformance.findMany({
    where: {
      level: "account",
      date: {
        gte: "2026-05-16",
        lte: "2026-06-14"
      }
    }
  });
  console.log(`Found ${rows.length} rows.`);
  for (const r of rows) {
    console.log(`Row: Date: ${r.date}, AccountID: ${r.account_id}, Spend: ${r.spend}, Purchases: ${r.purchases}, PurchaseValue: ${r.purchase_value}`);
  }

  console.log("--- All AdAccounts in DB ---");
  const accs = await prisma.adAccount.findMany();
  for (const a of accs) {
    console.log(`AdAccount: ID: ${a.id}, FB_ID: ${a.fb_account_id}, Name: ${a.fb_account_name}, ActivityStatus: ${a.activityStatus}`);
  }

  console.log("--- All AccountMappings in DB ---");
  const mappings = await prisma.accountMapping.findMany();
  for (const m of mappings) {
    console.log(`Mapping: ID: ${m.id}, FB_ID: ${m.fbAccountId}, Name: ${m.name}, StoreID: ${m.storeId}`);
  }
}

main().catch(console.error);
