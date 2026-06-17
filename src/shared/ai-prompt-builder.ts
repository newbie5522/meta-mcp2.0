import { PromptBuildInput, PromptBuildResult } from "./ai-prompt-boundary.types.js";
import {
  ISSUE_EXPLANATION_PROMPT_BOUNDARY,
  DASHBOARD_SUMMARY_PROMPT_BOUNDARY,
  REVIEW_TEMPLATE_PROMPT_BOUNDARY
} from "./ai-prompt-boundary-config.js";

export function buildPromptBoundaryPackage(input: PromptBuildInput): PromptBuildResult {
  const scenario = input.scenario;
  if (scenario === "explain_issue") {
    return buildIssueExplanationPrompt(input);
  } else if (scenario === "explain_dashboard") {
    return buildDashboardSummaryPrompt(input);
  } else if (scenario === "explain_review") {
    return buildReviewTemplatePrompt(input);
  } else {
    throw new Error(`Prompt builder handles only specified scenarios, found '${scenario}'`);
  }
}

export function buildIssueExplanationPrompt(input: PromptBuildInput): PromptBuildResult {
  const pkg = ISSUE_EXPLANATION_PROMPT_BOUNDARY;
  const issueData = input.issue ? JSON.stringify(input.issue, null, 2) : "无诊断主体";
  const statusData = input.statusDetail ? JSON.stringify(input.statusDetail, null, 2) : "无状态明细";
  const contextData = input.context ? JSON.stringify(input.context, null, 2) : "无上下文信息";

  // Check category for debug_invalid protection
  let isDebugInvalid = false;
  let actionClause = "请逐步列出具体的手工核对排查步骤。";
  if (input.issue && typeof input.issue === "object") {
    const rawIssue = input.issue as Record<string, unknown>;
    if (rawIssue.category === "debug_invalid") {
      isDebugInvalid = true;
      actionClause = "由于此条诊断属于底层通道对账数据无效（category === 'debug_invalid'），不允许给出推广素材修改、预算或广告账户物理操作方案，必须且仅能指出数据缺失根源与指导如何补全底层数据通道。";
    }
  }

  // Check human confirmation flag
  let humanConfirmationRequired = true;
  if (input.issue && typeof input.issue === "object") {
    const rawIssue = input.issue as Record<string, unknown>;
    if (rawIssue.humanConfirmationRequired === false) {
      humanConfirmationRequired = false;
    }
  }

  const systemPrompt = `你是一个辅助诊断决策分析机器人。
你只能基于系统所传入的诊断结果清单进行业务含义的翻译与多源对账勾稽关系的宏观讲解。
【绝对禁止的行为】：
1. 绝对严禁无中生成（establish/generate）任何原始诊断之外的全新成效推论或新的投放优化主张。
2. 绝对严禁改变任何传入异常记录的分类（category）或危险评分（severity/scores）。
3. 绝对不得虚构出不存在于传入数据中的任何数字。
4. 绝对严禁宣称你已经物理暂停了任何广告、已经变更了Meta预算，或宣称本平台能实现自动流转。所有陈述均应指引运营在外部后台手工查验。
5. 所有对账及操作建议，必须提醒运营专员线下多源校验后，方能自行手工在相应渠道完成。不可做出任何自动或免人工审核承诺。`;

  const userPrompt = `诊断分析引擎传入的目标对账主体如下所示：
---诊断记录事实---
${issueData}

---运营当前流转状态信息---
${statusData}

---分析上下文运行特征---
${contextData}

---输出撰写规范及提示---
1. 你的分析回复必须完全忠实于诊断引擎已输出的数字事实。
2. 若某项成效分析指标（比如 ROAS、广告花费或店平成绩）未出现在诊断事实中，你必须直接填报为“数据未提供”，切勿依靠行业先验常识脑补编造具体数值。
3. 如果输入事实中包含 limitations（限制要素），你必须在对应的 limitations 输出位置进行如实转录与强调。
4. 执行与跟进方案约束：
   - ${actionClause}
   - ${humanConfirmationRequired ? "所有的执行步骤必须声明：'需要人工确认。'" : "此 anomaly 表明不需要直接进行手工物理优化处理，仅需作为数据大盘风险说明。"}`;

  const outputContract = `【请输出符合以下 JSON 格式结构的非代币原生块文本】：
{
  "summary": "一句话客观描述对账引擎捕获的关键偏离事实",
  "businessMeaning": "用极其通俗易懂的方式向普通运营人员转述本诊断意味着哪类财务对账或技术报错风险",
  "evidenceExplanation": "依据传入的 Evidence 对账指标进行分析讲解。绝对不偏离输入指标，不存在数字则填报‘数据未提供’",
  "operatorActionPlan": "本步骤应为纯手工核对操作清单。若 category === 'debug_invalid' 必须严格放空或输出为不可执行",
  "riskNotes": "不合规操作带来的潜在资金损失或系统失联等重大警示",
  "validationPlan": "说明对于此类对账，在人工处置后，如何在接下来 3天 / 7天 / 14天 执行对账复核",
  "limitations": "转录诊断事实中指明的逻辑限制与延时问题",
  "modelBoundaryNotes": "说明离线系统无操控Meta或店铺的任何直接物理写入权，仅对离线数据做推演呈现",
  "requiresHumanConfirmation": true,
  "doNotDo": [
    "列出人工排查中千万不能盲目采用的危险策略（如：不要在数据未提供前直接对账截断、不要随意关闭健康的底层基础广告系列等）"
  ]
}`;

  return {
    package: pkg,
    systemPrompt,
    userPrompt,
    outputContract,
    safetyChecklist: {
      noExternalData: true,
      noMetricInvention: true,
      noExecutionClaim: true,
      noMetaWriteClaim: true,
      noBudgetChangeClaim: true,
      noCategoryMutation: true,
      noSeverityMutation: true,
      noScoreMutation: true,
      humanConfirmationRequired: true,
      debugInvalidProtected: isDebugInvalid
    }
  };
}

