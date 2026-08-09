import { expect, test } from "@playwright/test";

import { TEST_YM } from "./global-setup.js";
import { rowWith } from "./helpers/locators.js";

/**
 * 設計書 §8 のフロー1。
 * 支出を3件記録 → 計算 → 精算額が期待値と一致 → 支払い済みにする。
 *
 * 3000 + 1200 + 4800 = 9000。登録ユーザーは2人なので一人あたり 4500。
 * 全額を自分が払っているので、相手 → 自分へ 4500 の送金が1件出る。
 */
const EXPENSES = [
  { amount: "3000", item: "牛乳と卵", date: `${TEST_YM}-05` },
  { amount: "1200", item: "洗剤", date: `${TEST_YM}-09` },
  { amount: "4800", item: "外食", date: `${TEST_YM}-14` },
];

// 2本目は1本目が計算済みであることを前提にする（is_dirty を立てるため）。
test.describe.configure({ mode: "serial" });

test("月次 — 記録して計算し、送金を消し込む", async ({ page }) => {
  await page.goto(`/monthly/${TEST_YM}`);

  for (const expense of EXPENSES) {
    await page.getByRole("spinbutton", { name: "金額" }).fill(expense.amount);
    await page.getByRole("textbox", { name: "品目" }).fill(expense.item);
    // 既定は「今日」で、テスト用の月の範囲外なので必ず入れ直す（API が 400 を返す）。
    // 日付だけ getByLabel を使う。<input type="date"> には対応する ARIA ロールが
    // 無く、getByRole("textbox") では拾えない（金額は type="number" で spinbutton、
    // 品目は type="text" で textbox）。
    await page.getByLabel("日付").fill(expense.date);
    await page.getByRole("button", { name: "記録する" }).click();

    await expect(page.getByRole("button", { name: `${expense.item} を削除` })).toBeVisible();
  }

  // 送信後に消えるのは金額と品目だけ。日付とカテゴリは残る（設計書 §7.1）。
  await expect(page.getByRole("spinbutton", { name: "金額" })).toHaveValue("");
  await expect(page.getByLabel("日付")).toHaveValue(`${TEST_YM}-14`);

  await page.getByRole("link", { name: "計算する" }).click();
  await expect(page).toHaveURL(`/monthly/${TEST_YM}/result`);

  await page.getByRole("button", { name: "計算する" }).click();

  await expect(rowWith(page, "今月の合計")).toContainText("¥9,000");
  await expect(rowWith(page, "一人あたり")).toContainText("¥4,500");

  const toggle = page.getByRole("button", { name: /支払い済みにする$/ });
  await expect(toggle).toHaveCount(1);
  await toggle.click();

  await expect(page.getByRole("button", { name: /未払いに戻す$/ })).toHaveCount(1);
});

test("記録を足すと精算に再計算の警告が出る", async ({ page }) => {
  await page.goto(`/monthly/${TEST_YM}`);

  await page.getByRole("spinbutton", { name: "金額" }).fill("1000");
  await page.getByRole("textbox", { name: "品目" }).fill("追加の記録");
  await page.getByLabel("日付").fill(`${TEST_YM}-20`);
  await page.getByRole("button", { name: "記録する" }).click();
  await expect(page.getByRole("button", { name: "追加の記録 を削除" })).toBeVisible();

  await page.getByRole("link", { name: "計算する" }).click();

  await expect(page.getByRole("alert")).toContainText("記録が変わっています");

  await page.getByRole("button", { name: "再計算する" }).click();

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(rowWith(page, "今月の合計")).toContainText("¥10,000");
  await expect(rowWith(page, "一人あたり")).toContainText("¥5,000");
});
