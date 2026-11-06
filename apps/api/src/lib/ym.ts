const YM_PATTERN = /^(\d{4})-(\d{2})$/;

export function parseYm(ym: string): { year: number; month: number } | null {
  const matched = YM_PATTERN.exec(ym);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;

  return { year, month };
}

export const formatYm = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}`;

/** その年月の日数。spent_on の範囲検証に使う。 */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * spentOn（YYYY-MM-DD）がその年月の実在する日付かを確認する。
 * 月次の支出はすべて URL の :ym と同じ月に属している必要がある。
 */
export function spentOnInPeriod(spentOn: string, year: number, month: number): boolean {
  const [y, m, d] = spentOn.split("-").map(Number);
  if (y !== year || m !== month) return false;
  return d !== undefined && d >= 1 && d <= daysInMonth(year, month);
}
