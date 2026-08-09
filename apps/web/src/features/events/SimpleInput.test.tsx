import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SimpleInput } from "./SimpleInput.js";
import type { WizardState } from "./wizardReducer.js";

/**
 * 参加者名は重複しうる（reducer 側にも「同名の参加者がいても通る」テストがある）。
 * 金額欄のラベルが名前だけだと、同名の行を利用者も読み上げも自動テストも区別できない。
 * 品目側（ItemsInput）は行番号を付けているので、ここも揃える。
 */
const seed = (names: string[]): WizardState => ({
  title: "飲み会",
  mode: "simple",
  members: names.map((name) => ({ name, paid: "" as const })),
  items: [],
});

it("同名の参加者がいても金額欄を一意に指せる", () => {
  render(<SimpleInput state={seed(["田中", "田中"])} dispatch={vi.fn()} />);

  expect(screen.getByLabelText("1. 田中")).toBeInTheDocument();
  expect(screen.getByLabelText("2. 田中")).toBeInTheDocument();
});

it("名前が未入力でも行を指せる", () => {
  render(<SimpleInput state={seed(["田中", ""])} dispatch={vi.fn()} />);

  expect(screen.getByLabelText("2. 参加者 2")).toBeInTheDocument();
});
