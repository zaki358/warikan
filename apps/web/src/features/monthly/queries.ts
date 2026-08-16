import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiSend } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";
import type { Category, Expense, MonthlyDetail, MonthlyResult, Snapshot } from "../../lib/types.js";

export const useCategories = () =>
  useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => apiGet<Category[]>("/api/categories"),
    // マスタなので頻繁に変わらない
    staleTime: 5 * 60 * 1000,
  });

export const useMonthly = (ym: string) =>
  useQuery({
    queryKey: queryKeys.monthly(ym),
    queryFn: () => apiGet<MonthlyDetail>(`/api/monthly/${ym}`),
  });

export const useMonthlyResult = (ym: string) =>
  useQuery({
    queryKey: queryKeys.monthlyResult(ym),
    queryFn: () => apiGet<MonthlyResult>(`/api/monthly/${ym}/result`),
    // 未計算なら 404。エラーとして扱い、画面側で「まだ計算されていません」を出す。
    retry: false,
  });

export type ExpenseInput = {
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};

/**
 * 支出を変えると期間の is_dirty と精算結果の両方が変わる。
 * 楽観更新はせず、成功後に両方を invalidate する（設計書 §7.3）。
 *
 * `monthly(ym)` の invalidate は前方一致で `monthlyResult(ym)` も巻き込むため
 * 2本目は形式上は冗長だが、依存関係を明示するために残す。キーの構造が
 * 変わったときに片方だけ取り残されるのを防ぐ意味もある。
 */
function useExpenseMutation<TVariables>(
  ym: string,
  mutationFn: (variables: TVariables) => Promise<unknown>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.monthly(ym) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlyResult(ym) }),
      ]);
    },
  });
}

export const useAddExpense = (ym: string) =>
  useExpenseMutation(ym, (input: ExpenseInput) =>
    apiSend<Expense>("POST", `/api/monthly/${ym}/expenses`, input),
  );

export const useUpdateExpense = (ym: string) =>
  useExpenseMutation(ym, ({ id, ...patch }: ExpenseInput & { id: string }) =>
    apiSend<Expense>("PATCH", `/api/monthly/expenses/${id}`, patch),
  );

export const useDeleteExpense = (ym: string) =>
  useExpenseMutation(ym, (id: string) =>
    apiSend<{ id: string }>("DELETE", `/api/monthly/expenses/${id}`),
  );

export const useSettle = (ym: string) =>
  useExpenseMutation(ym, () => apiSend<Snapshot>("POST", `/api/monthly/${ym}/settle`));

/**
 * 送金の消し込みはスナップショット内の isPaid を変えるだけで、
 * 期間の status や is_dirty は動かない。精算結果だけを捨てる。
 */
export const useToggleTransfer = (ym: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ index, isPaid }: { index: number; isPaid: boolean }) =>
      apiSend<Snapshot>("PATCH", `/api/monthly/${ym}/result/transfers/${index}`, { isPaid }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.monthlyResult(ym) });
    },
  });
};
