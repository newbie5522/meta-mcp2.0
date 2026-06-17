import prisma from "../../db/index.js";
import { MetaPerformanceFactParams, MetaPerformanceFactSummary, DateRange } from "./data-pipeline-fact.types.js";
import { normalizeMetaAccountId } from "../utils.js";

function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  const parsed = Number(String(val));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getMetaAccountPerformanceFacts(params: MetaPerformanceFactParams) {
  const { startDate, endDate, accountId } = params;

  const whereClause: any = {
    level: "account",
    date: {
      gte: startDate,
      lte: endDate,
    },
  };

  if (accountId && accountId !== "all" && accountId !== "undefined") {
    whereClause.account_id = normalizeMetaAccountId(accountId);
  }

  return prisma.factMetaPerformance.findMany({
    where: whereClause,
    orderBy: { date: "desc" },
  });
}

export async function getSpendAccountIdsInRange(params: DateRange): Promise<string[]> {
  const { startDate, endDate } = params;

  const rows = await prisma.factMetaPerformance.findMany({
    where: {
      level: "account",
      date: {
        gte: startDate,
        lte: endDate,
      },
      spend: {
        gt: 0,
      },
    },
    select: {
      account_id: true,
    },
  });

  const distinctIds = new Set(rows.map(r => normalizeMetaAccountId(r.account_id)));
  return Array.from(distinctIds);
}

export async function getMetaPerformanceSummary(params: MetaPerformanceFactParams): Promise<MetaPerformanceFactSummary> {
  const rows = await getMetaAccountPerformanceFacts(params);

  const distinctAccounts = new Set<string>();
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalPurchases = 0;
  let totalPurchaseValue = 0;

  for (const row of rows) {
    const accId = normalizeMetaAccountId(row.account_id);
    distinctAccounts.add(accId);

    totalSpend += toNumber(row.spend);
    totalImpressions += toNumber(row.impressions);
    totalClicks += toNumber(row.clicks);
    totalPurchases += toNumber(row.purchases);
    totalPurchaseValue += toNumber(row.purchase_value);
  }

  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
  const avgCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
  const roas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

  return {
    factRowsCount: rows.length,
    spendAccountsInRange: distinctAccounts.size,
    spendAccountIds: Array.from(distinctAccounts),
    totalSpend,
    totalImpressions,
    totalClicks,
    totalPurchases,
    totalPurchaseValue,
    avgCtr,
    avgCpc,
    avgCpm,
    avgCpa,
    roas,
    dateRange: {
      startDate: params.startDate,
      endDate: params.endDate,
    },
    source: "FactMetaPerformance",
  };
}

export async function getFactMetaDateRangeAudit(params: DateRange) {
  const totalInDb = await prisma.factMetaPerformance.count();
  const levelAccountDb = await prisma.factMetaPerformance.count({ where: { level: "account" } });
  const inRangeCount = await prisma.factMetaPerformance.count({
    where: {
      date: {
        gte: params.startDate,
        lte: params.endDate,
      },
    },
  });

  return {
    totalRowsInDb: totalInDb,
    levelAccountRowsInDb: levelAccountDb,
    rowsInRange: inRangeCount,
  };
}
