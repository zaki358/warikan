import { expect, test } from "./helpers/events.js";
import { cardWith, rowWith } from "./helpers/locators.js";

/**
 * 設計書 §8 のフロー3。品目を追加 → 支払者ごとに集計されることを確認。
 *
 * 宿代 18000（山田）/ レンタカー 9400（川口）/ 夕食 7300（川口）。
 * 山田 18000・川口 16700、合計 34700、一人あたり 17350。
 * 川口 → 山田 650 の1件になる。
 */
test("単発品目別 — 支払者ごとに合算されることを確認する", async ({ page, trackEvent }) => {
  await page.goto("/events/new");

  await page.getByRole("textbox", { name: "タイトル" }).fill("E2E 品目別");
  await page.getByRole("radio", { name: "品目別" }).click();

  await page.getByRole("textbox", { name: "参加者 1 の名前" }).fill("山田");
  await page.getByRole("textbox", { name: "参加者 2 の名前" }).fill("川口");

  await page.getByRole("button", { name: "次へ" }).click();

  const items = [
    { name: "宿代", amount: "18000", payer: "山田" },
    { name: "レンタカー", amount: "9400", payer: "川口" },
    { name: "夕食", amount: "7300", payer: "川口" },
  ];

  for (const [index, item] of items.entries()) {
    await page.getByRole("button", { name: "＋ 品目を追加" }).click();
    await page.getByRole("textbox", { name: `品目 ${index + 1} の品目名` }).fill(item.name);
    await page.getByRole("spinbutton", { name: `品目 ${index + 1} の金額` }).fill(item.amount);
    await page.getByLabel(`品目 ${index + 1} の支払った人`).selectOption({ label: item.payer });
  }

  // 入力画面の「合計」行（ItemsInput）。入力しながら積み上がることを見る。
  await expect(rowWith(page, "合計")).toContainText("¥34,700");

  await page.getByRole("button", { name: "計算する" }).click();

  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  // 後片付け。ホームの一覧に残さない。ここで id を登録しておけば、この先の
  // assertion が落ちてもテスト終了時に必ず削除される（helpers/events.ts）。
  trackEvent(page.url().split("/").pop() ?? "");

  // 品目別では、入力した「立て替え額」ではなく品目の合算が支払額になる。
  // ¥18,000 は「支払い状況」の 山田 の行と「品目」の 宿代 の行の両方に出るので、
  // カードで絞ってから行を指す。ここで見たいのは「合算された支払額」のほう。
  const paidCard = cardWith(page, "支払い状況");
  await expect(rowWith(paidCard, "1. 山田")).toContainText("¥18,000");
  await expect(rowWith(paidCard, "2. 川口")).toContainText("¥16,700");
  await expect(rowWith(page, "一人あたり")).toContainText("¥17,350");

  await expect(
    page.getByRole("button", { name: "1. 川口 から 山田 への ¥650を支払い済みにする" }),
  ).toBeVisible();
});
