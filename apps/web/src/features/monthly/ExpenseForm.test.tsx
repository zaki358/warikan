import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExpenseForm } from "./ExpenseForm.js";

const users = [
  { userId: "u1", displayName: "自分" },
  { userId: "u2", displayName: "妻" },
];

const categories = [
  { id: 1, name: "食費" },
  { id: 2, name: "日用品" },
];

const setup = (onSubmit = vi.fn()) => {
  render(
    <ExpenseForm
      ym="2026-08"
      users={users}
      categories={categories}
      defaultPaidBy="u1"
      onSubmit={onSubmit}
      isSubmitting={false}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
};

/**
 * controlled な `<input type="date">` には `userEvent.type` で入力できない（実測）。
 * 1文字ずつ打つと jsdom が中間状態を不正な日付として弾いて value が "" になり、
 * React が state から書き戻すため、最終的に空のままになる。
 * 実ブラウザでも ISO 文字列を1文字ずつ打つ操作は存在せず、ピッカーやセグメントの確定は
 * 「妥当な値1回分の change」として届く。それに相当するのが fireEvent.change。
 */
const pickDate = (value: string) => {
  fireEvent.change(screen.getByLabelText("日付"), { target: { value } });
};

const fill = async (user: ReturnType<typeof userEvent.setup>, amount: string, item: string) => {
  await user.clear(screen.getByLabelText("金額"));
  await user.type(screen.getByLabelText("金額"), amount);
  await user.clear(screen.getByLabelText("品目"));
  await user.type(screen.getByLabelText("品目"), item);
};

describe("ExpenseForm", () => {
  it("入力して送信すると整数の金額で onSubmit が呼ばれる", async () => {
    const { onSubmit, user } = setup();

    await fill(user, "1200", "牛乳と卵");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).toHaveBeenCalledWith({
      paidBy: "u1",
      amount: 1200,
      itemName: "牛乳と卵",
      categoryId: 1,
      spentOn: expect.stringMatching(/^2026-08-\d{2}$/),
    });
  });

  it("送信後に金額と品目だけがクリアされる", async () => {
    const { user } = setup();

    await fill(user, "1200", "牛乳と卵");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(screen.getByLabelText("金額")).toHaveValue(null);
    expect(screen.getByLabelText("品目")).toHaveValue("");
  });

  it("送信後も支払者・カテゴリ・日付は直前の値を保つ", async () => {
    const { onSubmit, user } = setup();

    await user.click(screen.getByRole("radio", { name: "妻" }));
    await user.selectOptions(screen.getByLabelText("カテゴリ"), "2");
    pickDate("2026-08-20");

    await fill(user, "500", "ティッシュ");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    // 2回目の入力で選び直さなくてよいこと
    expect(screen.getByRole("radio", { name: "妻" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("カテゴリ")).toHaveValue("2");
    expect(screen.getByLabelText("日付")).toHaveValue("2026-08-20");

    await fill(user, "300", "洗剤");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).toHaveBeenLastCalledWith({
      paidBy: "u2",
      amount: 300,
      itemName: "洗剤",
      categoryId: 2,
      spentOn: "2026-08-20",
    });
  });

  it("金額が空なら送信できない", async () => {
    const { onSubmit, user } = setup();

    await user.type(screen.getByLabelText("品目"), "牛乳");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("品目が空白だけなら送信できない", async () => {
    const { onSubmit, user } = setup();

    await user.type(screen.getByLabelText("金額"), "100");
    await user.type(screen.getByLabelText("品目"), "   ");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("日付の入力可能範囲がその月に制限されている", () => {
    setup();

    const date = screen.getByLabelText("日付");
    expect(date).toHaveAttribute("min", "2026-08-01");
    expect(date).toHaveAttribute("max", "2026-08-31");
  });

  it("送信中はボタンを押せない", () => {
    render(
      <ExpenseForm
        ym="2026-08"
        users={users}
        categories={categories}
        defaultPaidBy="u1"
        onSubmit={vi.fn()}
        isSubmitting
      />,
    );

    expect(screen.getByRole("button", { name: "記録中…" })).toBeDisabled();
  });
});
