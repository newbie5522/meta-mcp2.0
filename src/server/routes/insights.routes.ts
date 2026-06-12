// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";

const router = Router();

router.get("/", async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const data = await prisma.factMetaPerformance.findMany({
      where: {
        date: {
          gte: startDate as string,
          lte: endDate as string,
        },
        level: "account"
      },
    });
    const formatted = data.map(item => ({
      id: item.id,
      accountId: item.account_id,
      level: item.level,
      campaignId: item.campaign_id,
      adsetId: item.adset_id,
      adId: item.ad_id,
      date: item.date,
      spend: item.spend,
      impressions: item.impressions,
      clicks: item.clicks,
      purchases: item.purchases,
      purchaseValue: item.purchase_value,
      ctr: item.ctr,
      cpc: item.cpc,
      roas: item.roas
    }));
    res.json({
      insights: formatted,
      dataSourceExplain: {
        primarySource: "FactMetaPerformance",
        legacySource: "AdInsight",
        legacyUsed: false
      }
    });
  } catch (error: any) {
    console.error("Fetch insights error:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch data", details: error?.message });
  }
});

export default router;