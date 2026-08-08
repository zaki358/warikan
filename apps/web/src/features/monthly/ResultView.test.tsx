import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Snapshot } from "../../lib/types.js";
import { ResultView } from "./ResultView.js";

const snapshot: Snapshot = {
  total: 84300,
  perPerson: 42150,
  byUser: [
    { userId: "u1", displayName: "自分", paid: 51000, share: 42150 },
    { userId: "u2", displayName: "妻", paid: 33300, share: 42150 },
  ],
  byCategory: [
    { categoryId: 1, name: "食費", amount: 32000 },
    { categoryId: 2, name: "日用品", amount: 18500 },
  ],
  transfers: [{ fromId: "u2", toId: "u1", amount: 8850, isPaid: false }],
  settledAt: "2026-08-31T12:00:00.000Z",
};

const setup = (overrides: { snapshot?: Snapshot; isDirty?: boolean } = {}) => {
  const onRecalculate = vi.fn();
  const onToggleTransfer = vi.fn();

  render(
    <ResultView
      snapshot={overrides.snapshot ?? snapshot}
      isDirty={overrides.isDirty ?? false}
      isBusy={false}
      onRecalculate={onRecalculate}
      onToggleTransfer={onToggleTransfer}
    />,
  );

  return { onRecalculate, onToggleTransfer, user: userEvent.setup() };
};

describe("ResultView", () => {
  it("合計と一人あたりを表示する", () => {
    setup();

    expect(screen.getByText("¥84,300")).toBeInTheDocument();
    expect(screen.getByText("¥42,150")).toBeInTheDocument();
  });

  it("カテゴリ別の金額と割合を出す", () => {
    setup();

    expect(screen.getByText("食費")).toBeInTheDocument();
    expect(screen.getByText("¥32,000")).toBeInTheDocument();
    // 32000 / 84300 = 37.96% → 38%
    expect(screen.getByText("38%")).toBeInTheDocument();
  });

  it("各人の支払額を出す", () => {
    setup();

    expect(screen.getByText("¥51,000")).toBeInTheDocument();
    expect(screen.getByText("¥33,300")).toBeInTheDocument();
  });

  it("送金を「誰から誰へ」で出す", () => {
    setup();

    expect(screen.getByText(/妻 → 自分/)).toBeInTheDocument();
    expect(screen.getByText("¥8,850")).toBeInTheDocument();
  });

  it("支払い済みに切り替えると index と isPaid を渡す", async () => {
    const { onToggleTransfer, user } = setup();

    await user.click(screen.getByRole("button", { name: /支払い済みにする$/ }));

    expect(onToggleTransfer).toHaveBeenCalledWith(0, true);
  });

  it("支払い済みなら未払いに戻せる", async () => {
    const paid: Snapshot = {
      ...snapshot,
      transfers: [{ fromId: "u2", toId: "u1", amount: 8850, isPaid: true }],
    };
    const { onToggleTransfer, user } = setup({ snapshot: paid });

    await user.click(screen.getByRole("button", { name: /未払いに戻す$/ }));

    expect(onToggleTransfer).toHaveBeenCalledWith(0, false);
  });

  it("isDirty が false なら警告を出さない", () => {
    setup();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("isDirty が true なら警告と再計算ボタンを出す", async () => {
    const { onRecalculate, user } = setup({ isDirty: true });

    expect(screen.getByRole("alert")).toHaveTextContent("記録が変わっています");

    await user.click(screen.getByRole("button", { name: "再計算する" }));
    expect(onRecalculate).toHaveBeenCalled();
  });

  it("送金が無い月は精算不要と出す", () => {
    setup({ snapshot: { ...snapshot, transfers: [] } });

    expect(screen.getByText("精算は不要です")).toBeInTheDocument();
  });
});

describe("送金の index", () => {
  // API は PATCH /api/monthly/{ym}/result/transfers/{index} で配列の位置を指す。
  // 表示側で並べ替えや絞り込みを入れると別の送金を消し込んでしまう。
  // 月次は2人固定なので送金は1件以下だが、index を渡す契約はここで固定しておく。
  it("表示順を並べ替えず、配列の位置をそのまま渡す", async () => {
    const twoTransfers: Snapshot = {
      ...snapshot,
      transfers: [
        { fromId: "u2", toId: "u1", amount: 8850, isPaid: false },
        { fromId: "u2", toId: "u1", amount: 1200, isPaid: false },
      ],
    };
    const { onToggleTransfer, user } = setup({ snapshot: twoTransfers });

    // 名前で「どの送金か」を指定する。位置で選ぶと、表示を並べ替える実装でも
    // 「n 番目のボタンに n が渡る」が成り立ってしまい、ずれを検知できない。
    await user.click(
      screen.getByRole("button", { name: "妻 から 自分 への ¥1,200を支払い済みにする" }),
    );

    expect(onToggleTransfer).toHaveBeenCalledWith(1, true);
  });
});
