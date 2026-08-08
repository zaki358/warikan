import { afterEach, describe, expect, it, vi } from "vitest";

import { clampToMonth, shiftYm, todayIso, todayYm, ymLabel } from "./ym.js";

describe("shiftYm", () => {
  it("翌月に進む", () => {
    expect(shiftYm("2026-08", 1)).toBe("2026-09");
  });

  it("前月に戻る", () => {
    expect(shiftYm("2026-08", -1)).toBe("2026-07");
  });

  it("年をまたいで進む", () => {
    expect(shiftYm("2026-12", 1)).toBe("2027-01");
  });

  it("年をまたいで戻る", () => {
    expect(shiftYm("2026-01", -1)).toBe("2025-12");
  });
});

describe("ymLabel", () => {
  it("日本語の年月にする", () => {
    expect(ymLabel("2026-08")).toBe("2026年8月");
  });
});

describe("todayYm / todayIso", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // 現在時刻に依存するので必ず固定する。
  // ローカル時刻の年月日を返す関数なので、固定値もローカル時刻で組み立てる
  // （UTC のインスタンスで固定するとタイムゾーン次第で1日ずれる）。
  const freeze = (year: number, month: number, day: number): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, month - 1, day, 12, 0, 0));
  };

  it("今日の年月を返す", () => {
    freeze(2026, 8, 3);

    expect(todayYm()).toBe("2026-08");
  });

  it("1桁の月を0埋めする", () => {
    freeze(2027, 1, 9);

    expect(todayYm()).toBe("2027-01");
  });

  it("今日の日付を YYYY-MM-DD で返す", () => {
    freeze(2027, 1, 9);

    expect(todayIso()).toBe("2027-01-09");
  });
});

describe("clampToMonth", () => {
  it("その月の日付はそのまま", () => {
    expect(clampToMonth("2026-08-15", "2026-08")).toBe("2026-08-15");
  });

  it("月初ちょうどはそのまま", () => {
    expect(clampToMonth("2026-08-01", "2026-08")).toBe("2026-08-01");
  });

  it("月末ちょうどはそのまま", () => {
    expect(clampToMonth("2026-08-31", "2026-08")).toBe("2026-08-31");
  });

  it("別の月の日付はその月の1日に寄せる", () => {
    expect(clampToMonth("2026-09-01", "2026-08")).toBe("2026-08-01");
  });

  it("対象月より前の日付は日を保ったまま対象月に移す", () => {
    expect(clampToMonth("2026-07-20", "2026-08")).toBe("2026-08-20");
  });

  it("対象月より後の日付は日を保ったまま対象月に移す", () => {
    expect(clampToMonth("2026-09-25", "2026-08")).toBe("2026-08-25");
  });

  it("月末を超える日は末日に丸める", () => {
    // 2月は28日まで（2026年は平年）
    expect(clampToMonth("2026-02-31", "2026-02")).toBe("2026-02-28");
  });

  it("うるう年の2月29日はそのまま残す", () => {
    expect(clampToMonth("2028-02-29", "2028-02")).toBe("2028-02-29");
  });

  it("平年の2月29日は28日に丸める", () => {
    expect(clampToMonth("2026-02-29", "2026-02")).toBe("2026-02-28");
  });

  it("日が読めない入力は1日にする", () => {
    expect(clampToMonth("2026-08", "2026-08")).toBe("2026-08-01");
  });
});
