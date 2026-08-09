import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiSend } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";
import type { CreateEventPayload, EventDetail, EventSummary } from "../../lib/types.js";

export const useEvents = () =>
  useQuery({ queryKey: queryKeys.events(), queryFn: () => apiGet<EventSummary[]>("/api/events") });

export const useEvent = (id: string) =>
  useQuery({
    queryKey: queryKeys.event(id),
    queryFn: () => apiGet<EventDetail>(`/api/events/${id}`),
    // 消したイベントや知らない id は 404。再試行せず画面側で出し分ける。
    retry: false,
  });

export const useCreateEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateEventPayload) =>
      apiSend<EventDetail>("POST", "/api/events", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events() });
    },
  });
};

export const useDeleteEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiSend<{ id: string }>("DELETE", `/api/events/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events() });
    },
  });
};

export const useToggleSettlement = (eventId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ settlementId, isPaid }: { settlementId: string; isPaid: boolean }) =>
      apiSend<EventDetail>("PATCH", `/api/events/${eventId}/settlements/${settlementId}`, {
        isPaid,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) });
    },
  });
};
