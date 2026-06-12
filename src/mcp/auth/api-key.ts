// @ts-nocheck
import crypto from "node:crypto";

export function isApiKeyConfigured(): boolean {
  return !!(process.env.MCP_API_KEY || process.env.API_KEY);
}

export function validateApiKey(candidate: string): boolean {
  const expected = process.env.MCP_API_KEY || process.env.API_KEY;
  if (!expected) return false;

  const candidateDigest = crypto.createHash("sha256").update(candidate).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();

  return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}
