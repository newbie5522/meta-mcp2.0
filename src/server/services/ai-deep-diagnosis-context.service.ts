import prisma from "../../db/index.js";
import { format, subDays, parseISO } from "date-fns";
import {
  AiDeepDiagnosisMode,
  AiDiagnosisScope,
  AiDeepDiagnosisInput,
  AiDataQualityReport,
  AiMetricSnapshot,
  AiFunnelBreakdown,
  AiCreativeSignal,
  AiOrderSignal,
  AiRuleIssueInput,
  AiEntityPerformanceNode,
  AiMetricComparison,
  AiEntityType,
  AiAllowedAnalysisTask,
  AiForbiddenAnalysisTask
} from "../../shared/ai-deep-diagnosis.types.js";
import {
  buildTimeWindow,
  createEmptyMetricSnapshot,
  createEmptyFunnelBreakdown,
  createEmptyOrderSignal,
  createDataQualityReport,
  toMetricComparison,
  mapRuleIssueToAiRuleIssueInput,
  buildMetricSnapshot,
  buildPerformanceComparisons,
  buildEntityPerformanceNode,
  buildCreativeSignal,
  buildFunnelBreakdown
} from "./ai-deep-diagnosis-context.mapper.js";
import {
  AiDeepDiagnosisContextRequest,
  AiDeepDiagnosisContextBuildResult
} from "./ai-deep-diagnosis-context.types.js";
import { generateDiagnosticIssues } from "./rule-diagnostic-engine.service.js";

interface StoreRowLike {
  id: number;
  name: string;
}

interface OrderRowLike {
  id: string;
  storeId: number;
  createdAt: Date;
  revenue?: number | null;
  orderTotal?: number | null;
  refunded?: boolean | null;
  refundedAt?: Date | null;
  productId?: string | null;
}

interface ProductRowLike {
  id: string;
  name: string;
}

interface CreativeFactRowLike {
  creativeId: string;
  creativeName: string;
  creativeType: string;
  firstSeen: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
}

interface MetaPerformanceRowLike {
  spend?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  purchases?: number | null;
  purchase_value?: number | null;
  purchaseValue?: number | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Unknown error");
}

/**
 * Main service responsible for read-only aggregation of real business data
 * into the complete AiDeepDiagnosisInput structured schema contract.
 */
