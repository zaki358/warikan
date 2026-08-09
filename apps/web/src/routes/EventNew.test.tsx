import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { initialWizardState, wizardReducer } from "../features/events/wizardReducer.js";
import { EventNew } from "./EventNew.js";

/**
 * 参加者の行も同じ形が並ぶ。行ごとに入力と削除ボタンを一意に指せないと、
 * 読み上げでも自動テストでも「どの行を消したのか」が確かめられない。
 */
function Harness() {
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);

  return (
    <MemoryRouter>
      <EventNew state={state} dispatch={dispatch} />
    </MemoryRouter>
  );
}

describe("EventNew", () => {
  it("参加者の行ごとに入力と削除ボタンを一意に指せる", () => {
    render(<Harness />);

    expect(screen.getByLabelText("参加者 1 の名前")).toBeInTheDocument();
    expect(screen.getByLabelText("参加者 2 の名前")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "参加者 1 を削除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "参加者 2 を削除" })).toBeInTheDocument();
  });

  it("消した行の名前が消え、後ろの行が繰り上がる", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("参加者 1 の名前"), "あや");
    await user.type(screen.getByLabelText("参加者 2 の名前"), "ぼぶ");

    await user.click(screen.getByRole("button", { name: "参加者 1 を削除" }));

    expect(screen.getByLabelText("参加者 1 の名前")).toHaveValue("ぼぶ");
    expect(screen.queryByLabelText("参加者 2 の名前")).not.toBeInTheDocument();
  });
});
