// Turning the score sheet's boxes into a score string (spec: Leagues > Scores
// and standings). Scores are written from your own side: your games first.
// The rules for a real score live in lib/tennisScore.ts, the same ones the
// API uses (C10), so a bad score shows its reason before Save.

import { checkTennisScore, isCompleteSet, isMatchTiebreak, RETIRED_SUFFIX, WALKOVER_SCORE } from "./tennisScore";

export interface SetEntry {
  me: string;
  them: string;
  /** Tiebreak points, only for a 7-6 or 6-7 set. */
  tbMe: string;
  tbThem: string;
}

export const emptySet = (): SetEntry => ({ me: "", them: "", tbMe: "", tbThem: "" });

export function isTiebreakSet(s: Pick<SetEntry, "me" | "them">): boolean {
  const a = Number(s.me);
  const b = Number(s.them);
  return s.me !== "" && s.them !== "" && ((a === 7 && b === 6) || (a === 6 && b === 7));
}

const filled = (s: Pick<SetEntry, "me" | "them">) => s.me !== "" && s.them !== "";
const games = (s: Pick<SetEntry, "me" | "them">) => ({ a: Number(s.me), b: Number(s.them) });

/**
 * How many set rows the sheet shows: two, and a third only at one set all.
 * Once someone has won the first two sets, the third row goes away (C10).
 */
export function setRowsToShow(sets: Pick<SetEntry, "me" | "them">[]): 2 | 3 {
  const [one, two] = sets;
  if (!one || !two || !filled(one) || !filled(two)) return 2;
  const g1 = games(one);
  const g2 = games(two);
  if (!isCompleteSet(g1) || !isCompleteSet(g2)) return 2;
  return g1.a > g1.b !== g2.a > g2.b ? 3 : 2;
}

export type ScoreDraft =
  | { ok: true; score: string; iWon: boolean; setsWon: number; setsLost: number }
  | { ok: false; message: string | null };

/**
 * Reads the boxes. `message` is null while the sheet is just incomplete, and
 * the reason a score isn't real otherwise. With `retired`, the opponent
 * stopped mid-match: the sets so far count as my win, shown as RET (Q6).
 */
export function readScore(sets: SetEntry[], opts: { retired?: boolean } = {}): ScoreDraft {
  const shown = sets.slice(0, setRowsToShow(sets));
  const parts: string[] = [];
  for (const s of shown) {
    if (s.me === "" && s.them === "") continue;
    if (s.me === "" || s.them === "") return { ok: false, message: null };
    let part = `${Number(s.me)}-${Number(s.them)}`;
    if (isTiebreakSet(s) && s.tbMe !== "" && s.tbThem !== "") {
      part += `(${Math.min(Number(s.tbMe), Number(s.tbThem))})`;
    }
    parts.push(part);
  }
  if (parts.length === 0) return { ok: false, message: null };
  const check = checkTennisScore(parts.join(", "), opts);
  if (!check.ok) {
    // One finished set is a sheet in progress, not a mistake yet.
    const only = shown.find(filled);
    if (!opts.retired && parts.length === 1 && only && isCompleteSet(games(only))) return { ok: false, message: null };
    return { ok: false, message: check.error };
  }
  let won = 0;
  let lost = 0;
  for (const part of check.sets) {
    const [a, b] = part.replace(/\(.*\)/, "").split("-").map(Number);
    if (!isCompleteSet({ a, b }) && !isMatchTiebreak({ a, b })) continue;
    if (a > b) won++;
    else lost++;
  }
  const score = check.sets.join(", ") + (opts.retired ? RETIRED_SUFFIX : "");
  return { ok: true, score, iWon: check.winnerSide === 1, setsWon: won, setsLost: lost };
}

/**
 * The boxes for a stored score like "6-3, 7-6(4)", first side on top, padded
 * to `count` sets. A tiebreak keeps the loser's points; the winner's are the
 * least that win it (7, or two more). RET is dropped; W/O has no sets.
 */
export function setsFromScore(score: string, count: number): SetEntry[] {
  const body = score.trim() === WALKOVER_SCORE ? "" : score.replace(/\s*RET\s*$/, "");
  const sets: SetEntry[] = body
    .split(",")
    .map((part) => part.trim().match(/^(\d+)-(\d+)(?:\((\d+)\))?$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => {
      const [a, b, tb] = [m[1], m[2], m[3]];
      if (tb == null) return { me: a, them: b, tbMe: "", tbThem: "" };
      const winnerPts = String(Math.max(7, Number(tb) + 2));
      return Number(a) > Number(b) ? { me: a, them: b, tbMe: winnerPts, tbThem: tb } : { me: a, them: b, tbMe: tb, tbThem: winnerPts };
    });
  while (sets.length < count) sets.push(emptySet());
  return sets;
}

// Season length (spec: Leagues > Setup: 1 to 24 weeks), as the admin types it (C8).
export const MIN_WEEKS = 1;
export const MAX_WEEKS = 24;

/**
 * The weeks a typed value means, and a note when it was out of range: 30
 * becomes 24 and 0 becomes 1, with a note before Create. Blank is null.
 */
export function readWeeks(text: string): { weeks: number | null; note: string | null } {
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return { weeks: null, note: null };
  const n = Number(digits);
  if (n < MIN_WEEKS) return { weeks: MIN_WEEKS, note: `A season is at least ${MIN_WEEKS} week, so this one is ${MIN_WEEKS} week.` };
  if (n > MAX_WEEKS) return { weeks: MAX_WEEKS, note: `A season is ${MAX_WEEKS} weeks at most, so this one is ${MAX_WEEKS} weeks.` };
  return { weeks: n, note: null };
}
