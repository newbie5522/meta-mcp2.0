import { describe, expect, it } from "vitest";
import { normalizeDetailsLevel } from "./accounts.routes";

describe("account details canonical hierarchy routing", () => {
  it("normalizes legacy details level names to canonical hierarchy levels", () => {
    expect(normalizeDetailsLevel("campaigns")).toBe("campaign");
    expect(normalizeDetailsLevel("adsets")).toBe("adset");
    expect(normalizeDetailsLevel("ads")).toBe("ad");
    expect(normalizeDetailsLevel("unknown")).toBeNull();
  });
});
