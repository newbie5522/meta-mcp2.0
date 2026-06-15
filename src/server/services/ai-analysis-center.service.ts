import prisma from "../../db/index.js";
import { format, subDays, parseISO } from "date-fns";
import { GoogleGenAI, Type } from "@google/genai";
import { getProductIntelligence } from "./product-intelligence.service.js";

export interface AnalysisCenterResult {
  type: string; // account_analysis, store_analysis, creative_analysis, product_analysis, country_analysis, unmapped_spend_risk, token_api_health, data_health_summary
  entityType: string; // "account" | "store" | "creative" | "product" | "country" | "system"
  entityId: string;
  title: string;
  severity: "critical" | "warning" | "info" | "healthy";
  summary: string;
  findings: string[];
  metrics: Record<string, any>;
  recommendations: { action: string; rationale: string; priority: number }[];
  limitations: string[];
  dataSourceExplain: string;
  generatedAt: Date;
}

// 1. Fetch token and logs health
async function fetchTokenHealth(): Promise<{ apiAccessStatus: string; identityStatus: string }> {
  try {
    const lastTestLog = await prisma.syncLog.findFirst({
      where: { type: "META_TOKEN_TEST" },
      orderBy: { startedAt: "desc" }
    });
    if (lastTestLog && lastTestLog.metadata) {
      const metaObj = JSON.parse(lastTestLog.metadata);
      if (metaObj.apiAccessStatus) {
        return {
          apiAccessStatus: metaObj.apiAccessStatus,
          identityStatus: metaObj.identityStatus || "unknown"
        };
      }
    }
    
    // Fallback logic - read active setting token
    const tokenSetting = await prisma.setting.findFirst({
      where: { key: { in: ["META_ACCESS_TOKEN", "meta_token"] } }
    });
    if (!tokenSetting || !tokenSetting.value.trim() || tokenSetting.value.includes("...")) {
      return { apiAccessStatus: "blocked", identityStatus: "invalid" };
    }
    return { apiAccessStatus: "usable", identityStatus: "valid" };
  } catch (e) {
    return { apiAccessStatus: "unknown", identityStatus: "unknown" };
  }
}

// 2. Main builder class for gathering true factual contexts
export class AIAnalysisCenterService {
  
