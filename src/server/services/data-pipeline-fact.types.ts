export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface OrderFactParams {
  startDate: string;
  endDate: string;
  storeId?: number | "all" | string;
  includeLegacyCreatedAtFallback?: boolean;
}

export interface OrderFactSummary {
  ordersCount: number;
  totalSales: number;
  aov: number;
  refundAmount: number;
  refundRate: number;
  legacyFallbackOrdersCount: number;
  legacyFallbackRevenue: number;
  legacyFallbackUsed: boolean;
  orders: any[];
}

export interface MetaPerformanceFactParams {
  startDate: string;
  endDate: string;
  storeId?: number | "all" | string;
  accountId?: string | "all";
}

export interface MetaPerformanceFactSummary {
  factRowsCount: number;
  spendAccountsInRange: number;
  spendAccountIds: string[];
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalPurchases: number;
  totalPurchaseValue: number;
  avgCtr: number;
  avgCpc: number;
  avgCpm: number;
  avgCpa: number;
  roas: number;
  dateRange: DateRange;
  source: "FactMetaPerformance";
}

export interface MappingFactSummary {
  adAccountsInventoryTotal: number;
  mappedAccountsCount: number;
  unmappedAccountsCount: number;
  spendAccountsInRange: number;
  unmappedSpendAccountsInRange: number;
  unmappedSpendAccountIds: string[];
  unmappedSpendAmount: number;
  mappingConflicts: string[];
  mappedAccountIds: string[];
  unmappedAccountIds: string[];
}

export interface FactSourceExplain {
  orderSource: "Order.store_local_date";
  metaSource: "FactMetaPerformance";
  mappingSource: "AccountMapping + AdAccount";
  legacyCreatedAtFallbackUsed: boolean;
  legacySourcesUsed: string[];
}

export interface DataPipelineAuditResult {
  success: boolean;
  status: "PASS" | "WARNING" | "FAIL";
  dateRange: DateRange;
  factSources: {
    orderSource: "Order.store_local_date";
    metaSource: "FactMetaPerformance";
    mappingSource: "AccountMapping + AdAccount";
  };
  counts: {
    storesTotal: number;
    ordersByStoreLocalDate: number;
    ordersMissingStoreLocalDate: number;
    legacyCreatedAtFallbackOrders: number;
    adAccountsInventoryTotal: number;
    metaStatusActiveAccounts: number;
    recentActivity90dAccounts: number;
    spendAccountsInRange: number;
    unmappedSpendAccountsInRange: number;
    factMetaPerformanceRowsInRange: number;
  };
  warnings: string[];
  violations: string[];
}
