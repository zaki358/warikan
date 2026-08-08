/**
 * タイムゾーン方針:
 * - 文字列（"2026-08" / "2026-08-03"）から作る日付は必ず `Date.UTC` + `getUTC*` で閉じる。
 *   `new Date("2026-08-03")` は UTC 深夜と解釈されるため、ローカル系メソッドで読むと
 *   UTC より西のタイムゾーンで1日ずれる。日付だけを扱う値にローカル時刻を混ぜない。
 * - 例外は `todayYm` / `todayIso`。「今日」は利用者の手元のカレンダー上の日付なので、
 *   こちらは意図的にローカル時刻（`getFullYear` など）で読む。
 */

const pad = (value: number): string => String(value).padStart(2, "0");

/** その年月の日数。 */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export function parseYm(ym: string): { year: number; month: number } | null {
  const matched = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;

  return { year, month };
}

/** 今日の年月。利用者の手元のカレンダー基準（ローカル時刻）。 */
export function todayYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** 今日の日付（YYYY-MM-DD）。利用者の手元のカレンダー基準（ローカル時刻）。 */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftYm(ym: string, delta: number): string {
  const parsed = parseYm(ym);
  if (!parsed) return ym;

  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

export function ymLabel(ym: string): string {
  const parsed = parseYm(ym);
  return parsed ? `${parsed.year}年${parsed.month}月` : ym;
}

/**
 * 日付を選択中の年月の範囲に収める。
 * 月をまたぐ入力はサーバー側で 400 になるため、送信前にここで防ぐ。
 *
 * 年月は常に `ym` で置き換え、日だけを 1〜末日に丸めて引き継ぐ。
 * （"2026-07-20" を "2026-08" に収めると "2026-08-20" になる）
 */
export function clampToMonth(dateIso: string, ym: string): string {
  const parsed = parseYm(ym);
  if (!parsed) return dateIso;

  const day = Number(dateIso.split("-")[2]);
  if (!Number.isInteger(day)) return `${ym}-01`;

  const last = daysInMonth(parsed.year, parsed.month);
  const clamped = Math.min(Math.max(day, 1), last);

  return `${ym}-${pad(clamped)}`;
}
