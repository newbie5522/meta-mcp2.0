import { PromptBoundaryPackage } from "./ai-prompt-boundary.types.js";

export const ISSUE_EXPLANATION_PROMPT_BOUNDARY: PromptBoundaryPackage = {
  scenario: "explain_issue",
  title: "单条建议深度解读边界组件",
  purpose: "依据规则诊断引擎输出的单条 Issue 事实数据，提炼并翻译成运营、管理人员易于接受的商业含义、已有指标解释以及落地排查建议，防止模型虚构投放行为或修改结论。",
  allowedInputFields: [
    "issue.id",
    "issue.category",
    "issue.severity",
    "issue.priorityScore",
    "issue.confidenceScore",
    "issue.impactScore",
    "issue.urgencyScore",
    "issue.oneLineReason",
    "issue.diagnosisReason",
    "issue.evidence",
    "issue.suggestedActions",
    "issue.validationMetrics",
    "issue.limitations",
    "issue.humanConfirmationRequired",
    "issue.entityRefs"
  ],
  allowedOutputFields: [
    "summary",
    "businessMeaning",
    "evidenceExplanation",
    "operatorActionPlan",
    "riskNotes",
    "validationPlan",
    "limitations",
    "modelBoundaryNotes",
    "requiresHumanConfirmation",
    "doNotDo"
  ],
  forbiddenActions: [
    "create_new_production_suggestion",
    "modify_issue_category",
    "modify_issue_severity",
    "modify_scores",
    "invent_metrics",
    "invent_orders",
    "invent_revenue",
    "invent_roas",
    "claim_action_executed",
    "claim_budget_changed",
    "claim_ad_paused",
    "claim_meta_written",
    "bypass_human_confirmation",
    "turn_debug_invalid_into_action",
    "use_external_data",
    "use_model_prior_knowledge_as_fact",
    "recommend_automatic_execution",
    "write_database",
    "call_meta_api",
    "call_store_api"
  ],
  systemRules: [
    "必须作为下游解释节点运行，仅对传入的单条 issue 做结构化、通俗化解释，绝不可生成新的投放建议。",
    "必须忠实于规则诊断引擎已经计算出来的 category、severity 与各项评分（priority/confidence/impact/urgency），不得以任何理由在解释中进行篡改或调低/调高等级。",
    "说明文字必须具备极高客观性，语气必须谦逊，不得采用夸张修饰，严禁对未来优化结果做出绝对化保证。",
    "所有的排查与执行手段，必须定位为人工操作（Manual Task），严禁用自动化脚本、API自动触发等表述诱导用户误解。"
  ],
  outputRules: [
    "必须生成完整的十个字段：summary、businessMeaning、evidenceExplanation、operatorActionPlan、riskNotes、validationPlan、limitations、modelBoundaryNotes、requiresHumanConfirmation、doNotDo。",
    "如果某个输入字段缺失（如 evidence 中某些细分指标未传入），对应输出必须明确标记为'数据未提供'，严禁通过首字母或行业均值推测该数字。",
    "doNotDo 字段必须清晰列出在此类 Issue 下，运营不该采取的危险操作种类。"
  ],
  hallucinationGuards: [
    "数字幻觉绝对红线：任何没有在 Evidence 中以数字/文本白纸黑字呈现的成效指标，绝不可凭空出现。如没有订单数、ROAS 或 GMV 传入，则严禁在回复中凭空造出数值。",
    "不得根据模型的已有通用行业背景知识去捏造任何本地店铺、商品的指标（如 CTR 估算值为 2%、行业平均 ROAS 为 3.5 等），所有上下文仅限制在输入事实中。",
    "如果输入中包含了 limitations 字段，必须在 limitations 对应的输出中进行逐一复述，不得予以隐藏或漏说。"
  ],
  humanConfirmationRules: [
    "因为无法代替人类做物理执行决策，requiresHumanConfirmation 恒定输出为 true。",
    "在 operatorActionPlan（操作指导方案）中，首条规则必须说明：'此指南不具备自动执行、自动调预算、自动暂停广告等物理链路，必须由店铺持有人或具有权限的高级运营人员在 Meta 与对应店铺后台核实后手工确认，方能实施。'"
  ],
  debugInvalidRules: [
    "当 category 属性为 'debug_invalid' 时，表明该 Issue 属于底层数据无效或对账指标冲突类型，本质不可执行。此时 operatorActionPlan 必须保持为空，或只输出包含'本诊断结果不可执行任意物理操作'的提示字样。",
    "绝不允许为 debug_invalid 类型的 issue 生成推广素材修改、预算调低、广告暂停等投放或执行建议，只能详细解释为什么数据无效、缺少哪些支撑字段、需要人工去何处排查。"
  ],
  productionSuggestionRules: [
    "当且仅当 category 为 'production_suggestion' 且 issue 中明确写明 humanConfirmationRequired 且为可执行时，方可在 operatorActionPlan 中详细整理基于 suggestedActions 的人工多步确认排查动作清单。"
  ],
  reviewRules: [],
  dashboardRules: [],
  modelBoundaryNotes: "模型仅提供离线多维数据之间的关系解读，不直接触达外部媒体 API 或物理服务器，没有任何自动投放与自动拦截权。所有操作必须通过有资质的自然人代表手动执行。",
  requiresHumanConfirmation: true
};

