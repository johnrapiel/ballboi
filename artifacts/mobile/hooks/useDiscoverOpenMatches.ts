// Open matches in Discover (F6): the list, one post, posting, joining and
// the rest, and the group chat once a match fills.

import { useAuth } from "@clerk/expo";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { discoverKeys } from "@/hooks/useDiscover";
import { apiErrorMessage, apiFetch } from "@/lib/api";
import { askForNotifications } from "@/lib/notifications";
import { openMatchesPath, type GroupMessage, type OpenMatchDetail, type OpenMatchList } from "@/lib/discover";

export const openMatchKeys = {
  all: ["discover", "open-matches"] as const,
  list: (radius: number) => ["discover", "open-matches", "list", radius] as const,
  one: (id: number) => ["discover", "open-matches", "one", id] as const,
  chat: (id: number) => ["discover", "open-matches", "chat", id] as const,
  mine: ["discover", "open-matches", "mine"] as const,
};

/** An API error with its code, so "This spot just filled" can be told apart. */
export class OpenMatchError extends Error {
  constructor(
    message: string,
    public code: string | null,
  ) {
    super(message);
  }
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    let code: string | null = null;
    try {
      code = ((await res.clone().json()) as { code?: string }).code ?? null;
    } catch {
      code = null;
    }
    throw new OpenMatchError(await apiErrorMessage(res, fallback), code);
  }
  return (await res.json()) as T;
}

export function useOpenMatches(radius: number, enabled = true) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: openMatchKeys.list(radius),
    queryFn: async () => json<OpenMatchList>(await apiFetch(openMatchesPath(radius), getToken), "Can't load open matches right now."),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useOpenMatch(id: number) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: openMatchKeys.one(id),
    queryFn: async () => json<OpenMatchDetail>(await apiFetch(`/api/open-matches/${id}`, getToken), "Can't load this match right now."),
    enabled: Number.isInteger(id) && id > 0,
    retry: (count, e) => count < 2 && !/isn't open/.test((e as Error).message),
  });
}

export function useMyOpenMatches() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: openMatchKeys.mine,
    queryFn: async () =>
      json<{
        matches: {
          id: number;
          when: string;
          format: string;
          courtName: string | null;
          status: string;
          spotsLeft: number;
          total: number;
          chatTitle: string;
        }[];
      }>(await apiFetch("/api/open-matches/mine", getToken), "Can't load your matches."),
  });
}

export function usePostOpenMatch() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      startsAt: string;
      endsAt: string;
      timeZone: string;
      format: "singles" | "doubles";
      spots: number;
      level: "close" | "wider" | "any";
      courtId: number | null;
      note: string | null;
    }) =>
      json<OpenMatchDetail>(
        await apiFetch("/api/open-matches", getToken, { method: "POST", body: JSON.stringify(input) }),
        "Couldn't post your match.",
      ),
    onSuccess: async () => {
      // Posting an open match: the notifications prompt, the first time (decision 125).
      void askForNotifications("openMatch");
      await qc.invalidateQueries({ queryKey: openMatchKeys.all });
    },
  });
}

export function useOpenMatchAction(id: number) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, userId }: { action: "join" | "drop" | "remove" | "cancel"; userId?: number }) =>
      json<OpenMatchDetail | { canceled: true }>(
        await apiFetch(`/api/open-matches/${id}/${action}`, getToken, { method: "POST", body: JSON.stringify(userId ? { userId } : {}) }),
        "Couldn't do that. Try again.",
      ),
    // Joining an open match: the notifications prompt, the first time (decision 125).
    onSuccess: (_result, { action }) => {
      if (action === "join") void askForNotifications("openMatch");
    },
    onSettled: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: openMatchKeys.all }), qc.invalidateQueries({ queryKey: discoverKeys.me })]);
    },
  });
}

/** The group chat: refreshed every 5 seconds while open. */
export function useGroupChat(id: number) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: openMatchKeys.chat(id),
    queryFn: async () =>
      json<{ open: boolean; messages: GroupMessage[] }>(
        await apiFetch(`/api/open-matches/${id}/messages`, getToken),
        "Can't load the group chat.",
      ),
    refetchInterval: 5_000,
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useSendGroupMessage(id: number) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      // Sending is the "messages" action on the post.
      const action = "messages";
      return json<GroupMessage>(
        await apiFetch(`/api/open-matches/${id}/${action}`, getToken, { method: "POST", body: JSON.stringify({ text }) }),
        "Not sent. Try again.",
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: openMatchKeys.chat(id) });
    },
  });
}
