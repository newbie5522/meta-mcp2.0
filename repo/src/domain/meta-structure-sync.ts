import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaAd, MetaAdSet, MetaApiResponse, MetaCampaign, MetaCreative } from "../meta/types.js";
import { AD_FIELDS, ADSET_FIELDS, CAMPAIGN_FIELDS, CREATIVE_FIELDS } from "../tools/field-policy.js";
import { buildFieldsParam } from "../utils/validation.js";
import { extractCreativeLinkUrl } from "./meta-creatives-sync.js";

export const syncMetaStructureInputSchema = z.object({
  adAccountId: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(500),
  maxPages: z.number().int().min(1).max(20).default(10),
});

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function fetchEdge<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  maxPages: number,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const response = await metaApiClient.get<MetaApiResponse<T>>(path, {
      ...params,
      after,
    });
    rows.push(...(response.data ?? []));
    after = response.paging?.cursors?.after;
    if (!after || !response.paging?.next) break;
  }
  return rows;
}

async function fetchCreative(creativeId: string): Promise<MetaCreative | null> {
  try {
    return await metaApiClient.get<MetaCreative>(`/${creativeId}`, {
      fields: buildFieldsParam(CREATIVE_FIELDS),
    });
  } catch {
    return null;
  }
}

export async function syncMetaStructureForAdAccount(input: z.input<typeof syncMetaStructureInputSchema>) {
  const parsed = syncMetaStructureInputSchema.parse(input);
  const adAccount = await prisma.adAccount.findUniqueOrThrow({ where: { id: parsed.adAccountId } });
  const log = await prisma.syncLog.create({
    data: {
      type: "meta_structure",
      status: "running",
      adAccountId: adAccount.id,
      metadata: {
        limit: parsed.limit,
        maxPages: parsed.maxPages,
      },
    },
  });

  try {
    const [campaigns, adsets, ads] = await Promise.all([
      fetchEdge<MetaCampaign>(
        `/${adAccount.metaAccountId}/campaigns`,
        { fields: buildFieldsParam(CAMPAIGN_FIELDS), limit: parsed.limit },
        parsed.maxPages,
      ),
      fetchEdge<MetaAdSet>(
        `/${adAccount.metaAccountId}/adsets`,
        { fields: buildFieldsParam(ADSET_FIELDS), limit: parsed.limit },
        parsed.maxPages,
      ),
      fetchEdge<MetaAd>(
        `/${adAccount.metaAccountId}/ads`,
        { fields: buildFieldsParam(AD_FIELDS), limit: parsed.limit },
        parsed.maxPages,
      ),
    ]);

    const creativeIds = [...new Set(ads.map((ad) => ad.creative?.id).filter((id): id is string => Boolean(id)))];
    const creativeById = new Map<string, MetaCreative>();
    for (const creativeId of creativeIds) {
      const creative = await fetchCreative(creativeId);
      if (creative) creativeById.set(creativeId, creative);
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const campaignByMetaId = new Map<string, string>();
      for (const campaign of campaigns) {
        if (!campaign.id) continue;
        const saved = await tx.campaign.upsert({
          where: {
            adAccountId_metaCampaignId: {
              adAccountId: adAccount.id,
              metaCampaignId: campaign.id,
            },
          },
          update: {
            name: campaign.name,
            status: campaign.status,
            objective: campaign.objective,
            dailyBudget: campaign.daily_budget,
            lifetimeBudget: campaign.lifetime_budget,
            lastSeenAt: now,
          },
          create: {
            adAccountId: adAccount.id,
            metaCampaignId: campaign.id,
            name: campaign.name,
            status: campaign.status,
            objective: campaign.objective,
            dailyBudget: campaign.daily_budget,
            lifetimeBudget: campaign.lifetime_budget,
            lastSeenAt: now,
          },
        });
        campaignByMetaId.set(campaign.id, saved.id);
      }

      const adsetByMetaId = new Map<string, string>();
      for (const adset of adsets) {
        if (!adset.id) continue;
        const localCampaignId = adset.campaign_id ? campaignByMetaId.get(adset.campaign_id) : undefined;
        const saved = await tx.adSet.upsert({
          where: {
            adAccountId_metaAdSetId: {
              adAccountId: adAccount.id,
              metaAdSetId: adset.id,
            },
          },
          update: {
            campaignId: localCampaignId,
            metaCampaignId: adset.campaign_id,
            name: adset.name,
            status: adset.status,
            dailyBudget: adset.daily_budget,
            bidStrategy: adset.bid_strategy,
            optimizationGoal: adset.optimization_goal,
            targetingGeo: jsonOrUndefined(adset.targeting?.geo_locations),
            lastSeenAt: now,
          },
          create: {
            adAccountId: adAccount.id,
            campaignId: localCampaignId,
            metaAdSetId: adset.id,
            metaCampaignId: adset.campaign_id,
            name: adset.name,
            status: adset.status,
            dailyBudget: adset.daily_budget,
            bidStrategy: adset.bid_strategy,
            optimizationGoal: adset.optimization_goal,
            targetingGeo: jsonOrUndefined(adset.targeting?.geo_locations),
            lastSeenAt: now,
          },
        });
        adsetByMetaId.set(adset.id, saved.id);
      }

      let adsSaved = 0;
      let creativeSnapshotsSaved = 0;
      for (const ad of ads) {
        if (!ad.id) continue;
        const creativeId = ad.creative?.id;
        const creative = creativeId ? creativeById.get(creativeId) : undefined;
        await tx.ad.upsert({
          where: {
            adAccountId_metaAdId: {
              adAccountId: adAccount.id,
              metaAdId: ad.id,
            },
          },
          update: {
            campaignId: ad.campaign_id ? campaignByMetaId.get(ad.campaign_id) : undefined,
            adsetId: ad.adset_id ? adsetByMetaId.get(ad.adset_id) : undefined,
            metaCampaignId: ad.campaign_id,
            metaAdSetId: ad.adset_id,
            name: ad.name,
            status: ad.status,
            creativeId,
            lastSeenAt: now,
          },
          create: {
            adAccountId: adAccount.id,
            campaignId: ad.campaign_id ? campaignByMetaId.get(ad.campaign_id) : undefined,
            adsetId: ad.adset_id ? adsetByMetaId.get(ad.adset_id) : undefined,
            metaAdId: ad.id,
            metaCampaignId: ad.campaign_id,
            metaAdSetId: ad.adset_id,
            name: ad.name,
            status: ad.status,
            creativeId,
            lastSeenAt: now,
          },
        });
        adsSaved++;

        await tx.metaAdCreative.upsert({
          where: {
            adAccountId_adId: {
              adAccountId: adAccount.id,
              adId: ad.id,
            },
          },
          update: {
            adName: ad.name,
            creativeId,
            title: creative?.title,
            body: creative?.body,
            imageUrl: creative?.image_url,
            videoId: creative?.video_id,
            linkUrl: creative ? extractCreativeLinkUrl(creative) : undefined,
            lastSeenAt: now,
          },
          create: {
            adAccountId: adAccount.id,
            adId: ad.id,
            adName: ad.name,
            creativeId,
            title: creative?.title,
            body: creative?.body,
            imageUrl: creative?.image_url,
            videoId: creative?.video_id,
            linkUrl: creative ? extractCreativeLinkUrl(creative) : undefined,
            lastSeenAt: now,
          },
        });
        creativeSnapshotsSaved++;
      }

      return {
        campaignsSaved: campaignByMetaId.size,
        adsetsSaved: adsetByMetaId.size,
        adsSaved,
        creativeSnapshotsSaved,
      };
    });

    const recordsFetched = campaigns.length + adsets.length + ads.length + creativeById.size;
    const recordsSaved = result.campaignsSaved + result.adsetsSaved + result.adsSaved + result.creativeSnapshotsSaved;
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFetched,
        recordsSaved,
        metadata: {
          limit: parsed.limit,
          maxPages: parsed.maxPages,
          campaignsFetched: campaigns.length,
          adsetsFetched: adsets.length,
          adsFetched: ads.length,
          creativeIdsFetched: creativeById.size,
          ...result,
        },
      },
    });

    return {
      fetched: {
        campaigns: campaigns.length,
        adsets: adsets.length,
        ads: ads.length,
        creatives: creativeById.size,
      },
      saved: result,
    };
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function syncMetaStructureForStore(storeId: string, limit = 500, maxPages = 10) {
  const mappings = await prisma.storeAdAccountMap.findMany({
    where: { storeId },
    select: { adAccountId: true },
  });
  const results = [];
  for (const mapping of mappings) {
    results.push(await syncMetaStructureForAdAccount({ adAccountId: mapping.adAccountId, limit, maxPages }));
  }
  return results;
}

export async function syncMetaStructureForActiveAccounts(limit = 500, maxPages = 10) {
  const accounts = await prisma.adAccount.findMany({
    where: {
      status: "1",
      recentActivity90d: true,
    },
    select: { id: true },
  });
  const results = [];
  for (const account of accounts) {
    results.push(await syncMetaStructureForAdAccount({ adAccountId: account.id, limit, maxPages }));
  }
  return { accounts: accounts.length, results };
}
