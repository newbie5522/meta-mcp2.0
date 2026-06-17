import prisma from "../../db/index.js";
import { normalizeMetaAccountId } from "../utils.js";
import { getSpendAccountIdsInRange } from "./meta-performance-fact.service.js";

export interface ResolvedBinding {
  accountId: string;
  storeId: number | null;
  conflict: boolean;
  warning?: string;
}

export async function resolveAccountStoreBinding(accountId: string): Promise<ResolvedBinding> {
  const normId = normalizeMetaAccountId(accountId);
  const actId = `act_${normId}`;

  const [mapping, adAccount] = await Promise.all([
    prisma.accountMapping.findFirst({
      where: {
        OR: [{ fbAccountId: normId }, { fbAccountId: actId }],
      },
    }),
    prisma.adAccount.findFirst({
      where: {
        OR: [{ fb_account_id: normId }, { fb_account_id: actId }],
      },
    }),
  ]);

  const mapStoreId = mapping?.storeId || null;
  const adAccStoreId = adAccount?.storeId || null;

  if (mapStoreId && adAccStoreId && mapStoreId !== adAccStoreId) {
    return {
      accountId: normId,
      storeId: mapStoreId, // Priority
      conflict: true,
      warning: `Conflict detected for Meta Account ID ${normId}: AccountMapping store ID is ${mapStoreId}, but AdAccount store ID is ${adAccStoreId}. Using AccountMapping priority.`,
    };
  }

  return {
    accountId: normId,
    storeId: mapStoreId || adAccStoreId,
    conflict: false,
  };
}

export async function getAccountMappingFacts(params: { startDate: string; endDate: string; storeId?: number | "all" | string }) {
  const { startDate, endDate, storeId } = params;

  // Fetch all AdAccounts, AccountMappings, and active stores
  const [adAccounts, accountMappings, allStores] = await Promise.all([
    prisma.adAccount.findMany({ select: { fb_account_id: true, fb_account_name: true, storeId: true } }),
    prisma.accountMapping.findMany({ select: { fbAccountId: true, name: true, storeId: true } }),
    prisma.store.findMany({ select: { id: true, name: true } }),
  ]);

  const storeIdsSet = new Set(allStores.map(s => s.id));

  // Get list of unique accounts from DB configurations (inventory)
  const inventorySet = new Set<string>();
  adAccounts.forEach(a => inventorySet.add(normalizeMetaAccountId(a.fb_account_id)));
  accountMappings.forEach(m => inventorySet.add(normalizeMetaAccountId(m.fbAccountId)));

  const inventoryAccountIds = Array.from(inventorySet);

  const mappedAccountIds: string[] = [];
  const unmappedAccountIds: string[] = [];
  const mappingConflicts: string[] = [];

  const storeFilterNum = storeId && storeId !== "all" && storeId !== "undefined" ? Number(storeId) : null;

  // Resolve bindings for each inventory account
  const resolvedBindings = await Promise.all(
    inventoryAccountIds.map(async (accId) => {
      const bound = await resolveAccountStoreBinding(accId);
      if (bound.conflict && bound.warning) {
        mappingConflicts.push(bound.warning);
      }
      return bound;
    })
  );

  // Filter bindings based on Store existence
  for (const b of resolvedBindings) {
    const hasValidStore = b.storeId !== null && storeIdsSet.has(b.storeId);
    if (hasValidStore) {
      if (storeFilterNum === null || b.storeId === storeFilterNum) {
        mappedAccountIds.push(b.accountId);
      }
    } else {
      unmappedAccountIds.push(b.accountId);
    }
  }

  // Find actual spend accounts from FactMetaPerformance in range
  const spendAccountIds = await getSpendAccountIdsInRange({ startDate, endDate });

  const unmappedSpendAccountIds: string[] = [];
  let unmappedSpendAmount = 0;

  if (spendAccountIds.length > 0) {
    const perfRows = await prisma.factMetaPerformance.findMany({
      where: {
        level: "account",
        date: { gte: startDate, lte: endDate },
        account_id: { in: spendAccountIds },
      },
      select: { account_id: true, spend: true },
    });

    for (const id of spendAccountIds) {
      const bound = await resolveAccountStoreBinding(id);
      const hasValidStore = bound.storeId !== null && storeIdsSet.has(bound.storeId);
      if (!hasValidStore) {
        unmappedSpendAccountIds.push(id);
        const spendVal = perfRows
          .filter(r => normalizeMetaAccountId(r.account_id) === id)
          .reduce((sum, r) => sum + (r.spend || 0), 0);
        unmappedSpendAmount += spendVal;
      }
    }
  }

  return {
    adAccountsInventoryTotal: inventoryAccountIds.length,
    mappedAccountsCount: mappedAccountIds.length,
    unmappedAccountsCount: unmappedAccountIds.length,
    spendAccountsInRange: spendAccountIds.length,
    unmappedSpendAccountsInRange: unmappedSpendAccountIds.length,
    unmappedSpendAccountIds,
    unmappedSpendAmount,
    mappingConflicts,
    mappedAccountIds,
    unmappedAccountIds,
  };
}

export async function getUnmappedSpendAccounts(params: { startDate: string; endDate: string }) {
  const mappingFacts = await getAccountMappingFacts(params);
  return {
    unmappedSpendAccountsCount: mappingFacts.unmappedSpendAccountsInRange,
    unmappedSpendAccountIds: mappingFacts.unmappedSpendAccountIds,
    unmappedSpendAmount: mappingFacts.unmappedSpendAmount,
  };
}
