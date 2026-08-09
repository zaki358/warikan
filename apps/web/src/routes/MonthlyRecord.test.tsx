import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonthlyRecord } from "./MonthlyRecord.js";

/**
 * 支払者の候補は「自分 + その月の支出に現れた人」ではなく
 * GET /api/users から作る。相手がまだ1件も記録していない月でも
 * 相手を選べ、表示名も本人の設定どおりになることを固定する。
 */
const envelope = (data: unknown) =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const routeFor = (path: string): unknown => {
  if (path === "/api/me") return { userId: "u1", email: "me@example.com", displayName: "わたし" };
  if (path === "/api/users") {
    return [
      { userId: "u1", displayName: "わたし" },
      { userId: "u2", displayName: "つれあい" },
    ];
  }
  if (path === "/api/categories") return [{ id: 1, name: "食費" }];
  if (path.startsWith("/api/monthly/")) {
    return {
      period: { ym: "2026-08", year: 2026, month: 8, status: "open", isDirty: false, settledAt: null },
      // 支出は自分の分だけ。それでも相手が候補に出ることを見る。
      expenses: [
        { id: "e1", paidBy: "u1", amount: 3000, itemName: "牛乳", categoryId: 1, spentOn: "2026-08-03" },
      ],
    };
  }
  throw new Error(`予期しないパス: ${path}`);
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => envelope(routeFor(String(input)))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const setup = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/monthly/2026-08"]}>
        <Routes>
          <Route path="/monthly/:ym" element={<MonthlyRecord />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("MonthlyRecord の支払者候補", () => {
  it("支出が無い相手も候補に出す", async () => {
    setup();

    expect(await screen.findByRole("radio", { name: "わたし" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: "つれあい" })).toBeInTheDocument();
  });

  it("固定文言の「パートナー」を出さない", async () => {
    setup();

    await screen.findByRole("radio", { name: "つれあい" });
    expect(screen.queryByText("パートナー")).not.toBeInTheDocument();
  });

  it("支出一覧の支払者名も API の表示名で出す", async () => {
    setup();

    // 支払者トグルにも同じ表示名「わたし」が出るため、支出一覧の行
    // （カテゴリ名と並ぶ「わたし ・ 食費」）に絞って一意に照合する。
    expect(await screen.findByText(/わたし\s*・\s*食費/)).toBeInTheDocument();
  });
});
