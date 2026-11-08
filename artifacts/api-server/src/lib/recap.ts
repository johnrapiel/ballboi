// The match recap (spec decision 148, John, Nov 8): a shareable image made
// after a score is entered. The server sends the facts; the app draws the
// image in the Day look. Pure, so it's tested in __tests__/recap.test.ts.
//
// - Names: your side in full, the other side as first name and last initial
//   (the app shortens them). Doubles: team names in the same pattern.
// - The score as stored (player 1's side) and which side won, for the winner
//   mark. RET and W/O carry over.
// - The date, the court when there is one, and the league's name, or
//   "Discover" or "Quick match".
// - Your record for the season this match was in, after it ("5-2 this
//   season"), by This season's rules (decision 121).
// - Aces and winners join once those stats pass their accuracy bars (G1).
//   Until then they aren't sent.

import { contextFor } from "./career.js";

export interface RecapMatch {
  id: number;
  leagueId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  winnerId: number | null;
  status: string;
  score: string | null;
  completedAt: string | null;
  location: string | null;
  voidedAt: Date | null;
  generatedFrom: string | null;
}

export interface RecapInput {
  viewer: string;
  match: RecapMatch;
  /** Names as shown: a signed-up player's profile name, a placeholder's own. */
  players: Map<number, { name: string; clerkUserId: string | null }>;
  leagueName: string | null;
  /** A Discover match card's court, when the match row has none. */
  planCourt: string | null;
  season: { name: string; wins: number; losses: number } | null;
}

export type RecapResult =
  | { ok: true; recap: Recap }
  | { ok: false; status: 403 | 404 | 409; error: string };

export interface Recap {
  matchId: number;
  /** The side you're on. */
  you: 1 | 2;
  side1: string[];
  side2: string[];
  /** As stored, from side 1's side. */
  score: string;
  winner: 1 | 2 | null;
  playedAt: string | null;
  court: string | null;
  context: string;
  season: { name: string; wins: number; losses: number } | null;
}

const team = (m: RecapMatch, side: 1 | 2) =>
  (side === 1 ? [m.player1Id, m.player3Id] : [m.player2Id, m.player4Id]).filter((id): id is number => id != null);

export function buildRecap(input: RecapInput): RecapResult {
  const { match: m } = input;
  const owner = (id: number) => input.players.get(id)?.clerkUserId ?? null;
  const you: 1 | 2 | null = team(m, 1).some((id) => owner(id) === input.viewer) ? 1 : team(m, 2).some((id) => owner(id) === input.viewer) ? 2 : null;
  if (you == null) return { ok: false, status: 403, error: "Only the players in this match can share its recap." };
  if (m.voidedAt || m.status !== "completed" || !m.score) return { ok: false, status: 409, error: "This match has no score yet." };
  const winner: 1 | 2 | null = m.winnerId == null ? null : team(m, 1).includes(m.winnerId) ? 1 : team(m, 2).includes(m.winnerId) ? 2 : null;
  const names = (side: 1 | 2) => team(m, side).map((id) => input.players.get(id)?.name?.trim() || "Player");
  return {
    ok: true,
    recap: {
      matchId: m.id,
      you,
      side1: names(1),
      side2: names(2),
      score: m.score,
      winner,
      playedAt: m.completedAt,
      court: m.location?.trim() || input.planCourt?.trim() || null,
      context: contextFor(m, new Map(m.leagueId != null && input.leagueName ? [[m.leagueId, { name: input.leagueName }]] : [])),
      season: input.season,
    },
  };
}