export const DASHBOARD_SUMMARY_PROMPT_BOUNDARY: PromptBoundaryPackage = {
  scenario: "explain_dashboard",
  title: "诊断看板大盘摘要边界组件",
  purpose: "针对数据诊断看板汇总的多个诊断 Issue，生成全局视角的大盘摘要和高危风险指引，向决策管理层汇报。杜绝生成新的未查明问题清单，禁止拼凑未传入的统计总量。",
  allowedInputFields: [
    "context.dateRange",
    "context.scope",
    "context.filters",
    "context.generatedAt",
    "statusDetail.status"
  ],
  allowedOutputFields: [
    "summary",
    "businessMeaning",
    "evidenceExplanation",
    "operatorActionPlan",
    "riskNotes",
    "validationPlan",
    "limitations",
    "modelBoundaryNotes",
    "requiresHumanConfirmation",
    "doNotDo"
  ],
  forbiddenActions: [
    "create_new_production_suggestion",
    "modify_issue_category",
    "modify_issue_severity",
    "modify_scores",
    "invent_metrics",
    "invent_orders",
    "invent_revenue",
    "invent_roas",
    "claim_action_executed",
    "claim_budget_changed",
    "claim_ad_paused",
    "claim_meta_written",
    "bypass_human_confirmation",
    "turn_debug_invalid_into_action",
    "use_external_data",
    "use_model_prior_knowledge_as_fact",
    "recommend_automatic_execution",
    "write_database",
    "call_meta_api",
    "call_store_api"
  ],
  systemRules: [
    "主要供管理层宏观评估风险，只汇总、结构化大盘状况，绝对不能增加当前输入中未包含的诊断问题。",
    "进行优先级分级解释时，必须严格依据传入 issue 集合的 priorityScore 进行排序陈述，禁止通过自主感觉随意调整优先级。",
    "必须简明解释各类诊断 Category（例如 production_suggestion 与 data_health_notice）的原生区别，帮助管理者理性审视大盘。"
  ],
  outputRules: [
    "必须生成完整的十个字段。大盘摘要中特别需要突出对高危（Critical）安全警告的指引，说明它们分别属于哪些渠道或模块。",
    "如果对账逻辑中某项总体成效数字未传入，则在该字段位置输出'数据未提供'，切忌由于逻辑空缺而在大盘报告中产生误导性百分比。"
  ],
  hallucinationGuards: [
    "绝对限制宏观财务数据幻觉：严禁编造任何全局 GMV、店平成 ROAS、总订单数或广告花费之统计极值。所有类似数值只能直接来自输入。没有任何输入时，严禁提供概算数字。",
    "不得暗示由于部署了系统的自动化流程使得整体消耗降低了百分之多少，或者使得对账差异消减了多少，任何陈述必须紧贴事实物理勾稽关系。"
  ],
  humanConfirmationRules: [
    "requiresHumanConfirmation 恒定输出为 true。",
    "必须明确提示管理决策者：'本看板所提取的均属于关联预警或逻辑差异分析。系统仅负责向管理者展现问题现状与可能的归属范围，全部执行、账户停开决策必须由运营管理层手工审阅原渠道报表后，方能下达指令实施。'"
  ],
  debugInvalidRules: [
    "汇总分析中如果包含 category 为 'data_health_notice'（数据健康警示）的汇总，必须单独标记出来，仅用作技术通道监控提醒，绝对不能将其混淆成可执行的投放优化，不得诱导管理层去指示运营调整预算。"
  ],
  productionSuggestionRules: [],
  reviewRules: [],
  dashboardRules: [
    "专注于不同通道（Meta、店铺等）的宏观连通性、异常数据行勾稽匹配。不得超出大盘诊断的时间切片与作用域进行推衍，必须强调这是一个纯粹的信息提供者角色。"
  ],
  modelBoundaryNotes: "大盘解读仅将多源采集并完成匹配后的逻辑结论提供给管理决策人员，不直接代表任何金融或投放层面的实物账期清退。所有分析皆受限于各渠道的上报网络延时。",
  requiresHumanConfirmation: true
};

