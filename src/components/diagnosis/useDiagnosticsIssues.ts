import { useState, useEffect } from "react";

export interface UniformIssue {
  issueId: string;
  issueType: string;
  category: "production_suggestion" | "data_health_notice" | "debug_invalid";
  severity: "critical" | "warning" | "info" | "healthy";
  entityType: string;
  entityId: string;
  entityName: string;
  title: string;
  oneLineReason: string;
  actionVerb: string;
  actionTarget: string;
  evidence: any;
  entityRefs: Array<{
    entityType: string;
    entityId: string;
    entityName: string;
    route: string;
    sourceTable: string;
  }>;
  route: string;
  limitations: string[];
  generationMode: string;
  humanConfirmationRequired: boolean;
  status: string;
  problemStage?: string | null;
  optimizationArea?: string | null;
  funnelStage?: string | null;
  diagnosisReason?: string | null;
  suggestedActions?: string[];
  validationMetrics?: string[] | string;
  priorityScore?: number;
  confidenceScore?: number;
  impactScore?: number;
  urgencyScore?: number;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
}

export interface DiagnosticsReportMeta {
  message: string;
  diagnosticsDegraded: boolean;
  failedDetectors: Array<{
    name: string;
    message: string;
  }>;
  backendSummary: any | null;
}

type IssueCategory = UniformIssue["category"];

export interface UseDiagnosticsIssuesOptions {
  startDate?: Date | string;
  endDate?: Date | string;
  categories?: IssueCategory[];
  includeDebug?: boolean;
  includeHealthy?: boolean;
}

function getLocalDateString(offsetDays = 0) {
  const today = new Date();
  today.setDate(today.getDate() - offsetDays);
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateString(value: Date | string | undefined, fallback: string) {
  if (!value) return fallback;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return value;
}

export function isBusinessActionableIssue(issue: UniformIssue) {
  const category = String(issue.category);
  return (
    category === "production_suggestion" &&
    issue.severity !== "healthy" &&
    issue.issueType !== "unmapped_spend_account" &&
    issue.problemStage !== "data_health" &&
    issue.optimizationArea !== "mapping"
  );
}

function filterIssues(
  rows: UniformIssue[],
  categories: IssueCategory[],
  includeDebug: boolean,
  includeHealthy: boolean
) {
  return rows.filter(issue => {
    if (!includeHealthy && issue.severity === "healthy") return false;
    if (!includeDebug && issue.category === "debug_invalid") return false;
    if (!categories.includes(issue.category)) return false;
    if (
      categories.includes("production_suggestion") &&
      !categories.includes("data_health_notice") &&
      !includeDebug &&
      !isBusinessActionableIssue(issue)
    ) {
      return false;
    }
    return true;
  });
}

export function useDiagnosticsIssues(options: UseDiagnosticsIssuesOptions = {}) {
  const [issues, setIssues] = useState<UniformIssue[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [reportMeta, setReportMeta] = useState<DiagnosticsReportMeta>({
    message: "",
    diagnosticsDegraded: false,
    failedDetectors: [],
    backendSummary: null
  });
  const [localStartDate, setStartDate] = useState<string>(() => getLocalDateString(29));
  const [localEndDate, setEndDate] = useState<string>(() => getLocalDateString(0));
  const categories = options.categories || ["production_suggestion"];
  const includeDebug = options.includeDebug === true;
  const includeHealthy = options.includeHealthy === true;
  const startDate = toDateString(options.startDate, localStartDate);
  const endDate = toDateString(options.endDate, localEndDate);
  const categoriesKey = categories.join(",");

  const fetchIssues = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/diagnostics/issues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          includeDebug,
          categories,
          includeHealthy
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || `HTTP error ${response.status}`);
      }

      const report = await response.json();

      if (report && report.success) {
        const nextIssues = Array.isArray(report.issues)
          ? filterIssues(report.issues, categories, includeDebug, includeHealthy)
          : [];
        setIssues(nextIssues);
        setReportMeta({
          message: report.message || "诊断已完成。",
          diagnosticsDegraded: Boolean(report.diagnosticsDegraded),
          failedDetectors: Array.isArray(report.failedDetectors) ? report.failedDetectors : [],
          backendSummary: report.summary || null
        });
      } else if (report && Array.isArray(report.issues)) {
        setIssues(filterIssues(report.issues, categories, includeDebug, includeHealthy));
        setReportMeta({
          message: report.message || report.error || "诊断接口返回降级结果。",
          diagnosticsDegraded: true,
          failedDetectors: Array.isArray(report.failedDetectors)
            ? report.failedDetectors
            : [
                {
                  name: "diagnostics_api",
                  message: report.error || "接口返回 success=false，但仍包含 issues 数组。"
                }
              ],
          backendSummary: report.summary || null
        });
      } else {
        throw new Error(report?.error || "获取异常：接口返回 success = false");
      }
    } catch (err: any) {
      console.error("[useDiagnosticsIssues FETCH ERROR]", err);
      setReportMeta({
        message: "",
        diagnosticsDegraded: false,
        failedDetectors: [],
        backendSummary: null
      });
      setError({
        message: err.message || "请求诊断数据失败",
        details: err?.stack || "检查网络连接或后端服务状态"
      }); 
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, [startDate, endDate, categoriesKey, includeDebug, includeHealthy]);

  // Summarize issues
  const summary = {
    total: issues.length,
    productionSuggestionCount: issues.filter(r => r.category === "production_suggestion").length,
    dataHealthNoticeCount: issues.filter(r => r.category === "data_health_notice").length,
    debugInvalidCount: issues.filter(r => r.category === "debug_invalid").length,
    
    // Severity
    criticalCount: issues.filter(r => r.severity === "critical").length,
    warningCount: issues.filter(r => r.severity === "warning").length,
    infoCount: issues.filter(r => r.severity === "info").length,
    healthyCount: issues.filter(r => r.severity === "healthy").length,

    // High priority issues (sorted by priority score desc)
    sortedIssues: [...issues].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0)),

    // Groups
    problemStages: issues.reduce((acc, iss) => {
      const stage = iss.problemStage || "unassigned";
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),

    optimizationAreas: issues.reduce((acc, iss) => {
      const area = iss.optimizationArea || "unassigned";
      acc[area] = (acc[area] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),

    funnelStages: issues.reduce((acc, iss) => {
      const fStage = iss.funnelStage || "unassigned";
      acc[fStage] = (acc[fStage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),

    // Unique Stores listed
    storeCount: new Set(
      issues
        .filter(iss => iss.entityType === "store" && iss.entityId)
        .map(iss => iss.entityId)
    ).size || 0,

    // Unique Accounts listed
    adAccountCount: new Set(
      issues
        .filter(iss => iss.entityType === "ad_account" && iss.entityId)
        .map(iss => iss.entityId)
    ).size || 0,
  };

  return {
    issues,
    summary,
    loading,
    error,
    reportMeta,
    refetch: fetchIssues,
    startDate,
    endDate,
    setStartDate,
    setEndDate
  };
}
