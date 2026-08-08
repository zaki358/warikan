import { describe, expect, it } from "vitest";

import { formatDateLabel, formatYen, percent } from "./format.js";

describe("formatYen", () => {
  it("3桁ごとに区切る", () => {
    expect(formatYen(12345)).toBe("¥12,345");
  });

  it("6桁でも崩れない", () => {
    expect(formatYen(1234567)).toBe("¥1,234,567");
  });

  it("0円を表示できる", () => {
    expect(formatYen(0)).toBe("¥0");
  });

  it("負の額は符号を先に置く", () => {
    expect(formatYen(-8850)).toBe("-¥8,850");
  });

  it("円記号は半角の U+00A5 を使う", () => {
    // Intl の style:"currency" は全角の ￥(U+FFE5) を返すため使わない。
    expect(formatYen(100).codePointAt(0)).toBe(0x00a5);
    expect(formatYen(-100).codePointAt(1)).toBe(0x00a5);
  });
});

describe("formatDateLabel", () => {
  it("月日と曜日にする", () => {
    // 2026-08-03 は月曜日
    expect(formatDateLabel("2026-08-03")).toBe("8/3(月)");
  });

  it("日曜日を正しく出す", () => {
    // 2026-08-02 は日曜日
    expect(formatDateLabel("2026-08-02")).toBe("8/2(日)");
  });

  it("月末をまたいでもずれない", () => {
    expect(formatDateLabel("2026-08-31")).toBe("8/31(月)");
  });
});

describe("percent", () => {
  it("四捨五入した整数を返す", () => {
    expect(percent(32000, 84300)).toBe(38);
  });

  it("全体が0なら0を返す", () => {
    expect(percent(0, 0)).toBe(0);
  });
});
