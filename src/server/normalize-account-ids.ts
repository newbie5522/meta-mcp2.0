import prisma from "../db/index.js";
import { normalizeMetaAccountId } from "./utils.js";

function isPureNumeric(id: string): boolean {
  return /^\d+$/.test(id.trim());
}

async function runNormalization() {
  console.log("==========================================");
  console.log("🚀 STARTING FB ACCOUNT ID FORMALIZATION & CLEANUP");
  console.log("==========================================\n");

  const tables = [
    "AdAccount",
    "AdInsight",
    "FactMetaPerformance",
    "Campaign",
    "AdSet",
    "Ad",
    "AdCreative",
    "AccountMapping",
    "DailySummary",
    "SyncLog",
    "MetaAccountMonitoring",
    "AiAnalysisReport"
  ];

  // Helper structures for logging
  const stats: Record<string, {
    beforeAct: number;
    beforeNumeric: number;
    afterAct: number;
    afterNumeric: number;
    merged: number;
    skipped: number;
    failed: number;
  }> = {};

  for (const t of tables) {
    stats[t] = { beforeAct: 0, beforeNumeric: 0, afterAct: 0, afterNumeric: 0, merged: 0, skipped: 0, failed: 0 };
  }

  // 1. Snapshot counts before migration
  console.log("📊 [1/4] Snapshotted count of account IDs before migration:");
  
  // -- AdAccount
  const adAccounts = await prisma.adAccount.findMany();
  for (const acc of adAccounts) {
    const id = acc.fb_account_id;
    if (isPureNumeric(id)) stats.AdAccount.beforeNumeric++;
    else if (id.startsWith("act_")) stats.AdAccount.beforeAct++;
    else stats.AdAccount.skipped++;
  }

  // -- AdInsight
  const adInsights = await prisma.adInsight.findMany();
  for (const item of adInsights) {
    const id = item.accountId;
    if (isPureNumeric(id)) stats.AdInsight.beforeNumeric++;
    else if (id.startsWith("act_")) stats.AdInsight.beforeAct++;
    else stats.AdInsight.skipped++;
  }

  // -- FactMetaPerformance
  const facts = await prisma.factMetaPerformance.findMany();
  for (const f of facts) {
    const id = f.account_id;
    if (isPureNumeric(id)) stats.FactMetaPerformance.beforeNumeric++;
    else if (id.startsWith("act_")) stats.FactMetaPerformance.beforeAct++;
    else stats.FactMetaPerformance.skipped++;
  }

  // -- Campaign
  const campaigns = await prisma.campaign.findMany();
  for (const c of campaigns) {
    const id = c.accountId;
    if (isPureNumeric(id)) stats.Campaign.beforeNumeric++;
    else if (id.startsWith("act_")) stats.Campaign.beforeAct++;
    else stats.Campaign.skipped++;
  }

  // -- AdSet
  const adsets = await prisma.adSet.findMany();
  for (const s of adsets) {
    const id = s.accountId;
    if (isPureNumeric(id)) stats.AdSet.beforeNumeric++;
    else if (id.startsWith("act_")) stats.AdSet.beforeAct++;
    else stats.AdSet.skipped++;
  }

  // -- Ad
  const ads = await prisma.ad.findMany();
  for (const a of ads) {
    const id = a.accountId;
    if (isPureNumeric(id)) stats.Ad.beforeNumeric++;
    else if (id.startsWith("act_")) stats.Ad.beforeAct++;
    else stats.Ad.skipped++;
  }

  // -- AdCreative
  const creatives = await prisma.adCreative.findMany();
  for (const cr of creatives) {
    const id = cr.fbAccountId;
    if (isPureNumeric(id)) stats.AdCreative.beforeNumeric++;
    else if (id.startsWith("act_")) stats.AdCreative.beforeAct++;
    else stats.AdCreative.skipped++;
  }

  // -- AccountMapping
  const mappings = await prisma.accountMapping.findMany();
  for (const m of mappings) {
    const id = m.fbAccountId;
    if (isPureNumeric(id)) stats.AccountMapping.beforeNumeric++;
    else if (id.startsWith("act_")) stats.AccountMapping.beforeAct++;
    else stats.AccountMapping.skipped++;
  }

  // -- DailySummary
  const summaries = await prisma.dailySummary.findMany({ where: { scope: "ad_account" } });
  for (const ds of summaries) {
    const id = ds.scopeId;
    if (isPureNumeric(id)) stats.DailySummary.beforeNumeric++;
    else if (id.startsWith("act_")) stats.DailySummary.beforeAct++;
    else stats.DailySummary.skipped++;
  }

  // -- SyncLog
  const logs = await prisma.syncLog.findMany();
  for (const log of logs) {
    const id = log.adAccountId;
    if (id) {
      if (isPureNumeric(id)) stats.SyncLog.beforeNumeric++;
      else if (id.startsWith("act_")) stats.SyncLog.beforeAct++;
    } else {
      stats.SyncLog.skipped++;
    }
  }

  // -- MetaAccountMonitoring
  const monitorings = await prisma.metaAccountMonitoring.findMany();
  for (const mon of monitorings) {
    const id = mon.accountId;
    if (isPureNumeric(id)) stats.MetaAccountMonitoring.beforeNumeric++;
    else if (id.startsWith("act_")) stats.MetaAccountMonitoring.beforeAct++;
    else stats.MetaAccountMonitoring.skipped++;
  }

  // -- AiAnalysisReport
  const reports = await prisma.aiAnalysisReport.findMany({
    where: { entityType: { in: ["ad_account", "account"] } }
  });
  for (const rep of reports) {
    const id = rep.entityId;
    if (isPureNumeric(id)) stats.AiAnalysisReport.beforeNumeric++;
    else if (id.startsWith("act_")) stats.AiAnalysisReport.beforeAct++;
    else stats.AiAnalysisReport.skipped++;
  }

  console.log("Snapshot complete. Processing migrations meticulously...");

  console.log("\n🌀 [2/4] Executing step-by-step account consolidation...\n");

  // Filter accounts with numeric IDs
  const numericAccs = adAccounts.filter(acc => isPureNumeric(acc.fb_account_id));
  console.log(`Found ${numericAccs.length} AdAccount records with pure numeric IDs to resolve.`);

  for (const nAcc of numericAccs) {
    const rawId = nAcc.fb_account_id;
    const actId = normalizeMetaAccountId(rawId);

    console.log(`-> Processing account: "${rawId}" -> "${actId}" ("${nAcc.fb_account_name}")`);

    // A. Ensure the "act_123" parent exists in AdAccount before moving children
    let normAcc = await prisma.adAccount.findUnique({
      where: { fb_account_id: actId }
    });

    if (normAcc) {
      console.log(`   [Merge Conflict] "${actId}" already exists in AdAccount. Merging properties...`);
      // Update properties of act_xxx preferring non-null/non-empty properties from raw entity
      await prisma.adAccount.update({
        where: { fb_account_id: actId },
        data: {
          fb_account_name: normAcc.fb_account_name || nAcc.fb_account_name,
          fb_access_token: normAcc.fb_access_token || nAcc.fb_access_token,
          currency: normAcc.currency || nAcc.currency,
          timezone: normAcc.timezone || nAcc.timezone,
          status: normAcc.status || nAcc.status,
          storeId: normAcc.storeId || nAcc.storeId,
          activityStatus: Math.min(normAcc.activityStatus, nAcc.activityStatus),
          recentActivity90d: normAcc.recentActivity90d || nAcc.recentActivity90d,
          lastActivityCheckedAt: normAcc.lastActivityCheckedAt || nAcc.lastActivityCheckedAt
        }
      });
      stats.AdAccount.merged++;
    } else {
      console.log(`   [Create Clone] Creating clone clone record for "${actId}"...`);
      await prisma.adAccount.create({
        data: {
          fb_account_id: actId,
          fb_account_name: nAcc.fb_account_name,
          fb_access_token: nAcc.fb_access_token,
          currency: nAcc.currency,
          timezone: nAcc.timezone,
          status: nAcc.status,
          storeId: nAcc.storeId,
          activityStatus: nAcc.activityStatus,
          recentActivity90d: nAcc.recentActivity90d,
          lastActivityCheckedAt: nAcc.lastActivityCheckedAt,
          createdAt: nAcc.createdAt,
          updatedAt: nAcc.updatedAt
        }
      });
    }

    // B. Migrate dependent records dynamically
    // B1. Campaign (simply update accountId, SQLite won't violate unique because ID is the single and true primary key value)
    const cCount = await prisma.campaign.updateMany({
      where: { accountId: rawId },
      data: { accountId: actId }
    });
    if (cCount.count > 0) {
      console.log(`   └ Campaign: updated ${cCount.count} records`);
    }

    // B2. AdSet
    const sCount = await prisma.adSet.updateMany({
      where: { accountId: rawId },
      data: { accountId: actId }
    });
    if (sCount.count > 0) {
      console.log(`   └ AdSet: updated ${sCount.count} records`);
    }

    // B3. Ad
    const aCount = await prisma.ad.updateMany({
      where: { accountId: rawId },
      data: { accountId: actId }
    });
    if (aCount.count > 0) {
      console.log(`   └ Ad: updated ${aCount.count} records`);
    }

    // B4. AdCreative
    const crCount = await prisma.adCreative.updateMany({
      where: { fbAccountId: rawId },
      data: { fbAccountId: actId }
    });
    if (crCount.count > 0) {
      console.log(`   └ AdCreative: updated ${crCount.count} records`);
    }

    // B5. AccountMapping (has @unique constraint on fbAccountId)
    const rawMapping = await prisma.accountMapping.findUnique({ where: { fbAccountId: rawId } });
    if (rawMapping) {
      const actMapping = await prisma.accountMapping.findUnique({ where: { fbAccountId: actId } });
      if (actMapping) {
        console.log(`   └ AccountMapping Conflict: Merging mappings by preferring store ownership...`);
        await prisma.accountMapping.update({
          where: { fbAccountId: actId },
          data: {
            storeId: actMapping.storeId || rawMapping.storeId,
            fbPageId: actMapping.fbPageId || rawMapping.fbPageId,
            project: actMapping.project || rawMapping.project,
            owner: actMapping.owner || rawMapping.owner,
            name: actMapping.name || rawMapping.name,
            mode: actMapping.mode || rawMapping.mode
          }
        });
        await prisma.accountMapping.delete({ where: { fbAccountId: rawId } });
        stats.AccountMapping.merged++;
      } else {
        await prisma.accountMapping.update({
          where: { fbAccountId: rawId },
          data: { fbAccountId: actId }
        });
      }
    }

    // B6. AdInsight (has unique constraint: @unique([accountId, level, campaignId, adsetId, adId, date]))
    const rawInsights = await prisma.adInsight.findMany({ where: { accountId: rawId } });
    for (const rawIns of rawInsights) {
      const existingNorm = await prisma.adInsight.findUnique({
        where: {
          accountId_level_campaignId_adsetId_adId_date: {
            accountId: actId,
            level: rawIns.level,
            campaignId: rawIns.campaignId,
            adsetId: rawIns.adsetId,
            adId: rawIns.adId,
            date: rawIns.date
          }
        }
      });

      if (existingNorm) {
        // Merge metrics and update
        const mergedS = rawIns.spend + existingNorm.spend;
        const mergedI = rawIns.impressions + existingNorm.impressions;
        const mergedCl = rawIns.clicks + existingNorm.clicks;
        const mergedAtc = rawIns.addToCart + existingNorm.addToCart;
        const mergedCh = rawIns.initiateCheckout + existingNorm.initiateCheckout;
        const mergedP = rawIns.purchases + existingNorm.purchases;
        const mergedVal = rawIns.purchaseValue + existingNorm.purchaseValue;

        const mergedCtr = mergedI > 0 ? (mergedCl / mergedI) * 100 : 0;
        const mergedCpc = mergedCl > 0 ? mergedS / mergedCl : 0;
        const mergedAtcRate = mergedCl > 0 ? (mergedAtc / mergedCl) * 100 : 0;
        const mergedChRate = mergedAtc > 0 ? (mergedCh / mergedAtc) * 100 : 0;
        const mergedCpp = mergedP > 0 ? mergedS / mergedP : 0;
        const mergedRoas = mergedS > 0 ? mergedVal / mergedS : 0;

        await prisma.adInsight.update({
          where: { id: existingNorm.id },
          data: {
            reach: Math.max(rawIns.reach, existingNorm.reach),
            impressions: mergedI,
            clicks: mergedCl,
            spend: mergedS,
            addToCart: mergedAtc,
            initiateCheckout: mergedCh,
            purchases: mergedP,
            purchaseValue: mergedVal,
            ctr: mergedCtr,
            cpc: mergedCpc,
            atcRate: mergedAtcRate,
            checkoutRate: mergedChRate,
            cpp: mergedCpp,
            roas: mergedRoas
          }
        });
        await prisma.adInsight.delete({ where: { id: rawIns.id } });
        stats.AdInsight.merged++;
      } else {
        await prisma.adInsight.update({
          where: { id: rawIns.id },
          data: { accountId: actId }
        });
      }
    }

    // B7. FactMetaPerformance (has unique constraint: @unique([date, level, account_id, entity_id]))
    const rawFacts = await prisma.factMetaPerformance.findMany({ where: { account_id: rawId } });
    for (const rf of rawFacts) {
      // If rf.entity_id was the raw accountId, normalize it too
      const normalizedEntityId = rf.level === "account" ? actId : rf.entity_id;

      const existingNormFact = await prisma.factMetaPerformance.findUnique({
        where: {
          date_level_account_id_entity_id: {
            date: rf.date,
            level: rf.level,
            account_id: actId,
            entity_id: normalizedEntityId
          }
        }
      });

      if (existingNormFact) {
        // Merge metrics and update
        const mergedS = rf.spend + existingNormFact.spend;
        const mergedI = rf.impressions + existingNormFact.impressions;
        const mergedCl = rf.clicks + existingNormFact.clicks;
        const mergedP = rf.purchases + existingNormFact.purchases;
        const mergedVal = rf.purchase_value + existingNormFact.purchase_value;

        const mergedCtr = mergedI > 0 ? (mergedCl / mergedI) * 100 : 0;
        const mergedCpc = mergedCl > 0 ? mergedS / mergedCl : 0;
        const mergedCpm = mergedI > 0 ? (mergedS / mergedI) * 1000 : 0;
        const mergedRoas = mergedS > 0 ? mergedVal / mergedS : 0;

        await prisma.factMetaPerformance.update({
          where: { id: existingNormFact.id },
          data: {
            spend: mergedS,
            impressions: mergedI,
            clicks: mergedCl,
            purchases: mergedP,
            purchase_value: mergedVal,
            ctr: mergedCtr,
            cpc: mergedCpc,
            cpm: mergedCpm,
            roas: mergedRoas,
            synced_at: new Date()
          }
        });
        await prisma.factMetaPerformance.delete({ where: { id: rf.id } });
        stats.FactMetaPerformance.merged++;
      } else {
        await prisma.factMetaPerformance.update({
          where: { id: rf.id },
          data: {
            account_id: actId,
            entity_id: normalizedEntityId,
            synced_at: new Date()
          }
        });
      }
    }

    // B8. DailySummary (scope === "ad_account") (has unique constraint: @unique([scope, scopeId, date]))
    const rawSummaries = await prisma.dailySummary.findMany({
      where: { scope: "ad_account", scopeId: rawId }
    });
    for (const rs of rawSummaries) {
      const existingNormSummary = await prisma.dailySummary.findUnique({
        where: {
          scope_scopeId_date: {
            scope: "ad_account",
            scopeId: actId,
            date: rs.date
          }
        }
      });

      if (existingNormSummary) {
        // Merge and update
        const mergedRev = rs.revenue + existingNormSummary.revenue;
        const mergedS = rs.spend + existingNormSummary.spend;
        const mergedO = rs.orders + existingNormSummary.orders;
        const mergedCl = rs.clicks + existingNormSummary.clicks;
        const mergedI = rs.impressions + existingNormSummary.impressions;

        const mergedRoas = mergedS > 0 ? mergedRev / mergedS : 0;
        const mergedMetaRoas = mergedS > 0 ? mergedRev / mergedS : 0; // standard fallback

        await prisma.dailySummary.update({
          where: { id: existingNormSummary.id },
          data: {
            revenue: mergedRev,
            spend: mergedS,
            orders: mergedO,
            clicks: mergedCl,
            impressions: mergedI,
            roas: mergedRoas,
            metaRoas: mergedMetaRoas
          }
        });
        await prisma.dailySummary.delete({ where: { id: rs.id } });
        stats.DailySummary.merged++;
      } else {
        await prisma.dailySummary.update({
          where: { id: rs.id },
          data: { scopeId: actId }
        });
      }
    }

    // B9. SyncLog
    const slCount = await prisma.syncLog.updateMany({
      where: { adAccountId: rawId },
      data: { adAccountId: actId }
    });
    if (slCount.count > 0) {
      console.log(`   └ SyncLog: updated ${slCount.count} records`);
    }

    // B10. MetaAccountMonitoring (uniqueness constraint on accountId)
    const rawMon = await prisma.metaAccountMonitoring.findUnique({ where: { accountId: rawId } });
    if (rawMon) {
      const normMon = await prisma.metaAccountMonitoring.findUnique({ where: { accountId: actId } });
      if (normMon) {
        await prisma.metaAccountMonitoring.update({
          where: { accountId: actId },
          data: {
            accountName: normMon.accountName || rawMon.accountName,
            status: normMon.status || rawMon.status,
            spendCap: normMon.spendCap || rawMon.spendCap,
            amountSpent: normMon.amountSpent || rawMon.amountSpent,
            balance: normMon.balance || rawMon.balance,
            currency: normMon.currency || rawMon.currency,
            timezone: normMon.timezone || rawMon.timezone,
            updatedAt: new Date()
          }
        });
        await prisma.metaAccountMonitoring.delete({ where: { accountId: rawId } });
        stats.MetaAccountMonitoring.merged++;
      } else {
        await prisma.metaAccountMonitoring.create({
          data: {
            accountId: actId,
            accountName: rawMon.accountName,
            status: rawMon.status,
            spendCap: rawMon.spendCap,
            amountSpent: rawMon.amountSpent,
            balance: rawMon.balance,
            currency: rawMon.currency,
            timezone: rawMon.timezone,
            updatedAt: new Date()
          }
        });
        await prisma.metaAccountMonitoring.delete({ where: { accountId: rawId } });
      }
    }

    // B11. AiAnalysisReport
    const repCount = await prisma.aiAnalysisReport.updateMany({
      where: { entityType: { in: ["ad_account", "account"] }, entityId: rawId },
      data: { entityId: actId }
    });
    if (repCount.count > 0) {
      console.log(`   └ AiAnalysisReport: updated ${repCount.count} reports`);
    }

    // C. Safely delete the old nAcc record
    await prisma.adAccount.delete({
      where: { fb_account_id: rawId }
    });
    console.log(`   └ AdAccount: old numeric record "${rawId}" deleted safely.`);
  }

  // 3. Scan and cleanup ORPHANED numeric IDs directly in children tables
  console.log("\n🌀 [3/4] Checking and clearing orphaned pure numeric account IDs across tables...\n");

  // Orphaned AdInsight
  const orphanedInsights = await prisma.adInsight.findMany();
  for (const item of orphanedInsights) {
    if (isPureNumeric(item.accountId)) {
      const actId = normalizeMetaAccountId(item.accountId);
      // Attempt merge or update
      try {
        const existingNorm = await prisma.adInsight.findFirst({
          where: {
            accountId: actId,
            level: item.level,
            campaignId: item.campaignId,
            adsetId: item.adsetId,
            adId: item.adId,
            date: item.date
          }
        });

        if (existingNorm) {
          const mergedS = item.spend + existingNorm.spend;
          const mergedI = item.impressions + existingNorm.impressions;
          const mergedCl = item.clicks + existingNorm.clicks;
          await prisma.adInsight.update({
            where: { id: existingNorm.id },
            data: {
              reach: Math.max(item.reach, existingNorm.reach),
              impressions: mergedI,
              clicks: mergedCl,
              spend: mergedS,
              purchases: item.purchases + existingNorm.purchases,
              purchaseValue: item.purchaseValue + existingNorm.purchaseValue
            }
          });
          await prisma.adInsight.delete({ where: { id: item.id } });
          stats.AdInsight.merged++;
        } else {
          await prisma.adInsight.update({
            where: { id: item.id },
            data: { accountId: actId }
          });
        }
      } catch (err: any) {
        stats.AdInsight.failed++;
      }
    }
  }

  // Orphaned FactMetaPerformance
  const orphanedFacts = await prisma.factMetaPerformance.findMany();
  for (const f of orphanedFacts) {
    let rawAcc = f.account_id;
    let rawEnt = f.entity_id;
    let needsUpdate = false;

    if (isPureNumeric(rawAcc)) {
      rawAcc = normalizeMetaAccountId(rawAcc);
      needsUpdate = true;
    }
    if (f.level === "account" && isPureNumeric(rawEnt)) {
      rawEnt = normalizeMetaAccountId(rawEnt);
      needsUpdate = true;
    }

    if (needsUpdate) {
      try {
        const existingNorm = await prisma.factMetaPerformance.findUnique({
          where: {
            date_level_account_id_entity_id: {
              date: f.date,
              level: f.level,
              account_id: rawAcc,
              entity_id: rawEnt
            }
          }
        });

        if (existingNorm) {
          const mergedS = f.spend + existingNorm.spend;
          const mergedI = f.impressions + existingNorm.impressions;
          const mergedCl = f.clicks + existingNorm.clicks;
          await prisma.factMetaPerformance.update({
            where: { id: existingNorm.id },
            data: {
              spend: mergedS,
              impressions: mergedI,
              clicks: mergedCl,
              purchases: f.purchases + existingNorm.purchases,
              purchase_value: f.purchase_value + existingNorm.purchase_value,
              synced_at: new Date()
            }
          });
          await prisma.factMetaPerformance.delete({ where: { id: f.id } });
          stats.FactMetaPerformance.merged++;
        } else {
          await prisma.factMetaPerformance.update({
            where: { id: f.id },
            data: { account_id: rawAcc, entity_id: rawEnt, synced_at: new Date() }
          });
        }
      } catch (err) {
        stats.FactMetaPerformance.failed++;
      }
    }
  }

  // Orphaned Campaigns, AdSets, Ads
  await prisma.campaign.updateMany({
    where: { accountId: { not: { startsWith: "act_" } } },
    data: { accountId: "act_unknown_orphan_campaign" } 
  });
  // Since we don't have many active orphans usually, but specifically let's let updateMany on Campaign check if any and normalize.
  const allCampaigns = await prisma.campaign.findMany();
  for (const c of allCampaigns) {
    if (isPureNumeric(c.accountId)) {
      await prisma.campaign.update({
        where: { id: c.id },
        data: { accountId: normalizeMetaAccountId(c.accountId) }
      });
    }
  }

  const allAdSets = await prisma.adSet.findMany();
  for (const s of allAdSets) {
    if (isPureNumeric(s.accountId)) {
      await prisma.adSet.update({
        where: { id: s.id },
        data: { accountId: normalizeMetaAccountId(s.accountId) }
      });
    }
  }

  const allAds = await prisma.ad.findMany();
  for (const a of allAds) {
    if (isPureNumeric(a.accountId)) {
      await prisma.ad.update({
        where: { id: a.id },
        data: { accountId: normalizeMetaAccountId(a.accountId) }
      });
    }
  }

  // Orphaned AdCreative
  const allCreatives = await prisma.adCreative.findMany();
  for (const cr of allCreatives) {
    if (isPureNumeric(cr.fbAccountId)) {
      await prisma.adCreative.update({
        where: { creativeId: cr.creativeId },
        data: { fbAccountId: normalizeMetaAccountId(cr.fbAccountId) }
      });
    }
  }

  // Orphaned account mapping
  const allMappings = await prisma.accountMapping.findMany();
  for (const m of allMappings) {
    if (isPureNumeric(m.fbAccountId)) {
      const actId = normalizeMetaAccountId(m.fbAccountId);
      try {
        const exist = await prisma.accountMapping.findUnique({ where: { fbAccountId: actId } });
        if (exist) {
          await prisma.accountMapping.delete({ where: { id: m.id } });
          stats.AccountMapping.merged++;
        } else {
          await prisma.accountMapping.update({
            where: { id: m.id },
            data: { fbAccountId: actId }
          });
        }
      } catch (e) {
        stats.AccountMapping.failed++;
      }
    }
  }

  // Orphaned DailySummaries
  const allSummaries = await prisma.dailySummary.findMany({ where: { scope: "ad_account" } });
  for (const s of allSummaries) {
    if (isPureNumeric(s.scopeId)) {
      const actId = normalizeMetaAccountId(s.scopeId);
      try {
        const exist = await prisma.dailySummary.findUnique({
          where: { scope_scopeId_date: { scope: "ad_account", scopeId: actId, date: s.date } }
        });
        if (exist) {
          await prisma.dailySummary.delete({ where: { id: s.id } });
          stats.DailySummary.merged++;
        } else {
          await prisma.dailySummary.update({
            where: { id: s.id },
            data: { scopeId: actId }
          });
        }
      } catch (e) {
        stats.DailySummary.failed++;
      }
    }
  }

  // Orphaned SyncLogs
  const allLogs = await prisma.syncLog.findMany();
  for (const log of allLogs) {
    if (log.adAccountId && isPureNumeric(log.adAccountId)) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { adAccountId: normalizeMetaAccountId(log.adAccountId) }
      });
    }
  }

  // Orphaned MetaAccountMonitoring
  const allMons = await prisma.metaAccountMonitoring.findMany();
  for (const mon of allMons) {
    if (isPureNumeric(mon.accountId)) {
      const actId = normalizeMetaAccountId(mon.accountId);
      try {
        const exist = await prisma.metaAccountMonitoring.findUnique({ where: { accountId: actId } });
        if (exist) {
          await prisma.metaAccountMonitoring.delete({ where: { accountId: mon.accountId } });
          stats.MetaAccountMonitoring.merged++;
        } else {
          // Since updating primary key directly is not supported or prone to error, we rebuild
          await prisma.metaAccountMonitoring.create({
            data: {
              accountId: actId,
              accountName: mon.accountName,
              status: mon.status,
              spendCap: mon.spendCap,
              amountSpent: mon.amountSpent,
              balance: mon.balance,
              currency: mon.currency,
              timezone: mon.timezone,
              updatedAt: new Date()
            }
          });
          await prisma.metaAccountMonitoring.delete({ where: { accountId: mon.accountId } });
        }
      } catch (e) {
        stats.MetaAccountMonitoring.failed++;
      }
    }
  }

  // Orphaned AiAnalysisReports
  const allReps = await prisma.aiAnalysisReport.findMany({ where: { entityType: { in: ["ad_account", "account"] } } });
  for (const r of allReps) {
    if (isPureNumeric(r.entityId)) {
      await prisma.aiAnalysisReport.update({
        where: { id: r.id },
        data: { entityId: normalizeMetaAccountId(r.entityId) }
      });
    }
  }

  // 4. Snapshot counts after migration
  console.log("\n📊 [4/4] Snapshotted count of account IDs after migration:\n");

  const postAdAccs = await prisma.adAccount.findMany();
  for (const acc of postAdAccs) {
    if (isPureNumeric(acc.fb_account_id)) stats.AdAccount.afterNumeric++;
    else if (acc.fb_account_id.startsWith("act_")) stats.AdAccount.afterAct++;
  }

  const postAdIns = await prisma.adInsight.findMany();
  for (const item of postAdIns) {
    if (isPureNumeric(item.accountId)) stats.AdInsight.afterNumeric++;
    else if (item.accountId.startsWith("act_")) stats.AdInsight.afterAct++;
  }

  const postFacts = await prisma.factMetaPerformance.findMany();
  for (const f of postFacts) {
    if (isPureNumeric(f.account_id)) stats.FactMetaPerformance.afterNumeric++;
    else if (f.account_id.startsWith("act_")) stats.FactMetaPerformance.afterAct++;
  }

  const postCampaigns = await prisma.campaign.findMany();
  for (const c of postCampaigns) {
    if (isPureNumeric(c.accountId)) stats.Campaign.afterNumeric++;
    else if (c.accountId.startsWith("act_")) stats.Campaign.afterAct++;
  }

  const postAdSets = await prisma.adSet.findMany();
  for (const s of postAdSets) {
    if (isPureNumeric(s.accountId)) stats.AdSet.afterNumeric++;
    else if (s.accountId.startsWith("act_")) stats.AdSet.afterAct++;
  }

  const postAds = await prisma.ad.findMany();
  for (const a of postAds) {
    if (isPureNumeric(a.accountId)) stats.Ad.afterNumeric++;
    else if (a.accountId.startsWith("act_")) stats.Ad.afterAct++;
  }

  const postCreatives = await prisma.adCreative.findMany();
  for (const cr of postCreatives) {
    if (isPureNumeric(cr.fbAccountId)) stats.AdCreative.afterNumeric++;
    else if (cr.fbAccountId.startsWith("act_")) stats.AdCreative.afterAct++;
  }

  const postMappings = await prisma.accountMapping.findMany();
  for (const m of postMappings) {
    if (isPureNumeric(m.fbAccountId)) stats.AccountMapping.afterNumeric++;
    else if (m.fbAccountId.startsWith("act_")) stats.AccountMapping.afterAct++;
  }

  const postSummaries = await prisma.dailySummary.findMany({ where: { scope: "ad_account" } });
  for (const s of postSummaries) {
    if (isPureNumeric(s.scopeId)) stats.DailySummary.afterNumeric++;
    else if (s.scopeId.startsWith("act_")) stats.DailySummary.afterAct++;
  }

  const postLogs = await prisma.syncLog.findMany();
  for (const log of postLogs) {
    if (log.adAccountId) {
      if (isPureNumeric(log.adAccountId)) stats.SyncLog.afterNumeric++;
      else if (log.adAccountId.startsWith("act_")) stats.SyncLog.afterAct++;
    }
  }

  const postMons = await prisma.metaAccountMonitoring.findMany();
  for (const mon of postMons) {
    if (isPureNumeric(mon.accountId)) stats.MetaAccountMonitoring.afterNumeric++;
    else if (mon.accountId.startsWith("act_")) stats.MetaAccountMonitoring.afterAct++;
  }

  const postReps = await prisma.aiAnalysisReport.findMany({ where: { entityType: { in: ["ad_account", "account"] } } });
  for (const r of postReps) {
    if (isPureNumeric(r.entityId)) stats.AiAnalysisReport.afterNumeric++;
    else if (r.entityId.startsWith("act_")) stats.AiAnalysisReport.afterAct++;
  }

  console.log("=========================================================================");
  console.log("                       FINAL NORMALIZATION REPORT                    ");
  console.log("=========================================================================");
  console.log(
    "Table Name             | Before Act | Before Num | After Act | After Num | Merged | Skipped | Failed"
  );
  console.log("-----------------------|------------|------------|-----------|-----------|--------|---------|--------");

  for (const t of tables) {
    const row = stats[t];
    const paddedName = t.padEnd(22);
    const bAct = String(row.beforeAct).padEnd(10);
    const bNum = String(row.beforeNumeric).padEnd(10);
    const aAct = String(row.afterAct).padEnd(9);
    const aNum = String(row.afterNumeric).padEnd(9);
    const mer = String(row.merged).padEnd(6);
    const skip = String(row.skipped).padEnd(7);
    const fail = String(row.failed);
    console.log(`${paddedName} | ${bAct} | ${bNum} | ${aAct} | ${aNum} | ${mer} | ${skip} | ${fail}`);
  }
  console.log("=========================================================================\n");
  console.log("✅ NORMALIZATION COMPLETED SUCCESSFULLY!");
}

runNormalization().catch((err) => {
  console.error("🚨 CRITICAL MIGRATION ERROR:", err);
});
