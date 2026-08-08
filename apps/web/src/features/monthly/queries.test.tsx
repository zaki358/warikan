import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "../../lib/queryKeys.js";
import { useAddExpense, useSettle, useToggleTransfer } from "./queries.js";

/**
 * ここで固定したいのは「どのキャッシュを捨てるか」だけ。
 * invalidate の対象を取り違えると、支出や精算をしたのに古い金額が
 * 表示されたままになる。画面を見ても気づきにくく、E2E でも検知が遅れる。
 */

const YM = "2026-08";

const createClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

const jsonResponse = (data: unknown) =>
  ({ status: 200, json: async () => ({ ok: true, data }) }) as unknown as Response;

/**
 * fetch のシグネチャ付きで宣言する。引数ゼロで宣言すると mock.calls[0] が
 * 空タプルになり、要素を取り出す箇所が TS2493 で落ちる。
 */
const stubFetch = (data: unknown) => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    jsonResponse(data),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/** invalidate されたキーを、呼ばれた順に取り出す。 */
const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("月次ミューテーションの invalidate 対象", () => {
  it("支出を追加すると、記録と精算結果の両方を捨てる", async () => {
    const queryClient = createClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    stubFetch({ id: "expense-1" });

    const { result } = renderHook(() => useAddExpense(YM), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        paidBy: "user-1",
        amount: 1200,
        itemName: "牛乳",
        categoryId: null,
        spentOn: "2026-08-03",
      });
    });

    expect(invalidatedKeys(spy)).toEqual(
      expect.arrayContaining([queryKeys.monthly(YM), queryKeys.monthlyResult(YM)]),
    );
  });

  it("精算すると、記録と精算結果の両方を捨てる（期間の status と isDirty も変わるため）", async () => {
    const queryClient = createClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    stubFetch({ total: 0, perPerson: 0, byUser: [], byCategory: [], transfers: [], settledAt: "" });

    const { result } = renderHook(() => useSettle(YM), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(undefined);
    });

    expect(invalidatedKeys(spy)).toEqual(
      expect.arrayContaining([queryKeys.monthly(YM), queryKeys.monthlyResult(YM)]),
    );
  });

  it("送金の消し込みは精算結果だけを捨てる（期間の状態は変わらないため）", async () => {
    const queryClient = createClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    stubFetch({ total: 0, perPerson: 0, byUser: [], byCategory: [], transfers: [], settledAt: "" });

    const { result } = renderHook(() => useToggleTransfer(YM), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ index: 0, isPaid: true });
    });

    expect(invalidatedKeys(spy)).toEqual([queryKeys.monthlyResult(YM)]);
  });
});

describe("キーの前方一致", () => {
  it("monthly の invalidate は monthlyResult も巻き込む", async () => {
    const queryClient = createClient();
    queryClient.setQueryData(queryKeys.monthly(YM), { period: null, expenses: [] });
    queryClient.setQueryData(queryKeys.monthlyResult(YM), { snapshot: null, isDirty: false });

    await queryClient.invalidateQueries({ queryKey: queryKeys.monthly(YM) });

    expect(queryClient.getQueryState(queryKeys.monthly(YM))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.monthlyResult(YM))?.isInvalidated).toBe(true);
  });

  it("monthlyResult の invalidate は monthly を巻き込まない", async () => {
    const queryClient = createClient();
    queryClient.setQueryData(queryKeys.monthly(YM), { period: null, expenses: [] });
    queryClient.setQueryData(queryKeys.monthlyResult(YM), { snapshot: null, isDirty: false });

    await queryClient.invalidateQueries({ queryKey: queryKeys.monthlyResult(YM) });

    expect(queryClient.getQueryState(queryKeys.monthlyResult(YM))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.monthly(YM))?.isInvalidated).toBe(false);
  });
});
