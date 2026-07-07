// @ts-nocheck
import prisma from "../../db/index.js";
import { normalizeMetaAccountId, getNumericAccountId } from "../utils.js";

export function canonicalActId(id: string | null | undefined): string {
  return normalizeMetaAccountId(String(id || ""));
}

/**
 * Dangerous cleanup helper.
 * Do not call before fetching fresh Meta rows.
 * Only use for explicit maintenance after successful upsert validation.
 */
export async function cleanMetaAccountFactsForRange(params: {
  accountIds: string[];
  startDate: string;
  endDate: string;
}) {
  const canonicalIds = params.accountIds.map(canonicalActId).filter(Boolean);
  const numericIds = canonicalIds.map(getNumericAccountId);

  const deleted = await prisma.factMetaPerformance.deleteMany({
    where: {
      level: "account",
      date: {
        gte: params.startDate,
        lte: params.endDate
      },
      OR: [
        { account_id: { in: canonicalIds } },
        { account_id: { in: numericIds } },
        { entity_id: { in: canonicalIds } },
        { entity_id: { in: numericIds } }
      ]
    }
  });

  return { deletedRows: deleted.count, canonicalIds, numericIds };
}

export async function getMetaAccountFactSpend(params: {
  accountIds: string[];
  startDate: string;
  endDate: string;
}) {
  const canonicalIds = params.accountIds.map(canonicalActId).filter(Boolean);

  const rows = await prisma.factMetaPerformance.findMany({
    where: {
      level: "account",
      account_id: { in: canonicalIds },
      entity_id: { in: canonicalIds },
      date: {
        gte: params.startDate,
        lte: params.endDate
      }
    }
  });

  const byAccount: Record<string, number> = {};
  for (const r of rows) {
    const id = canonicalActId(r.account_id);
    byAccount[id] = Number(((byAccount[id] || 0) + Number(r.spend || 0)).toFixed(2));
  }

  return { rows, byAccount };
}
