import { describe, expect, it } from "vitest";
import { barRatio, formatDuration, formatPerDay, formatRate } from "./format";

describe("formatDuration", () => {
  it("null/NaN 用占位符", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("按最大单位降级", () => {
    expect(formatDuration(30_000)).toBe("30 秒");
    expect(formatDuration(90_000)).toBe("1.5 分");
    expect(formatDuration(3 * 3_600_000)).toBe("3.0 小时");
    expect(formatDuration(36 * 3_600_000)).toBe("1.5 天");
  });
});

describe("formatPerDay / formatRate", () => {
  it("频率保留两位", () => {
    expect(formatPerDay(3 / 7)).toBe("0.43 次/天");
  });

  it("比率转百分比", () => {
    expect(formatRate(0)).toBe("0.0%");
    expect(formatRate(0.5)).toBe("50.0%");
  });
});

describe("barRatio", () => {
  it("按最大值归一化，max=0 返回 0", () => {
    expect(barRatio(2, 4)).toBe(0.5);
    expect(barRatio(5, 0)).toBe(0);
    expect(barRatio(10, 4)).toBe(1); // 上限 1
  });
});
