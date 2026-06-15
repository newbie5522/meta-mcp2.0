import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

async function main() {
  const targetDbPath = path.resolve("src/prisma/dev.db");

  console.log("=== src/prisma/dev.db File Check ===");
  if (fs.existsSync(targetDbPath)) {
    const stat = fs.statSync(targetDbPath);
    console.log(`src/prisma/dev.db size: ${stat.size} bytes`);

    const url = `file:${targetDbPath}`;
    console.log(`Testing Prisma against: ${url}`);
    const prisma = new PrismaClient({
      datasources: {
        db: { url }
      }
    });

    try {
      const storesCount = await prisma.store.count();
      console.log(`Prisma Count on src/prisma/dev.db succeeded! Stores Count: ${storesCount}`);
    } catch (err: any) {
      console.error("Prisma check failed:", err.message || err);
    } finally {
      await prisma.$disconnect();
    }
  } else {
    console.log("src/prisma/dev.db does not exist!");
  }
}

main();
