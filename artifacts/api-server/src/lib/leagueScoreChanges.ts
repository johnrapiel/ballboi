// Changing a league score after it's in (Oct 31 review, C4 and C5).
//
// - The player who entered a score can undo it for 10 minutes. Undo clears
//   the score; standings recompute. After that, the first score stands.
// - A league admin can correct any completed match from Manage. The match
//   shows "Corrected by {admin} on {date}". Players still can't dispute or edit.
// - Playoff scores move the winner on to the next round, so neither applies
//   to them yet.
//
// Pure functions, so they're easy to test.

export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface ChangeableMatch {
  status: string;
  score: string | null;
  winnerId: number | null;
  voidedAt: Date | null;
  playoffBracketId: number | null;
  recordedAt: string | null;
  recordedByClerkUserId: string | null;
  correctedAt: Date | null;
}

export type ChangeCheck = { ok: true } | { ok: false; status: number; error: string };

/** When the caller's undo runs out, as an ISO time, or null if they can't undo. */
export function undoDeadline(match: ChangeableMatch, userId: string | null, now: Date): string | null {
  if (!userId || match.status !== "completed" || match.voidedAt || match.playoffBracketId || match.correctedAt) return null;
  if (match.recordedByClerkUserId !== userId || !match.recordedAt) return null;
  const until = Date.parse(match.recordedAt) + UNDO_WINDOW_MS;
  if (isNaN(until) || until <= now.getTime()) return null;
  return new Date(until).toISOString();
}

export function checkUndo(match: ChangeableMatch, userId: string, now: Date): ChangeCheck {
  if (match.status !== "completed" || !match.score) return { ok: false, status: 409, error: "There's no score to undo." };
  if (match.playoffBracketId) return { ok: false, status: 409, error: "Playoff scores can't be undone." };
  if (match.correctedAt) return { ok: false, status: 409, error: "An admin corrected this score, so it can't be undone." };
  if (match.recordedByClerkUserId !== userId) {
    return { ok: false, status: 403, error: "Only the player who entered this score can undo it." };
  }
  if (!undoDeadline(match, userId, now)) {
    return { ok: false, status: 409, error: "It's been more than 10 minutes, so this score stands." };
  }
  return { ok: true };
}

export function checkCorrection(match: ChangeableMatch): ChangeCheck {
  if (match.voidedAt) return { ok: false, status: 409, error: "This match was cancelled when a player left the league." };
  if (match.status !== "completed" || !match.score) {
    return { ok: false, status: 409, error: "Only played matches can be corrected." };
  }
  if (match.playoffBracketId) return { ok: false, status: 409, error: "Playoff scores can't be corrected yet." };
  return { ok: true };
}

/**
 * How each player's league record (wins and losses on the player row) moves
 * when a counted result changes. `before` and `after` are the winning sides
 * (1 or 2), or null for no result.
 */
export function recordChanges(
  team1: number[],
  team2: number[],
  before: 1 | 2 | null,
  after: 1 | 2 | null,
): { playerId: number; wins: number; losses: number }[] {
  if (before === after) return [];
  const delta = new Map<number, { wins: number; losses: number }>();
  const add = (ids: number[], wins: number, losses: number) =>
    ids.forEach((id) => {
      const d = delta.get(id) ?? { wins: 0, losses: 0 };
      delta.set(id, { wins: d.wins + wins, losses: d.losses + losses });
    });
  const apply = (side: 1 | 2 | null, sign: 1 | -1) => {
    if (!side) return;
    const [winners, losers] = side === 1 ? [team1, team2] : [team2, team1];
    add(winners, sign, 0);
    add(losers, 0, sign);
  };
  apply(before, -1);
  apply(after, 1);
  return [...delta.entries()].map(([playerId, d]) => ({ playerId, ...d }));
}
