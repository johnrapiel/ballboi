// Turning the score sheet's boxes into a score string (spec: Leagues > Scores
// and standings). Scores are written from your own side: your games first.
// The rules for a real score live in lib/tennisScore.ts, the same ones the
// API uses (C10), so a bad score shows its reason before Save.

import { checkTennisScore, isCompleteSet, isMatchTiebreak, RETIRED_SUFFIX, WALKOVER_SCORE } from "./tennisScore";

export interface SetEntry {
  me: string;
  them: string;
  /** Tiebreak points, for a 7-6 or 6-7 set, or a set typed as 6-6. */
  tbMe: string;
  tbThem: string;
}

export const emptySet = (): SetEntry => ({ me: "", them: "", tbMe: "", tbThem: "" });

export function isTiebreakSet(s: Pick<SetEntry, "me" | "them">): boolean {
  const a = Number(s.me);
  const b = Number(s.them);
  return s.me !== "" && s.them !== "" && ((a === 7 && b === 6) || (a === 6 && b === 7));
}

/**
 * A set typed as 6-6: the players are thinking "6-all, then a tiebreak"
 * (finding 5, John, Nov 6). The tiebreak boxes show under it and are needed
 * to save; the tiebreak's winner takes the set 7-6.
 */
export function isSixAll(s: Pick<SetEntry, "me" | "them">): boolean {
  return s.me !== "" && s.them !== "" && Number(s.me) === 6 && Number(s.them) === 6;
}

/** The sheet shows tiebreak boxes under this set. */
export function showsTiebreak(s: Pick<SetEntry, "me" | "them">): boolean {
  return isTiebreakSet(s) || isSixAll(s);
}

/** The line above a 6-6 set's tiebreak boxes. */
export const sixAllPrompt = (setNumber: number) => `Set ${setNumber} went to a tiebreak. Enter the tiebreak score.`;

/** A finished set tiebreak: first to 7, win by 2 (7-5, 10-8). */
export function isFinishedTiebreak(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi >= 7 && hi - lo >= 2 && (hi === 7 || hi - lo === 2);
}

const TIEBREAK_HINT = "A tiebreak goes to 7, won by 2, like 7-5 or 10-8.";

type Resolved =
  | { kind: "empty" }
  | { kind: "incomplete" }
  | { kind: "error"; message: string }
  | { kind: "set"; me: number; them: number; part: string };

/**
 * One set's boxes as games and the score text for it. A 6-6 set needs its
 * tiebreak and becomes 7-6 or 6-7 to the tiebreak's winner; a 7-6 set's
 * tiebreak stays optional, as before.
 */
function resolveSet(s: SetEntry, setNumber: number): Resolved {
  if (s.me === "" && s.them === "") return { kind: "empty" };
  if (s.me === "" || s.them === "") return { kind: "incomplete" };
  const me = Number(s.me);
  const them = Number(s.them);
  const tbFilled = s.tbMe !== "" && s.tbThem !== "";
  const tbStarted = s.tbMe !== "" || s.tbThem !== "";
  const label = `Set ${setNumber} tiebreak`;
  if (isSixAll(s)) {
    if (!tbFilled) return { kind: "incomplete" };
    const a = Number(s.tbMe);
    const b = Number(s.tbThem);
    if (!isFinishedTiebreak(a, b)) return { kind: "error", message: `${label}: ${a}-${b} isn't a finished tiebreak. ${TIEBREAK_HINT}` };
    return a > b
      ? { kind: "set", me: 7, them: 6, part: `7-6(${b})` }
      : { kind: "set", me: 6, them: 7, part: `6-7(${a})` };
  }
  if (isTiebreakSet(s)) {
    if (!tbStarted) return { kind: "set", me, them, part: `${me}-${them}` };
    if (!tbFilled) return { kind: "incomplete" };
    const a = Number(s.tbMe);
    const b = Number(s.tbThem);
    if (!isFinishedTiebreak(a, b)) return { kind: "error", message: `${label}: ${a}-${b} isn't a finished tiebreak. ${TIEBREAK_HINT}` };
    if (a > b !== me > them) return { kind: "error", message: `${label}: whoever wins the tiebreak wins the set 7-6.` };
    return { kind: "set", me, them, part: `${me}-${them}(${Math.min(a, b)})` };
  }
  return { kind: "set", me, them, part: `${me}-${them}` };
}

/** A set's games once a 6-6 tiebreak is in (7-6), or null while it isn't. */
function gamesOf(s: SetEntry): { a: number; b: number } | null {
  const r = resolveSet(s, 1);
  return r.kind === "set" ? { a: r.me, b: r.them } : null;
}

/**
 * How many set rows the sheet uses: two, and a third only at one set all.
 * Once someone has won the first two sets, the third row goes away (C10).
 * The sheet still draws the third column, greyed out until it's needed.
 */
export function setRowsToShow(sets: SetEntry[]): 2 | 3 {
  const [one, two] = sets;
  if (!one || !two) return 2;
  const g1 = gamesOf(one);
  const g2 = gamesOf(two);
  if (!g1 || !g2 || !isCompleteSet(g1) || !isCompleteSet(g2)) return 2;
  return g1.a > g1.b !== g2.a > g2.b ? 3 : 2;
}

export type ScoreDraft =
  | { ok: true; score: string; iWon: boolean; setsWon: number; setsLost: number }
  | { ok: false; message: string | null };

/**
 * Reads the boxes. `message` is null while the sheet is just incomplete, and
 * the reason a score isn't real otherwise. With `retired`, the opponent
 * stopped mid-match: the sets so far count as my win, shown as RET (Q6).
 * With `quick`, it's a Quick match: every row counts, empty ones are skipped,
 * and one set or more saves (no best of three).
 */
export function readScore(sets: SetEntry[], opts: { retired?: boolean; quick?: boolean } = {}): ScoreDraft {
  const quick = !!opts.quick;
  const shown = quick ? sets : sets.slice(0, setRowsToShow(sets));
  const parts: string[] = [];
  let lastGames: { a: number; b: number } | null = null;
  for (let i = 0; i < shown.length; i++) {
    const s = shown[i];
    // While retired, a 6-6 set can be the one they stopped in, with no tiebreak.
    if (opts.retired && !quick && isSixAll(s) && s.tbMe === "" && s.tbThem === "") {
      parts.push("6-6");
      lastGames = { a: 6, b: 6 };
      continue;
    }
    const r = resolveSet(s, i + 1);
    if (r.kind === "empty") continue;
    if (r.kind === "incomplete") return { ok: false, message: null };
    if (r.kind === "error") return { ok: false, message: r.message };
    parts.push(r.part);
    lastGames = { a: r.me, b: r.them };
  }
  if (parts.length === 0) return { ok: false, message: null };
  const check = checkTennisScore(parts.join(", "), quick ? { quick } : { retired: opts.retired });
  if (!check.ok) {
    // One finished set is a league sheet in progress, not a mistake yet.
    if (!quick && !opts.retired && parts.length === 1 && lastGames && isCompleteSet(lastGames)) return { ok: false, message: null };
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
  const score = check.sets.join(", ") + (opts.retired && !quick ? RETIRED_SUFFIX : "");
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
