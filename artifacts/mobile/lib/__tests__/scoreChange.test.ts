import { describe, expect, it } from "vitest";

import { emptySet, hasScoreChange, normalizeScore, readScore, setsFromScore, type SetEntry } from "@/lib/scoreEntry";

// Finding 14 (John, Nov 11): Save edit stays off until the score differs
// from the saved one, so an unchanged "edit" never tells the opponent.

const set = (me: string, them: string, tbMe = "", tbThem = ""): SetEntry => ({ me, them, tbMe, tbThem });

describe("normalizeScore", () => {
  it("treats spacing, en dashes and case as the same score", () => {
    expect(normalizeScore("6-4,  6-3")).toBe("6-4, 6-3");
    expect(normalizeScore(" 6 - 4 , 7-6( 4 ) ")).toBe("6-4, 7-6(4)");
    expect(normalizeScore("6–4, 3–6")).toBe("6-4, 3-6");
    expect(normalizeScore("6-3, 2-1 ret")).toBe("6-3, 2-1 RET");
  });
});

describe("hasScoreChange (finding 14)", () => {
  it("is off for the prefilled score as it stands", () => {
    for (const saved of ["6-4, 6-3", "6-4, 3-6, 10-7", "7-6(4), 6-2", "6-7(5), 6-4, 6-1"]) {
      const draft = readScore(setsFromScore(saved, 3));
      expect(hasScoreChange(draft, saved)).toBe(false);
    }
  });

  it("is off for a Quick match's prefilled score", () => {
    const saved = "6-4";
    expect(hasScoreChange(readScore(setsFromScore(saved, 2), { quick: true }), saved)).toBe(false);
  });

  it("is off when the same score is typed again", () => {
    expect(hasScoreChange(readScore([set("6", "4"), set("6", "3"), emptySet()]), "6-4, 6-3")).toBe(false);
    // A 6-6 set with its tiebreak saves as 7-6, so it matches a saved 7-6(4).
    expect(hasScoreChange(readScore([set("6", "6", "7", "4"), set("6", "2"), emptySet()]), "7-6(4), 6-2")).toBe(false);
  });

  it("is on once a set changes, and off again when changed back", () => {
    const saved = "6-4, 6-3";
    const sets = setsFromScore(saved, 3);
    const changed = sets.map((s, i) => (i === 1 ? { ...s, them: "2" } : s));
    expect(hasScoreChange(readScore(changed), saved)).toBe(true);
    const back = changed.map((s, i) => (i === 1 ? { ...s, them: "3" } : s));
    expect(hasScoreChange(readScore(back), saved)).toBe(false);
  });

  it("counts a changed tiebreak or a retirement as a change", () => {
    expect(hasScoreChange(readScore([set("7", "6", "7", "5"), set("6", "2"), emptySet()]), "7-6(4), 6-2")).toBe(true);
    expect(hasScoreChange(readScore([set("6", "3"), set("2", "1"), emptySet()], { retired: true }), "6-3, 2-1")).toBe(true);
    expect(hasScoreChange(readScore([set("6", "3"), set("2", "1"), emptySet()], { retired: true }), "6-3, 2-1 RET")).toBe(false);
  });

  it("is off while the boxes don't read as a score", () => {
    expect(hasScoreChange(readScore([set("6", ""), emptySet(), emptySet()]), "6-4, 6-3")).toBe(false);
  });

  it("is on for any real score when nothing is saved yet", () => {
    const draft = readScore([set("6", "4"), set("6", "3"), emptySet()]);
    expect(hasScoreChange(draft, null)).toBe(true);
    expect(hasScoreChange(draft, "")).toBe(true);
  });
});
