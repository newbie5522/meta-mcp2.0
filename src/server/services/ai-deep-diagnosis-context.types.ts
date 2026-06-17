import {
  AiDeepDiagnosisMode,
  AiDiagnosisScope,
  AiDeepDiagnosisInput,
  AiDataQualityReport
} from "../../shared/ai-deep-diagnosis.types.js";

export interface AiDeepDiagnosisContextRequest {
  mode: AiDeepDiagnosisMode;
  scope: AiDiagnosisScope;
  startDate: string;
  endDate: string;
  comparisonStartDate?: string;
  comparisonEndDate?: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface AiDeepDiagnosisContextBuildResult {
  success: boolean;
  mode: "context_only";
  aiEnabled: false;
  explanation: null;
  input: AiDeepDiagnosisInput;
  dataQuality: AiDataQualityReport;
  limitations: string[];
  warnings: string[];
}
