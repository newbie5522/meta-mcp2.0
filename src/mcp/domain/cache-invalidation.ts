// @ts-nocheck
import { cacheDelete, cacheKey } from "../../packages/cache/src/index.js";
import { prisma } from "../db/prisma.js";

export function analysisRangeKey(since: Date, until: Date): string {
  return `${since.toISOString().slice(0, 10)}:${until.toISOString().slice(0, 10)}`;
}

export async function invalidateAdAccountAnalysisCaches(input: {
  adAccountId: string;
  since: Date;
  until: Date;
}): Promise<void> {
  const range = analysisRangeKey(input.since, input.until);
  await Promise.all([
    cacheDelete(cacheKey.dashboard()),
    cacheDelete(cacheKey.accountSummary("all", range)),
    cacheDelete(cacheKey.accountSummary(input.adAccountId, range)),
  ]);

  const mappings = await prisma.storeAdAccountMap.findMany({
    where: { adAccountId: input.adAccountId },
    select: { storeId: true },
  });
  await Promise.all(mappings.map((mapping) => invalidateStoreAnalysisCaches({
    storeId: mapping.storeId,
    since: input.since,
    until: input.until,
  })));
}

export async function invalidateStoreAnalysisCaches(input: {
  storeId: string;
  since: Date;
  until: Date;
}): Promise<void> {
  const range = analysisRangeKey(input.since, input.until);
  const until = input.until.toISOString().slice(0, 10);
  await Promise.all([
    cacheDelete(cacheKey.dashboard()),
    cacheDelete(cacheKey.storeSummary(input.storeId, range)),
    cacheDelete(cacheKey.accountSummary(`store:${input.storeId}`, range)),
    cacheDelete(cacheKey.countryAnalysis(input.storeId, range)),
    cacheDelete(cacheKey.productAnalysis(input.storeId, range)),
    cacheDelete(cacheKey.creativeAnalysis(input.storeId, range)),
    cacheDelete(cacheKey.trendAnalysis(input.storeId, until)),
  ]);
}