export async function buildAiDeepDiagnosisContext(
  request: AiDeepDiagnosisContextRequest
): Promise<AiDeepDiagnosisContextBuildResult> {
  const { mode, scope, startDate, endDate, comparisonStartDate, comparisonEndDate } = request;

  // Track findings for data quality & limitations
  const missingFields: string[] = [];
  const staleDataWarnings: string[] = [];
  const mappingWarnings: string[] = [];
  const attributionWarnings: string[] = [];
  const syncWarnings: string[] = [];
  const limitations: string[] = [];
  const warnings: string[] = [];

  // 1. Resolve store ID
  let storeIdParsed: number | undefined = undefined;
  if (scope.storeId) {
    storeIdParsed = parseInt(scope.storeId, 10);
    if (isNaN(storeIdParsed)) {
      storeIdParsed = undefined;
      mappingWarnings.push("Scope storeId is non-numeric: " + scope.storeId);
    }
  }

  // 2. Resolve ad account ID
  let adAccountIdSelected = scope.adAccountId || undefined;
  if (!adAccountIdSelected && storeIdParsed) {
    try {
      const mapping = await prisma.accountMapping.findFirst({
        where: { storeId: storeIdParsed }
      });
      if (mapping) {
        adAccountIdSelected = mapping.fbAccountId;
      } else {
        mappingWarnings.push(`No AccountMapping row exists for storeId ${storeIdParsed}`);
      }
    } catch (err: unknown) {
      mappingWarnings.push(`Failed to query AccountMapping from database: ${getErrorMessage(err)}`);
    }
  }

  if (!adAccountIdSelected) {
    missingFields.push("adAccountId");
    limitations.push("缺少广告账户绑定或选择，Meta层指标将完全缺少。");
  }

  // 3. Resolve Previous Window for Comparison
  let prevStart = comparisonStartDate;
  let prevEnd = comparisonEndDate;
  if (!prevStart || !prevEnd) {
    limitations.push("未显式传入对比时间窗口（comparisonStartDate/EndDate），系统已使用前一等长周期作为默认对比基准。");
    // Default to preceding window
    const s = parseISO(startDate);
    const e = parseISO(endDate);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const diffMs = e.getTime() - s.getTime();
      const sPrev = new Date(s.getTime() - diffMs - 1000 * 60 * 60 * 24);
      const ePrev = new Date(s.getTime() - 1000 * 60 * 60 * 24);
      prevStart = format(sPrev, "yyyy-MM-dd");
      prevEnd = format(ePrev, "yyyy-MM-dd");
    } else {
      prevStart = startDate;
      prevEnd = endDate;
    }
  }

  // 4. Query Store Information
  let storeRow: StoreRowLike | null = null;
  if (storeIdParsed) {
    try {
      const rawStore = await prisma.store.findUnique({
        where: { id: storeIdParsed }
      });
      if (rawStore) {
        storeRow = {
          id: rawStore.id,
          name: rawStore.name
        };
      }
      if (!storeRow) {
        mappingWarnings.push(`Store ID ${storeIdParsed} not found in database.`);
      }
    } catch (err: unknown) {
      mappingWarnings.push(`Failed to query Store from database: ${getErrorMessage(err)}`);
    }
  } else {
    if (mode === "store_overview" || mode === "product_performance" || mode === "cross_channel_attribution") {
      mappingWarnings.push(`Mode is '${mode}' but storeId was not provided.`);
    }
  }

  // 5. Build Time Window
  const timeWindow = buildTimeWindow({
    ...request,
    comparisonStartDate: prevStart,
    comparisonEndDate: prevEnd
  });

  // 6. Aggregate Store Sales & Orders Signals
  let orderSignals: AiOrderSignal | null = null;
  let storeSnapshot: AiMetricSnapshot = createEmptyMetricSnapshot();
  let storeSnapshotPrev: AiMetricSnapshot = createEmptyMetricSnapshot();

  if (storeIdParsed) {
    try {
      const startDateTime = parseISO(startDate + "T00:00:00Z");
      const endDateTime = parseISO(endDate + "T23:59:59.999Z");
      const prevStartDateTime = parseISO(prevStart + "T00:00:00Z");
      const prevEndDateTime = parseISO(prevEnd + "T23:59:59.999Z");

      const rawOrders = await prisma.order.findMany({
        where: {
          storeId: storeIdParsed,
          createdAt: { gte: startDateTime, lte: endDateTime }
        }
      });

      const rawOrdersPrev = await prisma.order.findMany({
        where: {
          storeId: storeIdParsed,
          createdAt: { gte: prevStartDateTime, lte: prevEndDateTime }
        }
      });

      const ordersList: OrderRowLike[] = rawOrders.map(o => ({
        id: o.id,
        storeId: o.storeId,
        createdAt: o.createdAt,
        revenue: o.revenue,
        orderTotal: o.orderTotal,
        refunded: o.refunded,
        refundedAt: o.refundedAt,
        productId: o.productId
      }));

      const ordersListPrev: OrderRowLike[] = rawOrdersPrev.map(o => ({
        id: o.id,
        storeId: o.storeId,
        createdAt: o.createdAt,
        revenue: o.revenue,
        orderTotal: o.orderTotal,
        refunded: o.refunded,
        refundedAt: o.refundedAt,
        productId: o.productId
      }));

      const ordersCount = ordersList.length;
      const totalRevenue = ordersList.reduce((sum, o) => sum + (o.revenue || o.orderTotal || 0), 0);
      const aov = ordersCount > 0 ? totalRevenue / ordersCount : 0;

      const refundOrders = ordersList.filter(o => o.refunded || o.refundedAt !== null);
      const refundAmount = refundOrders.reduce((sum, o) => sum + (o.revenue || o.orderTotal || 0), 0);
      const refundRate = totalRevenue > 0 ? refundAmount / totalRevenue : 0;

      const ordersCountPrev = ordersListPrev.length;
      const totalRevenuePrev = ordersListPrev.reduce((sum, o) => sum + (o.revenue || o.orderTotal || 0), 0);
      const aovPrev = ordersCountPrev > 0 ? totalRevenuePrev / ordersCountPrev : 0;
      const refundOrdersPrev = ordersListPrev.filter(o => o.refunded || o.refundedAt !== null);
      const refundAmountPrev = refundOrdersPrev.reduce((sum, o) => sum + (o.revenue || o.orderTotal || 0), 0);
      const refundRatePrev = totalRevenuePrev > 0 ? refundAmountPrev / totalRevenuePrev : 0;

      // Group products to find top items
      const productCounts: Record<string, { name: string; cnt: number; rev: number }> = {};
      for (const o of ordersList) {
        if (o.productId) {
          if (!productCounts[o.productId]) {
            productCounts[o.productId] = { name: "Product " + o.productId, cnt: 0, rev: 0 };
          }
          productCounts[o.productId].cnt += 1;
          productCounts[o.productId].rev += o.revenue || 0;
        }
      }

      // Try to resolve products from DB to get names
      const productIds = Object.keys(productCounts);
      if (productIds.length > 0) {
        const productsDb = await prisma.product.findMany({
          where: { id: { in: productIds } }
        });
        const typedProducts: ProductRowLike[] = productsDb.map(p => ({
          id: p.id,
          name: p.name
        }));
        for (const p of typedProducts) {
          if (productCounts[p.id]) {
            productCounts[p.id].name = p.name;
          }
        }
      }

      const topProducts = Object.entries(productCounts)
        .map(([id, val]) => ({
          productId: id,
          productName: val.name,
          orders: val.cnt,
          revenue: Number(val.rev.toFixed(2))
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      orderSignals = {
        orderCount: ordersCount,
        revenue: Number(totalRevenue.toFixed(2)),
        aov: Number(aov.toFixed(2)),
        topProducts,
        countryBreakdown: [],
        refundSignals: refundOrders.length > 0 ? [`本期内发生客户退款事件 ${refundOrders.length} 笔完成。`] : [],
        delayedAttributionNotes: ["由于在站一侧直接通过创建时间记录，而媒体侧可能发生 1-7 天归因滞后。"]
      };

      storeSnapshot = buildMetricSnapshot({
        orders: ordersCount,
        revenue: totalRevenue,
        aov: aov,
        refundAmount,
        refundRate
      });

      storeSnapshotPrev = buildMetricSnapshot({
        orders: ordersCountPrev,
        revenue: totalRevenuePrev,
        aov: aovPrev,
        refundAmount: refundAmountPrev,
        refundRate: refundRatePrev
      });

    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      warnings.push(`Failed to calculate Store and Order metrics: ${errMsg}`);
      orderSignals = createEmptyOrderSignal();
    }
  } else {
    orderSignals = createEmptyOrderSignal();
  }

  // 7. Aggregate Meta/Ad Performance Nodes
  let currentMetaPerformance: DbMetaAggregate = { spend: null, impressions: null, clicks: null, purchases: null, purchaseValue: null };
  let prevMetaPerformance: DbMetaAggregate = { spend: null, impressions: null, clicks: null, purchases: null, purchaseValue: null };

  interface DbMetaAggregate {
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    purchases: number | null;
    purchaseValue: number | null;
  }

  if (adAccountIdSelected) {
    try {
      // Primary Meta Perf Current
      const currentRows = await prisma.factMetaPerformance.findMany({
        where: {
          account_id: adAccountIdSelected,
          date: { gte: startDate, lte: endDate }
        }
      });
      currentMetaPerformance = aggregatePerformanceRows(currentRows, scope);

      // Previous Meta Perf
      const prevRows = await prisma.factMetaPerformance.findMany({
        where: {
          account_id: adAccountIdSelected,
          date: { gte: prevStart, lte: prevEnd }
        }
      });
      prevMetaPerformance = aggregatePerformanceRows(prevRows, scope);
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      warnings.push(`Exception querying FactMetaPerformance: ${errMsg}`);
    }
  }

  // Canonical funnel currently uses FactMetaPerformance clicks and purchase facts only.
  // AddToCart / InitiateCheckout are not available in the current fact source.
  let currentAddToCart: number | null = null;
  let currentInitiateCheckout: number | null = null;
  let prevAddToCart: number | null = null;
  let prevInitiateCheckout: number | null = null;

  if (adAccountIdSelected) {
    currentAddToCart = 0;
    currentInitiateCheckout = 0;
    prevAddToCart = 0;
    prevInitiateCheckout = 0;
  }

  // Map to complete snapshots
  const toCompleteSnapshot = (
    p: DbMetaAggregate,
    s: AiMetricSnapshot,
    atc: number | null,
    init: number | null
  ): AiMetricSnapshot => {
    const hasMeta = p.spend !== null || p.impressions !== null || p.clicks !== null;

    const ctr = (hasMeta && p.impressions && p.impressions > 0 && p.clicks !== null) ? (p.clicks / p.impressions) * 100 : null;
    const cpc = (hasMeta && p.clicks && p.clicks > 0 && p.spend !== null) ? p.spend / p.clicks : null;
    const cpm = (hasMeta && p.impressions && p.impressions > 0 && p.spend !== null) ? (p.spend / p.impressions) * 1000 : null;
    const roas = (hasMeta && p.spend && p.spend > 0 && p.purchaseValue !== null) ? p.purchaseValue / p.spend : null;
    const cpa = (hasMeta && p.purchases && p.purchases > 0 && p.spend !== null) ? p.spend / p.purchases : null;
    const conversionRate = (hasMeta && p.clicks && p.clicks > 0 && p.purchases !== null) ? (p.purchases / p.clicks) * 100 : null;

    return {
      spend: p.spend,
      impressions: p.impressions,
      clicks: p.clicks,
      ctr: ctr !== null ? Number(ctr.toFixed(4)) : null,
      cpc: cpc !== null ? Number(cpc.toFixed(4)) : null,
      cpm: cpm !== null ? Number(cpm.toFixed(4)) : null,
      purchases: p.purchases,
      purchaseValue: p.purchaseValue !== null ? Number(p.purchaseValue.toFixed(2)) : null,
      roas: roas !== null ? Number(roas.toFixed(4)) : null,
      cpa: cpa !== null ? Number(cpa.toFixed(4)) : null,
      addToCart: atc !== null ? atc : null,
      initiateCheckout: init !== null ? init : null,
      conversionRate: conversionRate !== null ? Number(conversionRate.toFixed(4)) : null,
      // Merge shop一端的数据
      orders: s.orders,
      revenue: s.revenue,
      aov: s.aov,
      refundAmount: s.refundAmount,
      refundRate: s.refundRate
    };
  };

  const primarySnapshot = toCompleteSnapshot(currentMetaPerformance, storeSnapshot, currentAddToCart, currentInitiateCheckout);
  const primarySnapshotPrev = toCompleteSnapshot(prevMetaPerformance, storeSnapshotPrev, prevAddToCart, prevInitiateCheckout);

  // Identify Missing Fields from Current Snapshot
  const standardFieldsToCheck: Array<keyof AiMetricSnapshot> = ["spend", "impressions", "clicks", "purchases", "purchaseValue", "orders", "revenue"];
  for (const f of standardFieldsToCheck) {
    if (primarySnapshot[f] === null) {
      missingFields.push(f);
    }
  }

  // Comparisons mapping
  const primaryComparisons = buildPerformanceComparisons(primarySnapshot, primarySnapshotPrev);

  // Try parsing entity identification for title
  let primaryEntityName = "Global Node";
  let primaryEntityType: AiEntityType = "store";

  if (mode === "store_overview") {
    primaryEntityType = "store";
    primaryEntityName = storeRow?.name || "默认独立站";
  } else if (adAccountIdSelected) {
    primaryEntityType = "ad_account";
    try {
      const accRow = await prisma.adAccount.findUnique({ where: { fb_account_id: adAccountIdSelected } });
      primaryEntityName = accRow?.fb_account_name || adAccountIdSelected;
      
      if (scope.campaignId) {
        primaryEntityType = "campaign";
        const campRow = await prisma.campaign.findUnique({ where: { id: scope.campaignId } });
        primaryEntityName = campRow?.name || `广告系列: ${scope.campaignId}`;
      } else if (scope.adSetId) {
        primaryEntityType = "adset";
        const adsetRow = await prisma.adSet.findUnique({ where: { id: scope.adSetId } });
        primaryEntityName = adsetRow?.name || `广告组: ${scope.adSetId}`;
      } else if (scope.adId) {
        primaryEntityType = "ad";
        const adRow = await prisma.ad.findUnique({ where: { id: scope.adId } });
        primaryEntityName = adRow?.name || `广告: ${scope.adId}`;
      }
    } catch (err: unknown) {
      warnings.push(`Failed to query metadata for primary entity from database: ${getErrorMessage(err)}`);
    }
  }

  // Construct Primary Node
  const primaryEntityNode = buildEntityPerformanceNode(
    primaryEntityType,
    scope.adId || scope.adSetId || scope.campaignId || adAccountIdSelected || scope.storeId || "global",
    primaryEntityName,
    null,
    primarySnapshot,
    primaryComparisons,
    [],
    []
  );

  // 8. Build Related Entity Nodes
  const relatedEntities: AiEntityPerformanceNode[] = [];
  if (adAccountIdSelected) {
    try {
      if (mode === "account_overview" || mode === "campaign_diagnosis") {
        // Find campaigns in this account
        const campaigns = await prisma.campaign.findMany({
          where: { accountId: adAccountIdSelected }
        });
        const campaignIds = campaigns.map(c => c.id);
        const relativeRows = await prisma.factMetaPerformance.findMany({
          where: {
            campaign_id: { in: campaignIds },
            level: "campaign",
            date: { gte: startDate, lte: endDate }
          }
        });

        const prevRelativeRows = await prisma.factMetaPerformance.findMany({
          where: {
            campaign_id: { in: campaignIds },
            level: "campaign",
            date: { gte: prevStart, lte: prevEnd }
          }
        });

        for (const camp of campaigns) {
          const campCurrent = relativeRows.filter(r => r.campaign_id === camp.id);
          const campPrev = prevRelativeRows.filter(r => r.campaign_id === camp.id);

          const aggCur = aggregatePerformanceRows(campCurrent);
          const aggPrev = aggregatePerformanceRows(campPrev);

          const snapCur = toCompleteSnapshot(aggCur, createEmptyMetricSnapshot(), null, null);
          const snapPrev = toCompleteSnapshot(aggPrev, createEmptyMetricSnapshot(), null, null);

          relatedEntities.push(
            buildEntityPerformanceNode(
              "campaign",
              camp.id,
              camp.name,
              adAccountIdSelected,
              snapCur,
              buildPerformanceComparisons(snapCur, snapPrev),
              [],
              []
            )
          );
        }
      } else if (mode === "adset_diagnosis" && scope.campaignId) {
        // Find adsets in campaign
        const adsets = await prisma.adSet.findMany({
          where: { campaignId: scope.campaignId }
        });
        const adsetIds = adsets.map(a => a.id);
        const relativeRows = await prisma.factMetaPerformance.findMany({
          where: {
            adset_id: { in: adsetIds },
            level: "adset",
            date: { gte: startDate, lte: endDate }
          }
        });

        for (const adset of adsets) {
          const adsetCurrent = relativeRows.filter(r => r.adset_id === adset.id);
          const aggCur = aggregatePerformanceRows(adsetCurrent);
          const snapCur = toCompleteSnapshot(aggCur, createEmptyMetricSnapshot(), null, null);

          relatedEntities.push(
            buildEntityPerformanceNode(
              "adset",
              adset.id,
              adset.name,
              scope.campaignId,
              snapCur,
              undefined,
              [],
              []
            )
          );
        }
      }
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      warnings.push(`Failed to construct related entities: ${errMsg}`);
    }
  }

  // 9. Aggregate Creative Signals from FactMetaPerformance (for fatigue diagnostic)
  const creativeSignals: AiCreativeSignal[] = [];
  try {
    const startCompareDate = startDate;
    const endCompareDate = endDate;

    const factWhere: any = {
      level: "ad",
      date: { gte: startCompareDate, lte: endCompareDate }
    };

    if (adAccountIdSelected) {
      factWhere.account_id = adAccountIdSelected;
    }

    if (scope.campaignId) {
      factWhere.campaign_id = scope.campaignId;
    }

    if (scope.adSetId) {
      factWhere.adset_id = scope.adSetId;
    }

    if (scope.adId) {
      factWhere.ad_id = scope.adId;
    }

    const factRows = await prisma.factMetaPerformance.findMany({
      where: factWhere,
      take: 1000
    });

    const creativeGroups: Record<string, CreativeFactRowLike> = {};

    for (const row of factRows) {
      const creativeId = row.creative_id || row.ad_id || row.entity_id;
      if (!creativeId) continue;

      const firstSeen = String(row.date);

      if (!creativeGroups[creativeId]) {
        creativeGroups[creativeId] = {
          creativeId,
          creativeName: `创意: ${creativeId}`,
          creativeType: "UNKNOWN",
          firstSeen,
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          purchaseValue: 0
        };
      } else if (firstSeen < creativeGroups[creativeId].firstSeen) {
        creativeGroups[creativeId].firstSeen = firstSeen;
      }

      creativeGroups[creativeId].spend += row.spend || 0;
      creativeGroups[creativeId].impressions += row.impressions || 0;
      creativeGroups[creativeId].clicks += row.clicks || 0;
      creativeGroups[creativeId].purchases += row.purchases || 0;
      creativeGroups[creativeId].purchaseValue += row.purchase_value || 0;
    }

    const aggregatedCreativesArr = Object.values(creativeGroups);

    if (aggregatedCreativesArr.length > 0) {
      const creativeIds = aggregatedCreativesArr.map((item) => item.creativeId);
      const creativeRowsDb = await prisma.adCreative.findMany({
        where: { creativeId: { in: creativeIds } }
      });

      for (const group of aggregatedCreativesArr) {
        const dbMeta = creativeRowsDb.find((item) => item.creativeId === group.creativeId);

        const ctr = group.impressions > 0 ? (group.clicks / group.impressions) * 100 : 0;
        const cpm = group.impressions > 0 ? (group.spend / group.impressions) * 1000 : 0;
        const roas = group.spend > 0 ? group.purchaseValue / group.spend : 0;

        const fatigueSignals: string[] = [];
        const performanceNotes: string[] = [];

        if (ctr < 0.8 && group.spend > 20) {
          fatigueSignals.push(`素材点击率（CTR）处于异常低位 (${ctr.toFixed(2)}%)，吸引力可能不足。`);
        }

          if (cpm > 25.0) {
        fatigueSignals.push(`素材 CPM 处于高位 ($${cpm.toFixed(2)})，需要人工复核是否存在素材空耗风险。`);
        }

        if (roas > 1.8) {
          performanceNotes.push("在诊断周期内回报正常，该信号仅作为素材表现参考，不代表系统已建议执行操作。");
        } else if (group.spend > 50 && group.purchases === 0) {
          performanceNotes.push("需要人工复核该素材在相同窗口内的转化质量。");
        }

        creativeSignals.push(
          buildCreativeSignal(
            group.creativeId,
            group.creativeName,
            dbMeta?.mediaType || group.creativeType,
            group.firstSeen || null,
            {
              spend: Number(group.spend.toFixed(2)),
              impressions: group.impressions,
              clicks: group.clicks,
              ctr: Number(ctr.toFixed(4)),
              cpm: Number(cpm.toFixed(4)),
              purchases: group.purchases,
              roas: Number(roas.toFixed(4)),
              frequency: null
            },
            fatigueSignals,
            performanceNotes
          )
        );
      }
    }
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    warnings.push(`Failed to calculate creative signals from FactMetaPerformance: ${errMsg}`);
  }

  // 10. Construct conversion funnel
  let funnelBreakdown: AiFunnelBreakdown | null = null;
  try {
    const dropOffNotes: string[] = [];
    const suspectedBottlenecks: string[] = [];

    const impressions = primarySnapshot.impressions;
    const clicks = primarySnapshot.clicks;
    const addToCart = primarySnapshot.addToCart;
    const initiateCheckout = primarySnapshot.initiateCheckout;
    const purchases = primarySnapshot.purchases;
    const orders = primarySnapshot.orders;

    if (impressions && clicks) {
      const ctr = clicks / impressions;
      if (ctr < 0.01) {
        suspectedBottlenecks.push("展示至点击流失过高 (CTR < 1%)，表明创意吸引力可能不足，需由运营人员在 Meta 后台和店铺订单侧交叉确认。");
      }
      dropOffNotes.push(`展示到点击转化率 (CTR): ${(ctr * 100).toFixed(2)}%`);
    } else {
      dropOffNotes.push("展示到点击流失信息由于缺少impressions或clicks指标未完全算得。");
    }

    if (clicks && addToCart) {
      const cartRate = addToCart / clicks;
      if (cartRate < 0.03) {
        suspectedBottlenecks.push("加购流失率严重 (加购率 < 3%)。检查着陆页打开延迟、排版、核心产品首屏图或零售价格差。");
      }
      dropOffNotes.push(`点击到加购率 (Cart Rate): ${(cartRate * 100).toFixed(2)}%`);
    }

    if (addToCart && initiateCheckout) {
      const ckRate = initiateCheckout / addToCart;
      if (ckRate < 0.3) {
        suspectedBottlenecks.push("发起结账阻滞极高 (加购到结账率 < 30%)，多由附加物流费或付款时效敏感导致。");
      }
      dropOffNotes.push(`加购到发起结账率: ${(ckRate * 100).toFixed(2)}%`);
    }

    if (initiateCheckout && purchases) {
      const buyRate = purchases / initiateCheckout;
      if (buyRate < 0.2) {
        suspectedBottlenecks.push("结账转购买低下 (< 20%)，推荐运营人员进行人工核查确认。");
      }
      dropOffNotes.push(`发起结账至完成购买率: ${(buyRate * 100).toFixed(2)}%`);
    }

    // Compare purchases vs orders
    if (purchases !== null && orders !== null && purchases !== 0 && orders !== 0) {
      const ratio = purchases / orders;
      if (ratio > 1.3 || ratio < 0.7) {
        attributionWarnings.push(`多通道数据偏差大：Meta上报成效 Purchases (${purchases} 笔) 与 运营一侧 Shopify/Shopline 实际接收 Orders (${orders} 笔) 差异率达 ${Math.abs((1 - ratio) * 100).toFixed(2)}%。`);
        suspectedBottlenecks.push("双向归因对账在数值上存在偏差。");
      }
    }

    funnelBreakdown = buildFunnelBreakdown(
      {
        impressions,
        clicks,
        addToCart,
        initiateCheckout,
        purchases,
        orders
      },
      dropOffNotes,
      suspectedBottlenecks
    );
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    warnings.push(`Failed to calculate funnel breakdown: ${errMsg}`);
    funnelBreakdown = createEmptyFunnelBreakdown();
  }

  // 11. Run Rules Engine and Map to Structured issues
  const ruleIssues: AiRuleIssueInput[] = [];
  try {
    // Invoke our existing engine read-only:
    const ruleParams = {
      startDate,
      endDate,
      accountId: adAccountIdSelected,
      storeId: storeIdParsed,
      includeDebug: false
    };

    const detectResult = await generateDiagnosticIssues(ruleParams);
    if (detectResult && detectResult.success && Array.isArray(detectResult.issues)) {
      for (const iss of detectResult.issues) {
        ruleIssues.push(mapRuleIssueToAiRuleIssueInput(iss));
      }
    } else {
      missingFields.push("ruleIssues");
      limitations.push("当前未发现可读取的规则诊断 issue 来源，因此 AI 上下文仅包含原始业务指标，不包含规则引擎结论。");
    }
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    warnings.push(`Failed to execute rule diagnostic engine: ${errMsg}`);
    missingFields.push("ruleIssues");
    limitations.push("规则诊断引擎暂不可用或查询返回空集。");
  }

  // 12. Determine Sync Warnings
  try {
    const lastSync = await prisma.syncLog.findFirst({
      orderBy: { startedAt: "desc" }
    });
    if (lastSync) {
      const endMs = lastSync.finishedAt ? lastSync.finishedAt.getTime() : lastSync.startedAt.getTime();
      const hoursAgo = (Date.now() - endMs) / (1000 * 60 * 60);
      if (hoursAgo > 24) {
        staleDataWarnings.push(`数据同步通道近 ${hoursAgo.toFixed(1)} 小时未发现活跃记录。时效性存在滞后风险。`);
      }
      if (lastSync.status === "failed") {
        syncWarnings.push(`最近一期的同步任务处于失败状态 (原因: ${lastSync.error || "未知类型"}).`);
      }
    } else {
      staleDataWarnings.push("系统内无任何历史同账号物理同步记录。");
    }
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    warnings.push(`Failed to check sync log status: ${errMsg}`);
  }

  // 13. Create Data Quality Report
  const dataQuality = createDataQualityReport({
    missingFields,
    staleDataWarnings,
    mappingWarnings,
    attributionWarnings,
    syncWarnings
  });

  // Allowed Task Tasks mapping based on mode
  const allowedAnalysisTasks: AiAllowedAnalysisTask[] = [];
  const forbiddenAnalysisTasks: AiForbiddenAnalysisTask[] = [
    "invent_missing_metrics",
    "claim_budget_changed",
    "claim_ad_paused",
    "claim_meta_written",
    "auto_optimize_campaign",
    "write_database",
    "call_external_api",
    "override_rule_engine",
    "ignore_data_quality_limits",
    "generate_fake_orders",
    "generate_fake_roas"
  ];

  if (mode === "account_overview") {
    allowedAnalysisTasks.push("summarize_performance", "compare_time_windows", "identify_metric_shift", "prioritize_operator_attention");
  } else if (mode === "store_overview") {
    allowedAnalysisTasks.push("summarize_performance", "compare_time_windows", "identify_metric_shift", "identify_data_quality_issue");
  } else if (mode === "campaign_diagnosis") {
    allowedAnalysisTasks.push("summarize_performance", "compare_time_windows", "identify_metric_shift", "rank_possible_causes", "prioritize_operator_attention");
  } else if (mode === "adset_diagnosis" || mode === "ad_diagnosis") {
    allowedAnalysisTasks.push("summarize_performance", "identify_metric_shift", "rank_possible_causes", "suggest_manual_validation_steps");
  } else if (mode === "creative_fatigue") {
    allowedAnalysisTasks.push("summarize_performance", "identify_metric_shift", "identify_creative_fatigue", "prioritize_operator_attention");
  } else if (mode === "product_performance") {
    allowedAnalysisTasks.push("summarize_performance", "compare_time_windows", "rank_possible_causes", "identify_data_quality_issue");
  } else if (mode === "funnel_breakdown") {
    allowedAnalysisTasks.push("summarize_performance", "explain_funnel_dropoff", "rank_possible_causes", "suggest_manual_validation_steps");
  } else if (mode === "data_quality") {
    allowedAnalysisTasks.push("summarize_performance", "identify_data_quality_issue", "suggest_manual_validation_steps");
  } else {
    // Cross channel attribution
    allowedAnalysisTasks.push("summarize_performance", "identify_metric_shift", "rank_possible_causes", "identify_data_quality_issue", "suggest_manual_validation_steps");
  }

  // Final structured input object
  const input: AiDeepDiagnosisInput = {
    mode,
    scope,
    timeWindow,
    primaryEntity: primaryEntityNode,
    relatedEntities,
    funnel: funnelBreakdown,
    creativeSignals,
    orderSignals,
    ruleIssues,
    dataQuality,
    limitations,
    allowedAnalysisTasks,
    forbiddenAnalysisTasks,
    humanReviewRequired: true
  };

  return {
    success: true,
    mode: "context_only",
    aiEnabled: false,
    explanation: null,
    input,
    dataQuality,
    limitations,
    warnings
  };
}

/**
 * Filter performance rows and aggregate sum values based on optional scope filters
 */
function aggregatePerformanceRows(
  rows: MetaPerformanceRowLike[],
  scope?: AiDiagnosisScope
): {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  purchases: number | null;
  purchaseValue: number | null;
} {
  let filtered = rows;
  if (scope) {
    if (scope.campaignId) {
      filtered = filtered.filter(r => r.campaign_id === scope.campaignId);
    }
    if (scope.adSetId) {
      filtered = filtered.filter(r => r.adset_id === scope.adSetId);
    }
    if (scope.adId) {
      filtered = filtered.filter(r => r.ad_id === scope.adId);
    }
  }

  if (filtered.length === 0) {
    return {
      spend: null,
      impressions: null,
      clicks: null,
      purchases: null,
      purchaseValue: null
    };
  }

  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let purchases = 0;
  let purchaseValue = 0;

  for (const r of filtered) {
    spend += r.spend || 0;
    impressions += r.impressions || 0;
    clicks += r.clicks || 0;
    purchases += r.purchases || 0;
    purchaseValue += r.purchase_value || r.purchaseValue || 0;
  }

  return {
    spend: Number(spend.toFixed(2)),
    impressions: Math.floor(impressions),
    clicks: Math.floor(clicks),
    purchases: Math.floor(purchases),
    purchaseValue: Number(purchaseValue.toFixed(2))
  };
}
