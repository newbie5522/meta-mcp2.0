import {
  AiDiagnosisTimeWindow,
  AiMetricSnapshot,
  AiMetricComparison,
  AiFunnelBreakdown,
  AiCreativeSignal,
  AiOrderSignal,
  AiRuleIssueInput,
  AiDataQualityReport,
  AiConfidenceLevel,
  AiEntityPerformanceNode,
  AiEntityType
} from "../../shared/ai-deep-diagnosis.types.js";
import { AiDeepDiagnosisContextRequest } from "./ai-deep-diagnosis-context.types.js";

export function createEmptyMetricSnapshot(): AiMetricSnapshot {
  return {
    spend: null,
    impressions: null,
    clicks: null,
    ctr: null,
    cpc: null,
    cpm: null,
    purchases: null,
    purchaseValue: null,
    roas: null,
    cpa: null,
    addToCart: null,
    initiateCheckout: null,
    conversionRate: null,
    orders: null,
    revenue: null,
    aov: null,
    refundAmount: null,
    refundRate: null
  };
}

export function createEmptyFunnelBreakdown(): AiFunnelBreakdown {
  return {
    impressions: null,
    clicks: null,
    viewContent: null,
    addToCart: null,
    initiateCheckout: null,
    purchases: null,
    orders: null,
    dropOffNotes: [],
    suspectedBottlenecks: []
  };
}

export function createEmptyOrderSignal(): AiOrderSignal {
  return {
    orderCount: null,
    revenue: null,
    aov: null,
    topProducts: [],
    countryBreakdown: [],
    refundSignals: [],
    delayedAttributionNotes: []
  };
}

export function toMetricComparison(current: number | null, previous: number | null): AiMetricComparison {
  if (current === null || previous === null) {
    return {
      current,
      previous,
      delta: null,
      deltaPercent: null,
      trend: "unknown"
    };
  }

  const delta = current - previous;
  let deltaPercent: number | null = null;
  if (previous !== 0) {
    deltaPercent = Number(((delta / previous) * 100).toFixed(2));
  }

  let trend: "up" | "down" | "flat" | "unknown" = "unknown";
  if (current > previous) {
    trend = "up";
  } else if (current < previous) {
    trend = "down";
  } else {
    trend = "flat";
  }

  return {
    current,
    previous,
    delta: Number(delta.toFixed(4)),
    deltaPercent,
    trend
  };
}

export function buildTimeWindow(request: AiDeepDiagnosisContextRequest): AiDiagnosisTimeWindow {
  const { startDate, endDate, comparisonStartDate, comparisonEndDate } = request;

  const s = new Date(startDate);
  const e = new Date(endDate);
  let days = 0;
  if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
    const diff = e.getTime() - s.getTime();
    days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24))) + 1;
  }

  let comparisonWindow: {
    label: string;
    startDate: string;
    endDate: string;
    days: number;
  } | null = null;

  if (comparisonStartDate && comparisonEndDate) {
    const cs = new Date(comparisonStartDate);
    const ce = new Date(comparisonEndDate);
    let cDays = 0;
    if (!isNaN(cs.getTime()) && !isNaN(ce.getTime())) {
      const diffC = ce.getTime() - cs.getTime();
      cDays = Math.max(0, Math.floor(diffC / (1000 * 60 * 60 * 24))) + 1;
    }
    comparisonWindow = {
      label: `${comparisonStartDate} 至 ${comparisonEndDate}`,
      startDate: comparisonStartDate,
      endDate: comparisonEndDate,
      days: cDays
    };
  }

  return {
    label: `${startDate} 至 ${endDate}`,
    startDate,
    endDate,
    days,
    comparisonWindow
  };
}

export interface RuleIssueLike {
  id?: string | number;
  category?: string;
  type?: string;
  severity?: string;
  priorityScore?: number | null;
  confidenceScore?: number | null;
  oneLineReason?: string;
  reason?: string;
  title?: string;
  diagnosisReason?: string;
  description?: string;
  content?: string;
  evidence?: unknown;
  payload?: unknown;
  suggestedActions?: string[] | unknown;
  humanConfirmationRequired?: boolean;
  limitations?: string[] | unknown;
  entityRefs?: unknown;
}

