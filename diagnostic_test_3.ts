process.env.DATABASE_URL = "file:/app/applet/prisma/dev.db";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: { url: "file:/app/applet/prisma/dev.db" }
  }
});

async function main() {
  console.log("=== START DATABASE EXPLORATION ===");
  try {
    // 1. Stores
    const stores = await prisma.store.findMany({ take: 5 });
    console.log("Stores count:", await prisma.store.count());
    console.log("Stores samples:", stores.map(s => ({ id: s.id, name: s.name, createdAt: s.createdAt })));

    // 2. AdAccounts
    const adAccounts = await prisma.adAccount.findMany({ take: 5 });
    console.log("AdAccounts count:", await prisma.adAccount.count());
    console.log("AdAccounts samples:", adAccounts.map(a => ({ id: a.id, name: a.name })));

    // 3. Campaigns
    const campaigns = await prisma.campaign.findMany({ take: 5 });
    console.log("Campaigns count:", await prisma.campaign.count());
    console.log("Campaigns samples:", campaigns.map(c => ({ id: c.id, name: c.name, adAccountId: c.adAccountId })));

    // 4. AdSets
    const adSets = await prisma.adSet.findMany({ take: 5 });
    console.log("AdSets count:", await prisma.adSet.count());
    console.log("AdSets samples:", adSets.map(a => ({ id: a.id, name: a.name, campaignId: a.campaignId })));

    // 5. Ads
    const ads = await prisma.ad.findMany({ take: 5 });
    console.log("Ads count:", await prisma.ad.count());
    console.log("Ads samples:", ads.map(a => ({ id: a.id, name: a.name, adSetId: a.adSetId })));

    // 6. Creatives
    const creatives = await prisma.metaCreative.findMany({ take: 5 });
    console.log("Creatives count:", await prisma.metaCreative.count());
    console.log("Creatives samples:", creatives.map(c => ({ id: c.id, name: c.name })));

    // 7. Orders count and date range
    const orderCount = await prisma.order.count();
    console.log("Orders count:", orderCount);
    if (orderCount > 0) {
      const firstOrder = await prisma.order.findFirst({ orderBy: { createdAt: "asc" } });
      const lastOrder = await prisma.order.findFirst({ orderBy: { createdAt: "desc" } });
      console.log("Orders date range:", firstOrder?.createdAt, "to", lastOrder?.createdAt);
    }

    // 8. Meta performance (Insights / Ad Performance / Creative Daily)
    // Let's check model names in prisma schema by querying counts or checking properties
    // We can do dynamic checks on the schema/prisma models
    const models = Object.keys(prisma).filter(k => !k.startsWith("_") && !k.startsWith("$"));
    console.log("Prisma models list:", models);

    // Let's try checking some key performance schema counts
    for (const m of ["metaInsight", "creativeInsight", "adInsight", "creativePerformanceDaily", "metaInsightDaily", "metaAdPerformance", "ruleIssue"]) {
      if ((prisma as any)[m]) {
        try {
          const cnt = await (prisma as any)[m].count();
          console.log(`Model ${m} count:`, cnt);
          if (cnt > 0) {
            const first = await (prisma as any)[m].findFirst();
            console.log(`Model ${m} sample keys:`, Object.keys(first));
          }
        } catch (e: any) {
          console.log(`Model ${m} error or not found:`, e.message);
        }
      } else {
        console.log(`Model ${m} not found on prisma client.`);
      }
    }

  } catch (err: any) {
    console.error("Exploration error:", err);
  } finally {
    await prisma.$disconnect();
    console.log("=== END DATABASE EXPLORATION ===");
  }
}

main();
