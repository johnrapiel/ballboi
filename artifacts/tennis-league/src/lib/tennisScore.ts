export interface ScoreValidationResult {
  valid: boolean;
  error?: string;
}

export type SetScore = { p1: string; p2: string; tb1?: string; tb2?: string };

export function formatScore(sets: SetScore[]): string {
  return sets
    .filter((s) => s.p1 !== "" || s.p2 !== "")
    .map((s) => {
      const p1Raw = s.p1 !== "" ? s.p1 : "0";
      const p2Raw = s.p2 !== "" ? s.p2 : "0";
      const p1 = parseInt(p1Raw);
      const p2 = parseInt(p2Raw);

      if (p1 === 6 && p2 === 6) {
        const tb1 = parseInt(s.tb1 || "0");
        const tb2 = parseInt(s.tb2 || "0");
        if (s.tb1 !== undefined || s.tb2 !== undefined) {
          if (tb1 > tb2) return `7-6(${tb2})`;
          if (tb2 > tb1) return `6-7(${tb1})`;
        }
        return "6-6";
      }

      const isLegacyTb = (p1 === 7 && p2 === 6) || (p1 === 6 && p2 === 7);
      if (isLegacyTb && (s.tb1 || s.tb2)) {
        const loserTb = p1 > p2 ? s.tb2 : s.tb1;
        return `${p1Raw}-${p2Raw}(${loserTb || "?"})`;
      }

      return `${p1Raw}-${p2Raw}`;
    })
    .join(", ");
}

const SET_PATTERN = /^\s*(\d+)-(\d+)(\(\d+\))?\s*$/;

const TB_SET_RE = /^(\d+)-(\d+)\((\d+)\)$/;

/**
 * Converts stored score notation like "7-6(4), 6-0" into a human-readable
 * display form like "7-6 (7-4), 6-0".
 *
 * The stored format uses the loser's tiebreak score in parens. This function
 * expands it to show both scores so it reads naturally.
 */
export function formatDisplayScore(score: string): string {
  return score
    .split(",")
    .map((s) => {
      const trimmed = s.trim();
      const m = trimmed.match(TB_SET_RE);
      if (!m) return trimmed;
      const p1 = parseInt(m[1], 10);
      const p2 = parseInt(m[2], 10);
      const loser = m[3];
      if (p1 > p2) return `${m[1]}-${m[2]} (7-${loser})`;
      return `${m[1]}-${m[2]} (${loser}-7)`;
    })
    .join(", ");
}

export function validateTennisScore(
  score: string,
  winnerSide: "me" | "opponent"
): ScoreValidationResult {
  const trimmed = score.trim();
  if (!trimmed) return { valid: true };

  const sets = trimmed.split(",");
  let mySets = 0;
  let opponentSets = 0;

  for (const set of sets) {
    const match = set.match(SET_PATTERN);
    if (!match) {
      return {
        valid: false,
        error: `"${set.trim()}" isn't a valid set score. Use a format like 6-4 for each set.`,
      };
    }
    const myGames = parseInt(match[1], 10);
    const opponentGames = parseInt(match[2], 10);
    if (myGames > opponentGames) {
      mySets++;
    } else if (opponentGames > myGames) {
      opponentSets++;
    }
  }

  if (mySets === opponentSets) {
    return {
      valid: false,
      error:
        "The set scores are tied. If a match tiebreak was played, include it in the score (e.g. 10-7). Otherwise, check your scores.",
    };
  }

  const impliedWinner: "me" | "opponent" = mySets > opponentSets ? "me" : "opponent";
  if (impliedWinner !== winnerSide) {
    const selectedLabel = winnerSide === "me" ? "yourself" : "your opponent";
    const impliedLabel = impliedWinner === "me" ? "you" : "your opponent";
    return {
      valid: false,
      error: `The score shows ${impliedLabel} winning more sets, but you selected ${selectedLabel} as the winner. Please correct the score or the winner.`,
    };
  }

  return { valid: true };
}

export function parseScore(score: string | null): SetScore[] {
  const blank = (): SetScore[] => [{ p1: "", p2: "" }, { p1: "", p2: "" }, { p1: "", p2: "" }];
  if (!score) return blank();
  const parts = score.split(",").map((s) => s.trim()).slice(0, 3);
  const parsed: SetScore[] = parts.map((part) => {
    const tbMatch = part.match(/\((\d+)\)/);
    const clean = part.replace(/\(\d+\)/, "").trim();
    const [g1, g2] = clean.split("-").map((x) => x.trim());
    const p1 = g1 ?? "";
    const p2 = g2 ?? "";
    const set: SetScore = { p1, p2 };
    const n1 = parseInt(p1);
    const n2 = parseInt(p2);
    if ((n1 === 7 && n2 === 6) || (n1 === 6 && n2 === 7)) {
      const loserScore = tbMatch ? tbMatch[1] : "";
      set.p1 = "6";
      set.p2 = "6";
      if (n1 > n2) {
        set.tb2 = loserScore;
      } else {
        set.tb1 = loserScore;
      }
    }
    return set;
  });
  while (parsed.length < 3) parsed.push({ p1: "", p2: "" });
  return parsed;
}

export function validateScoreFormat(score: string): ScoreValidationResult {
  const trimmed = score.trim();
  if (!trimmed) return { valid: true };

  const sets = trimmed.split(",");
  for (const set of sets) {
    if (!set.match(SET_PATTERN)) {
      return {
        valid: false,
        error: `"${set.trim()}" isn't a valid set score. Use a format like 6-4 for each set.`,
      };
    }
  }
  return { valid: true };
}
