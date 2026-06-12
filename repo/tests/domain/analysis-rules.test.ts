import { describe, expect, it } from "vitest";
import {
  buildAiAdvice,
  classifyCountryRecommendation,
  judgeCreativePerformance,
  ratio,
} from "../../src/domain/analysis-rules.js";

describe("analysis rules", () => {
  it("classifies country budget recommendations", () => {
    expect(classifyCountryRecommendation({
      orders: 0,
      sales: 0,
      spend: 80,
      realRoas: 0,
      metaRoas: 0,
    })).toBe("排除");

    expect(classifyCountryRecommendation({
      orders: 10,
      sales: 500,
      spend: 120,
      realRoas: 4.16,
      metaRoas: 3,
    })).toBe("单独开系列");
  });

  it("judges creative performance without write actions", () => {
    expect(judgeCreativePerformance({
      spend: 120,
      ctr: 2.1,
      cpc: 0.5,
      cpm: 10,
      purchases: 0,
      roas: 0,
      frequency: 1.2,
    })).toBe("高点击低转化");

    expect(judgeCreativePerformance({
      spend: 300,
      ctr: 1.4,
      cpc: 0.8,
      cpm: 12,
      purchases: 8,
      roas: 3.2,
      frequency: 1.8,
    })).toBe("可扩量");
  });

  it("builds advisory output instead of execution commands", () => {
    const advice = buildAiAdvice({
      orderCount: 12,
      sales: 600,
      spend: 200,
      realRoas: ratio(600, 200),
      metaRoas: 1.2,
      metaPurchases: 5,
      orderGap: 7,
    });

    expect(advice.currentConclusion).toContain("真实 ROAS");
    expect(advice.suggestedActions.join(" ")).toContain("建议");
    expect(advice.operatorChecklist.join(" ")).toContain("不会自动创建、暂停或修改广告");
  });
});
