import prisma from "../../db/index.js";

async function main() {
  console.log("[Clean-up] Querying database for non-canonical FactMetaPerformance records...");

  // 1. Delete all level=account records where account_id do not start with 'act_'
  const result = await prisma.factMetaPerformance.deleteMany({
    where: {
      OR: [
        {
          account_id: {
            not: {
              startsWith: "act_"
            }
          }
        },
        {
          entity_id: {
            not: {
              startsWith: "act_"
            }
          },
          level: "account"
        }
      ]
    }
  });

  console.log(`[Clean-up] Deleted ${result.count} non-canonical (numeric) FactMetaPerformance records.`);

  // 2. Perform a sanity check on outstanding rows
  const remainingCount = await prisma.factMetaPerformance.count();
  const nonCanonicalCount = await prisma.factMetaPerformance.count({
    where: {
      account_id: {
        not: {
          startsWith: "act_"
        }
      }
    }
  });

  console.log(`[Clean-up] Sanity Check: ${remainingCount} total rows remaining, ${nonCanonicalCount} non-canonical records.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
