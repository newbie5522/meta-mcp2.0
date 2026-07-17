import { Router } from "express";
import { getDashboardSummary } from "../services/dashboard.service.js";
import { ensureDataCenterFreshness, getFreshnessMeta } from "../services/data-center-auto-refresh.service.js";

const router = Router();

router.get("/", async (req, res) => {
  const { since, until } = req.query;

  try {
    const summary = await getDashboardSummary({
      since: since ? new Date(String(since)) : undefined,
      until: until ? new Date(String(until)) : undefined
    });

    const freshness = await getFreshnessMeta();

    return res.json({
      data: summary,
      dateRange: summary.dateRange,
      storeCoverage: summary.storeCoverage,
      metaCoverage: summary.metaCoverage,
      productCoverage: summary.productCoverage,
      freshness
    });
  } catch (err: any) {
    return res.status(500).json({
      status: "ERROR",
      error: "DASHBOARD_QUERY_FAILED",
      details: err.message
    });
  }
});

router.post("/refresh", async (req, res) => {
  const { startDate, endDate, storeId } = req.body || {};

  try {
    const result = await ensureDataCenterFreshness({
      reason: "manual_internal",
      requestedStartDate: startDate,
      requestedEndDate: endDate,
      storeId: storeId ? Number(storeId) : null,
      force: true,
      mode: "blocking"
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      status: "ERROR",
      error: "DASHBOARD_REFRESH_FAILED",
      details: err.message
    });
  }
});

export default router;
