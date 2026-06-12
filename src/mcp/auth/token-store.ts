// @ts-nocheck
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { tokenManager } from "./token-manager.js";

export interface RequestTokenContext {
  accessToken: string;
}

export const requestContext = new AsyncLocalStorage<RequestTokenContext>();

export function getAccessToken(): string {
  const token = requestContext.getStore()?.accessToken
    ?? tokenManager.getActiveToken()
    ?? process.env.META_ACCESS_TOKEN;

  if (!token) {
    throw new Error("No Meta access token available");
  }

  return token;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}
