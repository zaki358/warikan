import { expect, test } from "@playwright/test";

import { rowWith } from "./helpers/locators.js";

/**
 * 設計書 §8 のフロー2。3人・金額入力 → 精算結果を確認。
 *
 * 10000 + 3500 + 0 = 13500、一人あたり 4500。
 * 田中 +5500 / 佐藤 -1000 / 鈴木 -4500 なので、
 * 鈴木 → 田中 4500、佐藤 → 田中 1000 の2件になる。
 */
test("単発シンプル — 3人で割り勘して結果を確認する", async ({ page, request }) => {
  await page.goto("/events/new");

  await page.getByRole("textbox", { name: "タイトル" }).fill("E2E シンプル");
  await page.getByRole("button", { name: "＋ 参加者を追加" }).click();

  await page.getByRole("textbox", { name: "参加者 1 の名前" }).fill("田中");
  await page.getByRole("textbox", { name: "参加者 2 の名前" }).fill("佐藤");
  await page.getByRole("textbox", { name: "参加者 3 の名前" }).fill("鈴木");

  await page.getByRole("button", { name: "次へ" }).click();

  await page.getByRole("spinbutton", { name: "1. 田中" }).fill("10000");
  await page.getByRole("spinbutton", { name: "2. 佐藤" }).fill("3500");
  // 鈴木は空欄のまま。立て替えていない人は 0 として扱われる。

  await page.getByRole("button", { name: "計算する" }).click();

  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "E2E シンプル" })).toBeVisible();

  // ¥4,500 は「一人あたり」の行と「鈴木 → 田中」の送金行の両方に出る。
  // getByText だと2件一致して strict mode で落ちるので、行で絞る。
  await expect(rowWith(page, "合計")).toContainText("¥13,500");
  await expect(rowWith(page, "一人あたり")).toContainText("¥4,500");

  // 送金は2件。行番号つきのアクセシブル名で、どの行かを取り違えずに指せる。
  await expect(page.getByRole("button", { name: /支払い済みにする$/ })).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "1. 鈴木 から 田中 への ¥4,500を支払い済みにする" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2. 佐藤 から 田中 への ¥1,000を支払い済みにする" }),
  ).toBeVisible();

  // 2行目だけを消し込む。1行目が巻き込まれないことまで見る。
  await page.getByRole("button", { name: "2. 佐藤 から 田中 への ¥1,000を支払い済みにする" }).click();
  await expect(
    page.getByRole("button", { name: "2. 佐藤 から 田中 への ¥1,000を未払いに戻す" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1. 鈴木 から 田中 への ¥4,500を支払い済みにする" }),
  ).toBeVisible();

  // 後片付け。ホームの一覧に残さない。
  const eventId = page.url().split("/").pop();
  expect((await request.delete(`/api/events/${eventId}`)).ok()).toBe(true);
});
