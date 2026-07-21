import { describe, expect, it } from "vitest";
import { mapSyncErrorToPanel, mapSyncResultToPanel } from "./sync-trigger";

describe("sync trigger panel status mapping", () => {
  it("maps NO_NEW_DATA to neutral success and PARTIAL_SUCCESS to warning", () => {
    expect(mapSyncResultToPanel({ success: true, status: "NO_NEW_DATA" }).status).toBe("success");
    expect(mapSyncResultToPanel({ success: true, status: "PARTIAL_SUCCESS" }).status).toBe("warning");
  });

  it("keeps technical store sync keys out of the default panel message when business copy exists", () => {
    const panel = mapSyncErrorToPanel({
      data: {
        error: "STORE_TIMEZONE_UNVERIFIED",
        message: "店铺后台时区尚未验证，请重新保存店铺配置后再同步。"
      }
    });
    expect(panel.status).toBe("error");
    expect(panel.message).not.toContain("STORE_TIMEZONE_UNVERIFIED");
  });
});
