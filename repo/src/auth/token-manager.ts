import { logger } from "../utils/logger.js";

export class TokenManager {
  private tokens = new Map<string, string>();
  private activeTokenName: string | null = null;
  private envLoaded = false;

  private ensureEnvLoaded(): void {
    if (this.envLoaded) return;
    this.envLoaded = true;
    this.loadFromEnv();
  }

  private loadFromEnv(): void {
    const metaTokensJson = process.env.META_TOKENS;
    if (metaTokensJson) {
      try {
        const parsed: unknown = JSON.parse(metaTokensJson);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          for (const [name, token] of Object.entries(parsed)) {
            if (typeof token === "string" && token.length > 0) {
              this.tokens.set(name, token);
            }
          }
          const firstKey = Object.keys(parsed)[0];
          if (firstKey && this.tokens.has(firstKey)) {
            this.activeTokenName = firstKey;
          }
          logger.info({ count: this.tokens.size }, "Loaded Meta tokens from META_TOKENS");
        }
      } catch (error) {
        logger.error({ error }, "Failed to parse META_TOKENS JSON");
      }
    }

    const singleToken = process.env.META_ACCESS_TOKEN;
    if (singleToken && !this.tokens.has("default")) {
      this.tokens.set("default", singleToken);
      if (!this.activeTokenName) {
        this.activeTokenName = "default";
      }
    }
  }

  getActiveToken(): string | null {
    this.ensureEnvLoaded();
    if (!this.activeTokenName) return null;
    return this.tokens.get(this.activeTokenName) ?? null;
  }

  listTokens(): { active: string | null; available: string[] } {
    this.ensureEnvLoaded();
    return {
      active: this.activeTokenName,
      available: Array.from(this.tokens.keys()),
    };
  }

  resetForTests(): void {
    this.tokens.clear();
    this.activeTokenName = null;
    this.envLoaded = false;
  }
}

export function maskToken(token: string): string {
  if (token.length <= 10) return `${token.slice(0, 3)}***`;
  return `${token.slice(0, 10)}...`;
}

export const tokenManager = new TokenManager();
