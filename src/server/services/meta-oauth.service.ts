import crypto from "node:crypto";
import prisma from "../../db/index.js";
import { encryptToken, decryptToken, type EncryptedPayload } from "../../mcp/auth/crypto.js";

const GRAPH_VERSION = process.env.META_API_VERSION || "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const CONNECTION_KEY = "META_OAUTH_CONNECTION";

export const DEFAULT_META_SCOPES = [
  "public_profile",
  "ads_read",
  "ads_management",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
];

export type MetaPageConnection = {
  id: string;
  name: string;
  category?: string;
  tasks: string[];
  accessToken: string;
};

export type MetaConnection = {
  user: { id: string; name: string; email?: string };
  scopes: string[];
  accessToken: string;
  pages: MetaPageConnection[];
  connectedAt: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function scopes(): string[] {
  const configured = process.env.META_OAUTH_SCOPES?.split(",").map((x) => x.trim()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_META_SCOPES;
}

export function getMetaRedirectUri(): string {
  return process.env.META_OAUTH_REDIRECT_URI?.trim() || `${required("APP_URL").replace(/\/$/, "")}/api/meta-oauth/callback`;
}

export function createMetaAuthUrl(): string {
  const issuedAt = Date.now().toString();
  const nonce = crypto.randomBytes(24).toString("hex");
  const payload = `${issuedAt}.${nonce}`;
  const signature = crypto.createHmac("sha256", required("OAUTH_STATE_SECRET")).update(payload).digest("hex");
  const state = Buffer.from(`${payload}.${signature}`).toString("base64url");
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", required("META_APP_ID"));
  url.searchParams.set("redirect_uri", getMetaRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes().join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("auth_type", "rerequest");
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim();
  if (configId) url.searchParams.set("config_id", configId);
  return url.toString();
}

export function verifyMetaState(state: string): void {
  const decoded = Buffer.from(state, "base64url").toString("utf8");
  const [issuedAt, nonce, signature] = decoded.split(".");
  if (!issuedAt || !nonce || !signature) throw new Error("INVALID_OAUTH_STATE");
  if (Date.now() - Number(issuedAt) > 10 * 60 * 1000) throw new Error("EXPIRED_OAUTH_STATE");
  const expected = crypto.createHmac("sha256", required("OAUTH_STATE_SECRET")).update(`${issuedAt}.${nonce}`).digest();
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("INVALID_OAUTH_STATE");
}

async function graph<T>(path: string, token?: string): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  if (token) url.searchParams.set("access_token", token);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json() as any;
  if (!response.ok || body.error) throw new Error(body.error?.message || `Meta API HTTP ${response.status}`);
  return body as T;
}

export async function completeMetaOAuth(code: string): Promise<MetaConnection> {
  const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", required("META_APP_ID"));
  tokenUrl.searchParams.set("client_secret", required("META_APP_SECRET"));
  tokenUrl.searchParams.set("redirect_uri", getMetaRedirectUri());
  tokenUrl.searchParams.set("code", code);
  const shortResponse = await fetch(tokenUrl);
  const shortBody = await shortResponse.json() as any;
  if (!shortResponse.ok || !shortBody.access_token) throw new Error(shortBody.error?.message || "META_CODE_EXCHANGE_FAILED");

  const longUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", required("META_APP_ID"));
  longUrl.searchParams.set("client_secret", required("META_APP_SECRET"));
  longUrl.searchParams.set("fb_exchange_token", shortBody.access_token);
  const longResponse = await fetch(longUrl);
  const longBody = await longResponse.json() as any;
  const userToken = longBody.access_token || shortBody.access_token;

  const [user, permissions, pageResult] = await Promise.all([
    graph<any>("me?fields=id,name,email", userToken),
    graph<any>("me/permissions", userToken),
    graph<any>("me/accounts?fields=id,name,category,tasks,access_token&limit=200", userToken),
  ]);
  const connection: MetaConnection = {
    user,
    scopes: (permissions.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission),
    accessToken: userToken,
    pages: (pageResult.data || []).map((p: any) => ({
      id: String(p.id), name: p.name, category: p.category, tasks: p.tasks || [], accessToken: p.access_token,
    })),
    connectedAt: new Date().toISOString(),
  };
  const encrypted = encryptToken(JSON.stringify(connection), CONNECTION_KEY);
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: CONNECTION_KEY }, update: { value: JSON.stringify(encrypted) }, create: { key: CONNECTION_KEY, value: JSON.stringify(encrypted) } }),
    // Compatibility: existing advertising and analytics modules continue using the OAuth user token.
    prisma.setting.upsert({ where: { key: "META_ACCESS_TOKEN" }, update: { value: userToken }, create: { key: "META_ACCESS_TOKEN", value: userToken } }),
  ]);
  return connection;
}

export async function getMetaConnection(): Promise<MetaConnection | null> {
  const row = await prisma.setting.findUnique({ where: { key: CONNECTION_KEY } });
  if (!row?.value) return null;
  const encrypted = JSON.parse(row.value) as EncryptedPayload;
  return JSON.parse(decryptToken(encrypted, CONNECTION_KEY)) as MetaConnection;
}

export async function disconnectMetaOAuth(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: CONNECTION_KEY } });
}

export function publicConnection(connection: MetaConnection | null) {
  if (!connection) return { connected: false, requiredScopes: scopes() };
  return {
    connected: true,
    user: connection.user,
    scopes: connection.scopes,
    missingScopes: scopes().filter((scope) => !connection.scopes.includes(scope)),
    pages: connection.pages.map(({ accessToken: _token, ...page }) => page),
    connectedAt: connection.connectedAt,
  };
}

export async function getPageConnection(pageId: string): Promise<MetaPageConnection> {
  const connection = await getMetaConnection();
  const page = connection?.pages.find((item) => item.id === pageId);
  if (!page) throw new Error("PAGE_NOT_AUTHORIZED");
  return page;
}

export async function pageGraph<T>(pageId: string, path: string, init?: RequestInit): Promise<T> {
  const page = await getPageConnection(pageId);
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  url.searchParams.set("access_token", page.accessToken);
  const response = await fetch(url, init);
  const body = await response.json() as any;
  if (!response.ok || body.error) throw new Error(body.error?.message || `Meta API HTTP ${response.status}`);
  return body as T;
}
