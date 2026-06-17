export interface AiCompletionRequest {
  purpose: "chat" | "analysis" | "creative";
  system: string;
  user: string;
  model?: string;
}

export interface AiCompletionResponse {
  provider: "rules";
  model: "offline-rule-engine";
  text: string;
}

const DISABLED_MESSAGE = "AI provider runtime is disabled in current stage.";

export async function listAiProviderSettings(): Promise<[]> {
  return [];
}

export async function setAiProviderEnabled(): Promise<never> {
  throw new Error(DISABLED_MESSAGE);
}

export async function deleteAiProviderSetting(): Promise<never> {
  throw new Error(DISABLED_MESSAGE);
}

export async function listAvailableAiModels(): Promise<[]> {
  return [];
}

export async function completeWithConfiguredAi(
  _request: AiCompletionRequest
): Promise<null> {
  return null;
}

export function isAiProviderRuntimeDisabled(): true {
  return true;
}