export function buildDashboardSummaryPrompt(input: PromptBuildInput): PromptBuildResult {
  const pkg = DASHBOARD_SUMMARY_PROMPT_BOUNDARY;
  const contextData = input.context ? JSON.stringify(input.context, null, 2) : "无诊断上下文大盘属性";
  const statusData = input.statusDetail ? JSON.stringify(input.statusDetail, null, 2) : "无看板全局状态";

  const systemPrompt = `你是一个针对多源对账看板异常总结的管理视角解读机器人。
工作首要原则是为管理层提供全盘健康的宏观概览指引，不提供任何微观投放动作的细分生成。
【操作隔离红线】：
1. 绝对不可以建立（generate）任何原本不属于大盘诊断的全新异常报警，更不能编造新的账户问题。
2. 绝对不可替代管理层做出任何预算倾斜或账期暂缓决策。
3. 必须绝对遵循传入事实的时间范围进行总结，不得外推。`;

  const userPrompt = `当前诊断看板各接口状态与筛选上下文大底如下：
---看板流势上下文---
${contextData}

---汇总流转状况---
${statusData}

---分析汇报导向---
1. 梳理传入过滤范围及运行时间切片内的连接健康度，列出需要重点关注的高危风险分类。
2. 不得脑补生成宏观 GMV 汇总数据。未包含在输入中的综合 ROAS 与实际销售额，必须注明“数据未提供”。
3. 只能对已有在册 category 做分类逻辑特征解析，引导管理者安排专业人工去外部 Meta Manager 做细致核实。`;

  const outputContract = `【请输出符合以下 JSON 结构的文本】：
{
  "summary": "管理视角下大盘通道连结与差异度总结",
  "businessMeaning": "向高管简要阐述当前不同业务渠道（例如店铺与媒体）在逻辑上的对齐态势",
  "evidenceExplanation": "依据大盘输入的数据总量说明总体校验比例。若无明确财务成效汇总传出，涉及财务指标则列出‘数据未提供’",
  "operatorActionPlan": "告知管理者需要指示一线运营团队在各个独立后台上手工核实哪些高优先级项",
  "riskNotes": "不采取人工对账可能产生的多计消耗、多报店平成效的大盘管理风险",
  "validationPlan": "给出建议的宏观定期复审（3天、7天、14天等）管理流程对账规范",
  "limitations": "说明看板总体采集的时效性滞后说明",
  "modelBoundaryNotes": "说明分析机器人不介入后台资金物理流水，仅根据同步周期数据做出逻辑对齐报告",
  "requiresHumanConfirmation": true,
  "doNotDo": [
    "提点高层不可在发现异常数据时立刻盲目批量暂停Meta中运行良久的广告组，必须坚持人工审计优先"
  ]
}`;

  return {
    package: pkg,
    systemPrompt,
    userPrompt,
    outputContract,
    safetyChecklist: {
      noExternalData: true,
      noMetricInvention: true,
      noExecutionClaim: true,
      noMetaWriteClaim: true,
      noBudgetChangeClaim: true,
      noCategoryMutation: true,
      noSeverityMutation: true,
      noScoreMutation: true,
      humanConfirmationRequired: true,
      debugInvalidProtected: true
    }
  };
}

