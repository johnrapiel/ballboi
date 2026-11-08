// What counts as a real tennis score (Wave 1 review C10, decision Q6).
// A copy of artifacts/api-server/src/lib/tennisScore.ts: keep the two the same.
// The score sheets check with it before Save, and the API checks again.
//
// - A match is best of three sets.
// - A set ends 6-0 to 6-4, 7-5, or 7-6 (with the tiebreak loser's points in
//   parentheses, like 7-6(4)).
// - A third set at one set all can be a match tiebreak instead: first to 10,
//   win by 2 (10-7, 12-10).
// - Once someone has won two sets the match is over, so there's no third set.
// - "Opponent retired": the sets so far, where the last one can be unfinished.
//   It counts as a win for the player who entered it, and shows as RET.
// - A walkover (W/O) has no sets at all; the score string is just "W/O".
// - A Quick match is however many sets the players played, one to five
//   (`quick`). Each set is still a real set, and the last one can be a match
//   tiebreak. The winner has more sets; with sets level, more games (a match
//   tiebreak counts as one game). Level on both is refused: there's no winner.

export const RETIRED_SUFFIX = " RET";
export const WALKOVER_SCORE = "W/O";

const SET_HINT = "A set ends 6-0 to 6-4, 7-5 or 7-6.";
const DECIDER_HINT = "A third set can also be a match tiebreak, like 10-7.";

export interface ParsedSet {
  a: number;
  b: number;
  /** The tiebreak loser's points in a 7-6 set, when given. */
  tiebreak: number | null;
}

/** "7-6(4)" to { a: 7, b: 6, tiebreak: 4 }, or null when it isn't written like a set. */
export function readSet(text: string): ParsedSet | null {
  const m = text.trim().match(/^(\d{1,2})-(\d{1,2})(?:\((\d{1,2})\))?$/);
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]), tiebreak: m[3] != null ? Number(m[3]) : null };
}

/** A finished regular set: 6-0 to 6-4, 7-5 or 7-6. */
export function isCompleteSet(s: Pick<ParsedSet, "a" | "b">): boolean {
  const hi = Math.max(s.a, s.b);
  const lo = Math.min(s.a, s.b);
  return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6));
}

/** A finished match tiebreak: first to 10, win by 2. */
export function isMatchTiebreak(s: Pick<ParsedSet, "a" | "b">): boolean {
  const hi = Math.max(s.a, s.b);
  const lo = Math.min(s.a, s.b);
  return hi >= 10 && hi - lo >= 2 && (hi === 10 || hi - lo === 2);
}

/** A set that was still being played: nobody has won it yet. */
function isUnfinishedSet(s: Pick<ParsedSet, "a" | "b">, decider: boolean): boolean {
  if (isCompleteSet(s) || (decider && isMatchTiebreak(s))) return false;
  const hi = Math.max(s.a, s.b);
  const lo = Math.min(s.a, s.b);
  // Games in a set in progress (6-5 and 6-6 are fine; 7-3 isn't).
  if (hi <= 6) return true;
  // A match tiebreak in progress, like 8-6 or 10-9.
  return decider && (hi < 10 || hi - lo <= 1);
}

export type TennisScoreCheck =
  | { ok: true; sets: string[]; winnerSide: 1 | 2 }
  | { ok: false; error: string };

/**
 * Checks a score written from one side ("6-3, 4-6, 10-7"). With `retired`,
 * the opponent stopped mid-match: the sets so far, and the player who entered
 * it (side 1) wins. Returns the tidied sets and the winning side.
 */
