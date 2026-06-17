import {
  AiDeepDiagnosisMode,
  AiAllowedAnalysisTask,
  AiForbiddenAnalysisTask
} from "./ai-deep-diagnosis.types.js";

export const AI_DEEP_DIAGNOSIS_ALLOWED_TASKS: AiAllowedAnalysisTask[] = [
  "summarize_performance",
  "compare_time_windows",
  "identify_metric_shift",
  "rank_possible_causes",
  "explain_funnel_dropoff",
  "identify_creative_fatigue",
  "identify_data_quality_issue",
  "suggest_manual_validation_steps",
  "prioritize_operator_attention"
];

export const AI_DEEP_DIAGNOSIS_FORBIDDEN_TASKS: AiForbiddenAnalysisTask[] = [
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

export const AI_DEEP_DIAGNOSIS_REQUIRED_SECTIONS: string[] = [
  "executiveSummary",
  "keyFindings",
  "likelyCauses",
  "evidenceMap",
  "manualValidationSteps",
  "dataLimitations",
  "confidenceLevel",
  "doNotDo"
];

export interface AiDeepDiagnosisOutputSchema {
  executiveSummary: string;
  keyFindings: string[];
  likelyCauses: string[];
  evidenceMap: Record<string, string>;
  manualValidationSteps: string[];
  dataLimitations: string[];
  confidenceLevel: "high" | "medium" | "low" | "unknown";
  doNotDo: string[];
}

export const AI_DEEP_DIAGNOSIS_OUTPUT_REQUIREMENTS = {
  description: "所有深度分析分析器的根级数据结构契约，各分析模式输出必须严格满足该格式要求，拒绝编词、拒绝幻觉。",
  sections: AI_DEEP_DIAGNOSIS_REQUIRED_SECTIONS,
  validationRules: [
    "不得改变输出字段名称或破坏数据结构格式。",
    "字段所引用的指标必须在原输入存在，不可为了逻辑圆满随意撰写证据指标。",
    "如果缺少对应成效数据，在 evidenceMap 和 keyFindings 中必须清晰指出数据由于上游滞后未提供。"
  ]
};

export const AI_DEEP_DIAGNOSIS_DATA_QUALITY_RULES: string[] = [
  "对于底层缺失字段（missingFields 包含必要指标等情况），必须下调 confidenceLevel 到 medium 或 low。",
  "如果存在 staleDataWarnings，不得假定历史与当前性能趋势为常态，并在 dataLimitations 中明确说明时效不合规风险。",
  "如果 syncWarnings 与 mappingWarnings 触发，必须在 analysis 中指明由于映射异常，物理店铺和媒体侧可能存在误配。",
  "拒绝通过任何未授权的、非真实的店铺财务汇总数字作为趋势拟合依据。"
];

export const AI_DEEP_DIAGNOSIS_HUMAN_REVIEW_RULES: string[] = [
  "所有的 manualValidationSteps 必须被精确写明。不允许生成任何可以绕过操作人员线下审定的自动流转逻辑。",
  "doNotDo 字段必须指导人工核验中需要规避的一切高危动作，如‘切勿进行未授权一侧单方向清算’、‘不要直接关闭正在起量素材’等。",
  "任何最终结论，必须声明并附带人工多侧核对的动作入口描述。"
];

export interface AiDeepDiagnosisModeContract {
  mode: AiDeepDiagnosisMode;
  title: string;
  focus: string;
  allowedTasks: AiAllowedAnalysisTask[];
  forbiddenTasks: AiForbiddenAnalysisTask[];
  requiredDataQualityLevel: string;
}

export const AI_DEEP_DIAGNOSIS_MODE_CONTRACTS: Record<AiDeepDiagnosisMode, AiDeepDiagnosisModeContract> = {
  account_overview: {
    mode: "account_overview",
    title: "广告账户全局表现分析",
    focus: "评估广告账户在选定时间窗口的整体消耗、ROI、成效转化率以及相较于上周期的表现趋势，给出顶层健康指数。",
    allowedTasks: ["summarize_performance", "compare_time_windows", "identify_metric_shift", "prioritize_operator_attention"],
    forbiddenTasks: ["invent_missing_metrics", "claim_budget_changed", "claim_ad_paused", "auto_optimize_campaign", "write_database"],
    requiredDataQualityLevel: "medium"
  },
  store_overview: {
    mode: "store_overview",
    title: "店铺全局成效分析",
    focus: "评估独立站的总订单数、营业总营收、平均客单价（AOV）以及店铺一侧退款占比趋势，提供关联对账的基础线索。",
    allowedTasks: ["summarize_performance", "compare_time_windows", "identify_metric_shift", "identify_data_quality_issue"],
    forbiddenTasks: ["invent_missing_metrics", "claim_meta_written", "write_database", "generate_fake_orders", "generate_fake_roas"],
    requiredDataQualityLevel: "medium"
  },
  campaign_diagnosis: {
    mode: "campaign_diagnosis",
    title: "广告系列层级深度分析",
    focus: "对选定广告系列（Campaign）的细化表现做综合对比，发现由于多系列重叠或者投产偏离导致的花费效率低下。",
    allowedTasks: ["summarize_performance", "compare_time_windows", "identify_metric_shift", "rank_possible_causes", "prioritize_operator_attention"],
    forbiddenTasks: ["invent_missing_metrics", "claim_budget_changed", "claim_ad_paused", "auto_optimize_campaign"],
    requiredDataQualityLevel: "medium"
  },
  adset_diagnosis: {
    mode: "adset_diagnosis",
    title: "广告组层级配额与受众诊断",
    focus: "剖析异常广告组（AdSet）的受众表现，定位花费失调或千次展示成本（CPM）虚高后的可能因素。",
    allowedTasks: ["summarize_performance", "identify_metric_shift", "rank_possible_causes", "suggest_manual_validation_steps"],
    forbiddenTasks: ["invent_missing_metrics", "claim_budget_changed", "auto_optimize_campaign", "call_external_api"],
    requiredDataQualityLevel: "medium"
  },
  ad_diagnosis: {
    mode: "ad_diagnosis",
    title: "广告层级细化成效判定",
    focus: "对单条关键广告的各项点击、转化漏斗以及转化偏离指标进行关联分析，得出异常诊断。",
    allowedTasks: ["summarize_performance", "identify_metric_shift", "rank_possible_causes", "suggest_manual_validation_steps"],
    forbiddenTasks: ["invent_missing_metrics", "claim_ad_paused", "auto_optimize_campaign", "call_external_api"],
    requiredDataQualityLevel: "low"
  },
  creative_fatigue: {
    mode: "creative_fatigue",
    title: "创意素材生命力与衰耗判定",
    focus: "通过广告频次（Frequency）、近期展示（CPM）上涨、点击率（CTR）持续下降等信号，精准诊断创意素材衰竭状况。",
    allowedTasks: ["summarize_performance", "identify_metric_shift", "identify_creative_fatigue", "prioritize_operator_attention"],
    forbiddenTasks: ["invent_missing_metrics", "claim_ad_paused", "auto_optimize_campaign", "override_rule_engine"],
    requiredDataQualityLevel: "low"
  },
  product_performance: {
    mode: "product_performance",
    title: "商品成效与爆款关联分析",
    focus: "连结独立站具体商品热度与对应投放素材的产品引用，验证哪些主推单品转化受阻或存在差价脱节。",
    allowedTasks: ["summarize_performance", "compare_time_windows", "rank_possible_causes", "identify_data_quality_issue"],
    forbiddenTasks: ["invent_missing_metrics", "write_database", "generate_fake_orders", "generate_fake_roas"],
    requiredDataQualityLevel: "medium"
  },
  funnel_breakdown: {
    mode: "funnel_breakdown",
    title: "流量转化漏斗多重阻滞分析",
    focus: "针对展示到点击、加购（AddToCart）、发起结账（InitiateCheckout）到生成购买的流量断层，剖析体验和数据延迟性阻滞。",
    allowedTasks: ["summarize_performance", "explain_funnel_dropoff", "rank_possible_causes", "suggest_manual_validation_steps"],
    forbiddenTasks: ["invent_missing_metrics", "override_rule_engine", "ignore_data_quality_limits", "generate_fake_orders"],
    requiredDataQualityLevel: "low"
  },
  data_quality: {
    mode: "data_quality",
    title: "多源采集通道健康度评定",
    focus: "专门衡量和审查接口时效差异、未关联匹配实体、时差时区配置与上报漏记情况下的总体数据干净度。",
    allowedTasks: ["summarize_performance", "identify_data_quality_issue", "suggest_manual_validation_steps"],
    forbiddenTasks: ["invent_missing_metrics", "write_database", "ignore_data_quality_limits", "generate_fake_roas"],
    requiredDataQualityLevel: "low"
  },
  cross_channel_attribution: {
    mode: "cross_channel_attribution",
    title: "跨渠道归因与对账勾稽分析",
    focus: "处理由于 Meta 侧 Purchase 回传成效数据，与 Shopify 实际入库结算在笔数及账期金额上的物理差异核验。",
    allowedTasks: ["summarize_performance", "identify_metric_shift", "rank_possible_causes", "identify_data_quality_issue", "suggest_manual_validation_steps"],
    forbiddenTasks: ["invent_missing_metrics", "override_rule_engine", "ignore_data_quality_limits", "generate_fake_orders", "generate_fake_roas"],
    requiredDataQualityLevel: "medium"
  }
};

export function getAiDeepDiagnosisContract(mode: AiDeepDiagnosisMode): AiDeepDiagnosisModeContract {
  const contract = AI_DEEP_DIAGNOSIS_MODE_CONTRACTS[mode];
  if (!contract) {
    throw new Error(`[AiDeepDiagnosisContract] Mode '${mode}' was not found in static contracts.`);
  }
  return contract;
}
