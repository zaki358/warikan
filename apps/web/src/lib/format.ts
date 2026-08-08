// 区切りだけを Intl に任せ、通貨記号は自前で付ける。
// style: "currency" は ja-JP で全角の ￥(U+FFE5) を返すため使わない。
// 表示仕様は半角の ¥(U+00A5)。
const YEN = new Intl.NumberFormat("ja-JP");

/** 金額は整数（円）。表示のときだけ区切りを入れる。 */
export function formatYen(amount: number): string {
  return amount < 0 ? `-¥${YEN.format(-amount)}` : `¥${YEN.format(amount)}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * "2026-08-03" → "8/3(月)"
 *
 * タイムゾーン方針: 文字列を自前で分解し、曜日の算出だけ UTC 系で閉じる。
 * `new Date("2026-08-03")` は UTC 深夜として解釈されるため、`getDay()` などの
 * ローカル系メソッドで読むと UTC より西のタイムゾーンで前日にずれる
 * （America/New_York で "8/2(日)" になることを実測で確認した）。
 * `spentOn` は時刻を持たない「その日」なので、ローカル時刻を一切介在させない。
 */
export function formatDateLabel(spentOn: string): string {
  const [year, month, day] = spentOn.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return spentOn;

  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${month}/${day}(${weekday})`;
}

export function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}
