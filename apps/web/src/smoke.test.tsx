import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

// 描画後のクリーンアップは src/test-setup.ts で一括登録している。

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