export function buildReviewTemplatePrompt(input: PromptBuildInput): PromptBuildResult {
  const pkg = REVIEW_TEMPLATE_PROMPT_BOUNDARY;
  const issueData = input.issue ? JSON.stringify(input.issue, null, 2) : "无复盘主体";
  const statusData = input.statusDetail ? JSON.stringify(input.statusDetail, null, 2) : "无本次流转操作明细";

  const systemPrompt = `你是一个针对已执行（或已忽略）的诊断预警，生成回测复盘追溯模板的工作流机器人。
你只能整理过去的人工作业成果并搭建逻辑复盘骨架，不得伪造最终由于对账排查从而产生优化提升的既得成绩。
【严格红线】：
1. 绝对严禁宣称由于本平台的决策导致了某项核心 ROAS 的最终提升或者 CPA 最终下降。所有的成效结论行，必须打印未填写的占位符等待人工审计。
2. 数据状态不符合或主体不存在时，需坦诚表明复盘主体缺失。`;

  const userPrompt = `需对其建立回测与跟踪复盘模板的相关记录详情如下：
---对账实体详情---
${issueData}

---人工流转动作与原始备注---
${statusData}

---模板生成原则---
1. 若运营填写的 operatorNotes 不为空，必须如实转录原词提供在复盘模板的历史提纲里，不得精简漏失。
2. 必须依据异常自带的 validationMetrics 勾勒出 3d、7d、14d 后，人类需要复核的指标占位槽。
3. 严格排除被标记为 'ignored' 的不需执行的问题进入正规回测闭环。`;

  const outputContract = `【请按照以下 JSON 标准输出】：
{
  "summary": "本次运营动作落实情况及归档回测简述",
  "businessMeaning": "提炼原 issue 在业务流程追溯上的重要意义",
  "evidenceExplanation": "回顾当时对账引擎留底的偏离凭证。如果没有传入，则该对账区间标明‘数据未提供’",
  "operatorActionPlan": "根据输入备注信息，梳设一份留待运营手工在3天后核改、补充的数据录入计划",
  "riskNotes": "不履行后期复审跟踪导致的漏记或逃单隐患说明",
  "validationPlan": "详细设勒 3/7/14 天之后，运营需前往 Meta 调取的真实财务回溯指标项清单",
  "limitations": "告知对于人工反馈失实的审计缺陷限制",
  "modelBoundaryNotes": "说明机器人仅根据流盘单据做结构整理，不能证明外部渠道原始单据的物理真伪",
  "requiresHumanConfirmation": true,
  "doNotDo": [
    "提醒运营切勿把‘已忽略’或‘无效对账’强行套作为核心复盘追踪"
  ]
}`;

  return {
    package: pkg,
    systemPrompt,
    userPrompt,
    outputContract,
    safetyChecklist: {
      noExternalData: true,
      noMetricInvention: true,
      noExecutionClaim: true,
      noMetaWriteClaim: true,
      noBudgetChangeClaim: true,
      noCategoryMutation: true,
      noSeverityMutation: true,
      noScoreMutation: true,
      humanConfirmationRequired: true,
      debugInvalidProtected: true
    }
  };
}

export function assertPromptBoundarySafety(result: PromptBuildResult): boolean {
  if (!result || !result.package) {
    return false;
  }
  const isRequiresHuman = result.package.requiresHumanConfirmation === true;
  const isScenarioValid = ["explain_issue", "explain_dashboard", "explain_review"].includes(result.package.scenario);
  return isRequiresHuman && isScenarioValid;
}
