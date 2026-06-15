import prisma from "../db/index.js";

async function runMigration() {
  console.log("🚀 Starting migration of AdInsight real data to fact_meta_performance...");

  // Load all AdAccounts to map currencies and sandbox flags
  const adAccounts = await prisma.adAccount.findMany({
    include: { store: true }
  });
  const currencyMap = new Map<string, string>();
  const sandboxAccountSet = new Set<string>();
  for (const acc of adAccounts) {
    if (acc.fb_account_id) {
      currencyMap.set(acc.fb_account_id, acc.currency || "USD");
      if (acc.store?.mode === "sandbox") {
        sandboxAccountSet.add(acc.fb_account_id);
      }
    }
  }

  // Load all Ads to map creativeIds
  const ads = await prisma.ad.findMany();
  const creativeMap = new Map<string, string>();
  for (const ad of ads) {
    if (ad.id && ad.creativeId) {
      creativeMap.set(ad.id, ad.creativeId);
    }
  }

  // Fetch all existing AdInsight records
  const rawInsights = await prisma.adInsight.findMany();
  console.log(`Found ${rawInsights.length} records in AdInsight.`);

  let migratedCount = 0;
  let skippedCount = 0;

  const batchSize = 100;
  for (let i = 0; i < rawInsights.length; i += batchSize) {
    const batch = rawInsights.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (row) => {
        // Determine entity_id based on level
        let entity_id = "";
        if (row.level === "account") {
          entity_id = row.accountId;
        } else if (row.level === "campaign") {
          entity_id = row.campaignId;
        } else if (row.level === "adset") {
          entity_id = row.adsetId;
        } else if (row.level === "ad") {
          entity_id = row.adId;
        }

        if (!entity_id || !row.level) {
          console.warn(`[Skip] Row ID ${row.id} is missing level or entity_id:`, row);
          skippedCount++;
          return;
        }

        // Check if it's a sandbox/mock/fallback account
        if (sandboxAccountSet.has(row.accountId)) {
          skippedCount++;
          return;
        }

        // Resolve creative_id for level ad
        const creative_id = row.level === "ad" ? (creativeMap.get(row.adId) || "") : "";
        
        // Resolve currency
        const currency = currencyMap.get(row.accountId) || "USD";

        // Calculate CPM
        const cpmValue = row.impressions > 0 ? (row.spend / row.impressions) * 1000 : 0;

        // Upsert row
        await prisma.factMetaPerformance.upsert({
          where: {
            date_level_account_id_entity_id: {
              date: row.date,
              level: row.level,
              account_id: row.accountId,
              entity_id: entity_id,
            }
          },
          update: {
            campaign_id: row.campaignId || "",
            adset_id: row.adsetId || "",
            ad_id: row.adId || "",
            creative_id: creative_id,
            spend: row.spend ?? 0,
            impressions: row.impressions ?? 0,
            clicks: row.clicks ?? 0,
            ctr: row.ctr ?? 0,
            cpc: row.cpc ?? 0,
            cpm: cpmValue,
            purchases: row.purchases ?? 0,
            purchase_value: row.purchaseValue ?? 0,
            roas: row.roas ?? 0,
            currency: currency,
            synced_at: row.updatedAt,
          },
          create: {
            date: row.date,
            level: row.level,
            account_id: row.accountId,
            campaign_id: row.campaignId || "",
            adset_id: row.adsetId || "",
            ad_id: row.adId || "",
            creative_id: creative_id,
            entity_id: entity_id,
            spend: row.spend ?? 0,
            impressions: row.impressions ?? 0,
            clicks: row.clicks ?? 0,
            ctr: row.ctr ?? 0,
            cpc: row.cpc ?? 0,
            cpm: cpmValue,
            purchases: row.purchases ?? 0,
            purchase_value: row.purchaseValue ?? 0,
            roas: row.roas ?? 0,
            currency: currency,
            synced_at: row.updatedAt,
          }
        });

        migratedCount++;
      })
    );
    
    if (i > 0 && i % 1000 === 0) {
      console.log(`Processed ${i} of ${rawInsights.length} rows...`);
    }
  }

  console.log(`🏁 Migration Completed! Successfully migrated: ${migratedCount} rows, Skipped/Filtered: ${skippedCount} rows.`);
}

runMigration().catch(console.error);
