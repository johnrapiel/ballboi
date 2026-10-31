// League standings (spec: Leagues > Scores and standings).
//
// - Standings rank on wins only (decision 23). Players with the same number of
//   wins share a rank.
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

  rows.sort((a, b) => b.wins - a.wins || a.playerName.localeCompare(b.playerName));

  // Same wins, same rank: 1, 2, 2, 4.
  return rows.map((row, i) => {
    const firstWithSameWins = rows.findIndex((r) => r.wins === row.wins);
    return { ...row, rank: (firstWithSameWins === -1 ? i : firstWithSameWins) + 1 };
  });
}
