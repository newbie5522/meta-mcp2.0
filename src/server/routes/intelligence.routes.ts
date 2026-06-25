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
      where: { id: parseInt(id, 10) },
      data: { status }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to update suggestion status", details: error.message });
  }
});

/**
 * POST /api/intelligence/audit
 * Supports interactive Store Diagnostic Ask AI from StoreDataDashboard
 */
router.post("/audit", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    // Dynamic elegant offline heuristic parser
    const storeNameMatch = prompt.match(/店铺 "([^"]+)"/);
    const storeName = storeNameMatch ? storeNameMatch[1] : "未知店铺";

    const ordersMatch = prompt.match(/系统订单数：(\d+)/);
    const orders = ordersMatch ? parseInt(ordersMatch[1], 10) : 0;

    const salesMatch = prompt.match(/全渠道销售额：\$([\d.,]+)/);
    const sales = salesMatch ? parseFloat(salesMatch[1].replace(/,/g, "")) : 0;

    const adSpendMatch = prompt.match(/广告花费总支出：\$([\d.,]+)/);
    const spend = adSpendMatch ? parseFloat(adSpendMatch[1].replace(/,/g, "")) : 0;

    const roasMatch = prompt.match(/真实整店广告 ROAS：([\d\.]+)/);
    const roas = roasMatch ? parseFloat(roasMatch[1]) : null;

    const unbound = prompt.includes("未绑定") || prompt.includes("未绑定推广广告账号");

    let diagnostic = `📊 **《${storeName}》整店投放经营体检与优化建议短报**\n\n`;
    diagnostic += `**【ROAS 及经营综合点评】：**\n`;

    if (unbound) {
      diagnostic += `⚠️ **警告**: 当前店铺**未绑定任何 Meta 推广账号**，无法进行精确的流量 ROI 换算！前端处于纯买量盲跑状态，整店 ROAS 处于归因��[...]`;
    } else if (orders === 0 && sales === 0) {
      diagnostic += `🌱 **冷启动诊断**: 当前店铺成交订单数与全渠道销售额均为零，处于**冷启动建站对策期**。建议先利用少量核心 SKU 测试高意向受�[...]`;
    } else if (roas !== null && roas < 1.5) {
      diagnostic += `🚨 **高亏损严重警告**: 当前计算得出的真实整店 ROAS 仅为 **${roas.toFixed(2)}x**，低于 1.5 的健康保本水位。利润已被流量成本严重蚕��[...]`;
    } else if (roas !== null && roas >= 2.5) {
      diagnostic += `✅ **表现极佳**: 恭喜！当前真实整店 ROAS 为 **${roas.toFixed(2)}x**，表明测款转化极其健康，买量模型工作良好。可在控制 CPM 与频次的[...]`;
    } else if (roas !== null) {
      diagnostic += `⚖️ **平衡状态**: 真实整店 ROAS 当前录得 **${roas.toFixed(2)}x**，处于基本保本或微利区间。建议针对漏斗中段（加入购物车、发起结��[...]`;
    }

    diagnostic += `**【落地优化人工作业三条建议】:**\n`;
    diagnostic += `1. **资产齐套性校验**: 优先确定所有产生消耗的 Facebook 像素与独立站绑定完全，规避对账不归因。\n`;
    diagnostic += `2. **品控端严防死守**: 调取高单量 SKU 退货数据，防止假爆款退款带来隐形财务亏本。\n`;
    diagnostic += `3. **离线退避备注**: 当前处于本地静态决策评估，由离线策略引擎支持分析。`;

    return res.json({ success: true, analysis: diagnostic });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to perform store AI audit", details: error.message });
  }
});

export default router;
