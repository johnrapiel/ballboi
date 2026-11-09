// League standings (spec: Leagues > Scores and standings).
//
// - Standings rank on wins (decision 23). Players level on wins are split by
//   head to head among them, then share of sets won, then share of games won
//   (John, Nov 6: the same order playoff seeds use). Only players level on all
//   of those share a rank.
// - Grace-week matches don't count (decision 25), and neither do voided
//   matches or playoff matches.
// - A player who drops out is removed from standings (decision 27).
// - Doubles (D3, John, Nov 9): rotating-partner leagues rank players, both
//   partners credited with the result; fixed-partner leagues rank teams
//   ("John Rapiel & Sam Lee, 5-2"). Ties use the same order: head to head,
//   then sets won, then games won.
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
  /** Fixed-partner doubles: the team on each side (D3). */
  team1Id?: number | null;
  team2Id?: number | null;
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
  /** Fixed-partner doubles (D3): this row is a team. playerId is its first player; playerName is the team's name. */
  teamId?: number | null;
  /** Fixed-partner doubles: both players on the team, first player first. */
  teamPlayerIds?: number[] | null;
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

/** The ranked rows on each side of a match: players by default, or teams for fixed-partner doubles. */
export type SidesOf = (m: StandingMatch) => [number[], number[]];

const playerSides: SidesOf = (m) => [
  [m.player1Id, m.player3Id].filter((id): id is number => id != null),
  [m.player2Id, m.player4Id].filter((id): id is number => id != null),
];

const teamSides: SidesOf = (m) => [
  m.team1Id != null ? [m.team1Id] : [],
  m.team2Id != null ? [m.team2Id] : [],
];

function winningSide(m: StandingMatch): 1 | 2 | null {
  if (m.winnerId == null) return null;
  return m.winnerId === m.player1Id || m.winnerId === m.player3Id ? 1 : 2;
}

/**
 * Head-to-head wins among rows level on wins: each win in a match where one
 * of them was on the winning side and another on the losing side. In singles
 * that's their meetings; in rotating doubles a match counts for each tied
 * winner who beat a tied player (D3).
 */
export function headToHead(rows: Rankable[], counted: StandingMatch[], sides: SidesOf = playerSides): Map<number, number> {
  const byWins = new Map<number, Rankable[]>();
  for (const r of rows) byWins.set(r.wins, [...(byWins.get(r.wins) ?? []), r]);
  const h2h = new Map<number, number>();
  for (const group of byWins.values()) {
    if (group.length < 2) continue;
    const ids = new Set(group.map((r) => r.playerId));
    for (const m of counted) {
      const side = winningSide(m);
      if (side == null) continue;
      const [one, two] = sides(m);
      const [winners, losers] = side === 1 ? [one, two] : [two, one];
      const tiedWinners = winners.filter((id) => ids.has(id));
      if (!tiedWinners.length || !losers.some((id) => ids.has(id))) continue;
      for (const id of tiedWinners) h2h.set(id, (h2h.get(id) ?? 0) + 1);
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
export function rankOrder<T extends Rankable>(
  rows: T[],
  counted: StandingMatch[],
  sides: SidesOf = playerSides,
): T[] & { h2h: Map<number, number> } {
  const h2h = headToHead(rows, counted, sides);
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

export interface StandingTeam {
  id: number;
  playerIds: [number, number];
}

/** "John Rapiel & Sam Lee" (D3). */
export function teamStandingName(names: string[]): string {
  return names.join(" & ");
}

/**
 * Fixed-partner doubles standings (D3): one row per active team. A team that
 * was split, or lost a partner who left, is out of the standings, the way a
 * player who drops out is (decision 27); a re-teamed player's new team starts
 * at 0-0 (D4). Each row's playerId is the team's first player.
 */
export function computeTeamStandings(
  teams: StandingTeam[],
  names: Map<number, string>,
  matches: StandingMatch[],
  includeSeason: (season: string | null) => boolean = () => true,
): Standing[] {
  const counted = matches.filter((m) => countsForStandings(m) && includeSeason(m.season) && m.team1Id != null && m.team2Id != null);
  const rows = teams.map((t) => {
    const mine = counted.filter((m) => m.team1Id === t.id || m.team2Id === t.id);
    const onSide1 = mine.map((m) => m.team1Id === t.id);
    const wins = mine.filter((m, i) => winningSide(m) === (onSide1[i] ? 1 : 2)).length;
    const totals = accumulateScoreTotals(mine.map((m) => m.score), onSide1);
    return {
      // Rank by team: the team id stands in as the row key, swapped back below.
      playerId: t.id,
      playerName: teamStandingName(t.playerIds.map((id) => names.get(id) ?? "Player")),
      wins,
      losses: mine.length - wins,
      matchesPlayed: mine.length,
      winRate: mine.length ? wins / mine.length : 0,
      points: calculatePoints(totals, wins),
      ...totals,
      teamId: t.id,
      teamPlayerIds: [...t.playerIds],
    };
  });
  const ordered = rankOrder(rows, counted, teamSides);
  const key = (r: (typeof ordered)[number]) => tiebreakKey(r, ordered.h2h);
  return ordered.map((row, i) => {
    const first = ordered.findIndex((r) => key(r) === key(row));
    return { ...row, playerId: row.teamPlayerIds[0], rank: (first === -1 ? i : first) + 1 };
  });
}
