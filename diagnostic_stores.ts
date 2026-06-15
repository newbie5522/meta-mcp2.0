import prisma from "./src/db/index.js";

async function main() {
  const stores = await prisma.store.findMany();
  console.log("--- All Stores in DB ---");
  for (const s of stores) {
    console.log(`Store ID: ${s.id}, Name: ${s.name}, Domain: ${s.domain}, Mode: ${s.mode}, Platform: ${s.platform}`);
  }
}

main().catch(console.error);
