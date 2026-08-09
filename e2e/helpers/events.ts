import { test as base } from "@playwright/test";

/**
 * 単発割り勘（シンプル／品目別）の後片付け。
 *
 * spec の最後に `request.delete(...)` を1行書くだけだと、手前の assertion
 * が失敗したときにその行へ到達せず、作ったイベントが D1 に残ってホームの
 * 一覧にも出続けてしまう（実測済み：`apps/api/src/routes/events.ts` の
 * 集計ロジックを一時的に壊して確認した）。テスト本文の成否に関係なく
 * 必ず消えるよう、`test.extend` の fixture teardown（`use()` の後の行）に
 * 片付けを寄せる。teardown はテストが FAIL しても必ず実行される。
 *
 * 呼び出し側は id が分かった時点で `trackEvent(id)` を呼ぶだけでよい。
 * 実際の削除はテスト終了後にまとめて行われる。
 */
type Fixtures = {
  trackEvent: (eventId: string) => void;
};

export const test = base.extend<Fixtures>({
  trackEvent: async ({ request }, use) => {
    const eventIds: string[] = [];

    await use((eventId) => {
      eventIds.push(eventId);
    });

    // ここから teardown。
    for (const eventId of eventIds) {
      await request.delete(`/api/events/${eventId}`);
    }
  },
});

export { expect } from "@playwright/test";
