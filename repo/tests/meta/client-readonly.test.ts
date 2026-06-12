import { describe, expect, it, vi } from "vitest";
import { MetaApiClient, ReadOnlyModeError, isReadOnlyModeEnabled } from "../../src/meta/client.js";

describe("MetaApiClient READ_ONLY_MODE", () => {
  it("defaults to read-only mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("READ_ONLY_MODE", undefined);
    expect(isReadOnlyModeEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("forces read-only mode even if READ_ONLY_MODE=false outside tests", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("READ_ONLY_MODE", "false");
    expect(isReadOnlyModeEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("blocks POST requests before token resolution", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("READ_ONLY_MODE", "true");
    const client = new MetaApiClient({ baseUrl: "https://graph.facebook.com", apiVersion: "v25.0" });
    await expect(client.post("/act_123/campaigns", { name: "nope" })).rejects.toBeInstanceOf(ReadOnlyModeError);
    await expect(client.postForm("/123", { status: "PAUSED" })).rejects.toBeInstanceOf(ReadOnlyModeError);
    await expect(client.delete("/123")).rejects.toBeInstanceOf(ReadOnlyModeError);
    vi.unstubAllEnvs();
  });
});
