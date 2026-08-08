import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";

// 描画後のクリーンアップは src/test-setup.ts で一括登録している。

/**
 * QueryClientProvider は main.tsx 側にあり App には含まれないため、
 * データ取得を行う画面（Task 7 以降の MonthlyRecord など）を素の App で
 * 描画すると "No QueryClient set" で落ちる。ここで補う。
 *
 * fetch は解決しない Promise に差し替える。ルーティングだけを見たいので
 * 応答は要らず、テスト終了後に state 更新が走って act 警告が出るのも避けたい。
 */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("ルーティング", () => {
  it("/ でホームを表示する", () => {
    renderAt("/");

    expect(screen.getByRole("heading", { name: "割り勘" })).toBeInTheDocument();
  });

  it("/monthly/2026-08 で記録画面を表示する", () => {
    renderAt("/monthly/2026-08");

    // 記録画面は Task 7 で実装に置き換わり、仮の見出し「月次の記録」は無くなった。
    // 代わりに URL の :ym から作られる月ラベルを見る。パラメータの解釈まで確かめられる。
    expect(screen.getByText("2026年8月")).toBeInTheDocument();
  });

  it("/monthly/2026-08/result で精算画面を表示する", () => {
    renderAt("/monthly/2026-08/result");

    // 精算画面は Task 8 で実装に置き換わり、仮の見出し「月次の精算」は無くなった。
    // 記録画面と同じく、URL の :ym から作られる見出しを見てパラメータの解釈まで確かめる。
    expect(screen.getByRole("heading", { name: "2026年8月の精算" })).toBeInTheDocument();
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
