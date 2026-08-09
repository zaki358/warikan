import type { Locator, Page } from "@playwright/test";

/**
 * 同じ金額が「合計」「一人あたり」「カテゴリ別内訳」「送金」に同時に現れうる。
 * getByText だけだと複数一致して strict mode で落ちる。ラベルで行を絞ってから
 * 金額を見れば、対応関係まで一緒に確かめられる。
 */
export const rowWith = (scope: Page | Locator, label: string): Locator =>
  scope.locator(".list-row").filter({ hasText: label });

/**
 * 見出しでカードを1枚に絞る。品目別の結果画面では、支払者名（"1. 山田"）が
 * 「支払い状況」の行と「品目」の行の両方に出るため、カードで絞らないと
 * 行が一意にならない。
 */
export const cardWith = (page: Page, heading: string): Locator =>
  page.locator(".card").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
