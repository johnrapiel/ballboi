import type { QueryClient } from "@tanstack/react-query";

import {
  getGetLeagueBracketQueryKey,
  getGetLeagueMembershipQueryKey,
  getGetLeagueQueryKey,
  getGetLeagueScheduleQueryKey,
  getGetLeagueStandingsQueryKey,
  getGetLeagueTeamsQueryKey,
  getGetMyPartnerQueryKey,
  getGetLeaguesQueryKey,
  getGetMyLeagueWeekQueryKey,
  getGetMyPlayersQueryKey,
} from "@workspace/api-client-react";

// C4, C23: after a score, edit, correction, join, leave or end, everything that
// shows that league goes stale together: its page, its rounds and bracket,
// standings, the Leagues tab and Home. One list, so no screen misses one.

/** The query keys to refresh after something changes in a league. */
export function leagueQueryKeys(leagueId: number | null | undefined): readonly unknown[][] {
  const everywhere = [getGetLeaguesQueryKey().slice(0, 1), [...getGetMyLeagueWeekQueryKey()], [...getGetMyPlayersQueryKey()]];
  if (leagueId == null || !Number.isFinite(leagueId)) return everywhere;
  return [
    [...getGetLeagueQueryKey(leagueId)],
    [...getGetLeagueMembershipQueryKey(leagueId)],
    [...getGetLeagueScheduleQueryKey(leagueId)],
    [...getGetLeagueBracketQueryKey(leagueId)],
    [...getGetLeagueStandingsQueryKey(leagueId)],
    // Doubles partners (D2, D9): the team-up card and Manage > Teams.
    [...getGetMyPartnerQueryKey(leagueId)],
    [...getGetLeagueTeamsQueryKey(leagueId)],
    ...everywhere,
  ];
}

/** Match detail queries (one per match), which show a league's scores too. */
export const isMatchDetailKey = (key: readonly unknown[]): boolean => typeof key[0] === "string" && key[0].startsWith("/api/me/matches/");

/** Refresh every screen that shows this league, Home and Match detail included. */
export function refreshLeague(queryClient: QueryClient, leagueId: number | null | undefined): Promise<void> {
  return Promise.all([
    ...leagueQueryKeys(leagueId).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    queryClient.invalidateQueries({ predicate: (q) => isMatchDetailKey(q.queryKey) }),
  ]).then(() => undefined);
}
