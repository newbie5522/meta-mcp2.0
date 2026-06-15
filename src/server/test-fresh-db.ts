import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

async function main() {
  const freshDbPath = path.resolve("prisma/test-fresh.db");
  console.log(`Fresh DB file path: ${freshDbPath}`);

  if (fs.existsSync(freshDbPath)) {
    fs.unlinkSync(freshDbPath);
    console.log("Deleted old test-fresh.db");
  }

  // Create an empty file
  fs.writeFileSync(freshDbPath, "");

  const url = `file:${freshDbPath}`;
  console.log(`Initializing Prisma target URL: ${url}`);
  const prisma = new PrismaClient({
    datasources: {
      db: { url }
    }
  });

  try {
    console.log("Running prisma.$connect()...");
    await prisma.$connect();
    console.log("Connection successful!");

    // Let's see if we can do a push on this fresh database
    console.log("Successfully connected. Fresh DB is empty, testing schema push on it next...");
  } catch (err: any) {
    console.error("Connection failed on fresh empty file:", err.message || err);
  } finally {
    await prisma.$disconnect();
    if (fs.existsSync(freshDbPath)) {
      fs.unlinkSync(freshDbPath);
      console.log("Deleted test-fresh.db");
    }
  }
}

main();
