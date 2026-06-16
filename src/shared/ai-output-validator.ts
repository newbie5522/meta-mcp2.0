import { AIExplainInput, AIExplainOutput } from "./ai-explain.types";

/**
 * Validator function for AI Explain Schema (First Phase Schema Dry Run & Future Integration)
 */
export function validateAIExplainOutput(
  input: AIExplainInput,
  output: any
): {
  ok: boolean;
  errors: string[];
  sanitizedOutput?: AIExplainOutput;
} {
  const errors: string[] = [];

  // 1. Must be a valid object
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return {
      ok: false,
      errors: ["Output 必须是合法对象 (Output must be an object)"]
    };
  }

  // 2. Required fields validation
  const requiredFields: (keyof AIExplainOutput)[] = [
    "executiveSummary",
    "rootCauseAnalysis",
    "operatorActionPlan",
    "riskNotes",
    "validationPlan",
    "confidenceExplanation",
    "doNotDo",
    "requiresHumanConfirmation",
    "modelBoundaryNotes"
  ];

  for (const field of requiredFields) {
    if (!(field in output)) {
      errors.push(`缺失必填字段: ${field}`);
    }
  }

  // Validation Plan internal fields
  if (output.validationPlan) {
    if (typeof output.validationPlan !== "object" || Array.isArray(output.validationPlan)) {
      errors.push("validationPlan 字段必须是对象类型");
    } else {
      const requiredDays = ["day3", "day7", "day14"];
      for (const day of requiredDays) {
        if (!(day in output.validationPlan)) {
          errors.push(`validationPlan 缺失必填字段: ${day}`);
        }
      }
    }
  }

  // Early return if structural fields are missing to avoid runtime crashes
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Cast output type safely
  const typedOutput = output as AIExplainOutput;

  // 3. requiresHumanConfirmation must be true
  if (typedOutput.requiresHumanConfirmation !== true) {
    errors.push("requiresHumanConfirmation 字段值必须为 true");
  }

  // 4. modelBoundaryNotes validation
  const requiredBoundaryPhrase = "不拥有自动读取账户、修改广告或执行操作的权限";
  if (!typedOutput.modelBoundaryNotes || !typedOutput.modelBoundaryNotes.includes(requiredBoundaryPhrase)) {
    errors.push(`modelBoundaryNotes 必须包含: “${requiredBoundaryPhrase}”`);
  }

  // 5. doNotDo cannot be empty
  if (!Array.isArray(typedOutput.doNotDo) || typedOutput.doNotDo.length === 0) {
    errors.push("doNotDo 字段不能为空数组");
  }

  // 6. riskNotes cannot be empty
  if (!Array.isArray(typedOutput.riskNotes) || typedOutput.riskNotes.length === 0) {
    errors.push("riskNotes 字段不能为空数组");
  }

  // 7. If input.issue.humanConfirmationRequired !== true logic
  const isHumanConfirmationRequired = input.issue.humanConfirmationRequired === true;
  if (!isHumanConfirmationRequired) {
    if (typedOutput.operatorActionPlan && typedOutput.operatorActionPlan.length > 0) {
      errors.push("安全阻断: 缺少人工确认标记 (humanConfirmationRequired !== true) 时的建议其 operatorActionPlan 必须为空数组");
    }
    const safeSummaryPhrases = ["缺少人工确认标记", "未验证授权", "已阻止", "无法执行"];
    const summaryHasProof = safeSummaryPhrases.some(phrase => typedOutput.executiveSummary?.includes(phrase));
    if (!summaryHasProof) {
      errors.push("安全阻断: 缺少人工确认标记时，executiveSummary 必须说明缺少人工确认标记且已被阻止");
    }
    const safeDoNotDoPhrases = ["不要执行", "禁止执行", "阻止执行", "不要应用"];
    const doNotDoHasProof = typedOutput.doNotDo?.some(item => safeDoNotDoPhrases.some(p => item.includes(p)));
    if (!doNotDoHasProof) {
      errors.push("安全阻断: 缺少人工确认标记时，doNotDo 必须包含“不要执行”及相关警告");
    }
    const safeRiskNotesPhrases = ["humanConfirmationRequired", "人工确认", "安全授权"];
    const riskNotesHasProof = typedOutput.riskNotes?.some(item => safeRiskNotesPhrases.some(p => item.includes(p)));
    if (!riskNotesHasProof) {
      errors.push("安全阻断: 缺少人工确认标记时，riskNotes 必须包含 'humanConfirmationRequired' 或 '人工确认' 提示");
    }
    if (typedOutput.validationPlan) {
      const dayPhrases = [typedOutput.validationPlan.day3, typedOutput.validationPlan.day7, typedOutput.validationPlan.day14];
      const validationValid = dayPhrases.every(plan => plan && plan.includes("补齐人工确认标记"));
      if (!validationValid) {
        errors.push("安全阻断: 缺少人工确认标记时，validationPlan 不得引导执行，各子周期均应提示“需先补齐人工确认标记”");
      }
    }
  }

  // 8. If input.issue.category === "debug_invalid" logic
  if (input.issue.category === "debug_invalid") {
    if (typedOutput.operatorActionPlan && typedOutput.operatorActionPlan.length > 0) {
      errors.push("安全阻断: 对 debug_invalid 类型的记录，其 operatorActionPlan 必须为空数组，不得产生执行计划");
    }
    const isDoNotDoOk = typedOutput.doNotDo?.some(item => item.includes("不要作为正式建议执行"));
    if (!isDoNotDoOk) {
      errors.push("安全阻断: 对 debug_invalid 类型的记录，doNotDo 必包含提示 '不要作为正式建议执行'");
    }
    const isRiskNotesOk = typedOutput.riskNotes?.some(item => item.includes("不可执行") || item.includes("无效") || item.includes("仅调试"));
    if (!isRiskNotesOk) {
      errors.push("安全阻断: 对 debug_invalid 类型的记录，riskNotes 必须说明该诊断属于规则命中记录，不可执行");
    }
  }

  // 9. If limitations non-empty logic
  const originalLimitations = input.issue.limitations || [];
  if (originalLimitations.length > 0) {
    const hasLimitationInNotes = typedOutput.riskNotes?.some(risk => 
      originalLimitations.some((lim: string) => risk.includes(lim) || risk.toLowerCase().includes("limitation") || risk.includes("限制"))
    );
    if (!hasLimitationInNotes) {
      errors.push("安全阻断: 输入 issue 包含 limitations 限制条件，但 output.riskNotes 中未对此进行引用或警告说明");
    }
  }

  // 10. If missingMetrics / evidence.missingMetrics / funnelSnapshot.missingMetrics non-empty logic
  const missingMetrics =
    input.issue.evidence?.funnelSnapshot?.missingMetrics ||
    input.issue.evidence?.missingMetrics ||
    input.issue.missingMetrics ||
    [];
  if (missingMetrics.length > 0) {
    const hasMissingMetricsInNotes = typedOutput.riskNotes?.some(risk => 
      missingMetrics.some((metric: string) => risk.includes(metric) || risk.includes("指标缺失") || risk.includes("数据不足") || risk.includes("缺失"))
    );
    if (!hasMissingMetricsInNotes) {
      errors.push("安全阻断: 输入已标记数据指标缺失 (missingMetrics)，但 output.riskNotes 未明确警示数据不足或缺失情况");
    }
  }

  // 11. Forbidden auto-execution wording checks
  const bannedPhrases = [
    "已自动关闭",
    "已自动暂停",
    "已帮您调整",
    "已修改预算",
    "已应用到 Meta",
    "自动投放",
    "自动调价",
    "API 已通知修改",
    "已调低预算",
    "已调高预算",
    "已关闭广告",
    "已暂停广告",
    "已开启广告",
    "已调整页面",
    "已修改页面",
    "已完成优化",
    "已完成投放调整",
    "已在 Meta 后台",
    "我已帮你",
    "我已经帮你",
    "已为您关闭",
    "已为您暂停",
    "已为您调整",
    "已为您修改",
    "系统已自动",
    "模型已自动",
    "AI 已自动",
    "AI已经自动"
  ];

  // Utility to scan a text for banned words
  const scanTextForBannedPhrases = (text: string, pathName: string) => {
    for (const phrase of bannedPhrases) {
      if (text.includes(phrase)) {
        errors.push(`安全违规: 字段 ${pathName} 包含自动执行违规文案 “${phrase}”`);
      }
    }
  };

  // Scan all text outputs
  scanTextForBannedPhrases(typedOutput.executiveSummary || "", "executiveSummary");
  scanTextForBannedPhrases(typedOutput.rootCauseAnalysis || "", "rootCauseAnalysis");
  scanTextForBannedPhrases(typedOutput.confidenceExplanation || "", "confidenceExplanation");
  scanTextForBannedPhrases(typedOutput.modelBoundaryNotes || "", "modelBoundaryNotes");

  if (Array.isArray(typedOutput.operatorActionPlan)) {
    typedOutput.operatorActionPlan.forEach((val, idx) => {
      scanTextForBannedPhrases(val || "", `operatorActionPlan[${idx}]`);
    });
  }
  if (Array.isArray(typedOutput.riskNotes)) {
    typedOutput.riskNotes.forEach((val, idx) => {
      scanTextForBannedPhrases(val || "", `riskNotes[${idx}]`);
    });
  }
  if (Array.isArray(typedOutput.doNotDo)) {
    typedOutput.doNotDo.forEach((val, idx) => {
      scanTextForBannedPhrases(val || "", `doNotDo[${idx}]`);
    });
  }
  if (typedOutput.validationPlan) {
    scanTextForBannedPhrases(typedOutput.validationPlan.day3 || "", "validationPlan.day3");
    scanTextForBannedPhrases(typedOutput.validationPlan.day7 || "", "validationPlan.day7");
    scanTextForBannedPhrases(typedOutput.validationPlan.day14 || "", "validationPlan.day14");
  }

  // 12. Numerical/Metric Hallucination Checking
  // Allowed System numbers: 3, 7, 14, 0, 1, 50, 100
  const systemAllowedNumbers = new Set<string>(["3", "7", "14", "0", "1", "50", "100"]);

  // Set of clean, parsed numbers gathered recursively from all fields of input
  const gatheredInputNumbers = new Set<string>();

  const extractNumbersFromString = (text: string, targetSet: Set<string>) => {
    if (!text) return;
    // Regex matches integers or decimals, handles percentage signs or commas lightly by stripping/isolating them
    const matches = text.match(/\b\d+(?:\.\d+)?\b/g);
    if (matches) {
      for (const raw of matches) {
        // Strip trailing dot or clean up
        const clean = parseFloat(raw).toString();
        targetSet.add(clean);
      }
    }
  };

  const recursivelyGatherNumbers = (obj: any) => {
    if (obj === null || obj === undefined) return;
    if (typeof obj === "number") {
      gatheredInputNumbers.add(obj.toString());
    } else if (typeof obj === "string") {
      extractNumbersFromString(obj, gatheredInputNumbers);
    } else if (Array.isArray(obj)) {
      for (const child of obj) {
        recursivelyGatherNumbers(child);
      }
    } else if (typeof obj === "object") {
      for (const key of Object.keys(obj)) {
        recursivelyGatherNumbers(obj[key]);
      }
    }
  };

  // Gather actual numerical facts present inside input (diagnostics, issue title, reasons, metrics, context states, etc.)
  recursivelyGatherNumbers(input);

  // Helper to validate numbers found in a text blocks against both whitelists & gathered context numbers
  const validateTextNumbers = (text: string, pathName: string) => {
    if (!text) return;
    const matches = text.match(/\b\d+(?:\.\d+)?\b/g);
    if (matches) {
      for (const m of matches) {
        const floatStr = parseFloat(m).toString();
        // Skip numbers that match system allowed metrics/dates or are found organically in input context
        if (systemAllowedNumbers.has(floatStr) || gatheredInputNumbers.has(floatStr)) {
          continue;
        }
        errors.push(`数字幻觉阻断: 字段 ${pathName} 中包含未经授权/幻觉产生的指标数据 “${m}” (请确保该数字来自于输入事实或属于白名单数字 3、7、14、0、1、50%、100)`);
      }
    }
  };

  // Perform checks across all text response parameters
  validateTextNumbers(typedOutput.executiveSummary || "", "executiveSummary");
  validateTextNumbers(typedOutput.rootCauseAnalysis || "", "rootCauseAnalysis");
  validateTextNumbers(typedOutput.confidenceExplanation || "", "confidenceExplanation");
  
  if (Array.isArray(typedOutput.operatorActionPlan)) {
    typedOutput.operatorActionPlan.forEach((p, idx) => {
      validateTextNumbers(p || "", `operatorActionPlan[${idx}]`);
    });
  }
  if (Array.isArray(typedOutput.riskNotes)) {
    typedOutput.riskNotes.forEach((rn, idx) => {
      validateTextNumbers(rn || "", `riskNotes[${idx}]`);
    });
  }
  if (Array.isArray(typedOutput.doNotDo)) {
    typedOutput.doNotDo.forEach((dnd, idx) => {
      validateTextNumbers(dnd || "", `doNotDo[${idx}]`);
    });
  }
  if (typedOutput.validationPlan) {
    validateTextNumbers(typedOutput.validationPlan.day3 || "", "validationPlan.day3");
    validateTextNumbers(typedOutput.validationPlan.day7 || "", "validationPlan.day7");
    validateTextNumbers(typedOutput.validationPlan.day14 || "", "validationPlan.day14");
  }

  return {
    ok: errors.length === 0,
    errors,
    sanitizedOutput: errors.length === 0 ? typedOutput : undefined
  };
}
