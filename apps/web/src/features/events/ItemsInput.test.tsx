import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { describe, expect, it } from "vitest";

import { ItemsInput } from "./ItemsInput.js";
import { wizardReducer } from "./wizardReducer.js";
import type { WizardState } from "./wizardReducer.js";

/**
 * ここで固定したいのは2点。
 *
 * 1. 同じ形の行が並ぶので、行ごとに入力と削除ボタンを一意に指せること。
 *    全行が同名だと、読み上げでも自動テストでも行を区別できない（Task 8 の所見2と同根）。
 * 2. 品目の支払者は**参加者配列の index** で持つため、参加者を消すと参照がずれる。
 *    reducer 側の補正は Task 9 で検証済みなので、ここは
 *    「画面が reducer の結果をそのまま映すか」だけを見る。
 */

const seed = (): WizardState => ({
  title: "沖縄旅行",
  mode: "items",
  members: [
    { name: "あや", paid: "" },
    { name: "ぼぶ", paid: "" },
    { name: "かな", paid: "" },
  ],
  items: [
    { name: "宿代", amount: 20000, paidByIndex: 2 },
    { name: "レンタカー", amount: 8000, paidByIndex: 1 },
  ],
});

/** 実際の画面と同じく useReducer に繋いで描画する。 */
function Harness() {
  const [state, dispatch] = useReducer(wizardReducer, undefined, seed);

  return (
    <>
      <ItemsInput state={state} dispatch={dispatch} />
      <button type="button" onClick={() => dispatch({ type: "removeMember", index: 0 })}>
        先頭の参加者を消す
      </button>
    </>
  );
}

describe("ItemsInput", () => {
  it("行ごとに入力と削除ボタンを一意に指せる", () => {
    render(<Harness />);

    expect(screen.getByLabelText("品目 1 の品目名")).toHaveValue("宿代");
    expect(screen.getByLabelText("品目 2 の品目名")).toHaveValue("レンタカー");
    expect(screen.getByLabelText("品目 1 の金額")).toHaveValue(20000);
    expect(screen.getByLabelText("品目 2 の金額")).toHaveValue(8000);
    expect(screen.getByLabelText("品目 1 の支払った人")).toBeInTheDocument();
    expect(screen.getByLabelText("品目 2 の支払った人")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "品目 1 を削除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "品目 2 を削除" })).toBeInTheDocument();
  });

  it("合計を表示する", () => {
    render(<Harness />);

    expect(screen.getByText("¥28,000")).toBeInTheDocument();
  });

  it("参加者を消すと、支払者の選択が名前のまま追従する", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // 削除前。index ではなく名前で見る。index で見ると、ずれても気づけない。
    expect(screen.getByLabelText("品目 1 の支払った人")).toHaveDisplayValue("かな");
    expect(screen.getByLabelText("品目 2 の支払った人")).toHaveDisplayValue("ぼぶ");

    await user.click(screen.getByRole("button", { name: "先頭の参加者を消す" }));

    expect(screen.getByLabelText("品目 1 の支払った人")).toHaveDisplayValue("かな");
    expect(screen.getByLabelText("品目 2 の支払った人")).toHaveDisplayValue("ぼぶ");
    // 消えた参加者が選択肢に残らない。
    expect(screen.queryAllByRole("option", { name: "あや" })).toHaveLength(0);
  });

  it("品目を削除すると、残った行が繰り上がる", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "品目 1 を削除" }));

    expect(screen.getByLabelText("品目 1 の品目名")).toHaveValue("レンタカー");
    expect(screen.queryByLabelText("品目 2 の品目名")).not.toBeInTheDocument();
  });
});