export function checkTennisScore(raw: string, opts: { retired?: boolean; quick?: boolean } = {}): TennisScoreCheck {
  if (opts.quick) return checkQuickScore(raw);
  const retired = !!opts.retired;
  const parts = raw
    .replace(/\s*RET\s*$/i, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, error: retired ? "Enter the games played before your opponent retired." : "Enter the score for each set, like 6-4." };
  }
  if (parts.length > 3) return { ok: false, error: "A match is best of three sets." };

  let side1 = 0;
  let side2 = 0;
  let games = 0;
  const sets: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const set = readSet(parts[i]);
    if (!set) return { ok: false, error: `"${parts[i]}" isn't a set score. Use a format like 6-4.` };
    if (side1 === 2 || side2 === 2) {
      return { ok: false, error: "The match was over after two sets, so there's no third set." };
    }
    games += set.a + set.b;
    const decider = i === 2 && side1 === 1 && side2 === 1;
    const last = i === parts.length - 1;
    const label = `Set ${i + 1}`;
    if (set.tiebreak != null && !(isCompleteSet(set) && Math.max(set.a, set.b) === 7 && Math.min(set.a, set.b) === 6)) {
      return { ok: false, error: `${label}: only a 7-6 set has a tiebreak score.` };
    }
    const complete = isCompleteSet(set) || (decider && isMatchTiebreak(set));
    if (!complete) {
      if (retired && last && isUnfinishedSet(set, decider)) {
        sets.push(`${set.a}-${set.b}`);
        continue;
      }
      if (set.a === set.b) return { ok: false, error: `${label} is tied at ${set.a}-${set.b}. Every set needs a winner.` };
      return { ok: false, error: `${set.a}-${set.b} isn't a valid set. ${SET_HINT}${i === 2 ? ` ${DECIDER_HINT}` : ""}` };
    }
    if (set.a > set.b) side1++;
    else side2++;
    sets.push(`${set.a}-${set.b}${set.tiebreak != null ? `(${set.tiebreak})` : ""}`);
  }

  if (retired) {
    if (side1 === 2 || side2 === 2) {
      return { ok: false, error: "That match was finished. Turn off Opponent retired to save it." };
    }
    if (games === 0) return { ok: false, error: "Enter the games played before your opponent retired." };
    return { ok: true, sets, winnerSide: 1 };
  }
  if (side1 === 1 && side2 === 1) {
    return { ok: false, error: "The sets are tied. Add the third set, or a match tiebreak like 10-7." };
  }
  if (side1 < 2 && side2 < 2) return { ok: false, error: "Enter the second set. A match is best of three sets." };
  return { ok: true, sets, winnerSide: side1 > side2 ? 1 : 2 };
}

export const QUICK_MAX_SETS = 5;

/**
 * A Quick match score: any number of real sets from one to five, no
 * best-of-three rules. Empty parts are skipped. Side 1 is the player
 * entering it.
 */
function checkQuickScore(raw: string): TennisScoreCheck {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "Enter the score for each set, like 6-4." };
  if (parts.length > QUICK_MAX_SETS) return { ok: false, error: `A Quick match can have up to ${QUICK_MAX_SETS} sets.` };
  let sets1 = 0;
  let sets2 = 0;
  let games1 = 0;
  let games2 = 0;
  const sets: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const set = readSet(parts[i]);
    if (!set) return { ok: false, error: `"${parts[i]}" isn't a set score. Use a format like 6-4.` };
    const label = `Set ${i + 1}`;
    const last = i === parts.length - 1;
    const tiebreakDecider = last && i > 0 && !isCompleteSet(set) && isMatchTiebreak(set);
    if (set.tiebreak != null && !(isCompleteSet(set) && Math.max(set.a, set.b) === 7 && Math.min(set.a, set.b) === 6)) {
      return { ok: false, error: `${label}: only a 7-6 set has a tiebreak score.` };
    }
    if (!isCompleteSet(set) && !tiebreakDecider) {
      if (set.a === set.b) return { ok: false, error: `${label} is tied at ${set.a}-${set.b}. Every set needs a winner.` };
      return { ok: false, error: `${set.a}-${set.b} isn't a valid set. ${SET_HINT}${i > 0 ? " The last set can also be a match tiebreak, like 10-7." : ""}` };
    }
    if (set.a > set.b) sets1++;
    else sets2++;
    // A match tiebreak counts as one game to its winner.
    if (tiebreakDecider) {
      if (set.a > set.b) games1++;
      else games2++;
    } else {
      games1 += set.a;
      games2 += set.b;
    }
    sets.push(`${set.a}-${set.b}${set.tiebreak != null ? `(${set.tiebreak})` : ""}`);
  }
  if (sets1 !== sets2) return { ok: true, sets, winnerSide: sets1 > sets2 ? 1 : 2 };
  if (games1 !== games2) return { ok: true, sets, winnerSide: games1 > games2 ? 1 : 2 };
  return { ok: false, error: "The sets and games are level, so there's no winner. Add the set or tiebreak that decided it." };
}

/** True for a stored score that ended in a retirement, like "6-3, 2-1 RET". */
export function isRetiredScore(score: string | null | undefined): boolean {
  return !!score && /\sRET$/.test(score.trim());
}

/** The score as the other side sees it: "6-3, 2-1 RET" becomes "3-6, 1-2 RET". W/O stays W/O. */
export function flipScore(score: string): string {
  const retired = isRetiredScore(score);
  const body = retired ? score.trim().replace(/\s*RET$/, "") : score;
  const flipped = body
    .split(",")
    .map((set) => {
      const m = set.trim().match(/^(\d+)-(\d+)(\(\d+\))?$/);
      return m ? `${m[2]}-${m[1]}${m[3] ?? ""}` : set.trim();
    })
    .join(", ");
  return retired ? `${flipped}${RETIRED_SUFFIX}` : flipped;
}
