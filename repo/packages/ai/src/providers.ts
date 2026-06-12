import { z } from "zod";
import type { AiProvider, Prisma } from "@prisma/client";
import { decryptToken, encryptToken } from "../../../src/auth/crypto.js";
import { prisma } from "../../../src/db/prisma.js";

export const aiProviderSchema = z.enum(["openai", "gemini"]);

export const upsertAiProviderSchema = z.object({
  provider: aiProviderSchema,
  displayName: z.string().min(1).max(80).default("default"),
  apiKey: z.string().min(8),
  defaultChatModel: z.string().min(1).max(120).optional(),
  defaultAnalysisModel: z.string().min(1).max(120).optional(),
  defaultCreativeModel: z.string().min(1).max(120).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(999).default(100),
});

export const updateAiProviderSchema = z.object({
  provider: aiProviderSchema.optional(),
  displayName: z.string().min(1).max(80).optional(),
  apiKey: z.string().min(8).optional(),
  defaultChatModel: z.string().min(1).max(120).optional().nullable(),
  defaultAnalysisModel: z.string().min(1).max(120).optional().nullable(),
  defaultCreativeModel: z.string().min(1).max(120).optional().nullable(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(999).optional(),
});

export const listAiModelsSchema = z.object({
  provider: aiProviderSchema.optional(),
  apiKey: z.string().min(8).optional(),
  providerId: z.string().min(1).optional(),
}).refine((value) => Boolean(value.providerId || (value.provider && value.apiKey)), {
  message: "providerId or provider + apiKey is required",
});

export interface AiCompletionRequest {
  purpose: "chat" | "analysis" | "creative";
  system: string;
  user: string;
  model?: string;
}

export interface AiCompletionResponse {
  provider: AiProvider | "rules";
  model: string;
  text: string;
}

function aad(provider: string, displayName: string): string {
  return `ai-provider:${provider}:${displayName}`;
}

function encryptedApiKey(provider: string, displayName: string, apiKey: string): Prisma.InputJsonObject {
  const encrypted = encryptToken(apiKey, aad(provider, displayName));
  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
  };
}

function decryptApiKey(setting: {
  provider: AiProvider;
  displayName: string;
  apiKeyEncrypted: unknown;
}): string {
  return decryptToken(
    setting.apiKeyEncrypted as { ciphertext: string; iv: string; tag: string },
    aad(setting.provider, setting.displayName),
  );
}

function maskKey(setting: { apiKeyEncrypted: unknown }): string {
  return setting.apiKeyEncrypted ? "********" : "";
}

export async function upsertAiProviderSetting(input: z.input<typeof upsertAiProviderSchema>) {
  const parsed = upsertAiProviderSchema.parse(input);
  const setting = await prisma.aiProviderSetting.upsert({
    where: {
      provider_displayName: {
        provider: parsed.provider,
        displayName: parsed.displayName,
      },
    },
    create: {
      provider: parsed.provider,
      displayName: parsed.displayName,
      apiKeyEncrypted: encryptedApiKey(parsed.provider, parsed.displayName, parsed.apiKey),
      defaultChatModel: parsed.defaultChatModel,
      defaultAnalysisModel: parsed.defaultAnalysisModel,
      defaultCreativeModel: parsed.defaultCreativeModel,
      enabled: parsed.enabled,
      priority: parsed.priority,
    },
    update: {
      apiKeyEncrypted: encryptedApiKey(parsed.provider, parsed.displayName, parsed.apiKey),
      defaultChatModel: parsed.defaultChatModel,
      defaultAnalysisModel: parsed.defaultAnalysisModel,
      defaultCreativeModel: parsed.defaultCreativeModel,
      enabled: parsed.enabled,
      priority: parsed.priority,
    },
  });
  return {
    ...setting,
    apiKeyMasked: maskKey(setting),
    apiKeyEncrypted: undefined,
  };
}

export async function listAiProviderSettings() {
  const settings = await prisma.aiProviderSetting.findMany({
    orderBy: [{ enabled: "desc" }, { priority: "asc" }, { provider: "asc" }, { displayName: "asc" }],
  });
  return settings.map((setting) => ({
    id: setting.id,
    provider: setting.provider,
    displayName: setting.displayName,
    defaultChatModel: setting.defaultChatModel,
    defaultAnalysisModel: setting.defaultAnalysisModel,
    defaultCreativeModel: setting.defaultCreativeModel,
    enabled: setting.enabled,
    priority: setting.priority,
    apiKeyMasked: maskKey(setting),
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt,
  }));
}

