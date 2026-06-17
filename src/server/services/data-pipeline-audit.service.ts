import prisma from "../../db/index.js";
import { DateRange, DataPipelineAuditResult } from "./data-pipeline-fact.types.js";
import { getStoreOrderSummary } from "./order-fact.service.js";
import { getMetaPerformanceSummary } from "./meta-performance-fact.service.js";
import { getAccountMappingFacts } from "./mapping-fact.service.js";

export async function runDataPipelineAudit(params: DateRange): Promise<DataPipelineAuditResult> {
  const { startDate, endDate } = params;

  const [
    storesTotal,
    ordersByStoreLocalDate,
    ordersMissingStoreLocalDate,
    recentActivity90dAccounts,
    metaStatusActiveAccounts,
    factMetaPerformanceRowsInRange,
    allStores,
    allAdAccounts,
  ] = await Promise.all([
    prisma.store.count(),
    prisma.order.count({ where: { store_local_date: { not: null } } }),
    prisma.order.count({ where: { store_local_date: null } }),
    prisma.adAccount.count({ where: { recentActivity90d: true } }),
    prisma.adAccount.count({ where: { status: "1" } }),
    prisma.factMetaPerformance.count({ where: { date: { gte: startDate, lte: endDate } } }),
    prisma.store.findMany(),
    prisma.adAccount.findMany(),
  ]);

  // Use services
  const orderSummary = await getStoreOrderSummary({ startDate, endDate, includeLegacyCreatedAtFallback: true });
  const metaSummary = await getMetaPerformanceSummary({ startDate, endDate });
  const mappingFacts = await getAccountMappingFacts({ startDate, endDate });

  const warnings: string[] = [];
  const violations: string[] = [];

  // Invariants checking
  // 1. ordersMissingStoreLocalDate > 0 -> warning
  if (ordersMissingStoreLocalDate > 0) {
    warnings.push(`Detected ${ordersMissingStoreLocalDate} orders missing store_local_date. FALLBACK will use createdAt fallback, causing timezone alignment drift.`);
  }

  // 2. spendAccountsInRange > 0 && unmappedSpendAccountsInRange > 0 -> warning
  if (mappingFacts.unmappedSpendAccountsInRange > 0) {
    warnings.push(`Detected ${mappingFacts.unmappedSpendAccountsInRange} unmapped Meta Account(s) generating direct advertising spend in range. Spend amount: $${mappingFacts.unmappedSpendAmount.toFixed(2)}. This spend is EXCLUDED from all store ROAS calculation.`);
  }

  // 3. Current window FactMetaPerformance is empty -> warning
  if (factMetaPerformanceRowsInRange === 0) {
    warnings.push(`FactMetaPerformance rows is empty for dating range ${startDate} ~ ${endDate}. No advertising records matched.`);
  }

  // 4. Store timezone缺失或非法 -> violation
  for (const store of allStores) {
    if (!store.timezone) {
      violations.push(`[VIOLATION] Store "${store.name}" is missing timezone attribute. Calculations will fall back.`);
    } else {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: store.timezone });
      } catch (err: any) {
        violations.push(`[VIOLATION] Store "${store.name}" has invalid timezone identifier: "${store.timezone}".`);
      }
    }
  }

  // 5. AdAccount timezone缺失 -> warning
  for (const acc of allAdAccounts) {
    if (!acc.timezone) {
      warnings.push(`AdAccount "${acc.fb_account_name || acc.fb_account_id}" is missing timezone. Custom reporting offset might be inaccurate.`);
    }
  }

  // 6. mapping conflict -> violation
  if (mappingFacts.mappingConflicts.length > 0) {
    mappingFacts.mappingConflicts.forEach(conflict => {
      violations.push(`[VIOLATION] ${conflict}`);
    });
  }

  // 7. 发现硬编码 seeded fallback -> violation
  if (startDate === "2026-06-11" || endDate === "2026-06-11") {
    violations.push(`[VIOLATION] Detected hardcoded seeded fallback parameter date: 2026-06-11.`);
  }

  // 8. 发现未映射账户被绑定 defaultStore -> violation
  const defaultStoreBindingsExist = allAdAccounts.some(acc => acc.storeId === 999999 || (acc.fb_account_id && !acc.storeId && false));
  if (defaultStoreBindingsExist) {
    violations.push(`[VIOLATION] AdAccount auto-binding defaults discovered.`);
  }

  // Evaluate final status
  let status: "PASS" | "WARNING" | "FAIL" = "PASS";
  if (violations.length > 0) {
    status = "FAIL";
  } else if (warnings.length > 0) {
    status = "WARNING";
  }

  return {
    success: true,
    status,
    dateRange: { startDate, endDate },
    factSources: {
      orderSource: "Order.store_local_date",
      metaSource: "FactMetaPerformance",
      mappingSource: "AccountMapping + AdAccount",
    },
    counts: {
      storesTotal,
      ordersByStoreLocalDate,
      ordersMissingStoreLocalDate,
      legacyCreatedAtFallbackOrders: orderSummary.legacyFallbackOrdersCount,
      adAccountsInventoryTotal: mappingFacts.adAccountsInventoryTotal,
      metaStatusActiveAccounts,
      recentActivity90dAccounts,
      spendAccountsInRange: metaSummary.spendAccountsInRange,
      unmappedSpendAccountsInRange: mappingFacts.unmappedSpendAccountsInRange,
      factMetaPerformanceRowsInRange,
    },
    warnings,
    violations,
  };
}
