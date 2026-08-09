import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventSummary, MonthlyDetail } from "../lib/types.js";
import { Home } from "./Home.js";

/**
 * ホームは表示だけの画面だが、次の2点は目視で気づきにくいので固定する。
 *
 * 1. 「今月の合計」は支出の合計。API はこの数字を返さないので画面側で足す。
 * 2. 確定後に記録が変わった月（is_dirty）は、ホームの時点で警告を出す。
 *    出ないと古い精算額のまま送金してしまう。
 */

const period = (isDirty: boolean) => ({
  ym: "2026-08",
  year: 2026,
  month: 8,
  status: "settled",
  isDirty,
  settledAt: "2026-08-31T12:00:00.000Z",
});

const monthly = (isDirty = false): MonthlyDetail => ({
  period: period(isDirty),
  expenses: [
    {
      id: "x1",
      paidBy: "u1",
      amount: 1200,
      itemName: "牛乳",
      categoryId: 1,
      spentOn: "2026-08-03",
    },
    {
      id: "x2",
      paidBy: "u2",
      amount: 34500,
      itemName: "家賃",
      categoryId: null,
      spentOn: "2026-08-01",
    },
  ],
});

const events: EventSummary[] = [
  {
    id: "e1",
    title: "沖縄旅行",
    mode: "items",
    total: 24000,
    perPerson: 4000,
    createdAt: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "e2",
    title: "飲み会",
    mode: "simple",
    total: 12000,
    perPerson: 3000,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

/** fetch のシグネチャ付きで宣言する。引数ゼロだと mock.calls[0] が空タプルになる。 */
const renderHome = (options: { monthly?: MonthlyDetail; events?: EventSummary[] } = {}) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const data = url.startsWith("/api/events") ? (options.events ?? events) : (options.monthly ?? monthly());
    return { status: 200, json: async () => ({ ok: true, data }) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home", () => {
  it("今月の合計は支出の合計", async () => {
    renderHome();

    expect(await screen.findByText("¥35,700")).toBeInTheDocument();
  });

  it("単発の割り勘を一覧に出し、結果画面へのリンクにする", async () => {
    renderHome();

    const link = await screen.findByRole("link", { name: /沖縄旅行/ });
    expect(link).toHaveAttribute("href", "/events/e1");
    expect(screen.getByRole("link", { name: /飲み会/ })).toHaveAttribute("href", "/events/e2");
  });

  it("単発の割り勘が無ければその旨を出す", async () => {
    renderHome({ events: [] });

    expect(await screen.findByText("まだありません。")).toBeInTheDocument();
  });

  it("確定後に記録が変わっていれば警告を出す", async () => {
    renderHome({ monthly: monthly(true) });

    expect(await screen.findByText("計算後に記録が変わっています。")).toBeInTheDocument();
  });

  it("記録が変わっていなければ警告を出さない", async () => {
    renderHome();

    expect(await screen.findByText("¥35,700")).toBeInTheDocument();
    expect(screen.queryByText("計算後に記録が変わっています。")).not.toBeInTheDocument();
  });
});
