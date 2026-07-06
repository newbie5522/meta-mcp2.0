export interface AiCompletionRequest {
  purpose: "chat" | "analysis" | "creative";
  system: string;
  user: string;
  model?: string;
}

export interface AiCompletionResponse {
  provider: string;
  model: string;
  text: string;
  raw?: unknown;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_PROVIDER_NAME = "openai_compatible";

function readEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function getAiApiKey(): string {
  return readEnv("AI_API_KEY");
}

function getAiBaseUrl(): string {
  return (readEnv("AI_API_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getAiModel(model?: string): string {
  return (model || readEnv("AI_MODEL") || DEFAULT_MODEL).trim();
}

function getAiProviderName(): string {
  return readEnv("AI_PROVIDER_NAME") || DEFAULT_PROVIDER_NAME;
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export async function listAiProviderSettings(): Promise<any[]> {
  const key = getAiApiKey();
  return [
    {
      provider: getAiProviderName(),
      baseUrl: getAiBaseUrl(),
      defaultModel: getAiModel(),
      enabled: Boolean(key),
      apiKeyMasked: key ? maskSecret(key) : null,
      source: "environment"
    }
  ];
}

export async function setAiProviderEnabled(): Promise<{ success: true; source: "environment" }> {
  return { success: true, source: "environment" };
}

export async function deleteAiProviderSetting(): Promise<{ success: true; source: "environment" }> {
  return { success: true, source: "environment" };
}

export async function listAvailableAiModels(): Promise<any[]> {
  const configuredModel = getAiModel();
  const models = new Set([configuredModel, DEFAULT_MODEL]);
  return Array.from(models).map((id) => ({
    id,
    provider: getAiProviderName(),
    source: "configured"
  }));
}

export async function completeWithConfiguredAi(
  request: AiCompletionRequest
): Promise<AiCompletionResponse | null> {
  const apiKey = getAiApiKey();
  if (!apiKey) {
    return null;
  }

  const provider = getAiProviderName();
  const model = getAiModel(request.model);
  const url = `${getAiBaseUrl()}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[AI Provider] chat completion failed", {
        provider,
        model,
        status: response.status,
        statusText: response.statusText,
        body: body.slice(0, 300)
      });
      return null;
    }

    const raw = await response.json();
    const text = raw?.choices?.[0]?.message?.content;

    if (typeof text !== "string" || !text.trim()) {
      console.error("[AI Provider] chat completion returned empty content", {
        provider,
        model
      });
      return null;
    }

    return {
      provider,
      model,
      text: text.trim(),
      raw
    };
  } catch (error: any) {
    console.error("[AI Provider] chat completion request failed", {
      provider,
      model,
      message: error?.message || String(error)
    });
    return null;
  }
}

export function isAiProviderRuntimeDisabled(): boolean {
  return !getAiApiKey();
}
