// @ts-nocheck
import { z } from "zod";

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
  provider: "openai" | "gemini" | "rules";
  model: string;
  text: string;
}

// Ensure database query operations return empty or throw to enforce the hard disable of real provider config
export async function listAiProviderSettings() {
  return [];
}

export async function setAiProviderEnabled(id: string, enabled: boolean) {
  throw new Error("AI provider runtime is disabled in current stage.");
}

export async function deleteAiProviderSetting(id: string) {
  throw new Error("AI provider runtime is disabled in current stage.");
}

export async function listAvailableAiModels(input: any) {
  throw new Error("AI provider runtime is disabled in current stage.");
}

export async function completeWithConfiguredAi(request: AiCompletionRequest): Promise<AiCompletionResponse | null> {
  // Gracefully return null so caller fallback functions execute without causing 500 errors
  return null;
}