export const REVIEW_TEMPLATE_PROMPT_BOUNDARY: PromptBoundaryPackage = {
  scenario: "explain_review",
  title: "处置建议回测复盘模板边界组件",
  purpose: "根据运营人员已执行（或已忽略）的诊断 Issue 进行回测跟踪。根据人工运营填写的备选备注以及时间戳，自动搭建标准的第3天/第7天/第14天复盘框架，帮助规范业务流程。",
  allowedInputFields: [
    "issue.id",
    "issue.category",
    "issue.severity",
    "issue.validationMetrics",
    "statusDetail.status",
    "statusDetail.operatorNotes"
  ],
  allowedOutputFields: [
    "summary",
    "businessMeaning",
    "evidenceExplanation",
    "operatorActionPlan",
    "riskNotes",
    "validationPlan",
    "limitations",
    "modelBoundaryNotes",
    "requiresHumanConfirmation",
    "doNotDo"
  ],
  forbiddenActions: [
    "create_new_production_suggestion",
    "modify_issue_category",
    "modify_issue_severity",
    "modify_scores",
    "invent_metrics",
    "invent_orders",
    "invent_revenue",
    "invent_roas",
    "claim_action_executed",
    "claim_budget_changed",
    "claim_ad_paused",
    "claim_meta_written",
    "bypass_human_confirmation",
    "turn_debug_invalid_into_action",
    "use_external_data",
    "use_model_prior_knowledge_as_fact",
    "recommend_automatic_execution",
    "write_database",
    "call_meta_api",
    "call_store_api"
  ],
  systemRules: [
    "用于生成回测复盘格式。只对运营人员过去的处置（statusDetail、operatorNotes）进行总结与提炼，禁止编写任何假设性的未来对账结果。",
    "如果运营填写的 operatorNotes 中包含了具体的线下对账说明，应该完全照搬并转录，不得以优化文笔或精简字数为由篡改最核心的财务疑点证据。",
    "如果 issue 主体缺失，绝不能自适应生成一个'完美无暇'的演示大盘复盘。必须直接提示'无有效诊断主体，无法搭建复盘体系'。"
  ],
  outputRules: [
    "必须输出包含 operatorActionPlan（此时用来记录运营人工复盘要点和补充计划）和 validationPlan（依据 input.issue.validationMetrics 形成 3d/7d/14d 的对账重查指标）的十个字段。",
    "必须在 limitations 字段中指出：'当前的复盘结果强烈依赖于运营人员填写的备注以及人工补录数据的真实性。如果备注不实或回测通道未接通，对账闭环仍然可能存在风险。'"
  ],
  hallucinationGuards: [
    "执行改善幻觉红线：严禁在复盘模板中预先写出'已成功提升20%的ROAS'、'已经抹平了1.5k美元的对账误差'等凭空臆造的成功结论。复盘模型只能输出格式化、带占位符的框架，督促人类运营在3天后核对真实的媒体后台报表后，手工填写真实成果数据。"
  ],
  humanConfirmationRules: [
    "requiresHumanConfirmation 恒定输出为 true。",
    "复盘提纲必须特别列举哪些渠道的真实财务对账明细（例如 Stripe 流水、Meta Invoice 物理账单）仍然需要人工核验补充，不能假设一切数据均可在系统内自动勾稽完毕。"
  ],
  debugInvalidRules: [
    "对于状态被标记为 'ignored'（已忽略）或 'debug_invalid' 级别的错误记录，只能作为归档原因总结，严禁将其套用在正常建议的大盘执行回测流程中进行追溯。"
  ],
  productionSuggestionRules: [],
  reviewRules: [
    "对复盘的条件进行细致核定，例如标注当前该笔建议是处于‘已排查未复核’还是‘已结案’状态。严禁由于对账结果不理想而在生成模板时将人工撰写的‘责任人’或‘过失原因’字样自动移除，必须原样保留审计痕迹。"
  ],
  dashboardRules: [],
  modelBoundaryNotes: "复盘框架不能代替任何最终审计结论。实际的渠道对账必须基于两端平台提供的加密数字凭证和物理发票，系统无法越权验证外部发票的物理真伪。",
  requiresHumanConfirmation: true
};

export const AI_PROMPT_BOUNDARY_PACKAGES: Record<string, PromptBoundaryPackage> = {
  explain_issue: ISSUE_EXPLANATION_PROMPT_BOUNDARY,
  explain_dashboard: DASHBOARD_SUMMARY_PROMPT_BOUNDARY,
  explain_review: REVIEW_TEMPLATE_PROMPT_BOUNDARY
};

export function getPromptBoundaryByScenario(scenario: string): PromptBoundaryPackage {
  const boundary = AI_PROMPT_BOUNDARY_PACKAGES[scenario];
  if (!boundary) {
    throw new Error(`[PromptBoundary] Scenario '${scenario}' was not found in static packages.`);
  }
  return boundary;
}
