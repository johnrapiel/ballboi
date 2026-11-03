// Turning the score sheet's boxes into a score string (spec: Leagues > Scores
// and standings). Scores are written from your own side: your games first.

export interface SetEntry {
  me: string;
  them: string;
  /** Tiebreak points, only for a 7-6 or 6-7 set. */
  tbMe: string;
  tbThem: string;
}

export const emptySet = (): SetEntry => ({ me: "", them: "", tbMe: "", tbThem: "" });

export function isTiebreakSet(s: SetEntry): boolean {
  const a = Number(s.me);
  const b = Number(s.them);
  return s.me !== "" && s.them !== "" && ((a === 7 && b === 6) || (a === 6 && b === 7));
}

export type ScoreDraft =
  | { ok: true; score: string; iWon: boolean; setsWon: number; setsLost: number }
  | { ok: false; message: string | null };

/** Reads the boxes. `message` is null while the sheet is just incomplete. */
export function readScore(sets: SetEntry[]): ScoreDraft {
  const parts: string[] = [];
  let won = 0;
  let lost = 0;
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (s.me === "" && s.them === "") continue;
    if (s.me === "" || s.them === "") return { ok: false, message: null };
    const a = Number(s.me);
    const b = Number(s.them);
    if (a === b) return { ok: false, message: `Set ${i + 1} is tied. Every set needs a winner.` };
    let part = `${a}-${b}`;
    if (isTiebreakSet(s) && s.tbMe !== "" && s.tbThem !== "") {
      part += `(${Math.min(Number(s.tbMe), Number(s.tbThem))})`;
    }
    parts.push(part);
    if (a > b) won++;
    else lost++;
  }
  if (parts.length === 0) return { ok: false, message: null };
  if (won === lost) return { ok: false, message: "The sets are tied. Add the third set, or a match tiebreak like 10-7." };
  return { ok: true, score: parts.join(", "), iWon: won > lost, setsWon: won, setsLost: lost };
}

/**
 * The boxes for a stored score like "6-3, 7-6(4)", first side on top, padded
 * to `count` sets. A tiebreak keeps the loser's points; the winner's are the
 * least that win it (7, or two more).
 */
export function setsFromScore(score: string, count: number): SetEntry[] {
  const sets: SetEntry[] = score
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
