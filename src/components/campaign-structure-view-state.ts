import {
  CURRENT_RANGE_NOT_READY_MESSAGE,
  DATE_RANGE_MISMATCH_MESSAGE,
  getSafeLastGoodData,
  isDateRangeMismatch,
  makeLastGoodData,
  shouldPreserveLastGoodData
} from "@/lib/data-view-state";

export function hasPerformanceFacts(row: any) {
  return row?.hasPerformanceFacts !== false && row?.spend !== null && row?.impressions !== null;
}

export function formatNumber(value: any) {
  return value === null || value === undefined ? "N/A" : Number(value).toLocaleString();
}

export function formatFixed(value: any, digits = 2, suffix = "") {
  return value === null || value === undefined ? "N/A" : `${Number(value).toFixed(digits)}${suffix}`;
}

export function formatMoney(value: any) {
  return value === null || value === undefined ? "N/A" : `$${Number(value).toFixed(2)}`;
}

export function buildHierarchyPerformanceTotals(rows: any[]) {
  const performanceRows = rows.filter(hasPerformanceFacts);
  if (performanceRows.length === 0) {
    return {
      performanceRows,
      spend: null,
      impressions: null,
      clicks: null,
      purchases: null,
      purchaseValue: null,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
      roas: null
    };
  }

  const spend = performanceRows.reduce((sum, item) => sum + Number(item.spend || 0), 0);
  const impressions = performanceRows.reduce((sum, item) => sum + Number(item.impressions || 0), 0);
  const clicks = performanceRows.reduce((sum, item) => sum + Number(item.clicks || 0), 0);
  const purchases = performanceRows.reduce((sum, item) => sum + Number(item.purchases || 0), 0);
  const purchaseValue = performanceRows.reduce((sum, item) => sum + Number(item.purchaseValue || item.purchase_value || 0), 0);

  return {
    performanceRows,
    spend,
    impressions,
    clicks,
    purchases,
    purchaseValue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    cpa: purchases > 0 ? spend / purchases : null,
    roas: spend > 0 ? purchaseValue / spend : null
  };
}

function calculatedCpc(row: any) {
  return Number(row?.clicks || 0) > 0 && row?.spend !== null && row?.spend !== undefined
    ? Number(row.spend) / Number(row.clicks)
    : null;
}

function calculatedCpa(row: any) {
  return Number(row?.purchases || 0) > 0 && row?.spend !== null && row?.spend !== undefined
    ? Number(row.spend) / Number(row.purchases)
    : null;
}

export function buildCampaignAiPayload(input: {
  row: any;
  viewLevel: "accounts" | "campaigns" | "adsets" | "ads";
  startDate: string;
  endDate: string;
  selectedAccount?: string;
  selectedAccountName?: string;
  selectedCampaignId?: string;
  selectedAdSetId?: string;
}) {
  const { row, viewLevel } = input;
  if (!hasPerformanceFacts(row)) {
    return { blocked: true, reason: "NO_PERFORMANCE_FACTS" as const };
  }

  const cpc = calculatedCpc(row);
  const cpa = calculatedCpa(row);
  const name = row.name || row.fb_account_name || row.id;
  const prompt = [
    `分析 ${viewLevel}: ${name}`,
    `日期范围: ${input.startDate} ~ ${input.endDate}`,
    `花费金额: ${formatMoney(row.spend)}`,
    `展现次数: ${formatNumber(row.impressions)}`,
    `点击数量: ${formatNumber(row.clicks)}`,
    `购买成效: ${formatNumber(row.purchases)}`,
    `CPC: ${formatMoney(cpc)}`,
    `CPA: ${formatMoney(cpa)}`,
    `ROAS: ${formatFixed(row.roas)}`
  ].join("\n");

  return {
    blocked: false as const,
    prompt,
    context: {
      level: viewLevel,
      accountId: input.selectedAccount || row.fb_account_id || row.accountId || null,
      accountName: input.selectedAccountName || row.fb_account_name || row.accountName || null,
      campaignId: row.campaignId || (viewLevel === "campaigns" ? row.id : input.selectedCampaignId) || null,
      adsetId: row.adsetId || (viewLevel === "adsets" ? row.id : input.selectedAdSetId) || null,
      adId: viewLevel === "ads" ? row.id : null,
      name,
      spend: row.spend ?? null,
      impressions: row.impressions ?? null,
      clicks: row.clicks ?? null,
      purchases: row.purchases ?? null,
      cpc,
      cpa,
      roas: row.roas ?? null,
      dateRange: {
        startDate: input.startDate,
        endDate: input.endDate
      }
    }
  };
}

export function dispatchCampaignAiRequest(input: {
  row: any;
  viewLevel: "accounts" | "campaigns" | "adsets" | "ads";
  startDate: string;
  endDate: string;
  selectedAccount?: string;
  selectedAccountName?: string;
  selectedCampaignId?: string;
  selectedAdSetId?: string;
  dispatchEvent: (event: CustomEvent) => void;
  writeClipboard: (text: string) => Promise<void> | void;
}) {
  const payload = buildCampaignAiPayload(input);
  if (payload.blocked) return payload;

  input.dispatchEvent(new CustomEvent("open-ai-context", {
    detail: {
      source: "campaign_structure",
      title: `分析${input.viewLevel}: ${payload.context.name || payload.context.adId || payload.context.campaignId || payload.context.accountId}`,
      prompt: payload.prompt,
      context: payload.context
    }
  }));
  void input.writeClipboard(payload.prompt);
  return { ...payload, dispatched: true };
}

export function resolveCampaignStructureResponseState(input: {
  payload: any;
  rows: any[];
  startStr: string;
  endStr: string;
  requestKey: string;
  lastGoodData: any;
}) {
  const { payload, rows, startStr, endStr, requestKey, lastGoodData } = input;
  const responseDateRange = payload?.dateRange || payload?.appliedFilters || null;

  if (isDateRangeMismatch(payload, startStr, endStr)) {
    return {
      data: [],
      structureSummary: payload || null,
      dataHealth: { status: "DATE_RANGE_MISMATCH", message: DATE_RANGE_MISMATCH_MESSAGE },
      viewNotice: DATE_RANGE_MISMATCH_MESSAGE,
      responseDateRange,
      nextLastGoodData: lastGoodData
    };
  }

  if (shouldPreserveLastGoodData(payload, rows, lastGoodData, requestKey)) {
    const safeLastGoodData = getSafeLastGoodData(lastGoodData, requestKey);
    if (safeLastGoodData) {
      return {
        data: safeLastGoodData.data || [],
        structureSummary: safeLastGoodData.structureSummary || null,
        dataHealth: safeLastGoodData.dataHealth || null,
        viewNotice: CURRENT_RANGE_NOT_READY_MESSAGE,
        responseDateRange,
        nextLastGoodData: lastGoodData,
        preservedLastGoodData: true
      };
    }
  }

  const dataHealth = payload?.dataHealth || payload?.health || null;
  return {
    data: rows,
    structureSummary: payload || null,
    dataHealth,
    viewNotice: null,
    responseDateRange,
    nextLastGoodData: makeLastGoodData(requestKey, rows, {
      structureSummary: payload || null,
      dataHealth
    })
  };
}
