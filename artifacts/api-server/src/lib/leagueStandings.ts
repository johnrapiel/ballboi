// League standings (spec: Leagues > Scores and standings).
//
// - Standings rank on wins (decision 23). Players level on wins are split by
//   head to head among them, then share of sets won, then share of games won
//   (John, Nov 6: the same order playoff seeds use). Only players level on all
//   of those share a rank.
// - Grace-week matches don't count (decision 25), and neither do voided
//   matches or playoff matches.
// - A player who drops out is removed from standings (decision 27).
//
// Pure functions, so they're easy to test.

import { accumulateScoreTotals, calculatePoints } from "./scoringUtils.js";

export interface StandingPlayer {
  id: number;
  name: string;
  leftAt: Date | null;
}

export interface StandingMatch {
  status: string;
  winnerId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  score: string | null;
  season: string | null;
  voidedAt: Date | null;
  inGrace: boolean;
  playoffBracketId: number | null;
}

export interface Standing {
  rank: number;
  playerId: number;
  playerName: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  winRate: number;
  /** Kept for older app builds; standings no longer rank on points. */
  points: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
}

/** Whether a completed match counts toward standings. */
export function countsForStandings(m: StandingMatch): boolean {
  return m.status === "completed" && m.winnerId !== null && !m.voidedAt && !m.inGrace && !m.playoffBracketId;
}

function onTeam1(m: StandingMatch, playerId: number): boolean {
  return m.player1Id === playerId || m.player3Id === playerId;
}

function plays(m: StandingMatch, playerId: number): boolean {
  return [m.player1Id, m.player2Id, m.player3Id, m.player4Id].includes(playerId);
}

/** Team 1 is player1 + player3; winnerId is the winning team's first player. */
function won(m: StandingMatch, playerId: number): boolean {
  return onTeam1(m, playerId) ? m.winnerId === m.player1Id : m.winnerId === m.player2Id;
}

export function computeStandings(
  players: StandingPlayer[],
  matches: StandingMatch[],
  includeSeason: (season: string | null) => boolean = () => true,
): Standing[] {
  const counted = matches.filter((m) => countsForStandings(m) && includeSeason(m.season));

  const rows = players
    .filter((p) => !p.leftAt)
    .map((p) => {
      const mine = counted.filter((m) => plays(m, p.id));
      const wins = mine.filter((m) => won(m, p.id)).length;
      const losses = mine.length - wins;
      const totals = accumulateScoreTotals(
        mine.map((m) => m.score),
        mine.map((m) => onTeam1(m, p.id)),
      );
      return {
        playerId: p.id,
        playerName: p.name,
        wins,
        losses,
        matchesPlayed: mine.length,
        winRate: mine.length ? wins / mine.length : 0,
        points: calculatePoints(totals, wins),
        ...totals,
      };
    });

  const ordered = rankOrder(rows, counted);

  // Level on everything that ranks, same rank: 1, 2, 2, 4.
  const key = (r: (typeof ordered)[number]) => tiebreakKey(r, ordered.h2h);
  return ordered.map((row, i) => {
    const first = ordered.findIndex((r) => key(r) === key(row));
    return { ...row, rank: (first === -1 ? i : first) + 1 };
  });
}

function share(won: number, lost: number): number {
  return won + lost > 0 ? won / (won + lost) : 0;
}

type Rankable = Pick<Standing, "playerId" | "playerName" | "wins" | "setsWon" | "setsLost" | "gamesWon" | "gamesLost">;

/** Head-to-head wins among players level on wins (singles meetings between two of them). */
export function headToHead(rows: Rankable[], counted: StandingMatch[]): Map<number, number> {
  const byWins = new Map<number, Rankable[]>();
  for (const r of rows) byWins.set(r.wins, [...(byWins.get(r.wins) ?? []), r]);
  const h2h = new Map<number, number>();
  for (const group of byWins.values()) {
    if (group.length < 2) continue;
    const ids = new Set(group.map((r) => r.playerId));
    for (const m of counted) {
      if (!ids.has(m.player1Id) || !ids.has(m.player2Id) || m.winnerId == null) continue;
      h2h.set(m.winnerId, (h2h.get(m.winnerId) ?? 0) + 1);
    }
  }
  return h2h;
}

function tiebreakKey(r: Rankable, h2h: Map<number, number>): string {
  return [r.wins, h2h.get(r.playerId) ?? 0, share(r.setsWon, r.setsLost), share(r.gamesWon, r.gamesLost)].join("|");
}

/**
 * Rows in rank order: wins, then head to head among players level on wins, then
 * share of sets won, then share of games won, then name for a stable list.
 * Standings and playoff seeds both use it.
 */
export function rankOrder<T extends Rankable>(rows: T[], counted: StandingMatch[]): T[] & { h2h: Map<number, number> } {
  const h2h = headToHead(rows, counted);
  const sorted = [...rows].sort(
    (a, b) =>
      b.wins - a.wins ||
      (h2h.get(b.playerId) ?? 0) - (h2h.get(a.playerId) ?? 0) ||
      share(b.setsWon, b.setsLost) - share(a.setsWon, a.setsLost) ||
      share(b.gamesWon, b.gamesLost) - share(a.gamesWon, a.gamesLost) ||
      a.playerName.localeCompare(b.playerName),
  );
  return Object.assign(sorted, { h2h });
}