export function mapRuleIssueToAiRuleIssueInput(issue: RuleIssueLike | null | undefined): AiRuleIssueInput {
  if (!issue) {
    return {
      id: "unknown-issue",
      category: "general",
      severity: "warning",
      priorityScore: null,
      confidenceScore: null,
      oneLineReason: "",
      diagnosisReason: "",
      evidence: {},
      suggestedActions: [],
      humanConfirmationRequired: true,
      limitations: [],
      entityRefs: []
    };
  }

  let resolvedEvidence: Record<string, unknown> = {};
  if (issue.evidence !== undefined && issue.evidence !== null) {
    if (typeof issue.evidence === "object" && !Array.isArray(issue.evidence)) {
      resolvedEvidence = issue.evidence as Record<string, unknown>;
    } else if (typeof issue.evidence === "string") {
      resolvedEvidence = { text: issue.evidence };
    }
  } else if (issue.payload !== undefined && issue.payload !== null) {
    if (typeof issue.payload === "object" && !Array.isArray(issue.payload)) {
      resolvedEvidence = issue.payload as Record<string, unknown>;
    } else if (typeof issue.payload === "string") {
      resolvedEvidence = { text: issue.payload };
    }
  }

  let resolvedEntityRefs: Record<string, unknown>[] = [];
  const rawRefs = issue.entityRefs;
  if (Array.isArray(rawRefs)) {
    resolvedEntityRefs = rawRefs.map((ref: unknown) => {
      if (ref && typeof ref === "object") {
        return ref as Record<string, unknown>;
      } else if (typeof ref === "string") {
        return { id: ref };
      }
      return {};
    });
  }

  const priorityScore = typeof issue.priorityScore === "number" ? issue.priorityScore : null;
  const confidenceScore = typeof issue.confidenceScore === "number" ? issue.confidenceScore : null;

  return {
    id: String(issue.id || ""),
    category: String(issue.category || issue.type || "general"),
    severity: String(issue.severity || "warning"),
    priorityScore,
    confidenceScore,
    oneLineReason: String(issue.oneLineReason || issue.reason || issue.title || ""),
    diagnosisReason: String(issue.diagnosisReason || issue.description || issue.content || ""),
    evidence: resolvedEvidence,
    suggestedActions: Array.isArray(issue.suggestedActions) ? (issue.suggestedActions as unknown[]).map(String) : [],
    humanConfirmationRequired: typeof issue.humanConfirmationRequired === "boolean" ? issue.humanConfirmationRequired : true,
    limitations: Array.isArray(issue.limitations) ? (issue.limitations as unknown[]).map(String) : [],
    entityRefs: resolvedEntityRefs
  };
}

export function createDataQualityReport(params: {
  missingFields: string[];
  staleDataWarnings: string[];
  mappingWarnings: string[];
  attributionWarnings: string[];
  syncWarnings: string[];
}): AiDataQualityReport {
  const { missingFields, staleDataWarnings, mappingWarnings, attributionWarnings, syncWarnings } = params;

  let confidenceLevel: AiConfidenceLevel = "high";

  // Determine confidenceLevel based on severity of issues
  // Major missing fields or critical mapping warnings will downgrade confidence level
  const criticalMissing = missingFields.some(f => 
    ["spend", "revenue", "impressions", "orders", "clicks"].includes(f)
  );

  if (criticalMissing || mappingWarnings.length >= 2 || syncWarnings.length >= 2) {
    confidenceLevel = "low";
  } else if (missingFields.length > 0 || staleDataWarnings.length > 0 || mappingWarnings.length > 0 || syncWarnings.length > 0 || attributionWarnings.length > 0) {
    confidenceLevel = "medium";
  }

  return {
    missingFields,
    staleDataWarnings,
    mappingWarnings,
    attributionWarnings,
    syncWarnings,
    confidenceLevel
  };
}

