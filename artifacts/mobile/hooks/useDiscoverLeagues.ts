// Open leagues in Discover: the list, one league's page, and asking for a
// spot or a waitlist place through the existing league join requests.

import { useAuth } from "@clerk/expo";
import { getGetMyJoinRequestsQueryKey } from "@workspace/api-client-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { discoverKeys } from "@/hooks/useDiscover";
import { apiErrorMessage, apiFetch } from "@/lib/api";
import { askForNotifications } from "@/lib/notifications";
import { leaguesPath, type DiscoverLeague, type DiscoverLeagues } from "@/lib/discover";

export const leagueKeys = {
  list: (radius: number) => ["discover", "leagues", radius] as const,
  one: (leagueId: number) => ["discover", "league", leagueId] as const,
};

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
  return (await res.json()) as T;
}

export function useDiscoverLeagues(radius: number, enabled = true) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: leagueKeys.list(radius),
    queryFn: async () => json<DiscoverLeagues>(await apiFetch(leaguesPath(radius), getToken), "Can't load Open leagues right now."),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDiscoverLeague(leagueId: number) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: leagueKeys.one(leagueId),
    queryFn: async () =>
      json<DiscoverLeague>(await apiFetch(`/api/discover/leagues/${leagueId}`, getToken), "Can't load this league right now."),
    enabled: Number.isInteger(leagueId) && leagueId > 0,
    retry: (count, e) => count < 2 && !/isn't open/.test((e as Error).message),
  });
}

/** Ask for a spot (before the season) or a waitlist place (started or full). The server decides which. */
export function useAskToJoin(leagueId: number) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note: string | null) =>
      json<{ kind: "request" | "waitlist"; message?: string }>(
        await apiFetch(`/api/leagues/${leagueId}/join-requests`, getToken, {
          method: "POST",
          body: JSON.stringify({ playerName: "", note }),
        }),
        "Couldn't send your request. Try again.",
      ),
    // Asking to join a league: the notifications prompt, the first time (decision 125).
    onSuccess: () => void askForNotifications("joinedLeague"),
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: discoverKeys.all }),
        qc.invalidateQueries({ queryKey: getGetMyJoinRequestsQueryKey() }),
      ]);
    },
  });
}

/** Cancel a request, or leave the waitlist. */
export function useWithdraw(leagueId: number) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/leagues/${leagueId}/join-requests/me`, getToken, { method: "DELETE" });
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't do that. Try again."));
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: discoverKeys.all }),
        qc.invalidateQueries({ queryKey: getGetMyJoinRequestsQueryKey() }),
      ]);
    },
  });
}
