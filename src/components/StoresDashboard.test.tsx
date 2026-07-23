import { describe, expect, it } from "vitest";
import {
  getTimestampConversionLabel,
  getTimestampEncodingLabel,
  getTimezoneSourceLabel,
  getWarningsBadgeLabel
} from "./StoresDashboard";

describe("StoresDashboard timezone diagnostics display helpers", () => {
  it("shows neutral UTC timestamp encoding and store timezone conversion copy", () => {
    const diagnostics = {
      normalizedTimezone: "America/Los_Angeles",
      warnings: [],
      timestampDiagnostics: {
        encoding: "UTC",
        observedOffsets: ["+00:00"],
        normalizedToTimezone: "America/Los_Angeles",
        localDateField: "Order.store_local_date",
        message: "平台订单时间使用 UTC 编码，系统会按店铺时区换算为订单本地日期。"
      }
    };

    expect(getTimestampEncodingLabel(diagnostics)).toBe("订单时间编码：UTC（+00:00）");
    expect(getTimestampConversionLabel(diagnostics)).toBe(
      "日期换算：已按 America/Los_Angeles 换算为 Order.store_local_date"
    );
    expect(diagnostics.warnings).toEqual([]);
  });

  it("uses the attention label only when warnings are present", () => {
    const warnings = ["最近一次订单同步未完整覆盖所选日期范围。"];

    expect(getWarningsBadgeLabel(warnings)).toBe("需关注");
    expect(getWarningsBadgeLabel(warnings)).not.toBe("有警报");
    expect(getWarningsBadgeLabel([])).toBe("");
  });

  it("maps all canonical timezoneSource values to user-facing Chinese labels", () => {
    expect(getTimezoneSourceLabel("platform_shop_api")).toBe("平台 API 已验证");
    expect(getTimezoneSourceLabel("persisted_verified")).toBe("历史验证记录");
    expect(getTimezoneSourceLabel("manual_verified")).toBe("管理员人工确认");
    expect(getTimezoneSourceLabel("temporary_default_la")).toBe("临时按美西时区");
    expect(getTimezoneSourceLabel("unverified")).toBe("尚未验证");
  });
});
