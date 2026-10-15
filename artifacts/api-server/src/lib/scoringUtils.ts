/**
 * Pure scoring helpers for ladder point calculation.
 *
 * Keeping this logic separate from route handlers makes it trivially
 * unit-testable without a database or HTTP server.
 *
 * Ladder scoring formula:
 *   points = gamesWon + setsWon × 3 + wins × 6
 *
 * Games are capped at 6 per set so that a 7-6 tiebreak set scores the same
 * as a 6-0 bagel — the extra game is noise, not dominance.
 */

export interface SetScore {
  myGames: number;
  oppGames: number;
}

export interface ScoreTotals {
  gamesWon: number;
  gamesLost: number;
  setsWon: number;
  setsLost: number;
}

/**
 * Parse a single set string such as "6-3", "7-6(4)", or "6-0" into the raw
 * game counts for each side (team-1 perspective).
 *
 * Returns `null` when the string cannot be parsed.
 */
export function parseSet(setStr: string): SetScore | null {
  const cleaned = setStr.trim().replace(/\(\d+\)/, "");
  const parts = cleaned.split("-");
  if (parts.length !== 2) return null;
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  if (isNaN(a) || isNaN(b)) return null;
  return { myGames: a, oppGames: b };
}

/**
 * Accumulate set/game totals for a player across a collection of score strings.
 *
 * @param scoreStrings  Score strings like `"6-3, 7-6(4)"`, one per match.
 * @param isTeam1Array  Whether the player was on team-1 for each match (parallel array).
 */
export function accumulateScoreTotals(
  scoreStrings: (string | null | undefined)[],
  isTeam1Array: boolean[],
): ScoreTotals {
  let gamesWon = 0, gamesLost = 0, setsWon = 0, setsLost = 0;

  for (let i = 0; i < scoreStrings.length; i++) {
    const score = scoreStrings[i];
    if (!score) continue;
    const isTeam1 = isTeam1Array[i];
    const sets = score.split(",").map((s) => s.trim());
    for (const setStr of sets) {
      const parsed = parseSet(setStr);
      if (!parsed) continue;
      const rawMyGames = isTeam1 ? parsed.myGames : parsed.oppGames;
      const rawOppGames = isTeam1 ? parsed.oppGames : parsed.myGames;
      // Cap at 6: a 7-6 tiebreak win shouldn't outscore a 6-0 bagel win
      gamesWon += Math.min(rawMyGames, 6);
      gamesLost += Math.min(rawOppGames, 6);
      if (rawMyGames > rawOppGames) setsWon++;
      else setsLost++;
    }
  }

  return { gamesWon, gamesLost, setsWon, setsLost };
}

/**
 * Calculate ladder points from accumulated score totals and match wins.
 *
 *   points = gamesWon + setsWon × 3 + wins × 6
 */
export function calculatePoints(totals: ScoreTotals, wins: number): number {
  return totals.gamesWon + totals.setsWon * 3 + wins * 6;
}
