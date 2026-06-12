// @ts-nocheck
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { metaApiClient } from "../meta/client.js";
import type { MetaAd, MetaApiResponse, MetaCreative } from "../meta/types.js";
import { AD_FIELDS, CREATIVE_FIELDS } from "../tools/field-policy.js";
import { buildFieldsParam } from "../utils/validation.js";

export const syncCreativesInputSchema = z.object({
  adAccountId: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(250),
  maxPages: z.number().int().min(1).max(20).default(10),
});

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function extractCreativeLinkUrl(creative: MetaCreative): string | undefined {
  const spec = creative.object_story_spec;
  const linkData = spec?.link_data;
  if (typeof linkData === "object" && linkData !== null && "link" in linkData) {
    return maybeString((linkData as Record<string, unknown>).link);
  }

  const videoData = spec?.video_data;
  if (typeof videoData === "object" && videoData !== null && "call_to_action" in videoData) {
    const callToAction = (videoData as Record<string, unknown>).call_to_action;
    if (typeof callToAction === "object" && callToAction !== null && "value" in callToAction) {
      const value = (callToAction as Record<string, unknown>).value;
      if (typeof value === "object" && value !== null && "link" in value) {
        return maybeString((value as Record<string, unknown>).link);
      }
    }
  }

  return undefined;
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

async function fetchAdsPages(
  accountId: string,
  limit: number,
  maxPages: number,
): Promise<MetaAd[]> {
  const ads: MetaAd[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const response = await metaApiClient.get<MetaApiResponse<MetaAd>>(
      `/${accountId}/ads`,
      {
        fields: buildFieldsParam(AD_FIELDS),
        limit,
        after,
      },
    );
    ads.push(...(response.data ?? []));
    after = response.paging?.cursors?.after;
    if (!after || !response.paging?.next) break;
  }
  return ads;
}

export async function syncMetaCreativeSnapshotsForAdAccount(input: z.input<typeof syncCreativesInputSchema>) {
  const parsed = syncCreativesInputSchema.parse(input);
  const adAccount = await prisma.adAccount.findUniqueOrThrow({ where: { id: parsed.adAccountId } });
  const log = await prisma.syncLog.create({
    data: {
      type: "meta_creatives",
      status: "running",
      adAccountId: adAccount.id,
      metadata: { limit: parsed.limit, maxPages: parsed.maxPages },
    },
  });

  try {
    const ads = await fetchAdsPages(adAccount.metaAccountId, parsed.limit, parsed.maxPages);
    const creativeIds = [...new Set(ads.map((ad) => ad.creative?.id).filter((id): id is string => Boolean(id)))];
    const creativeById = new Map<string, MetaCreative>();

    for (const creativeId of creativeIds) {
      const creative = await fetchCreative(creativeId);
      if (creative) creativeById.set(creativeId, creative);
    }

    let saved = 0;
    const now = new Date();
    for (const ad of ads) {
      if (!ad.id) continue;
      const creativeId = ad.creative?.id;
      const creative = creativeId ? creativeById.get(creativeId) : undefined;
      await prisma.metaAdCreative.upsert({
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
      saved++;
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFetched: ads.length,
        recordsSaved: saved,
        metadata: {
          limit: parsed.limit,
          maxPages: parsed.maxPages,
          creativeIdsFetched: creativeById.size,
        },
      },
    });

    return {
      adsFetched: ads.length,
      creativeIdsFetched: creativeById.size,
      saved,
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

export async function syncMetaCreativeSnapshotsForStore(storeId: string, limit = 250, maxPages = 10) {
  const mappings = await prisma.storeAdAccountMap.findMany({
    where: { storeId },
    select: { adAccountId: true },
  });
  const results = [];
  for (const mapping of mappings) {
    results.push(await syncMetaCreativeSnapshotsForAdAccount({ adAccountId: mapping.adAccountId, limit, maxPages }));
  }
  return results;
}

export async function syncMetaCreativeSnapshotsForActiveAccounts(limit = 250, maxPages = 10) {
  const accounts = await prisma.adAccount.findMany({
    where: {
      status: "1",
      recentActivity90d: true,
    },
    select: { id: true },
  });
  const results = [];
  for (const account of accounts) {
    results.push(await syncMetaCreativeSnapshotsForAdAccount({ adAccountId: account.id, limit, maxPages }));
  }
  return { accounts: accounts.length, results };
}
