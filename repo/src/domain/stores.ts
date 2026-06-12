import { z } from "zod";
import { decryptToken, encryptToken } from "../auth/crypto.js";
import { prisma } from "../db/prisma.js";
import type { Prisma } from "@prisma/client";

export const storePlatformSchema = z.enum(["shopline", "shoplazza", "shopify"]);
export const storeStatusSchema = z.enum(["active", "inactive"]);

function normalizeStoreDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/admin(?:\/.*)?$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function storeApiBaseUrl(value: string): string {
  const domain = normalizeStoreDomain(value);
  if (!domain || domain.includes(" ") || domain.includes("/")) {
    throw new Error("请输入店铺后台 API 域名，例如 your-handle.myshopline.com、your-subdomain.myshoplaza.com 或 your-store.myshopify.com。");
  }
  return `https://${domain}`;
}

export const createStoreSchema = z.object({
  name: z.string().min(1).max(160),
  platform: storePlatformSchema,
  domain: z.string().min(1).max(255).transform(normalizeStoreDomain),
  apiBaseUrl: z.string().url().optional(),
  apiToken: z.string().min(8),
  status: storeStatusSchema.default("active"),
});

export const updateStoreSchema = createStoreSchema
  .omit({ apiToken: true })
  .partial()
  .extend({
    apiToken: z.string().min(8).optional(),
    timezone: z.string().min(1).max(80).optional(),
  });

export type CreateStoreInput = z.input<typeof createStoreSchema>;
export type UpdateStoreInput = z.input<typeof updateStoreSchema>;

function storeTokenAad(platform: string, domain: string): string {
  return `store:${platform}:${domain.toLowerCase()}`;
}

function encryptStoreToken(platform: string, domain: string, apiToken: string): Prisma.InputJsonObject {
  const encrypted = encryptToken(apiToken, storeTokenAad(platform, domain));
  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
  };
}

export async function createStore(input: CreateStoreInput) {
  const parsed = createStoreSchema.parse(input);
  const domain = normalizeStoreDomain(parsed.apiBaseUrl ?? parsed.domain);
  const apiBaseUrl = storeApiBaseUrl(domain);
  const apiTokenEncrypted = encryptStoreToken(parsed.platform, domain, parsed.apiToken);

  return prisma.store.create({
    data: {
      name: parsed.name,
      platform: parsed.platform,
      domain,
      apiBaseUrl,
      status: parsed.status,
      apiTokenEncrypted,
    },
  });
}

export async function updateStore(storeId: string, input: UpdateStoreInput) {
  const existing = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const parsed = updateStoreSchema.parse(input);
  const platform = parsed.platform ?? existing.platform;
  const connectionChanged = Boolean(parsed.platform || parsed.domain || parsed.apiBaseUrl);
  const domain = connectionChanged
    ? normalizeStoreDomain(parsed.apiBaseUrl ?? parsed.domain ?? existing.apiBaseUrl)
    : existing.domain;
  const apiBaseUrl = connectionChanged ? storeApiBaseUrl(domain) : undefined;
  const apiTokenEncrypted =
    parsed.apiToken
      ? encryptStoreToken(platform, domain, parsed.apiToken)
      : platform !== existing.platform || domain !== existing.domain
        ? encryptStoreToken(platform, domain, decryptStoreToken(existing))
        : undefined;
  return prisma.store.update({
    where: { id: storeId },
    data: {
      name: parsed.name,
      platform,
      domain,
      apiBaseUrl,
      status: parsed.status,
      apiTokenEncrypted,
      timezone: parsed.timezone,
      timezoneSource: parsed.timezone ? "manual" : undefined,
      timezoneVerifiedAt: parsed.timezone ? new Date() : undefined,
    },
  });
}

export async function deactivateStore(storeId: string) {
  return prisma.store.update({
    where: { id: storeId },
    data: { status: "inactive" },
  });
}

export async function listStores() {
  const stores = await prisma.store.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      platform: true,
      domain: true,
      apiBaseUrl: true,
      currency: true,
      timezone: true,
      timezoneSource: true,
      timezoneVerifiedAt: true,
      apiTokenEncrypted: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      adAccountMaps: {
        select: {
          adAccount: {
            select: {
              id: true,
              metaAccountId: true,
              name: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return stores.map(({ apiTokenEncrypted, adAccountMaps, ...store }) => ({
    ...store,
    apiTokenConfigured: Boolean(apiTokenEncrypted),
    mappedAccounts: adAccountMaps.map((mapping) => mapping.adAccount),
  }));
}

export function decryptStoreToken(store: {
  platform: string;
  domain: string;
  apiTokenEncrypted: unknown;
}): string {
  return decryptToken(
    store.apiTokenEncrypted as { ciphertext: string; iv: string; tag: string },
    storeTokenAad(store.platform, store.domain),
  );
}