export async function updateAiProviderSetting(id: string, input: z.input<typeof updateAiProviderSchema>) {
  const existing = await prisma.aiProviderSetting.findUniqueOrThrow({ where: { id } });
  const parsed = updateAiProviderSchema.parse(input);
  const provider = parsed.provider ?? existing.provider;
  const displayName = parsed.displayName ?? existing.displayName;
  const apiKeyEncrypted = parsed.apiKey
    ? encryptedApiKey(provider, displayName, parsed.apiKey)
    : provider !== existing.provider || displayName !== existing.displayName
      ? encryptedApiKey(provider, displayName, decryptApiKey(existing))
      : undefined;
  const setting = await prisma.aiProviderSetting.update({
    where: { id },
    data: {
      provider,
      displayName,
      apiKeyEncrypted,
      defaultChatModel: parsed.defaultChatModel === null ? null : parsed.defaultChatModel,
      defaultAnalysisModel: parsed.defaultAnalysisModel === null ? null : parsed.defaultAnalysisModel,
      defaultCreativeModel: parsed.defaultCreativeModel === null ? null : parsed.defaultCreativeModel,
      enabled: parsed.enabled,
      priority: parsed.priority,
    },
  });
  return {
    ...setting,
    apiKeyMasked: maskKey(setting),
    apiKeyEncrypted: undefined,
  };
}

export async function setAiProviderEnabled(id: string, enabled: boolean) {
  const setting = await prisma.aiProviderSetting.update({
    where: { id },
    data: { enabled },
  });
  return {
    ...setting,
    apiKeyMasked: maskKey(setting),
    apiKeyEncrypted: undefined,
  };
}

export async function deleteAiProviderSetting(id: string) {
  await prisma.aiProviderSetting.delete({ where: { id } });
  return { ok: true };
}

export async function listAvailableAiModels(input: z.input<typeof listAiModelsSchema>) {
  const parsed = listAiModelsSchema.parse(input);
  let provider = parsed.provider;
  let apiKey = parsed.apiKey;
  if (parsed.providerId) {
    const setting = await prisma.aiProviderSetting.findUniqueOrThrow({ where: { id: parsed.providerId } });
    provider = setting.provider;
    apiKey = decryptApiKey(setting);
  }
  if (!provider || !apiKey) throw new Error("AI provider and API key are required");
  if (provider === "gemini") return listGeminiModels(apiKey);
  return listOpenAiModels(apiKey);
}

async function getActiveProvider() {
  return prisma.aiProviderSetting.findFirst({
    where: { enabled: true },
    orderBy: [{ priority: "asc" }, { provider: "asc" }, { displayName: "asc" }],
  });
}

function modelFor(setting: NonNullable<Awaited<ReturnType<typeof getActiveProvider>>>, purpose: AiCompletionRequest["purpose"]) {
  if (purpose === "creative") return setting.defaultCreativeModel ?? setting.defaultChatModel ?? defaultModel(setting.provider);
  if (purpose === "analysis") return setting.defaultAnalysisModel ?? setting.defaultChatModel ?? defaultModel(setting.provider);
  return setting.defaultChatModel ?? defaultModel(setting.provider);
}

function defaultModel(provider: AiProvider): string {
  return provider === "gemini" ? "gemini-1.5-flash" : "gpt-4o-mini";
}

export async function completeWithConfiguredAi(request: AiCompletionRequest): Promise<AiCompletionResponse | null> {
  const setting = await getActiveProvider();
  if (!setting) return null;
  const model = request.model ?? modelFor(setting, request.purpose);
  const apiKey = decryptApiKey(setting);
  if (setting.provider === "gemini") {
    return {
      provider: setting.provider,
      model,
      text: await callGemini(apiKey, model, request),
    };
  }
  return {
    provider: setting.provider,
    model,
    text: await callOpenAi(apiKey, model, request),
  };
}

async function callOpenAi(apiKey: string, model: string, request: AiCompletionRequest): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: request.purpose === "creative" ? 0.8 : 0.2,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

async function listOpenAiModels(apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI models HTTP ${response.status}`);
  const payload = await response.json() as { data?: Array<{ id?: string }> };
  const models = (payload.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id))
    .filter((id) => /^(gpt-|o\d|o-|chatgpt-)/.test(id))
    .sort((a, b) => a.localeCompare(b));
  return {
    provider: "openai" as const,
    models,
    defaultChatModel: models.find((model) => model.includes("4o-mini")) ?? models[0] ?? "gpt-4o-mini",
  };
}

async function callGemini(apiKey: string, model: string, request: AiCompletionRequest): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || "";
}

async function listGeminiModels(apiKey: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!response.ok) throw new Error(`Gemini models HTTP ${response.status}`);
  const payload = await response.json() as {
    models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  };
  const models = (payload.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => (model.name ?? model.displayName ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return {
    provider: "gemini" as const,
    models,
    defaultChatModel: models.find((model) => model.includes("flash")) ?? models[0] ?? "gemini-1.5-flash",
  };
}
