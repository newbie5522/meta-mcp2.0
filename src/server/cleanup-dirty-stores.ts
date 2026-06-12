import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanData() {
  console.log("=== START DATABASE CLEANUP ===");

  // Fetch all AccountMappings
  const mappings = await prisma.accountMapping.findMany();
  console.log(`Total AccountMapping records: ${mappings.length}`);

  // Create a map of fbAccountId -> storeId
  const mappingMap = new Map<string, number | null>();
  mappings.forEach(m => {
    if (m.fbAccountId) {
      mappingMap.set(m.fbAccountId, m.storeId);
    }
  });

  // Fetch all AdAccounts
  const adAccounts = await prisma.adAccount.findMany();
  console.log(`Total AdAccounts: ${adAccounts.length}`);

  let updatedCount = 0;
  for (const ac of adAccounts) {
    const correctStoreId = mappingMap.get(ac.fb_account_id) || null;
    if (ac.storeId !== correctStoreId) {
      await prisma.adAccount.update({
        where: { fb_account_id: ac.fb_account_id },
        data: { storeId: correctStoreId }
      });
      updatedCount++;
    }
  }

  console.log(`Successfully reset and aligned storeId for ${updatedCount} AdAccounts in the database!`);

  // Verify Romanticed (storeId = 3)
  const romanticedStoreId = 3;
  const mapCount = await prisma.accountMapping.count({ where: { storeId: romanticedStoreId } });
  const adAccCount = await prisma.adAccount.count({ where: { storeId: romanticedStoreId } });

  console.log(`Verification - Store Romanticed mapping:`);
  console.log(` - AccountMapping count: ${mapCount}`);
  console.log(` - AdAccount mapped count: ${adAccCount}`);

  console.log("=== DATABASE CLEANUP COMPLETED ===");
  await prisma.$disconnect();
}

cleanData().catch(console.error);
