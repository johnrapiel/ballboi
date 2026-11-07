// Changing a league score after it's in (finding 7, John, Nov 6; C5).
//
// - Either player can edit the score for 24 hours after it's first entered.
//   The latest edit stands, the other player sees "Score edited by {name}",
//   and standings recompute. There's no countdown and no Undo.
// - After 24 hours it locks. Only a league admin's logged correction in Manage
//   can change it then. The match shows "Corrected by {admin} on {date}", and
//   a corrected score can't be edited by players again.
// - A playoff score moves the winner on, so an edit is allowed only while the
//   match it feeds is unplayed; the edited winner takes that spot.
// - A result the admin entered (a playoff past its play-by date, a walkover)
//   isn't the players' to edit.
// - Once a league ends, its scores are final: no edits and no corrections (Q9).
//   A league ends when an admin taps End, or on its own once the season and
//   any playoffs are done.
//
// Replaces "the first score stands" and the 10-minute Undo (Oct 31 review, C4).
// Pure functions, so they're easy to test.

export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export const FINAL_SCORES_MESSAGE = "This league has ended, so its scores are final.";
export const EDIT_LOCKED_MESSAGE = "It's been more than 24 hours, so this score is locked. Your league admin can correct it in Manage.";

/**
 * When the players' 24-hour edit runs out, as an ISO time, or null when the
 * score can't be edited. `players` are the Clerk ids of everyone in the match;
 * the caller and whoever entered the score must both be one of them.
 */
export function editDeadline(match: ChangeableMatch, userId: string | null, players: string[], now: Date): string | null {
  if (!userId || !players.includes(userId)) return null;
  if (match.status !== "completed" || !match.score || match.voidedAt || match.correctedAt) return null;
  if (!match.recordedAt || !match.recordedByClerkUserId || !players.includes(match.recordedByClerkUserId)) return null;
  const until = Date.parse(match.recordedAt) + EDIT_WINDOW_MS;
  if (isNaN(until) || until <= now.getTime()) return null;
  return new Date(until).toISOString();
}

export function checkEdit(
  match: ChangeableMatch,
  userId: string,
  players: string[],
  now: Date,
  opts: { leagueEnded?: boolean; next?: { status: string } | null } = {},
): ChangeCheck {
  if (opts.leagueEnded) return { ok: false, status: 409, error: FINAL_SCORES_MESSAGE };
  if (!players.includes(userId)) return { ok: false, status: 403, error: "Only the players in this match can edit its score." };
  if (match.voidedAt) return { ok: false, status: 409, error: "This match was cancelled when a player left the league." };
  if (match.status !== "completed" || !match.score) return { ok: false, status: 409, error: "There's no score to edit yet." };
  if (match.correctedAt) return { ok: false, status: 409, error: "Your league admin corrected this score, so it can't be edited." };
  if (!match.recordedByClerkUserId || !players.includes(match.recordedByClerkUserId)) {
    return { ok: false, status: 409, error: "Your league admin entered this result. They can correct it in Manage." };
  }
  if (match.playoffBracketId && opts.next?.status === "completed") {
    return { ok: false, status: 409, error: "The next playoff round has been played, so this score stands." };
  }
  if (!editDeadline(match, userId, players, now)) return { ok: false, status: 409, error: EDIT_LOCKED_MESSAGE };
  return { ok: true };
}

/**
 * `next` is the playoff match this one feeds: null when there isn't one yet
 * (or this is the final). Once that match is played, the score stands.
 */
export function checkCorrection(match: ChangeableMatch, next: { status: string } | null = null, leagueEnded = false): ChangeCheck {
  if (leagueEnded) return { ok: false, status: 409, error: FINAL_SCORES_MESSAGE };
  if (match.voidedAt) return { ok: false, status: 409, error: "This match was cancelled when a player left the league." };
  if (match.status !== "completed" || !match.score) {
    return { ok: false, status: 409, error: "Only played matches can be corrected." };
  }
  if (match.playoffBracketId && next?.status === "completed") {
    return { ok: false, status: 409, error: "The next playoff round has been played, so this score stands." };
  }
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
