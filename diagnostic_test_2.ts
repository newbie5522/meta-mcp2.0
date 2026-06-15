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

  const aggMap = new Map<string, any>();
  for (const r of rows) {
    if (!r.account_id) continue;
    if (!aggMap.has(r.account_id)) {
      aggMap.set(r.account_id, { spend: 0, purchases: 0, value: 0 });
    }
    const o = aggMap.get(r.account_id);
    o.spend += r.spend || 0;
    o.purchases += r.purchases || 0;
    o.value += r.purchase_value || 0;
  }

  console.log("--- Aggregated Spend by Account ---");
  for (const [accId, data] of aggMap.entries()) {
    const adAcc = await prisma.adAccount.findFirst({
      where: {
        fb_account_id: accId
      }
    });

    const mapping = await prisma.accountMapping.findFirst({
      where: {
        fbAccountId: accId
      }
    });

    console.log(`AccountID: ${accId}`);
    console.log(`  AdAccount in DB? ${adAcc ? 'YES (name: ' + adAcc.fb_account_name + ')' : 'NO'}`);
    console.log(`  Mapping in DB? ${mapping ? 'YES (storeId: ' + mapping.storeId + ')' : 'NO'}`);
    console.log(`  Metrics in Range: Spend: $${data.spend.toFixed(2)}, Purchases: ${data.purchases}, PurchaseValue: $${data.value.toFixed(2)}`);
  }
}

main().catch(console.error);
