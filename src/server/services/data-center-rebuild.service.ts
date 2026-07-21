import prisma from "../../db/index.js";
import { SyncCenter } from "./sync-center.service.js";
import { refreshMetaDataCenterLedger } from "./datacenter-meta-ledger.service.js";
import { executeStoreDataPipeline } from "./store-data-pipeline.service.js";
import { runDataCenterAudit } from "./data-center-audit.service.js";
import { getMetaToken } from "../utils.js";
import dayjs from "dayjs";

export interface StepResult {
  step: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  recordsFetched: number;
  recordsSaved: number;
  recordsUpdated: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
  sourceTable: string | null;
  targetTable: string | null;
}

export interface RebuildParams {
  startDate: string;
  endDate: string;
  storeId?: string | number | null;
  accountId?: string | null;
  includeMetaAccounts?: boolean;
  includeMetaStructure?: boolean;
  includeMetaRawFacts?: boolean;
  includeMetaLedger?: boolean;
  includeAudience?: boolean;
  includeStoreOrders?: boolean;
  includeStoreLedger?: boolean;
  rebuildStoreOrders?: boolean;
}

export async function runDataCenterRebuild(params: RebuildParams) {
  const taskChainId = "dc-rebuild-" + Math.random().toString(36).substring(2, 8);
  const startDb = dayjs(params.startDate);
  const endDb = dayjs(params.endDate);
  const daysDiff = Math.max(1, endDb.diff(startDb, "day") + 1);

  const steps: StepResult[] = [];

  // Determine parameters defaults
  const includeMetaAccounts = params.includeMetaAccounts !== false;
  const includeMetaStructure = params.includeMetaStructure !== false;
  const includeMetaRawFacts = params.includeMetaRawFacts !== false;
  const includeMetaLedger = params.includeMetaLedger !== false;
  const includeAudience = params.includeAudience !== false;
  const includeStoreOrders = params.includeStoreOrders !== false;
  const includeStoreLedger = params.includeStoreLedger !== false;
  const rebuildStoreOrders = !!params.rebuildStoreOrders;

  // Let's perform prechecks and load assets
  let hasMetaToken = false;
  let hasStoreTokens = false;

  // Track counts
  let metaStepsExecuted = 0;
  let storeStepsExecuted = 0;
  const storePipelineReceipts: any[] = [];

  // 1. precheck_meta_token
  const step1Start = new Date().toISOString();
  let metaToken: string | null = null;
  try {
    metaToken = await getMetaToken();
    hasMetaToken = !!metaToken;
  } catch (err) {}
  steps.push({
    step: "precheck_meta_token",
    status: hasMetaToken ? "SUCCESS" : "FAILED",
    recordsFetched: hasMetaToken ? 1 : 0,
    recordsSaved: hasMetaToken ? 1 : 0,
    recordsUpdated: 0,
    errorMessage: hasMetaToken ? null : "Meta access token is missing or invalid in settings",
    startedAt: step1Start,
    finishedAt: new Date().toISOString(),
    sourceTable: "Settings",
    targetTable: null
  });

  // 2. precheck_store_token
  const step2Start = new Date().toISOString();
  let targetStores: any[] = [];
  try {
    if (params.storeId) {
      targetStores = await prisma.store.findMany({ where: { id: Number(params.storeId) } });
    } else {
      targetStores = await prisma.store.findMany();
    }
    const tokenStores = targetStores.filter(
      s => s.shopline_token || s.shopify_token || s.shoplazza_token
    );
    hasStoreTokens = tokenStores.length > 0;
  } catch (err) {}
  steps.push({
    step: "precheck_store_token",
    status: hasStoreTokens ? "SUCCESS" : "FAILED",
    recordsFetched: targetStores.length,
    recordsSaved: targetStores.filter(s => s.shopline_token || s.shopify_token || s.shoplazza_token).length,
    recordsUpdated: 0,
    errorMessage: hasStoreTokens ? null : "No active store tokens found for any selected stores",
    startedAt: step2Start,
    finishedAt: new Date().toISOString(),
    sourceTable: "Store",
    targetTable: null
  });

  // 3. precheck_mapping
  const step3Start = new Date().toISOString();
  let mappingCount = 0;
  try {
    const mappingsFilter: any = {};
    if (params.storeId) {
      mappingsFilter.storeId = Number(params.storeId);
    }
    mappingCount = await prisma.accountMapping.count({ where: mappingsFilter });
  } catch (err) {}
  steps.push({
    step: "precheck_mapping",
    status: "SUCCESS",
    recordsFetched: mappingCount,
    recordsSaved: mappingCount,
    recordsUpdated: 0,
    errorMessage: mappingCount === 0 ? "Warning: No account mapping records found in local database." : null,
    startedAt: step3Start,
    finishedAt: new Date().toISOString(),
    sourceTable: "AccountMapping",
    targetTable: null
  });

  // 4. sync_meta_accounts
  const step4Start = new Date().toISOString();
  if (!includeMetaAccounts) {
    steps.push({
      step: "sync_meta_accounts",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped by parameter setting",
      startedAt: step4Start,
      finishedAt: step4Start,
      sourceTable: null,
      targetTable: null
    });
  } else if (!hasMetaToken) {
    steps.push({
      step: "sync_meta_accounts",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped because Meta access token is missing",
      startedAt: step4Start,
      finishedAt: step4Start,
      sourceTable: null,
      targetTable: null
    });
  } else {
    metaStepsExecuted++;
    try {
      const taskId = await SyncCenter.syncMetaAccounts(taskChainId, "rebuild_api", null);
      const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
      steps.push({
        step: "sync_meta_accounts",
        status: log?.status === "success" ? "SUCCESS" : "FAILED",
        recordsFetched: log?.recordsFetched || 0,
        recordsSaved: log?.recordsSaved || 0,
        recordsUpdated: 0,
        errorMessage: log?.status === "failed" ? "SyncCenter.syncMetaAccounts task failed" : null,
        startedAt: step4Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "AdAccount"
      });
    } catch (err: any) {
      steps.push({
        step: "sync_meta_accounts",
        status: "FAILED",
        recordsFetched: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        errorMessage: err.message || String(err),
        startedAt: step4Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "AdAccount"
      });
    }
  }

  // 5. sync_meta_structure
  const step5Start = new Date().toISOString();
  if (!includeMetaStructure) {
    steps.push({
      step: "sync_meta_structure",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped by parameter setting",
      startedAt: step5Start,
      finishedAt: step5Start,
      sourceTable: null,
      targetTable: null
    });
  } else if (!hasMetaToken) {
    steps.push({
      step: "sync_meta_structure",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped because Meta access token is missing",
      startedAt: step5Start,
      finishedAt: step5Start,
      sourceTable: null,
      targetTable: null
    });
  } else {
    metaStepsExecuted++;
    try {
      const taskId = await SyncCenter.syncMetaStructure(taskChainId, "rebuild_api", null);
      const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
      steps.push({
        step: "sync_meta_structure",
        status: log?.status === "success" ? "SUCCESS" : "FAILED",
        recordsFetched: log?.recordsFetched || 0,
        recordsSaved: log?.recordsSaved || 0,
        recordsUpdated: 0,
        errorMessage: log?.status === "failed" ? "SyncCenter.syncMetaStructure task failed" : null,
        startedAt: step5Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "Campaign, AdSet, Ad"
      });
    } catch (err: any) {
      steps.push({
        step: "sync_meta_structure",
        status: "FAILED",
        recordsFetched: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        errorMessage: err.message || String(err),
        startedAt: step5Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "Campaign, AdSet, Ad"
      });
    }
  }

  // 6. sync_meta_insights_to_fact_meta_performance
  const step6Start = new Date().toISOString();
  if (!includeMetaRawFacts) {
    steps.push({
      step: "sync_meta_insights_to_fact_meta_performance",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped by parameter setting",
      startedAt: step6Start,
      finishedAt: step6Start,
      sourceTable: null,
      targetTable: null
    });
  } else if (!hasMetaToken) {
    steps.push({
      step: "sync_meta_insights_to_fact_meta_performance",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped because Meta access token is missing",
      startedAt: step6Start,
      finishedAt: step6Start,
      sourceTable: null,
      targetTable: null
    });
  } else {
    metaStepsExecuted++;
    try {
      const taskId = await SyncCenter.syncMetaInsights(
        taskChainId,
        "rebuild_api",
        null,
        daysDiff,
        params.accountId || null,
        params.startDate,
        params.endDate
      );
      const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
      steps.push({
        step: "sync_meta_insights_to_fact_meta_performance",
        status: log?.status === "success" ? "SUCCESS" : "FAILED",
        recordsFetched: log?.recordsFetched || 0,
        recordsSaved: log?.recordsSaved || 0,
        recordsUpdated: 0,
        errorMessage: log?.status === "failed" ? "SyncCenter.syncMetaInsights task failed" : null,
        startedAt: step6Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "FactMetaPerformance"
      });
    } catch (err: any) {
      steps.push({
        step: "sync_meta_insights_to_fact_meta_performance",
        status: "FAILED",
        recordsFetched: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        errorMessage: err.message || String(err),
        startedAt: step6Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "FactMetaPerformance"
      });
    }
  }

  // 7. sync_meta_audience_to_fact_audience_breakdown
  const step7Start = new Date().toISOString();
  if (!includeAudience) {
    steps.push({
      step: "sync_meta_audience_to_fact_audience_breakdown",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped by parameter setting",
      startedAt: step7Start,
      finishedAt: step7Start,
      sourceTable: null,
      targetTable: null
    });
  } else if (!hasMetaToken) {
    steps.push({
      step: "sync_meta_audience_to_fact_audience_breakdown",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped because Meta access token is missing",
      startedAt: step7Start,
      finishedAt: step7Start,
      sourceTable: null,
      targetTable: null
    });
  } else {
    metaStepsExecuted++;
    try {
      const taskId = await SyncCenter.syncMetaAudience(
        taskChainId,
        "rebuild_api",
        null,
        daysDiff,
        params.accountId || null,
        params.startDate,
        params.endDate
      );
      const log = await prisma.syncLog.findUnique({ where: { id: taskId } });
      steps.push({
        step: "sync_meta_audience_to_fact_audience_breakdown",
        status: log?.status === "success" ? "SUCCESS" : "FAILED",
        recordsFetched: log?.recordsFetched || 0,
        recordsSaved: log?.recordsSaved || 0,
        recordsUpdated: 0,
        errorMessage: log?.status === "failed" ? "SyncCenter.syncMetaAudience task failed" : null,
        startedAt: step7Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "FactAudienceBreakdown"
      });
    } catch (err: any) {
      steps.push({
        step: "sync_meta_audience_to_fact_audience_breakdown",
        status: "FAILED",
        recordsFetched: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        errorMessage: err.message || String(err),
        startedAt: step7Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "Meta API",
        targetTable: "FactAudienceBreakdown"
      });
    }
  }

  // 8. refresh_meta_datacenter_ledger
  const step8Start = new Date().toISOString();
  if (!includeMetaLedger) {
    steps.push({
      step: "refresh_meta_datacenter_ledger",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped by parameter setting",
      startedAt: step8Start,
      finishedAt: step8Start,
      sourceTable: null,
      targetTable: null
    });
  } else if (!hasMetaToken) {
    steps.push({
      step: "refresh_meta_datacenter_ledger",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped because Meta access token is missing",
      startedAt: step8Start,
      finishedAt: step8Start,
      sourceTable: null,
      targetTable: null
    });
  } else {
    metaStepsExecuted++;
    try {
      const result = await refreshMetaDataCenterLedger({
        startDate: params.startDate,
        endDate: params.endDate,
        storeId: params.storeId ? Number(params.storeId) : undefined,
        accountIds: params.accountId ? [params.accountId] : undefined,
        includeUnmapped: true
      });
      steps.push({
        step: "refresh_meta_datacenter_ledger",
        status: (result.failedAccounts || []).length > 0 ? "PARTIAL" : "SUCCESS",
        recordsFetched: result.recordsFetched || 0,
        recordsSaved: result.recordsSaved || 0,
        recordsUpdated: result.recordsUpdated || 0,
        errorMessage: (result.failedAccounts || []).length > 0 
          ? `Failed accounts found: ${JSON.stringify(result.failedAccounts)}`
          : null,
        startedAt: step8Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "FactMetaPerformance",
        targetTable: "DataCenterMetaAccountDaily"
      });
    } catch (err: any) {
      steps.push({
        step: "refresh_meta_datacenter_ledger",
        status: "FAILED",
        recordsFetched: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        errorMessage: err.message || String(err),
        startedAt: step8Start,
        finishedAt: new Date().toISOString(),
        sourceTable: "FactMetaPerformance",
        targetTable: "DataCenterMetaAccountDaily"
      });
    }
  }

  // 9. sync_store_orders_to_order
  const step9Start = new Date().toISOString();
  if (!includeStoreOrders) {
    steps.push({
      step: "sync_store_orders_to_order",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped by parameter setting",
      startedAt: step9Start,
      finishedAt: step9Start,
      sourceTable: null,
      targetTable: null
    });
  } else if (!hasStoreTokens) {
    steps.push({
      step: "sync_store_orders_to_order",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped because no target stores have tokens found in system",
      startedAt: step9Start,
      finishedAt: step9Start,
      sourceTable: null,
      targetTable: null
    });
  } else {
    storeStepsExecuted++;
    let totalFetched = 0;
    let totalSaved = 0;
    const failedSyncStores: any[] = [];
    const activeStores = targetStores.filter(
      s => s.shopline_token || s.shopify_token || s.shoplazza_token
    );

    for (const store of activeStores) {
      try {
        const receipt = await executeStoreDataPipeline({
          store,
          chainId: taskChainId,
          triggeredBy: "rebuild_api",
          days: daysDiff,
          startDate: params.startDate,
          endDate: params.endDate,
          rebuild: rebuildStoreOrders
        } as any);
        storePipelineReceipts.push(receipt);
        totalFetched += receipt.orderSync.recordsFetched || 0;
        totalSaved += receipt.orderSync.recordsSaved || 0;
        if (receipt.orderSync.status === "FAILED" || receipt.status === "FAILED") {
          failedSyncStores.push({ storeId: store.id, message: receipt.orderSync.error || "Store pipeline sync failed" });
        }
      } catch (err: any) {
        failedSyncStores.push({ storeId: store.id, message: err.message || String(err) });
      }
    }

    let statusVal: "SUCCESS" | "PARTIAL" | "FAILED" = "SUCCESS";
    if (failedSyncStores.length > 0) {
      if (failedSyncStores.length === activeStores.length) {
        statusVal = "FAILED";
      } else {
        statusVal = "PARTIAL";
      }
    }

    steps.push({
      step: "sync_store_orders_to_order",
      status: statusVal,
      recordsFetched: totalFetched,
      recordsSaved: totalSaved,
      recordsUpdated: 0,
      errorMessage: failedSyncStores.length > 0 
        ? `Exceptions: ${JSON.stringify(failedSyncStores)}`
        : null,
      startedAt: step9Start,
      finishedAt: new Date().toISOString(),
      sourceTable: "Store API",
      targetTable: "Order"
    });
  }

  // 10. refresh_store_datacenter_ledger
  const step10Start = new Date().toISOString();
  if (!includeStoreLedger) {
    steps.push({
      step: "refresh_store_datacenter_ledger",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped by parameter setting",
      startedAt: step10Start,
      finishedAt: step10Start,
      sourceTable: null,
      targetTable: null
    });
  } else if (!hasStoreTokens) {
    steps.push({
      step: "refresh_store_datacenter_ledger",
      status: "SKIPPED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: "Skipped because no target stores have tokens found in system",
      startedAt: step10Start,
      finishedAt: step10Start,
      sourceTable: null,
      targetTable: null
    });
  } else {
    storeStepsExecuted++;
    let totalFetched = 0;
    let totalSaved = 0;
    const failedLedgerStores: any[] = [];
    const activeStores = targetStores.filter(
      s => s.shopline_token || s.shopify_token || s.shoplazza_token
    );

    for (const store of activeStores) {
      try {
        let receipt = storePipelineReceipts.find(item => Number(item.storeId) === Number(store.id));
        if (!receipt) {
          receipt = await executeStoreDataPipeline({
            store,
            chainId: taskChainId,
            triggeredBy: "rebuild_api",
            days: daysDiff,
            startDate: params.startDate,
            endDate: params.endDate,
            rebuild: rebuildStoreOrders
          });
          storePipelineReceipts.push(receipt);
        }
        totalFetched += receipt.ledger.recordsFetched || 0;
        totalSaved += receipt.ledger.recordsSaved || 0;
        if (receipt.ledger.status === "FAILED") {
          failedLedgerStores.push({ storeId: store.id, message: receipt.ledger.error || "Store ledger projection failed" });
        }
      } catch (err: any) {
        failedLedgerStores.push({ storeId: store.id, message: err.message || String(err) });
      }
    }

    let statusVal: "SUCCESS" | "PARTIAL" | "FAILED" = "SUCCESS";
    if (failedLedgerStores.length > 0) {
      if (failedLedgerStores.length === activeStores.length) {
        statusVal = "FAILED";
      } else {
        statusVal = "PARTIAL";
      }
    }

    steps.push({
      step: "refresh_store_datacenter_ledger",
      status: statusVal,
      recordsFetched: totalFetched,
      recordsSaved: totalSaved,
      recordsUpdated: 0,
      errorMessage: failedLedgerStores.length > 0 
        ? `Exceptions: ${JSON.stringify(failedLedgerStores)}`
        : null,
      startedAt: step10Start,
      finishedAt: new Date().toISOString(),
      sourceTable: "Order",
      targetTable: "DataCenterStoreDaily"
    });
  }

  // 11. run_data_center_audit
  const step11Start = new Date().toISOString();
  let auditReport: any = null;
  try {
    auditReport = await runDataCenterAudit({
      startDate: params.startDate,
      endDate: params.endDate,
      storeId: params.storeId ? String(params.storeId) : undefined,
      accountId: params.accountId ? String(params.accountId) : undefined
    });

    steps.push({
      step: "run_data_center_audit",
      status: "SUCCESS",
      recordsFetched: 1,
      recordsSaved: 1,
      recordsUpdated: 0,
      errorMessage: null,
      startedAt: step11Start,
      finishedAt: new Date().toISOString(),
      sourceTable: "Multiple Tables",
      targetTable: "Report"
    });
  } catch (err: any) {
    steps.push({
      step: "run_data_center_audit",
      status: "FAILED",
      recordsFetched: 0,
      recordsSaved: 0,
      recordsUpdated: 0,
      errorMessage: err.message || String(err),
      startedAt: step11Start,
      finishedAt: new Date().toISOString(),
      sourceTable: "Multiple Tables",
      targetTable: "Report"
    });
  }

  // Aggregate stats
  const totalSteps = steps.length;
  const successSteps = steps.filter(s => s.status === "SUCCESS").length;
  const partialSteps = steps.filter(s => s.status === "PARTIAL").length;
  const failedSteps = steps.filter(s => s.status === "FAILED").length;
  const skippedSteps = steps.filter(s => s.status === "SKIPPED").length;

  let overallStatus: "SUCCESS" | "PARTIAL" | "FAILED" = "SUCCESS";
  if (failedSteps > 0) {
    if (successSteps === 0 && partialSteps === 0) {
      overallStatus = "FAILED";
    } else {
      overallStatus = "PARTIAL";
    }
  } else if (partialSteps > 0) {
    overallStatus = "PARTIAL";
  }

  // Generate actionable nextActions from failed steps and audit report
  const nextActions: string[] = [];
  steps.forEach(s => {
    if (s.status === "FAILED" && s.errorMessage) {
      nextActions.push(`Fix issue with ${s.step}: ${s.errorMessage}`);
    }
  });

  if (auditReport?.nextActions) {
    nextActions.push(...auditReport.nextActions);
  }

  // Simple backup defaults if empty
  if (nextActions.length === 0) {
    nextActions.push("Data Center Rebuild finished successfully with all records synchronized perfectly.");
  }

  return {
    success: overallStatus !== "FAILED",
    status: overallStatus,
    startDate: params.startDate,
    endDate: params.endDate,
    filters: {
      storeId: params.storeId || null,
      accountId: params.accountId || null
    },
    steps,
    summary: {
      totalSteps,
      successSteps,
      partialSteps,
      failedSteps,
      skippedSteps,
      metaStepsExecuted,
      storeStepsExecuted
    },
    auditReport,
    nextActions: Array.from(new Set(nextActions)),
    dataSourceExplain: {
      metaRawFactTarget: "FactMetaPerformance",
      metaLedgerTarget: "DataCenterMetaAccountDaily",
      audienceTarget: "FactAudienceBreakdown",
      storeOrderTarget: "Order",
      storeLedgerTarget: "DataCenterStoreDaily",
      finalAudit: "runDataCenterAudit"
    }
  };
}
