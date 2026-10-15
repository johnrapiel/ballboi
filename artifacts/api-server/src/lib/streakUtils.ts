/**
 * Pure streak-calculation helpers for the player stats endpoint.
 *
 * Keeping this logic separate from the route handler makes it trivially
 * unit-testable without a database or an HTTP server.
 */

export interface MatchResult {
  winnerId: number | null;
}

export interface StreakResult {
  /** Positive = win streak length, negative = loss streak length, 0 = no decided matches */
  currentStreak: number;
  /** Length of the longest consecutive win streak (0 when the player has no wins) */
  longestWinStreak: number;
}

/**
 * Compute the current streak and the longest win streak for a player.
 *
 * @param decidedMatches  Matches with a declared winner, ordered **newest first**.
 * @param playerId        The player whose perspective is used.
 */
export function calculateStreaks(
  decidedMatches: MatchResult[],
  playerId: number,
): StreakResult {
  let currentStreak = 0;
  let longestWinStreak = 0;

  if (decidedMatches.length === 0) {
    return { currentStreak, longestWinStreak };
  }

  const mostRecentIsWin = decidedMatches[0].winnerId === playerId;
  let streakCount = 0;
  for (const m of decidedMatches) {
    const isWin = m.winnerId === playerId;
    if (isWin !== mostRecentIsWin) break;
    streakCount++;
  }
  currentStreak = mostRecentIsWin ? streakCount : -streakCount;

  let tempWinStreak = 0;
  for (const m of decidedMatches) {
    if (m.winnerId === playerId) {
      tempWinStreak++;
      longestWinStreak = Math.max(longestWinStreak, tempWinStreak);
    } else {
      tempWinStreak = 0;
    }
  }

  return { currentStreak, longestWinStreak };
}
