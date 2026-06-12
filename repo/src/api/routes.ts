import { Router, type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { createStore, deactivateStore, listStores, updateStore } from "../domain/stores.js";
import { listAdAccounts, syncMetaAdAccounts } from "../domain/ad-accounts.js";
import { getAccountSpendReport } from "../domain/account-spend.js";
import { accountAnalysisQuerySchema, getAccountDetailAnalysis } from "../domain/account-analysis.js";
import { audienceAnalysisQuerySchema, getAudienceAnalysis } from "../domain/audience-analysis.js";
import { runCopilotChat } from "../../packages/ai/src/copilot.js";
import { generateCreativeBrief } from "../../packages/ai/src/creative.js";
import {
  deleteAiProviderSetting,
  listAiProviderSettings,
  listAvailableAiModels,
  setAiProviderEnabled,
  updateAiProviderSetting,
  upsertAiProviderSetting,
} from "../../packages/ai/src/providers.js";
import {
  bindStoreToAdAccount,
  bindStoreToAdAccounts,
  importConfirmedMappings,
  mappingImportRowSchema,
  validateMappingImport,
  validateMappingImportFile,
} from "../domain/mappings.js";
import { syncAllStoreOrders, syncStoreOrders, testStoreConnectionByCredentials, testStoreOrderAccess } from "../domain/order-sync.js";
import { syncStoreProfile } from "../domain/store-profile.js";
import {
  insightBreakdownSchema,
  syncMetaInsightsForActiveAccounts,
  syncMetaInsightsForAdAccount,
  syncMetaInsightsForStore,
} from "../domain/meta-insights-sync.js";
import { syncMetaCreativeSnapshotsForAdAccount, syncMetaCreativeSnapshotsForStore } from "../domain/meta-creatives-sync.js";
import { syncMetaStructureForAdAccount, syncMetaStructureForStore } from "../domain/meta-structure-sync.js";
import { getSyncOperationsSummary, listSyncLogs, retryFailedSyncLogs } from "../domain/sync-logs.js";
import {
  generateCreativeBriefFromSuggestion,
  getAiAnalysisReportById,
  getAiActionSuggestionReport,
  listAiActionSuggestions,
  updateAiActionSuggestionStatus,
} from "../domain/ai-suggestions.js";
import { createAdAccountDeepAnalysisReport, createEntityDeepAnalysisReport, entityDeepAnalysisSchema } from "../domain/ai-deep-analysis.js";
import { runMediaBuyingRuleMonitor } from "../domain/rule-monitor.js";
import { requireAdmin } from "../admin/session.js";
import { getDashboardSummary } from "../domain/dashboard.js";
import { getSystemConfigSummary } from "../domain/system-config.js";
import {
  analysisRangeSchema,
  getCountryAnalysis,
  getCreativeAnalysis,
  getProductAnalysis,
  getStoreAdAccountAnalysis,
  getStoreOverviewAnalysis,
  getTrendAnalysis,
  trendAnalysisSchema,
} from "../domain/analysis.js";

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

async function trySyncStoreProfile(storeId: string) {
  try {
    return { profileSync: await syncStoreProfile(storeId), warning: null };
  } catch (error) {
    return {
      profileSync: null,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

const idParamsSchema = z.object({ id: z.string().min(1) });
const bindSchema = z.object({
  storeId: z.string().min(1),
  adAccountId: z.string().min(1),
});
const csvSchema = z.object({
  csv: z.string().min(1),
});
const importFileSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentBase64: z.string().min(1).max(1_500_000),
});
const syncOrdersSchema = z.object({
  rangeStart: z.string().optional(),
  rangeEnd: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  storeId: z.string().optional(),
  limit: z.number().int().min(1).max(250).optional(),
  maxPages: z.number().int().min(1).max(100).optional(),
});
const testStoreConnectionSchema = z.object({
  domain: z.string().min(1),
  token: z.string().min(1),
});
const syncMetaAccountSchema = z.object({
  adAccountId: z.string().min(1),
  days: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
  since: z.string().optional(),
  until: z.string().optional(),
  level: z.enum(["campaign", "adset", "ad"]).optional(),
  countryBreakdown: z.boolean().optional(),
  syncBreakdowns: z.boolean().optional(),
  breakdowns: z.array(insightBreakdownSchema).max(5).optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
});
const syncMetaActiveAccountsSchema = z.object({
  days: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  level: z.enum(["campaign", "adset", "ad"]).optional(),
  countryBreakdown: z.boolean().optional(),
  syncBreakdowns: z.boolean().optional(),
  breakdowns: z.array(insightBreakdownSchema).max(5).optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
  accountLimit: z.number().int().min(1).max(500).optional(),
});
const syncMetaStoreSchema = z.object({
  storeId: z.string().min(1),
  days: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
  since: z.string().optional(),
  until: z.string().optional(),
  level: z.enum(["campaign", "adset", "ad"]).optional(),
  countryBreakdown: z.boolean().optional(),
  syncBreakdowns: z.boolean().optional(),
  breakdowns: z.array(insightBreakdownSchema).max(5).optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
});
const syncCreativeAccountSchema = z.object({
  adAccountId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
});
const syncCreativeStoreSchema = z.object({
  storeId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
});
const syncStructureAccountSchema = z.object({
  adAccountId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
});
const syncStructureStoreSchema = z.object({
  storeId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
});

export function createApiRouter(): Router {
  const router = Router();

  router.use(requireAdmin);

  router.get("/dashboard", asyncHandler(async (req, res) => {
    const refresh = req.query.refresh === "true" || req.query.refresh === "1";
    const since = typeof req.query.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.since)
      ? new Date(`${req.query.since}T00:00:00.000Z`)
      : undefined;
    const until = typeof req.query.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.until)
      ? new Date(`${req.query.until}T00:00:00.000Z`)
      : undefined;
    res.json({ data: await getDashboardSummary({ refresh, since, until }) });
  }));

  router.get("/system/config-summary", asyncHandler(async (_req, res) => {
    res.json({ data: await getSystemConfigSummary() });
  }));

  router.get("/stores", asyncHandler(async (_req, res) => {
    res.json({ data: await listStores() });
  }));

  router.post("/stores", asyncHandler(async (req, res) => {
    const store = await createStore(req.body);
    const profile = await trySyncStoreProfile(store.id);
    res.status(201).json({ data: profile.profileSync?.store ?? store, warning: profile.warning });
  }));

  router.patch("/stores/:id", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const store = await updateStore(id, req.body);
    const shouldSyncProfile = Boolean(req.body?.apiToken || req.body?.domain || req.body?.apiBaseUrl || req.body?.platform);
    const profile = shouldSyncProfile ? await trySyncStoreProfile(store.id) : { profileSync: null, warning: null };
    res.json({ data: profile.profileSync?.store ?? store, warning: profile.warning });
  }));

  router.post("/stores/:id/deactivate", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json({ data: await deactivateStore(id) });
  }));

  router.post("/stores/:id/test-token", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json({ data: await testStoreOrderAccess(id) });
  }));

  router.post("/stores/test-shoplazza-connection", asyncHandler(async (req, res) => {
    const body = testStoreConnectionSchema.parse(req.body ?? {});
    const result = await testStoreConnectionByCredentials({ platform: "shoplazza", domain: body.domain, token: body.token });
    res.json({
      success: true,
      message: result.message,
      products: result.products ?? [],
      api_path_used: result.endpoint,
      data: result,
    });
  }));

  router.post("/stores/test-shopline-connection", asyncHandler(async (req, res) => {
    const body = testStoreConnectionSchema.parse(req.body ?? {});
    const result = await testStoreConnectionByCredentials({ platform: "shopline", domain: body.domain, token: body.token });
    res.json({
      success: true,
      message: result.message,
      products: result.products ?? [],
      api_path_used: result.endpoint,
      data: result,
    });
  }));

  router.post("/stores/test-shopify-connection", asyncHandler(async (req, res) => {
    const body = testStoreConnectionSchema.parse(req.body ?? {});
    const result = await testStoreConnectionByCredentials({ platform: "shopify", domain: body.domain, token: body.token });
    res.json({
      success: true,
      message: result.message,
      products: result.products ?? [],
      api_path_used: result.endpoint,
      data: result,
    });
  }));

  router.post("/stores/:id/sync-profile", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json({ data: await syncStoreProfile(id) });
  }));

  router.post("/stores/:id/sync-orders", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = syncOrdersSchema.parse(req.body ?? {});
    const result = await syncStoreOrders({
      storeId: id,
      rangeStart: parseDate(body.rangeStart),
      rangeEnd: parseDate(body.rangeEnd),
      limit: body.limit,
      maxPages: body.maxPages,
    });
    res.json({ data: result });
  }));

  router.post("/sync-store", asyncHandler(async (req, res) => {
    const body = syncOrdersSchema.parse(req.body ?? {});
    const result = await syncAllStoreOrders({
      storeId: body.storeId,
      rangeStart: parseDate(body.rangeStart ?? body.startDate),
      rangeEnd: parseDate(body.rangeEnd ?? body.endDate),
      limit: body.limit,
      maxPages: body.maxPages,
    });
    res.json({
      success: result.success,
      fetched: result.fetched,
      saved: result.saved,
      stores: result.stores,
      results: result.results,
      data: result,
    });
  }));

  router.get("/ad-accounts", asyncHandler(async (_req, res) => {
    res.json({ data: await listAdAccounts() });
  }));

  router.post("/ad-accounts/sync", asyncHandler(async (req, res) => {
    const body = z.object({
      limit: z.number().int().min(1).max(500).optional(),
      activeLastDays: z.number().int().min(1).max(365).optional(),
    }).parse(req.body ?? {});
    res.json({ data: await syncMetaAdAccounts(body) });
  }));

  router.get("/ad-accounts/spend", asyncHandler(async (req, res) => {
    res.json({ data: await getAccountSpendReport(req.query) });
  }));

  router.post("/mappings/bind", asyncHandler(async (req, res) => {
    const body = bindSchema.parse(req.body);
    res.json({ data: await bindStoreToAdAccount(body.storeId, body.adAccountId) });
  }));

  router.post("/mappings/bind-bulk", asyncHandler(async (req, res) => {
    const body = z.object({
      storeId: z.string().min(1),
      adAccountIds: z.array(z.string().min(1)).min(1).max(200),
    }).parse(req.body ?? {});
    res.json({ data: await bindStoreToAdAccounts(body.storeId, body.adAccountIds) });
  }));

  router.post("/mappings/validate-csv", asyncHandler(async (req, res) => {
    const body = csvSchema.parse(req.body);
    res.json({ data: await validateMappingImport(body.csv) });
  }));

  router.post("/mappings/validate-file", asyncHandler(async (req, res) => {
    const body = importFileSchema.parse(req.body);
    res.json({ data: await validateMappingImportFile(body) });
  }));

  router.post("/mappings/import-confirmed", asyncHandler(async (req, res) => {
    const body = z.object({ rows: z.array(mappingImportRowSchema) }).parse(req.body);
    res.json({ data: await importConfirmedMappings(body.rows) });
  }));

  router.post("/meta-insights/sync-account", asyncHandler(async (req, res) => {
    const body = syncMetaAccountSchema.parse(req.body);
    res.json({ data: await syncMetaInsightsForAdAccount(body) });
  }));

  router.post("/meta-insights/sync-active-accounts", asyncHandler(async (req, res) => {
    const body = syncMetaActiveAccountsSchema.parse(req.body ?? {});
    res.json({ data: await syncMetaInsightsForActiveAccounts(body) });
  }));

  router.post("/meta-insights/sync-store", asyncHandler(async (req, res) => {
    const body = syncMetaStoreSchema.parse(req.body);
    res.json({
      data: await syncMetaInsightsForStore(body.storeId, body.days, body.maxPages ?? 10, {
        since: body.since,
        until: body.until,
        level: body.level,
        countryBreakdown: body.countryBreakdown,
        syncBreakdowns: body.syncBreakdowns,
        breakdowns: body.breakdowns,
      }),
    });
  }));

  router.post("/meta-structure/sync-account", asyncHandler(async (req, res) => {
    const body = syncStructureAccountSchema.parse(req.body);
    res.json({ data: await syncMetaStructureForAdAccount(body) });
  }));

  router.post("/meta-structure/sync-store", asyncHandler(async (req, res) => {
    const body = syncStructureStoreSchema.parse(req.body);
    res.json({ data: await syncMetaStructureForStore(body.storeId, body.limit ?? 500, body.maxPages ?? 10) });
  }));

  router.post("/meta-creatives/sync-account", asyncHandler(async (req, res) => {
    const body = syncCreativeAccountSchema.parse(req.body);
    res.json({ data: await syncMetaCreativeSnapshotsForAdAccount(body) });
  }));

  router.post("/meta-creatives/sync-store", asyncHandler(async (req, res) => {
    const body = syncCreativeStoreSchema.parse(req.body);
    res.json({ data: await syncMetaCreativeSnapshotsForStore(body.storeId, body.limit ?? 250, body.maxPages ?? 10) });
  }));

  router.get("/sync-logs", asyncHandler(async (req, res) => {
    res.json({ data: await listSyncLogs(req.query) });
  }));

  router.get("/sync-logs/summary", asyncHandler(async (_req, res) => {
    res.json({ data: await getSyncOperationsSummary() });
  }));

  router.post("/sync-logs/retry-failed", asyncHandler(async (req, res) => {
    const body = z.object({ limit: z.number().int().min(1).max(20).optional() }).parse(req.body ?? {});
    res.json({ data: await retryFailedSyncLogs(body.limit ?? 10) });
  }));

  router.get("/ai/providers", asyncHandler(async (_req, res) => {
    res.json({ data: await listAiProviderSettings() });
  }));

  router.post("/ai/providers", asyncHandler(async (req, res) => {
    res.status(201).json({ data: await upsertAiProviderSetting(req.body) });
  }));

  router.patch("/ai/providers/:id", asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    res.json({ data: await updateAiProviderSetting(id, req.body) });
  }));

  router.post("/ai/providers/:id/enabled", asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
    res.json({ data: await setAiProviderEnabled(id, body.enabled) });
  }));

  router.delete("/ai/providers/:id", asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    res.json({ data: await deleteAiProviderSetting(id) });
  }));

  router.post("/ai/models", asyncHandler(async (req, res) => {
    res.json({ data: await listAvailableAiModels(req.body) });
  }));

  router.post("/ai/chat", asyncHandler(async (req, res) => {
    res.json({ data: await runCopilotChat(req.body) });
  }));

  router.post("/ai/creative-brief", asyncHandler(async (req, res) => {
    res.json({ data: await generateCreativeBrief(req.body) });
  }));

  router.get("/ai/suggestions", asyncHandler(async (req, res) => {
    res.json({ data: await listAiActionSuggestions(req.query) });
  }));

  router.post("/ai/suggestions/run-rules", asyncHandler(async (_req, res) => {
    res.json({ data: await runMediaBuyingRuleMonitor() });
  }));

  router.post("/ai/suggestions/analyze-account", asyncHandler(async (req, res) => {
    const body = accountAnalysisQuerySchema.parse(req.body ?? {});
    res.status(201).json({ data: await createAdAccountDeepAnalysisReport(body) });
  }));

  router.post("/ai/suggestions/analyze-entity", asyncHandler(async (req, res) => {
    const body = entityDeepAnalysisSchema.parse(req.body ?? {});
    res.status(201).json({ data: await createEntityDeepAnalysisReport(body) });
  }));

  router.get("/ai/suggestions/:id/report", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json({ data: await getAiActionSuggestionReport(id) });
  }));

  router.get("/ai/reports/:id", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json({ data: await getAiAnalysisReportById(id) });
  }));

  router.post("/ai/suggestions/:id/creative-brief", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.status(201).json({ data: await generateCreativeBriefFromSuggestion(id, req.body) });
  }));

  router.patch("/ai/suggestions/:id", asyncHandler(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json({ data: await updateAiActionSuggestionStatus(id, req.body) });
  }));

  router.get("/analysis/store-overview", asyncHandler(async (req, res) => {
    const query = analysisRangeSchema.parse(req.query);
    res.json({ data: await getStoreOverviewAnalysis(query) });
  }));

  router.get("/analysis/ad-accounts", asyncHandler(async (req, res) => {
    const query = analysisRangeSchema.parse(req.query);
    res.json({ data: await getStoreAdAccountAnalysis(query) });
  }));

  router.get("/analysis/account-detail", asyncHandler(async (req, res) => {
    const query = accountAnalysisQuerySchema.parse(req.query);
    res.json({ data: await getAccountDetailAnalysis(query) });
  }));

  router.get("/analysis/countries", asyncHandler(async (req, res) => {
    const query = analysisRangeSchema.parse(req.query);
    res.json({ data: await getCountryAnalysis(query) });
  }));

  router.get("/analysis/audience", asyncHandler(async (req, res) => {
    const query = audienceAnalysisQuerySchema.parse(req.query);
    res.json({ data: await getAudienceAnalysis(query) });
  }));

  router.get("/analysis/products", asyncHandler(async (req, res) => {
    const query = analysisRangeSchema.parse(req.query);
    res.json({ data: await getProductAnalysis(query) });
  }));

  router.get("/analysis/creatives", asyncHandler(async (req, res) => {
    const query = analysisRangeSchema.parse(req.query);
    res.json({ data: await getCreativeAnalysis(query) });
  }));

  router.get("/analysis/trends", asyncHandler(async (req, res) => {
    const query = trendAnalysisSchema.parse(req.query);
    res.json({ data: await getTrendAnalysis(query) });
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "invalid_request", details: error.issues });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "internal_error", message });
  });

  return router;
}
