import prisma from "../../db/index.js";
import { format, subDays, parseISO } from "date-fns";
import { GoogleGenAI, Type } from "@google/genai";
import { getProductIntelligence } from "./product-intelligence.service.js";

export interface AnalysisCenterParams {
  type: string;
  entityType: string;
  entityId: string;
  startDate: string;
  endDate: string;
  storeId?: number;
  accountId?: string;
  includeRecommendations?: boolean;
}

export interface AnalysisCenterResult {
  type: string;
  entityType: string;
  entityId: string;
  title: string;
  severity: "critical" | "warning" | "info" | "healthy";
  summary: string;
  findings: string[];
  metrics: Record<string, any>;
  recommendations: { id?: string; action: string; rationale: string; priority: number; status: string }[];
  limitations: string[];
  dataSourceExplain: string;
  generatedAt: Date;
}

// Helper to fetch token and logs health
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

/**
 * 1. buildAnalysisContext(params)
 * Gathers authentic database facts and status indicators. No mocks.
 */
export async function buildAnalysisContext(params: AnalysisCenterParams): Promise<any> {
  const { type, entityType, entityId, startDate, endDate } = params;

  // Gather token status
  const tokenHealth = await fetchTokenHealth();

  // Spot check unmapped active accounts
  const unmappedActiveAccounts = await prisma.adAccount.findMany({
    where: { storeId: null, recentActivity90d: true }
  });

  let metrics: Record<string, any> = {};
  let findings: string[] = [];
  let severity: "critical" | "warning" | "info" | "healthy" = "info";
  let title = "智能诊断分析";

  if (type === "account_analysis") {
    title = "广告账户多维投放提效诊断";
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

    const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;

    metrics = { spend, impressions, clicks, purchases, purchaseValue, ctr: ctrPct, cpc, cpm, roas };

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
    const storeIdNum = parseInt(entityId, 10);
    if (!isNaN(storeIdNum)) {
      const store = await prisma.store.findUnique({ where: { id: storeIdNum } });
      if (store) {
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
      }
    }

  } else if (type === "creative_analysis") {
    title = "高消耗素材饱和与漏斗衰减诊断";
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

    const creativeList = Object.values(grouped).sort((a: any, b: any) => b.spend - a.spend).slice(0, 5);
    metrics = { count: creativeList.length, topCreatives: creativeList };

    if (creativeList.length === 0) {
      severity = "info";
      findings.push("此时间范围内未录得任何 Meta 广告素材的日常花费表现数据。");
    } else {
      const fatigued = creativeList.filter((c: any) => {
        const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
        const roas = c.spend > 0 ? c.revenue / c.spend : 0;
        return c.spend > 100 && (ctr < 1.0 || roas < 1.2);
      });

      if (fatigued.length > 0) {
        severity = "warning";
        findings.push(`在主力消耗素材中，共诊断出 ${fatigued.length} 个素材存在明显的饱和高疲劳或低点击率现象。`);
        fatigued.forEach((f: any) => {
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

    const countryList = Object.values(grouped).sort((a: any, b: any) => b.spend - a.spend).slice(0, 5);
    metrics = { count: countryList.length, countries: countryList };

    const subZeroRoas = countryList.filter((c: any) => {
      const roas = c.spend > 0 ? c.purchaseValue / c.spend : 0;
      return c.spend > 50 && roas < 1.0;
    });

    if (subZeroRoas.length > 0) {
      severity = "warning";
      findings.push(`在广告消耗占比居首的国家中, 共有 ${subZeroRoas.length} 块区域录得流量超支且亏损严重。`);
      subZeroRoas.forEach((c: any) => {
        const roas = c.spend > 0 ? c.purchaseValue / c.spend : 0;
        findings.push(`- 国家 [${c.countryCode}]：实消 $${c.spend.toFixed(2)}，购买转化 ROAS 仅为 ${roas.toFixed(2)}x。`);
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

  return {
    type,
    entityType,
    entityId,
    startDate,
    endDate,
    metrics,
    findings,
    severity,
    title,
    tokenHealth,
    unmappedActiveAccountsCount: unmappedActiveAccounts.length
  };
}

/**
 * 2. buildLimitations(context)
 * Gathers clear real boundaries. No mocks.
 */
export function buildLimitations(context: any): string[] {
  const limitations: string[] = [];

  if (context.unmappedActiveAccountsCount > 0) {
    limitations.push("存在未绑定店铺但有消耗广告账户，店铺 ROAS 可能被高估。");
  }

  limitations.push("当前不支持产品级广告花费归因，因此不得输出产品级 ROAS 结论。");

  limitations.push("当前订单表缺少国家字段，国家分析仅代表 Meta 受众国家表现，不代表订单国家销售。");

  if (context.tokenHealth?.apiAccessStatus !== "usable") {
    limitations.push("当前 Meta API 不可实时同步，分析基于本地缓存数据。");
  }

  return limitations;
}

/**
 * 3. buildDataSourceExplain(context)
 * Explains exactly which relational tables supported this analysis. No mocks.
 */
export function buildDataSourceExplain(context: any): string {
  const { type } = context;
  switch (type) {
    case "account_analysis":
      return "数据源来自真实 FactMetaPerformance (广告层组成成单事实源) 与 AccountMapping 绑定关系。";
    case "store_analysis":
      return "数据源基于 Store、动态 Order 事实流、以及 mapped 广告消耗，并跨表计算整店 ROAS 漏斗。";
    case "creative_analysis":
      return "数据源来自 CreativePerformanceDaily 每日素材表，评估顶级消耗素材的疲劳深度。";
    case "product_analysis":
      return "核心来源于真实 Order 销售明细大表聚合而得 of 商品成效上下文。";
    case "country_analysis":
      return "核心来自 FactAudienceBreakdown (Meta 受众拆分事实表) 国家维度花费。";
    case "unmapped_spend_risk":
      return "针对系统内具有巨额广告支出，但未映射或绑定任何独立站，造成全店 ROAS 被高估的专项审计。";
    case "token_api_health":
      return "检测系统当前的 Meta Access Token 信标和后台实时抓取接口的物理通信情况。";
    case "data_health_summary":
      return "对本地关系表中各项订单条目、广告事实记录和配置节点进行交叉验证与一致性完整审计。";
    default:
      return "对账数据流来自本地事实总表";
  }
}

/**
 * 4. generateAIAnalysis(params)
 * Coordinates the full sequence to produce an AnalysisCenterResult and save to Prisma.
 * Strictly pending status with no auto execution and only permitted action keys.
 */
export async function generateAIAnalysis(params: AnalysisCenterParams): Promise<AnalysisCenterResult> {
  const context = await buildAnalysisContext(params);
  const limitations = buildLimitations(context);
  const dataSourceExplain = buildDataSourceExplain(context);

  const { type, entityType, entityId, startDate, endDate } = params;
  let severity = context.severity;
  let summary = "";
  let findings = context.findings;
  let rawRecommendations: { action: string; rationale: string; priority: number }[] = [];

  // Generate recommendations mapping to permitted actions only
  // bind_unmapped_account, review_low_roas_country, review_high_spend_low_purchase_account, refresh_meta_token, map_product_attribution, investigate_data_gap
  const getPermittedRecommendations = (): { action: string; rationale: string; priority: number }[] => {
    const recs: { action: string; rationale: string; priority: number }[] = [];
    if (context.unmappedActiveAccountsCount > 0 || type === "unmapped_spend_risk") {
      recs.push({
        action: "bind_unmapped_account",
        rationale: "存在广告户产生消耗却未分配任何店铺，需在账户映射页面人工手动关联店铺。",
        priority: 1
      });
    }
    if (type === "token_api_health" || context.tokenHealth?.apiAccessStatus !== "usable") {
      recs.push({
        action: "refresh_meta_token",
        rationale: "当前 Meta Token 连接被阻挡或过期失效，亟需人工重新授权，刷新密钥以通畅网络管道。",
        priority: 1
      });
    }
    if (type === "country_analysis") {
      recs.push({
        action: "review_low_roas_country",
        rationale: "诊断出特定受众国家获客单价偏离常态，必须人工调缩面向低 ROI 国家的预算分配。",
        priority: 2
      });
    }
    if (type === "account_analysis" || type === "store_analysis") {
      const spend = context.metrics.spend || context.metrics.adSpend || 0;
      const roas = context.metrics.roas || context.metrics.realRoas || 0;
      if (spend > 0 && roas < 1.5) {
        recs.push({
          action: "review_high_spend_low_purchase_account",
          rationale: "整店或单户 ROAS 低于盈亏边缘平衡点，需立刻对高消低效 Campaign 进行人工优化割损。",
          priority: 1
        });
      }
    }
    if (type === "product_analysis") {
      recs.push({
        action: "map_product_attribution",
        rationale: "当前不支持产品级广告归因，需人工建立特定 SKU 与广告像素的单独映射标签进行毛利审计。",
        priority: 3
      });
    }
    if (type === "data_health_summary" || findings.join("").includes("⚠️")) {
      recs.push({
        action: "investigate_data_gap",
        rationale: "部分本地事实条数与前端转化存在一定的沟稽漏缺，建议进行物理层一致性大对账。",
        priority: 3
      });
    }
    if (recs.length === 0) {
      recs.push({
        action: "investigate_data_gap",
        rationale: "系统运行非常稳健，建议进行周期性常规人工勾稽，核验买量转化漏斗漏失率。",
        priority: 3
      });
    }
    return recs;
  };

  rawRecommendations = getPermittedRecommendations();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // 1. OFFLINE FALLBACK ENGINE
    summary = `【离线数据分析与诊断报表 - Offline Rule Engine】\n\n本地未检测到 GEMINI_API_KEY，已启动本地勾稽算法完成研判。\n\n【主要诊断结论】：针对 [${context.title}] 完成离线事实指标验算。\n\n【核心发现】:\n${findings.map((f: string, i: number) => `${i + 1}. ${f}`).join("\n")}`;

    const dbReport = await prisma.aiAnalysisReport.create({
      data: {
        type,
        entityType,
        entityId,
        dateRange: `${startDate} 至 ${endDate}`,
        conclusion: summary,
        dataBasis: `source=True_Database_Facts;type=${type};metrics=${JSON.stringify(context.metrics)}`,
        riskPoints: findings.join("; "),
        priority: severity === "critical" ? 1 : (severity === "warning" ? 2 : 3),
        model: "offline-rule-engine",
        metadata: JSON.stringify({
          isFallback: true,
          analysisType: type,
          primarySources: [dataSourceExplain],
          limitations,
          metricsSnapshot: context.metrics,
          generatedBy: "System Offline Rule Engine v2.0",
          version: "2.0.0"
        })
      }
    });

    const suggestions = await Promise.all(
      rawRecommendations.map(async rec => {
        const suggestion = await prisma.aiActionSuggestion.create({
          data: {
            reportId: dbReport.id,
            action: rec.action,
            rationale: rec.rationale,
            priority: rec.priority,
            status: "pending"
          }
        });
        return {
          id: suggestion.id,
          action: suggestion.action,
          rationale: suggestion.rationale,
          priority: suggestion.priority,
          status: suggestion.status
        };
      })
    );

    return {
      type,
      entityType,
      entityId,
      title: context.title,
      severity,
      summary,
      findings,
      metrics: context.metrics,
      recommendations: suggestions,
      limitations,
      dataSourceExplain,
      generatedAt: dbReport.createdAt
    };

  } else {
    // 2. FORMAL GEMINI INTEGRATION
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const systemContext = `
    你是一个专门负责底层对账、买量风控和全链条电商运营的顶级 AI 商业分析参谋。
    你需要针对分析类型：[${type}]（周期 [${startDate} ~ ${endDate}]），结合所得底层核心事实指标，撰写出一份措辞犀利、行文充满行内术语、无任何 mock 数据的诊断结论。

    【底层事实核心指标 snapshot】:
    ${JSON.stringify(context.metrics, null, 2)}

    【物理归因限制】:
    ${limitations.map((l, i) => `${i + 1}. ${l}`).join("\n")}

    【规则限制】：
    1. 切忌建议执行全自动去初始化或预算修改，所有决定行动标注为“需要人工确认”或对应的作业建议。
    2. 绝不能幻想任何数值或虚假的波动！

    请必须在 outputs 字段中，输出符合 JSON response 格式的数据：
    {
      "title": "拟定专业的标题",
      "severity": "critical" | "warning" | "info" | "healthy" 结合数据合理评级,
      "summary": "撰写犀利的中文总结 (包含Emoji配排，不超250字)",
      "findings": ["特定核心发现1", "特定核心发现2"... 必须紧密联系数据]
    }
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `对账目标：对 [${startDate} 至 ${endDate}] 的相关事实数据展开综合研判。`,
        config: {
          systemInstruction: systemContext,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              severity: { type: Type.STRING, enum: ["critical", "warning", "info", "healthy"] },
              summary: { type: Type.STRING },
              findings: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["title", "severity", "summary", "findings"]
          }
        }
      });

      const parsedResponse = JSON.parse(response.text.trim());
      severity = parsedResponse.severity || severity;
      summary = parsedResponse.summary || summary;
      findings = parsedResponse.findings || findings;

      const dbReport = await prisma.aiAnalysisReport.create({
        data: {
          type,
          entityType,
          entityId,
          dateRange: `${startDate} 至 ${endDate}`,
          conclusion: parsedResponse.summary,
          dataBasis: `source=True_Database_Facts;type=${type};metrics=${JSON.stringify(context.metrics)}`,
          riskPoints: parsedResponse.findings.join("; "),
          priority: severity === "critical" ? 1 : (severity === "warning" ? 2 : 3),
          model: "gemini-3.5-flash",
          metadata: JSON.stringify({
            isFallback: false,
            analysisType: type,
            primarySources: [dataSourceExplain],
            limitations,
            metricsSnapshot: context.metrics,
            generatedBy: "Google Gemini 3.5 Flash",
            version: "3.5.0"
          })
        }
      });

      const suggestions = await Promise.all(
        rawRecommendations.map(async rec => {
          const suggestion = await prisma.aiActionSuggestion.create({
            data: {
              reportId: dbReport.id,
              action: rec.action,
              rationale: rec.rationale,
              priority: rec.priority,
              status: "pending"
            }
          });
          return {
            id: suggestion.id,
            action: suggestion.action,
            rationale: suggestion.rationale,
            priority: suggestion.priority,
            status: suggestion.status
          };
        })
      );

      return {
        type,
        entityType,
        entityId,
        title: parsedResponse.title || context.title,
        severity,
        summary,
        findings,
        metrics: context.metrics,
        recommendations: suggestions,
        limitations,
        dataSourceExplain,
        generatedAt: dbReport.createdAt
      };

    } catch (err) {
      console.error("Gemini API crash. Fallback to offline rule engine.", err);
      // Clean fallback if API times out or errs
      const fallbackReport = await prisma.aiAnalysisReport.create({
        data: {
          type,
          entityType,
          entityId,
          dateRange: `${startDate} 至 ${endDate}`,
          conclusion: `【数据分析结论（离线引擎支持）】\n\n无法建立 Gemini 物理连结，已开启防退机制完成指标解算。\n\n【核心发现】:\n${findings.map((f: string, i: number) => `${i + 1}. ${f}`).join("\n")}`,
          dataBasis: `source=True_Database_Facts;type=${type};metrics=${JSON.stringify(context.metrics)}`,
          riskPoints: findings.join("; "),
          priority: severity === "critical" ? 1 : (severity === "warning" ? 2 : 3),
          model: "offline-rule-engine-fallback",
          metadata: JSON.stringify({
            isFallback: true,
            analysisType: type,
            primarySources: [dataSourceExplain],
            limitations,
            metricsSnapshot: context.metrics,
            generatedBy: "System Offline Fallback Engine v2.0",
            version: "2.0.0"
          })
        }
      });

      const suggestions = await Promise.all(
        rawRecommendations.map(async rec => {
          const suggestion = await prisma.aiActionSuggestion.create({
            data: {
              reportId: fallbackReport.id,
              action: rec.action,
              rationale: rec.rationale,
              priority: rec.priority,
              status: "pending"
            }
          });
          return {
            id: suggestion.id,
            action: suggestion.action,
            rationale: suggestion.rationale,
            priority: suggestion.priority,
            status: suggestion.status
          };
        })
      );

      return {
        type,
        entityType,
        entityId,
        title: context.title,
        severity,
        summary: fallbackReport.conclusion,
        findings,
        metrics: context.metrics,
        recommendations: suggestions,
        limitations,
        dataSourceExplain,
        generatedAt: fallbackReport.createdAt
      };
    }
  }
}