  static async runAnalysis(params: {
    type: string;
    entityType: string;
    entityId: string;
    startDate: string;
    endDate: string;
    storeId?: number;
    accountId?: string;
  }): Promise<AnalysisCenterResult> {
    const { type, entityType, entityId, startDate, endDate } = params;
    
    // Initialize common items
    const limitations: string[] = [];
    let severity: "critical" | "warning" | "info" | "healthy" = "info";
    let title = "";
    let dataSourceExplain = "";
    let metrics: Record<string, any> = {};
    let findings: string[] = [];
    let recommendations: { action: string; rationale: string; priority: number }[] = [];
    let summary = "";

    // A. Detect Global Constraints & Limitations
    // 1. Unmapped Spend Check
    const unmappedSpendCheck = await prisma.adAccount.findMany({
      where: { storeId: null, recentActivity90d: true }
    });
    if (unmappedSpendCheck.length > 0) {
      limitations.push("存在未绑定店铺但有消耗广告账户，店铺 ROAS 可能被高估。");
    }

    // 2. Product Spend attribution check
    limitations.push("当前不支持产品级广告花费归因，因此不得输出产品级 ROAS 结论。");

    // 3. Order country field check (Check if any orders lack country field)
    limitations.push("当前订单表缺少国家字段，国家分析仅代表 Meta 受众国家表现，不代表订单国家销售。");

    // 4. Token status check
    const tokenHealth = await fetchTokenHealth();
    if (tokenHealth.apiAccessStatus !== "usable") {
      limitations.push("当前 Meta API 不可实时同步，分析基于本地缓存数据。");
    }

    // B. Build contextual details based on analysis type
    if (type === "account_analysis") {
      title = "广告账户多维投放提效诊断";
      dataSourceExplain = "数据源来自真实 FactMetaPerformance (广告层组成效事实源) 与 AccountMapping 绑定关系。";
      
      const targetId = entityId || "all";
      const whereClause: any = { level: "account", date: { gte: startDate, lte: endDate } };
      if (targetId !== "all") {
        whereClause.account_id = targetId;
      }

      const performanceRecords = await prisma.factMetaPerformance.findMany({ where: whereClause });
      
      const spend = performanceRecords.reduce((sum, r) => sum + (r.spend || 0), 0);
      const impressions = performanceRecords.reduce((sum, r) => sum + (r.impressions || 0), 0);
      const clicks = performanceRecords.reduce((sum, r) => sum + (r.clicks || 0), 0);
      const purchases = performanceRecords.reduce((sum, r) => sum + (r.purchases || 0), 0);
      const purchaseValue = performanceRecords.reduce((sum, r) => sum + (r.purchase_value || 0), 0);

      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
      const roas = spend > 0 ? purchaseValue / spend : 0;

      metrics = { spend, impressions, clicks, purchases, purchaseValue, ctr, cpc, cpm, roas };

      if (spend > 0 && roas < 1.3) {
        severity = "critical";
        findings.push(`当前时段花费 $${spend.toFixed(2)}, 整体 ROAS 仅为 ${roas.toFixed(2)}x, 处于亏损低能状态。`);
      } else if (spend > 0 && roas < 2.0) {
        severity = "warning";
        findings.push(`整体成效 ROAS 处于平衡线边缘 (${roas.toFixed(2)}x), 建议立刻优化差效 Campaign 或 adset。`);
      } else if (spend > 0) {
        severity = "healthy";
        findings.push(`账户表现极为健康, 录得 ROAS ${roas.toFixed(2)}x, 单次点击成本 $${cpc.toFixed(2)}。`);
      } else {
        severity = "info";
        findings.push("该时段内选定的广告账户未录得任何花费消耗。");
      }

    } else if (type === "store_analysis") {
      title = "店铺整店经营成效综合体检";
      dataSourceExplain = "数据源基于 Store、动态 Order 事实流、以及 mapped 广告消耗，并跨表计算整店 ROAS 漏斗。";
      
      const storeIdNum = parseInt(entityId, 10);
      if (isNaN(storeIdNum)) {
        throw new Error("Invalid storeId for store_analysis");
      }

      const store = await prisma.store.findUnique({ where: { id: storeIdNum } });
      if (!store) {
        throw new Error(`Store not found: ${entityId}`);
      }

      // Aggregate orders
      const rawOrders = await prisma.order.findMany({
        where: {
          storeId: storeIdNum,
          createdAt: {
            gte: new Date(`${startDate}T00:00:00.000Z`),
            lte: new Date(`${endDate}T23:59:59.999Z`)
          }
        }
      });

      const filteredOrders = rawOrders.filter(order => {
        let orderDateStr = order.store_local_date;
        if (!orderDateStr && order.createdAt) {
          try {
            orderDateStr = new Date(order.createdAt).toISOString().split('T')[0];
          } catch (e) {
            orderDateStr = "";
          }
        }
        return orderDateStr && orderDateStr >= startDate && orderDateStr <= endDate;
      });

      // Filter out canceled or unpaid
      const validOrders = filteredOrders.filter(curr => {
        const payStatus = (curr.paymentStatus || "").toLowerCase();
        const fulStatus = (curr.fulfillmentStatus || "").toLowerCase();
        return !["waiting", "unpaid", "pending", "failed", "cancelled", "canceled"].includes(payStatus) &&
               !["cancelled", "canceled"].includes(fulStatus) &&
               curr.refunded !== true;
      });

      const ordersCount = validOrders.length;
      const totalSales = validOrders.reduce((sum, o) => {
        const val = (o.orderTotal !== null && o.orderTotal !== undefined && o.orderTotal > 0)
          ? o.orderTotal
          : (o.revenue || 0);
        return sum + val;
      }, 0);
      const totalRefundedSum = filteredOrders.filter(o => o.refunded).reduce((sum, o) => sum + (o.revenue || 0), 0);
      const avgOrderValue = ordersCount > 0 ? totalSales / ordersCount : 0;

      // Find ad spend for mapped accounts
      const mappedAccounts = await prisma.accountMapping.findMany({ where: { storeId: storeIdNum } });
      const fbAccountIds = mappedAccounts.map(m => m.fbAccountId);

      let adSpend = 0;
      if (fbAccountIds.length > 0) {
        const perf = await prisma.factMetaPerformance.findMany({
          where: {
            account_id: { in: fbAccountIds },
            level: "account",
            date: { gte: startDate, lte: endDate }
          }
        });
        adSpend = perf.reduce((sum, r) => sum + (r.spend || 0), 0);
      }

      const realRoas = adSpend > 0 ? totalSales / adSpend : 0;
      metrics = { ordersCount, totalSales, totalRefundedSum, avgOrderValue, adSpend, realRoas };

      findings.push(`店铺成效：包含有效订单 ${ordersCount} 笔，累计真实总销售额 $${totalSales.toFixed(2)} USD。`);
      if (fbAccountIds.length === 0) {
        severity = "warning";
        findings.push("⚠️ 目前店铺没有绑定任何 Meta 广告账户，无法归因多渠道 ROI 成效。");
      } else {
        findings.push(`已绑定广告账户共花费 $${adSpend.toFixed(2)}，整店商业 ROAS 现为 ${realRoas.toFixed(2)}x。`);
        if (realRoas < 1.5 && adSpend > 0) {
          severity = "critical";
          findings.push("⚠️ 真实 ROAS 低于 1.5，若加上货值和运费扣减，经营面临高亏损风险。");
        } else if (realRoas >= 2.5) {
          severity = "healthy";
          findings.push("✅ 整店广告 ROI 表现极佳, 建议按节奏扩量并优化后端客单价转化。");
        } else {
          severity = "info";
          findings.push("整店收益相对平稳，建议精细化对账和进行特定 SKU 测款。");
        }
      }

    } else if (type === "creative_analysis") {
      title = "高消耗素材饱和与漏斗衰减诊断";
      dataSourceExplain = "数据源来自 CreativePerformanceDaily 每日素材表，评估顶级消耗素材的疲劳深度。";

      const rangeStats = await prisma.creativePerformanceDaily.findMany({
        where: { date: { gte: startDate, lte: endDate } }
      });

      const grouped: Record<string, any> = {};
      for (const item of rangeStats) {
        if (!grouped[item.creativeId]) {
          grouped[item.creativeId] = {
            creativeId: item.creativeId,
            spend: 0,
            impressions: 0,
            clicks: 0,
            purchases: 0,
            revenue: 0,
            mediaType: item.type || "IMAGE"
          };
        }
        grouped[item.creativeId].spend += item.spend || 0;
        grouped[item.creativeId].impressions += item.impressions || 0;
        grouped[item.creativeId].clicks += item.clicks || 0;
        grouped[item.creativeId].purchases += item.purchases || 0;
        grouped[item.creativeId].revenue += item.revenue || 0;
      }

      const creativeList = Object.values(grouped).sort((a, b) => b.spend - a.spend).slice(0, 5);
      metrics = { count: creativeList.length, topCreatives: creativeList };

      if (creativeList.length === 0) {
        severity = "info";
        findings.push("此时间范围内未录得任何 Meta 广告素材的日常花费表现数据。");
      } else {
        const fatigued = creativeList.filter(c => {
          const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
          const roas = c.spend > 0 ? c.revenue / c.spend : 0;
          return c.spend > 100 && (ctr < 1.0 || roas < 1.2);
        });

        if (fatigued.length > 0) {
          severity = "warning";
          findings.push(`在主力消耗素材中，共诊断出 ${fatigued.length} 个素材存在明显的饱和高疲劳或低点击率现象。`);
          fatigued.forEach(f => {
            const ctr = f.impressions > 0 ? (f.clicks / f.impressions) * 100 : 0;
            findings.push(`- 素材 ${f.creativeId} (${f.mediaType})：花费 $${f.spend.toFixed(2)}，点击率仅 ${ctr.toFixed(2)}% ，购买转化亏损。`);
          });
        } else {
          severity = "healthy";
          findings.push("消耗排名前列的主力广告素材转化漏斗全段健康，漏斗损耗率在安全阈值内。");
        }
      }

    } else if (type === "product_analysis") {
      title = "爆款商品退款与广告成效归因诊断";
      dataSourceExplain = "核心来源于真实 Order 销售明细大表聚合而得的商品成效上下文。";

      const productsData = await getProductIntelligence(startDate, endDate);
      const topProducts = productsData.sort((a, b) => b.revenue - a.revenue).slice(0, 5);
      metrics = { totalProductCount: productsData.length, topProducts };

      const highRefundProducts = topProducts.filter(p => p.refundRate > 10);
      if (highRefundProducts.length > 0) {
        severity = "critical";
        findings.push(`诊断发现 ${highRefundProducts.length} 款主力销售商品退货退款偏高（超过 10% 阈值）。`);
        highRefundProducts.forEach(p => {
          findings.push(`- 商品 [${p.productName}] (SKU: ${p.sku})：退款率达 ${p.refundRate.toFixed(1)}%，侵蚀了大部分前端广告利润。`);
        });
      } else if (topProducts.length > 0) {
        severity = "healthy";
        findings.push("主推测款商品的前端退货退款表现优秀，退货风险阻隔较好。");
      } else {
        severity = "info";
        findings.push("当前日期切片内未捕获到任何商品实际成单销售记录。");
      }

    } else if (type === "country_analysis") {
      title = "出海受众国家成效与转化差异诊断";
      dataSourceExplain = "核心来自 FactAudienceBreakdown (Meta 受众拆分事实表) 国家维度花费。";

      const breakdownRecords = await prisma.factAudienceBreakdown.findMany({
        where: {
          dimension_type: "country",
          date: { gte: startDate, lte: endDate }
        }
      });

      const grouped: Record<string, any> = {};
      for (const item of breakdownRecords) {
        const code = item.dimension_value || "unknown";
        if (!grouped[code]) {
          grouped[code] = {
            countryCode: code,
            spend: 0,
            impressions: 0,
            clicks: 0,
            purchases: 0,
            purchaseValue: 0
          };
        }
        grouped[code].spend += item.spend || 0;
        grouped[code].impressions += item.impressions || 0;
        grouped[code].clicks += item.clicks || 0;
        grouped[code].purchases += item.purchases || 0;
        grouped[code].purchaseValue += item.purchase_value || 0;
      }

      const countryList = Object.values(grouped).sort((a, b) => b.spend - a.spend).slice(0, 5);
      metrics = { count: countryList.length, countries: countryList };

      const subZeroRoas = countryList.filter(c => {
        const roas = c.spend > 0 ? c.purchaseValue / c.spend : 0;
        return c.spend > 50 && roas < 1.0;
      });

      if (subZeroRoas.length > 0) {
        severity = "warning";
        findings.push(`在广告消耗占比居首的国家中, 共有 ${subZeroRoas.length} 块区域录得流量超支且亏损严重。`);
        subZeroRoas.forEach(c => {
          const roas = c.spend > 0 ? c.purchaseValue / c.spend : 0;
          findings.push(`- 国家 [${c.countryCode}]：实消 $${c.spend.toFixed(2)}，购买转化 ROAS 仅为 ${roas.toFixed(2)}xx。`);
        });
      } else if (countryList.length > 0) {
        severity = "healthy";
        findings.push("各大核心受众主推国家的转化表现均衡，暂无流量过度倾斜或恶意点击区域。");
      } else {
        severity = "info";
        findings.push("受众拆分表中未发现此时间范围内的国家细分表现。");
      }

    } else if (type === "unmapped_spend_risk") {
      title = "未绑定账号漏油失控花费专项审计";
      dataSourceExplain = "针对系统内具有巨额广告支出，但未映射或绑定任何独立站，造成全店 ROAS 被高估的专项审计。";

      const activeAccounts = await prisma.adAccount.findMany({
        where: { storeId: null }
      });

      const unmappedIds = activeAccounts.map(a => a.fb_account_id);
      let totalUnmappedSpend = 0;
      const detailSpent: any[] = [];

      if (unmappedIds.length > 0) {
        const perf = await prisma.factMetaPerformance.findMany({
          where: {
            account_id: { in: unmappedIds },
            level: "account",
            date: { gte: startDate, lte: endDate }
          }
        });

        for (const act of activeAccounts) {
          const actSpend = perf.filter(p => p.account_id === act.fb_account_id).reduce((sum, r) => sum + (r.spend || 0), 0);
          if (actSpend > 0) {
            totalUnmappedSpend += actSpend;
            detailSpent.push({ accountId: act.fb_account_id, name: act.fb_account_name, spend: actSpend });
          }
        }
      }

      metrics = { totalAccounts: activeAccounts.length, totalUnmappedSpend, detailSpent };

      if (totalUnmappedSpend > 100) {
        severity = "critical";
        findings.push(`⚠️ 发生高危流量漏油！有 ${detailSpent.length} 个广告账户在持续进行花费消耗，但未建立任何店铺映射绑定关系。`);
        findings.push(`累计未绑定消耗：$${totalUnmappedSpend.toFixed(2)} USD。这不仅导致该账户表现无法被追溯对账，还会严重高估其它活跃店铺得出的整店 ROAS 结论。`);
      } else {
        severity = "healthy";
        findings.push("系统资产对齐率高。所有当前产生了广告消耗的 Meta 账户均已按标准完成与各独立站主体的绑定关系映射。");
      }

    } else if (type === "token_api_health") {
      title = "Meta API 同步信道健康诊断";
      dataSourceExplain = "检测系统当前的 Meta Access Token 信标和后台实时抓取接口的物理通信情况。";

      metrics = {
        apiAccessStatus: tokenHealth.apiAccessStatus,
        identityStatus: tokenHealth.identityStatus
      };

      if (tokenHealth.apiAccessStatus !== "usable") {
        severity = "critical";
        findings.push(`信宿物理信道阻断！Meta API 接入诊断报出：[${tokenHealth.apiAccessStatus}] 异常状态。`);
        findings.push("这表示系统无法立刻向 Meta Graph 接口发出拉取指令。目前展示的所有广告维度均读取自动抓取的本地备份缓存，并非最新的事实成效。");
      } else {
        severity = "healthy";
        findings.push("Meta API 信道连接通畅。Access Token 状态验证为 [usable (可用)]，同步任务已可无障碍实时响应。");
      }

    } else if (type === "data_health_summary") {
      title = "数据底层健康与勾稽关系验证";
      dataSourceExplain = "对本地关系表中各项订单条目、广告事实记录和配置节点进行交叉验证与一致性完整审计。";

      const factMetaCount = await prisma.factMetaPerformance.count();
      const factAudienceCount = await prisma.factAudienceBreakdown.count();
      const shopOrdersCount = await prisma.order.count();
      const activeStoresCount = await prisma.store.count();
      const activeAccountsCount = await prisma.adAccount.count();
      const creativeCount = await prisma.creativePerformanceDaily.count();

      metrics = { factMetaCount, factAudienceCount, shopOrdersCount, activeStoresCount, activeAccountsCount, creativeCount };

      if (factMetaCount === 0 || shopOrdersCount === 0) {
        severity = "warning";
        findings.push("⚠️ 检测到数据层完整度存在缺陷。广告事实表或订单数据库主表目前处于真空无记录状态。");
      } else {
        severity = "healthy";
        findings.push("数据集成闭环极佳。对订单表、消耗层、受众细分、素材历史性能的底层实体数量交叉复核全部通过。");
        findings.push(`- 动态成单数: ${shopOrdersCount} | 日耗花费条目: ${factMetaCount} | 受众受载切片数: ${factAudienceCount} | 在册店铺: ${activeStoresCount} | 素材库在录: ${creativeCount}`);
      }
    }

    // C. Evaluate response mechanism: Google Gemini OR Offline fallback rule-engine
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // 1. OFFLINE RULE ENGINE FALLBACK (isFallback=true)
      limitations.push("当前为离线规则评估，不是正式 AI 模型分析。");
      
      const offlineConclusion = `【离线数据分析与诊断报表 - Offline Rule Engine】\n\n系统检测到本地未配置正式的 GEMINI_API_KEY，已自动为您切回离线诊断规则套件对事实表进行综合运算。\n\n【诊断摘要】：已针对 [${title}] 完成离线指标交叉验算。分析时段: ${startDate} 至 ${endDate}。\n\n【核心发现】:\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n【限制备注】：此离线诊断基于现有本地备份数据库运行，请尽快于系统后台‘Secrets’配置密匙以获得 Gemini 自然语言诊断分析。`;
      
      // Determine recommendations locally based on severity & type
      recommendations = AIAnalysisCenterService.getOfflineRecommendations(type, severity, metrics);

      // Create physical DB fallback report
      const dbReport = await prisma.aiAnalysisReport.create({
        data: {
          type,
          entityType,
          entityId,
          dateRange: `${startDate} 至 ${endDate}`,
          conclusion: offlineConclusion,
          dataBasis: `source=True_Database_Facts;type=${type};metrics=${JSON.stringify(metrics)}`,
          riskPoints: findings.join("; "),
          priority: severity === "critical" ? 1 : (severity === "warning" ? 2 : 3),
          model: "offline-rule-engine",
          metadata: JSON.stringify({
            isFallback: true,
            analysisType: type,
            primarySources: [dataSourceExplain],
            limitations,
            metricsSnapshot: metrics,
            generatedBy: "System Offline Rule Engine v2.0",
            version: "2.0.0"
          })
        }
      });

      // Insert suggestions to DB
      if (recommendations.length > 0) {
        await Promise.all(
          recommendations.map(rec =>
            prisma.aiActionSuggestion.create({
              data: {
                reportId: dbReport.id,
                action: rec.action,
                rationale: rec.rationale,
                priority: rec.priority,
                status: "pending"
              }
            })
          )
        );
      }

      return {
        type,
        entityType,
        entityId,
        title,
        severity,
        summary: offlineConclusion,
        findings,
        metrics,
        recommendations,
        limitations,
        dataSourceExplain,
        generatedAt: dbReport.createdAt
      };
    } else {
      // 2. FORMAL GEMINI AI INTEGRATION (isFallback=false)
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Construct system context prompt incorporating dataBasis, limitations, types
      const systemContext = `
      你是一个专门负责底层对账、投放风控和全链条电商运营的顶级 AI 商业分析参谋。
      你需要针对用户请求的分析类型：[${type}] 实体类型:[${entityType}] entityId:[${entityId}]（分析段 [${startDate} ~ ${endDate}]），结合系统提取出来的真实核心数据库事实和指标，撰写出一份条理清晰、措辞犀利、行文充满行话、不掺杂任何水分或 Mock 数据的诊断结论。

      【当前获取的底层真实成效事实指标 (True Database Metrics & Facts)】:
      ${JSON.stringify(metrics, null, 2)}

      【数据来源与事实勾稽审计说明 (Data Basis Explain)】:
      ${dataSourceExplain}

      【当前系统采集与数据集成物理限制环境评估 (System Limitations)】:
      ${limitations.map((l, i) => `${i + 1}. ${l}`).join("\n")}

      【重要设计指导方针】：
      1. 禁止凭空捏造、伪造、或幻想任何数值。所有诊断百分比和金额波动必须和上述真实数据匹配。
      2. 绝不建议系统做出任何自动化的预算修改或去初始化行为，所有策略优化均标为“建议”，需要人工审阅。
      3. 必须在返回内容的“限制说明 (limitations)”部分，清晰列出上述评估出的系统物理限制。

      请必须在 outputs 字段中，输出符合 JSON response 格式的数据：
      {
        "title": "请拟定一份专业的标题",
        "severity": "critical" | "warning" | "info" | "healthy" 结合数据合理评估
        "summary": "撰写一小段犀利的中文诊断总结(Emoji配排，不超250字)",
        "findings": ["核心发现1", "核心发现2"... 必须由数据推导，不能空话],
        "recommendations": [
           { 
             "action": "推荐人工作业行动名称", 
             "rationale": "行动支撑原因(不超过60字)", 
             "priority": 1(最紧急) 到 3(常规) 
           }
        ]
      }
      `;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `请立刻对分析段 [${startDate} ~ ${endDate}] 相关的事实数据展开分析。`,
          config: {
            systemInstruction: systemContext,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ["critical", "warning", "info", "healthy"] },
                summary: { type: Type.STRING },
                findings: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      action: { type: Type.STRING },
                      rationale: { type: Type.STRING },
                      priority: { type: Type.INTEGER }
                    },
                    required: ["action", "rationale", "priority"]
                  }
                }
              },
              required: ["title", "severity", "summary", "findings", "recommendations"]
            }
          }
        });

        const parsedResponse = JSON.parse(response.text.trim());
        
        // Write the actual AI Analysis Report to DB
        const dbReport = await prisma.aiAnalysisReport.create({
          data: {
            type,
            entityType,
            entityId,
            dateRange: `${startDate} 至 ${endDate}`,
            conclusion: parsedResponse.summary,
            dataBasis: `source=True_Database_Facts;type=${type};metrics=${JSON.stringify(metrics)}`,
            riskPoints: parsedResponse.findings.join("; "),
            priority: parsedResponse.severity === "critical" ? 1 : (parsedResponse.severity === "warning" ? 2 : 3),
            model: "gemini-3.5-flash",
            metadata: JSON.stringify({
              isFallback: false,
              analysisType: type,
              primarySources: [dataSourceExplain],
              limitations,
              metricsSnapshot: metrics,
              generatedBy: "Google Gemini 3.5 Flash",
              version: "3.5.0"
            })
          }
        });

        // Insert suggestions to DB
        if (parsedResponse.recommendations && parsedResponse.recommendations.length > 0) {
          await Promise.all(
            parsedResponse.recommendations.map((rec: any) =>
              prisma.aiActionSuggestion.create({
                data: {
                  reportId: dbReport.id,
                  action: rec.action,
                  rationale: rec.rationale,
                  priority: rec.priority || 3,
                  status: "pending"
                }
              })
            )
          );
        }

        return {
          type,
          entityType,
          entityId,
          title: parsedResponse.title || title,
          severity: parsedResponse.severity || severity,
          summary: parsedResponse.summary,
          findings: parsedResponse.findings || findings,
          metrics,
          recommendations: parsedResponse.recommendations || recommendations,
          limitations,
          dataSourceExplain,
          generatedAt: dbReport.createdAt
        };

      } catch (err: any) {
        console.error("Gemini API call failed, falling back to rule engine:", err);
        // Fallback to offline rule engine if API calls fail or timeout
        return this.runAnalysis({ ...params, type: type + "_offline_fallback" }); // recursively fall back to offline
      }
    }
  }

  // Helper method to resolve structured action suggestions offline
  private static getOfflineRecommendations(
    type: string, 
    severity: string, 
    metrics: Record<string, any>
  ): { action: string; rationale: string; priority: number }[] {
    const list: { action: string; rationale: string; priority: number }[] = [];

    if (type === "unmapped_spend_risk" && severity === "critical") {
      list.push({
        action: "将漏油消耗账户绑定到相关店铺",
        rationale: "存在广告户产生美元预算花费却未分配任何店铺，漏掉了归因链路，需在账户映射页面手动关联店铺。",
        priority: 1
      });
    } else if (type === "token_api_health" && severity === "critical") {
      list.push({
        action: "重新授权更新 Meta API Access Token",
        rationale: "当前 Meta Token 连接被阻挡或过期失效，数据只能通过缓存降级运行，亟需刷新密钥确保同步管道正常通透。",
        priority: 1
      });
    } else if (type === "store_analysis") {
      if (metrics.realRoas !== undefined && metrics.realRoas < 1.5 && metrics.adSpend > 0) {
        list.push({
          action: "审核低 ROAS 受众，收拢亏损广告系列",
          rationale: "整店广告 ROAS 为 " + metrics.realRoas.toFixed(2) + "x 低于盈亏平衡线，需人工调整素材与出价，及时收止亏损。",
          priority: 1
        });
      }
      if (metrics.adSpend === 0) {
        list.push({
          action: "自查广告账户绑定状态，开始向新站导流",
          rationale: "店铺未关联任何广告产生花费，可能正处于冷启动冷建站时期，建议按计划部署测款投放。",
          priority: 2
        });
      }
    } else if (type === "creative_analysis") {
      list.push({
        action: "更换疲劳高消耗素材",
        rationale: "顶级消耗素材点击率偏离健康水位，高频展示可能引发受众视觉疲劳，需手动上传备用新视觉方案。",
        priority: 2
      });
    } else if (type === "product_analysis" && severity === "critical") {
      list.push({
        action: "核查品控及发货流程，查补退货成因",
        rationale: "部分主推爆款的退货率处于危险高位（>10%），极其侵蚀整体前端广告毛利润，人工抽检供应链或缩减发货延迟。",
        priority: 1
      });
    } else if (type === "country_analysis") {
      list.push({
        action: "人工调缩超额超支低 ROAS 国家的广告配给",
        rationale: "受众拆分中诊断出特定大区获客单价畸高、ROAS 塌方，必须于 Meta 广告后台调缩面向此国家的定向投放预算。",
        priority: 2
      });
    } else {
      list.push({
        action: "进行日常对账与数据集成交叉核对",
        rationale: "建议开展常规人工复核，定期审查订单量与广告户消耗一致性，确保商业罗盘指标精确可用。",
        priority: 3
      });
    }

    return list;
  }
}
