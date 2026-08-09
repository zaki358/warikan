import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { MAX_AMOUNT } from "../lib/limits.js";
import { AmountInput } from "./AmountInput.js";

/**
 * API の zod は amount を 0〜10,000,000 で弾く（apps/api/src/routes/events.ts）。
 * 画面側に上限が無いと、利用者はフォームを全部埋めてから汎用の 400 を受け取る。
 * 入力段階で弾く（負値・小数を弾いているのと同じ扱い）。
 */

/**
 * **state を持つラッパ経由で描画すること。**
 * AmountInput は制御コンポーネントなので、`value` を固定したまま `user.type` すると
 * React が毎キーストローク後に DOM の値を props の値へ戻す。実測すると
 * "12345" をタイプして onChange に届くのは `[1, 12, 123, 1234, 12345]` ではなく
 * `[1, 2, 3, 4, 5]` になり、桁が積み上がらない。上限のテストが
 * 「どんな実装でも必ず通る」空のテストになってしまう。
 */
function Host({ onChange }: { onChange: (value: number | "") => void }) {
  const [value, setValue] = useState<number | "">("");

  return (
    <AmountInput
      id="amount"
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

it("上限を超える金額は反映しない", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Host onChange={onChange} />);

  // "10000001" は1桁ずつ積み上がる。7桁目までは上限内なので通り、
  // 8文字目で 10,000,001 になった時点だけ弾かれる。
  await user.type(screen.getByRole("spinbutton"), String(MAX_AMOUNT + 1));

  expect(onChange).not.toHaveBeenCalledWith(MAX_AMOUNT + 1);
  // 弾かれた入力は state に入らないので、画面には直前の値が残る。
  // 上限判定を消すとここが 10000001 になり、この行が落ちる。
  expect(screen.getByRole("spinbutton")).toHaveValue(1_000_000);
});

it("上限ちょうどは通す", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Host onChange={onChange} />);

  await user.type(screen.getByRole("spinbutton"), String(MAX_AMOUNT));

  expect(onChange).toHaveBeenCalledWith(MAX_AMOUNT);
  expect(screen.getByRole("spinbutton")).toHaveValue(MAX_AMOUNT);
});
