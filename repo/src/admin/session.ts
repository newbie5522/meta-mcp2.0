import crypto from "node:crypto";
import type { Request, RequestHandler, Response } from "express";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface AdminSessionPayload {
  username: string;
  exp: number;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function requireAdminConfig(): { username: string; password: string; secret: string } {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!username || !password || !secret) {
    throw new Error("ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET are required");
  }
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }

  return { username, password, secret };
}

function hmac(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash("sha256").update(a).digest();
  const right = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

function signSession(payload: AdminSessionPayload, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${hmac(body, secret)}`;
}

function verifySession(token: string, secret: string): AdminSessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature || !safeEqual(signature, hmac(body, secret))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSessionPayload;
    if (!payload.username || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function setAdminCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearAdminCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function assertAdminConfig(): void {
  if (process.env.NODE_ENV === "production") {
    requireAdminConfig();
  }
}

export function validateAdminCredentials(username: string, password: string): boolean {
  const config = requireAdminConfig();
  return safeEqual(username, config.username) && safeEqual(password, config.password);
}

export function createAdminSession(username: string): string {
  const { secret } = requireAdminConfig();
  return signSession(
    {
      username,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    secret,
  );
}

export function currentAdmin(req: Request): AdminSessionPayload | null {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return verifySession(token, secret);
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  const admin = currentAdmin(req);
  if (admin) {
    next();
    return;
  }

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "admin_login_required" });
    return;
  }
  res.redirect(302, "/admin/login");
};

export function loginAdmin(res: Response, username: string): void {
  setAdminCookie(res, createAdminSession(username));
}

export function logoutAdmin(res: Response): void {
  clearAdminCookie(res);
}
