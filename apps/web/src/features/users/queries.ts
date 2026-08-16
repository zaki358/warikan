import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiSend } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";
import type { Me, UserSummary } from "../../lib/types.js";

export const useMe = () =>
  useQuery({ queryKey: queryKeys.me(), queryFn: () => apiGet<Me>("/api/me") });

/** 登録済みユーザー。2人しか居らず、増えることも稀なので長めに寝かせる。 */
export const useUsers = () =>
  useQuery({
    queryKey: queryKeys.users(),
    queryFn: () => apiGet<UserSummary[]>("/api/users"),
    staleTime: 5 * 60 * 1000,
  });

/**
 * 表示名の変更。自分・相手のどちらの id も渡せる（設定画面から一括で
 * 直せるようにするための決定。API 側も権限を分けていない）。
 *
 * 自分を改名すると /api/me も古くなるため、users と me の両方を invalidate する。
 * 月次のキーは触らない — 精算画面の名前は表示時に users から解決するので、
 * ここで無効化する必要が無い。楽観更新はしない。
 */
export const useRenameUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, displayName }: { userId: string; displayName: string }) =>
      apiSend<UserSummary>("PATCH", `/api/users/${userId}`, { displayName }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me() }),
      ]);
    },
  });
};
