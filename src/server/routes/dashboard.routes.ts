import { Router } from "express";
import { getDashboardSummary } from "../services/dashboard.service.js";
import { ensureDataCenterFreshness, getFreshnessMeta } from "../services/data-center-auto-refresh.service.js";
import dayjs from "dayjs";
import prisma from "../../db/index.js";

const router = Router();

router.get("/", async (req, res) => {
  const { since, until, refresh } = req.query;
  
  try {
    const startDate = since ? dayjs(since as string).format("YYYY-MM-DD") : undefined;
    const endDate = until ? dayjs(until as string).format("YYYY-MM-DD") : undefined;

    let mode: "background" | "blocking_if_missing" = "background";
    if (startDate && endDate) {
      const ledgerCount = await prisma.dataCenterStoreDaily.count({
        where: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      });
      if (ledgerCount === 0) {
        mode = "blocking_if_missing";
      }
    }

    ensureDataCenterFreshness({
      reason: "api_request",
      requestedStartDate: startDate,
      requestedEndDate: endDate,
      mode
    }).catch(err => console.warn("[DataCenterAutoRefresh] background ensure failed", err));

    const summary = await getDashboardSummary({
      refresh: refresh === "true",
      since: since ? new Date(since as string) : undefined,
      until: until ? new Date(until as string) : undefined
    });

    const freshness = await getFreshnessMeta();
    
    // UI expects API result wrapper { data: ... }
    res.json({
      data: summary,
      dataSourceExplain: {
        primarySource: "FactMetaPerformance",
        fallbackSource: null,
        fallbackUsed: false
      },
      freshness
    });
  } catch (err: any) {
    console.error("Dashboard endpoint error:", err);
    res.status(500).json({ error: "Failed to generate dashboard summary" });
  }
});

export default router;
