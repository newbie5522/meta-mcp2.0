import prisma from "./src/db/index.js";

async function main() {
  console.log("--- Scanning and Deleting Demo Store / Account Data ---");

  // 1. Find stores to delete
  const stores = await prisma.store.findMany();
  let deletedStoresCount = 0;
  for (const s of stores) {
    const nameMatch = s.name && (s.name.includes("Shopline Fashion Store") || s.name.toLowerCase().includes("demo") || s.name.toLowerCase().includes("seed"));
    const domainMatch = s.domain && (s.domain.includes("fashion.shoplineapp.com") || s.domain.toLowerCase().includes("demo") || s.domain.toLowerCase().includes("seed"));
    const modeMatch = s.mode && (s.mode.toLowerCase().includes("demo") || s.mode.toLowerCase().includes("seed"));
    
    if (nameMatch || domainMatch || modeMatch) {
      console.log(`Deleting Store: ID: ${s.id}, Name: ${s.name}, Domain: ${s.domain}`);
      // Find related ad accounts or mappings to delete
      await prisma.adAccount.deleteMany({ where: { storeId: s.id } });
      await prisma.accountMapping.deleteMany({ where: { storeId: s.id } });
      await prisma.store.delete({ where: { id: s.id } });
      deletedStoresCount++;
    }
  }

  // 2. Clear any ad accounts containing "sandbox" or "test" or similar
  const adAccs = await prisma.adAccount.findMany();
  let deletedAccsCount = 0;
  const sandboxIds = ["act_439281903", "act_583920194", "act_204928103"];
  for (const a of adAccs) {
    const isSandboxId = sandboxIds.includes(a.fb_account_id);
    const hasDemoName = a.fb_account_name && (a.fb_account_name.toLowerCase().includes("demo") || a.fb_account_name.toLowerCase().includes("sandbox") || a.fb_account_name.toLowerCase().includes("seed"));
    if (isSandboxId || hasDemoName) {
      console.log(`Deleting AdAccount: FB_ID: ${a.fb_account_id}, Name: ${a.fb_account_name}`);
      await prisma.adAccount.delete({ where: { id: a.id } });
      deletedAccsCount++;
    }
  }

  console.log(`Cleanup completed! Deleted ${deletedStoresCount} stores and ${deletedAccsCount} ad accounts.`);
}

main().catch(console.error);
