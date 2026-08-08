/**
 * invalidate の対象を取り違えると、金額が古いまま表示される。
 * キーは必ずここから取る。文字列を直に書かない。
 *
 * TanStack Query の invalidate は既定で**前方一致**（exact: false）なので、
 * `monthly(ym)` = ["monthly", ym] の invalidate は
 * `monthlyResult(ym)` = ["monthly", ym, "result"] も巻き込む。逆は巻き込まない。
 * この包含関係は意図的なもので、`features/monthly/queries.test.tsx` で固定している。
 */
export const queryKeys = {
  me: () => ["me"] as const,
  categories: () => ["categories"] as const,
  monthly: (ym: string) => ["monthly", ym] as const,
  monthlyResult: (ym: string) => ["monthly", ym, "result"] as const,
  events: () => ["events"] as const,
  event: (id: string) => ["events", id] as const,
};