export function buildMetricSnapshot(params: Partial<AiMetricSnapshot>): AiMetricSnapshot {
  const empty = createEmptyMetricSnapshot();
  return {
    spend: typeof params.spend === "number" ? params.spend : empty.spend,
    impressions: typeof params.impressions === "number" ? params.impressions : empty.impressions,
    clicks: typeof params.clicks === "number" ? params.clicks : empty.clicks,
    ctr: typeof params.ctr === "number" ? params.ctr : empty.ctr,
    cpc: typeof params.cpc === "number" ? params.cpc : empty.cpc,
    cpm: typeof params.cpm === "number" ? params.cpm : empty.cpm,
    purchases: typeof params.purchases === "number" ? params.purchases : empty.purchases,
    purchaseValue: typeof params.purchaseValue === "number" ? params.purchaseValue : empty.purchaseValue,
    roas: typeof params.roas === "number" ? params.roas : empty.roas,
    cpa: typeof params.cpa === "number" ? params.cpa : empty.cpa,
    addToCart: typeof params.addToCart === "number" ? params.addToCart : empty.addToCart,
    initiateCheckout: typeof params.initiateCheckout === "number" ? params.initiateCheckout : empty.initiateCheckout,
    conversionRate: typeof params.conversionRate === "number" ? params.conversionRate : empty.conversionRate,
    orders: typeof params.orders === "number" ? params.orders : empty.orders,
    revenue: typeof params.revenue === "number" ? params.revenue : empty.revenue,
    aov: typeof params.aov === "number" ? params.aov : empty.aov,
    refundAmount: typeof params.refundAmount === "number" ? params.refundAmount : empty.refundAmount,
    refundRate: typeof params.refundRate === "number" ? params.refundRate : empty.refundRate
  };
}

export function buildPerformanceComparisons(current: AiMetricSnapshot, previous: AiMetricSnapshot): Record<string, AiMetricComparison> {
  const comp: Record<string, AiMetricComparison> = {};
  const keys = Object.keys(current) as Array<keyof AiMetricSnapshot>;
  for (const key of keys) {
    comp[key] = toMetricComparison(current[key], previous[key]);
  }
  return comp;
}

export function buildEntityPerformanceNode(
  entityType: AiEntityType,
  entityId: string,
  entityName: string,
  parentEntityId: string | null | undefined,
  metrics: AiMetricSnapshot,
  comparisons?: Record<string, AiMetricComparison>,
  issues?: AiRuleIssueInput[],
  dataQualityNotes?: string[]
): AiEntityPerformanceNode {
  return {
    entityType,
    entityId,
    entityName,
    parentEntityId: parentEntityId || null,
    metrics,
    comparisons: comparisons || {},
    issues: issues || [],
    dataQualityNotes: dataQualityNotes || []
  };
}

export function buildCreativeSignal(
  creativeId: string,
  creativeName: string,
  creativeType: string,
  firstSeenAt: string | null,
  metrics: Partial<AiMetricSnapshot> & { frequency?: number | null },
  fatigueSignals: string[],
  performanceNotes: string[]
): AiCreativeSignal {
  return {
    creativeId,
    creativeName,
    creativeType,
    firstSeenAt,
    spend: typeof metrics.spend === "number" ? metrics.spend : null,
    impressions: typeof metrics.impressions === "number" ? metrics.impressions : null,
    clicks: typeof metrics.clicks === "number" ? metrics.clicks : null,
    ctr: typeof metrics.ctr === "number" ? metrics.ctr : null,
    cpm: typeof metrics.cpm === "number" ? metrics.cpm : null,
    frequency: typeof metrics.frequency === "number" ? metrics.frequency : null,
    purchases: typeof metrics.purchases === "number" ? metrics.purchases : null,
    roas: typeof metrics.roas === "number" ? metrics.roas : null,
    fatigueSignals,
    performanceNotes
  };
}

export function buildFunnelBreakdown(
  metrics: {
    impressions: number | null;
    clicks: number | null;
    viewContent?: number | null;
    addToCart: number | null;
    initiateCheckout: number | null;
    purchases: number | null;
    orders: number | null;
  },
  dropOffNotes: string[],
  suspectedBottlenecks: string[]
): AiFunnelBreakdown {
  return {
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    viewContent: typeof metrics.viewContent === "number" ? metrics.viewContent : null,
    addToCart: metrics.addToCart,
    initiateCheckout: metrics.initiateCheckout,
    purchases: metrics.purchases,
    orders: metrics.orders,
    dropOffNotes,
    suspectedBottlenecks
  };
}
