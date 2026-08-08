import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App.js";

// Testing Library の自動クリーンアップは、グローバルな `afterEach` が存在するときだけ
// 登録される（`@testing-library/react` の index.js が `typeof afterEach === "function"`
// で判定している）。vitest.config.ts は `globals: false` なのでこれが登録されず、
// 描画した DOM が body に積み上がって getByRole が「複数見つかった」で落ちる。
// 明示的に呼んでテストを1件ずつ独立させる。
afterEach(cleanup);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe("ルーティング", () => {
  it("/ でホームを表示する", () => {
    renderAt("/");

    expect(screen.getByRole("heading", { name: "割り勘" })).toBeInTheDocument();
  });

  it("/monthly/2026-08 で記録画面を表示する", () => {
    renderAt("/monthly/2026-08");

    expect(screen.getByRole("heading", { name: "月次の記録" })).toBeInTheDocument();
  });

  it("/monthly/2026-08/result で精算画面を表示する", () => {
    renderAt("/monthly/2026-08/result");

    expect(screen.getByRole("heading", { name: "月次の精算" })).toBeInTheDocument();
  });

  it("/events/new でウィザードを表示する", () => {
    renderAt("/events/new");

    expect(screen.getByRole("heading", { name: "新しい割り勘" })).toBeInTheDocument();
  });

  it("知らないパスはホームに飛ばす", () => {
    renderAt("/nope");

    expect(screen.getByRole("heading", { name: "割り勘" })).toBeInTheDocument();
  });
});
