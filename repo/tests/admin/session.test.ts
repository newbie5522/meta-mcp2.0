import { describe, expect, it, vi } from "vitest";
import { createAdminSession, validateAdminCredentials } from "../../src/admin/session.js";

describe("admin session", () => {
  it("validates admin credentials with configured env", () => {
    vi.stubEnv("ADMIN_USERNAME", "admin");
    vi.stubEnv("ADMIN_PASSWORD", "strong-password");
    vi.stubEnv("SESSION_SECRET", "a".repeat(32));

    expect(validateAdminCredentials("admin", "strong-password")).toBe(true);
    expect(validateAdminCredentials("admin", "wrong")).toBe(false);

    vi.unstubAllEnvs();
  });

  it("creates an opaque signed session token", () => {
    vi.stubEnv("ADMIN_USERNAME", "admin");
    vi.stubEnv("ADMIN_PASSWORD", "strong-password");
    vi.stubEnv("SESSION_SECRET", "a".repeat(32));

    const token = createAdminSession("admin");
    expect(token).toContain(".");
    expect(token).not.toContain("strong-password");

    vi.unstubAllEnvs();
  });
});
