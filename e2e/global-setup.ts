import { execSql } from "./helpers/db.js";

export const BASE_URL = "http://localhost:8788";

/** 実在の月に触れないよう、遠い未来の月をテスト専用に使う。 */
export const TEST_YM = "2099-01";

/**
 * E2E は「起動済みの wrangler dev」に対して実行する。
 *
 * playwright.config.ts の webServer で起動させない理由:
 * Windows では wrangler を落としても子の workerd が残り、親が生きていると
 * 再生成される（CLAUDE.md 参照）。Playwright の webServer は
 * プロセスツリーを親から順に落とす保証が無く、テストのたびに
 * 8788 を掴んだ workerd が積み上がる。手で起動・停止させるほうが安全。
 */
export default async function globalSetup(): Promise<void> {
  const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      [
        `${BASE_URL} に繋がりません。先に次の2つを実行してください。`,
        "  npm run build -w @warikan/web",
        "  npm run dev -w @warikan/api -- --port 8788",
      ].join("\n"),
    );
  }

  // テスト専用の月だけを消す。利用者の実データには触れない。
  // monthly_periods は year / month の整数列で持ち、monthly_expenses は
  // period_id で参照する（period_ym / ym という列は存在しない）。
  const [yearStr, monthStr] = TEST_YM.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  execSql(
    `DELETE FROM monthly_expenses WHERE period_id IN` +
      ` (SELECT id FROM monthly_periods WHERE year = ${year} AND month = ${month});` +
      ` DELETE FROM monthly_periods WHERE year = ${year} AND month = ${month};`,
  );

  // 月次は登録済みユーザー全員で割る（apps/api/src/services/settle.ts）。
  // 相手がローカルで一度もログインしていないと1人になり、
  // 一人あたりが総額と一致してしまって精算を確認できない。
  execSql(
    "INSERT OR IGNORE INTO users (id, email, display_name, created_at)" +
      " VALUES ('e2e-partner', 'partner@example.com', 'つれあい', '2000-01-01T00:00:00.000Z')",
  );

  const res = await fetch(`${BASE_URL}/api/users`);
  const body = (await res.json()) as { ok: boolean; data?: { userId: string }[] };
  if (!body.ok || body.data?.length !== 2) {
    throw new Error(
      `登録ユーザーがちょうど2人である前提です（実際: ${body.data?.length ?? "取得失敗"}人）。` +
        " ローカルの users テーブルを確認してください。",
    );
  }
}
