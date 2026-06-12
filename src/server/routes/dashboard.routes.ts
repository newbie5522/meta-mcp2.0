import { Router } from "express";
import { getDashboardSummary } from "../services/dashboard.service.js";

const router = Router();

router.get("/", async (req, res) => {
  const { since, until, refresh } = req.query;
  
  try {
    const summary = await getDashboardSummary({
      refresh: refresh === "true",
      since: since ? new Date(since as string) : undefined,
      until: until ? new Date(until as string) : undefined
    });
    
    // UI expects API result wrapper { data: ... }
    res.json({
      data: summary,
      dataSourceExplain: {
        primarySource: "FactMetaPerformance",
        legacySource: "AdInsight",
        legacyUsed: false
      }
    });
  } catch (err: any) {
    console.error("Dashboard endpoint error:", err);
    res.status(500).json({ error: "Failed to generate dashboard summary" });
  }
});

export default router;
