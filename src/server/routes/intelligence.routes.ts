// @ts-nocheck
import { Router } from "express";
import prisma from "../../db/index.js";
import { getProductIntelligence } from "../services/product-intelligence.service.js";
import { getCreativeIntelligence } from "../services/creative-intelligence.service.js";
import { getAggregatedCreativeInsights } from "../services/creative-insights.service.js";
import { attributePurchases } from "../services/attribution.service.js";
import { aggregateData } from "../services/aggregation.service.js";

const router = Router();

router.get("/products", async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: "Missing dates" });
  try {
    const data = await getProductIntelligence(startDate as string, endDate as string);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch product intelligence", details: error.message });
  }
});

router.get("/creatives", async (req, res) => {
  const { startDate, endDate, storeFilter } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: "Missing dates" });
  try {
    const result = await getAggregatedCreativeInsights({
      startDate: startDate as string,
      endDate: endDate as string,
      storeId: storeFilter as string,
      pageSize: 1000
    });
    
    const data = result.data || [];
    
    // Set headers for chunked streaming response
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    res.write('[\n');
    for (let i = 0; i < data.length; i++) {
      res.write(JSON.stringify(data[i]));
      if (i < data.length - 1) {
        res.write(',\n');
      }
    }
    res.write('\n]');
    res.end();
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch creative intelligence", details: error.message });
    } else {
      res.end();
    }
  }
});

router.get("/creatives/daily", async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: "Missing dates" });
  try {
    const data = await prisma.creativePerformanceDaily.findMany({
      where: {
        date: { gte: startDate as string, lte: endDate as string }
      },
      orderBy: { date: 'asc' }
    });
    res.json(data || []);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch daily creative performance", details: error.message });
  }
});

router.post("/creatives/clear-metrics", async (req, res) => {
  try {
    await prisma.creativePerformanceDaily.deleteMany({});
    res.json({ success: true, message: "素材表现指标的所有数据已成功清除" });
  } catch (error: any) {
    res.status(500).json({ error: "清除素材表现指标数据失败", details: error.message });
  }
});

router.post("/aggregate", async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: "Missing dates" });
  try {
    await attributePurchases();
    const result = await aggregateData(startDate, endDate);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to aggregate intelligence", details: error.message });
  }
});

/**
 * GET /api/intelligence/suggestions
 * Fetch AI recommendation cards from the SQLite database
 */
router.get("/suggestions", async (req, res) => {
  try {
    const suggestions = await prisma.aiActionSuggestion.findMany({
      include: {
        report: true
      },
      orderBy: {
        id: "desc"
      }
    });
    res.json(suggestions);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch AI suggestions", details: error.message });
  }
});

/**
 * POST /api/intelligence/suggestions/:id/status
 * Alter recommendations execution state
 */
router.post("/suggestions/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status is required" });
  try {
    const updated = await prisma.aiActionSuggestion.update({
      where: { id },
      data: { status }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to update suggestion status", details: error.message });
  }
});

export default router;
