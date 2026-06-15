import { PrismaClient } from "@prisma/client";
import path from "path";

async function main() {
  console.log("=== Testing dev.db ===");
  const prisma1 = new PrismaClient();
  try {
    const storesCount = await prisma1.store.count();
    console.log(`dev.db Stores Count: ${storesCount}`);
  } catch (err: any) {
    console.error("dev.db Prisma Count failed:", err.message || err);
  } finally {
    await prisma1.$disconnect();
  }

  console.log("\n=== Testing dev.db.legacy ===");
  const legacyUrl = `file:${path.resolve("prisma/dev.db.legacy")}`;
  console.log(`Legacy DB URL: ${legacyUrl}`);
  const prisma2 = new PrismaClient({
    datasources: {
      db: {
        url: legacyUrl
      }
    }
  });
  try {
    const storesCount = await prisma2.store.count();
    console.log(`dev.db.legacy Stores Count: ${storesCount}`);
  } catch (err: any) {
    console.error("dev.db.legacy Prisma Count failed:", err.message || err);
  } finally {
    await prisma2.$disconnect();
  }
}

main();
