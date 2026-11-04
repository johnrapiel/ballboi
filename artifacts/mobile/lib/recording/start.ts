// The one way into the recorder, so every entry point (Ball Boi tab, match
// cards, Quick match) goes through the same checks.
//
// Used by the Ball Boi tab's "Record a match" and Home's singles match cards
// ("Record with Ball Boi", PR 4).

import type { useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;

export interface RecorderTarget {
  matchId: number;
  opponentName: string;
  /** The match's league, so the score prompt posts to it. Null for a Quick match. */
  leagueId: number | null;
}

export function openRecorder(router: Router, target: RecorderTarget) {
  router.push({
    pathname: "/record/[matchId]",
    params: {
      matchId: String(target.matchId),
      opponent: target.opponentName,
      ...(target.leagueId != null ? { league: String(target.leagueId) } : {}),
    },
  });
}
