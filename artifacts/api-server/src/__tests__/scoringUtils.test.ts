/**
 * Unit tests for the ladder scoring helpers in lib/scoringUtils.ts
 *
 * Verifies that:
 *  - parseSet correctly strips tiebreak suffixes and returns raw game counts
 *  - accumulateScoreTotals computes gamesWon, gamesLost, setsWon, setsLost
 *    with the 6-game cap applied
 *  - calculatePoints produces the correct ladder total (gamesWon + setsWon×3 + wins×6)
 *  - Tiebreak sets (7-6) are capped to 6 games for the winner
 *  - Bagel sets (6-0) score the same as tiebreak wins on the games dimension
 */
import { describe, it, expect } from "vitest";
import {
  parseSet,
  accumulateScoreTotals,
  calculatePoints,
} from "../lib/scoringUtils.js";

// ---------------------------------------------------------------------------
// parseSet
// ---------------------------------------------------------------------------

describe("parseSet", () => {
  it("parses a normal set '6-3'", () => {
    const result = parseSet("6-3");
    expect(result).toEqual({ myGames: 6, oppGames: 3 });
  });

  it("parses a tiebreak set '7-6(4)' and returns the raw scores", () => {
    const result = parseSet("7-6(4)");
    expect(result).toEqual({ myGames: 7, oppGames: 6 });
  });

  it("parses a tiebreak set '6-7(4)' where team 1 lost the tiebreak", () => {
    const result = parseSet("6-7(4)");
    expect(result).toEqual({ myGames: 6, oppGames: 7 });
  });

  it("parses a bagel set '6-0'", () => {
    const result = parseSet("6-0");
    expect(result).toEqual({ myGames: 6, oppGames: 0 });
  });

  it("parses a set with leading/trailing whitespace", () => {
    const result = parseSet("  6-3  ");
    expect(result).toEqual({ myGames: 6, oppGames: 3 });
  });

  it("returns null for an invalid string with no hyphen", () => {
    expect(parseSet("63")).toBeNull();
  });

  it("returns null for a string with non-numeric values", () => {
    expect(parseSet("six-three")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseSet("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// accumulateScoreTotals — single match, player as team 1
// ---------------------------------------------------------------------------

describe("accumulateScoreTotals — normal set (6-3)", () => {
  it("computes correct gamesWon, gamesLost, setsWon, setsLost for a 6-3 set win", () => {
    const result = accumulateScoreTotals(["6-3"], [true]);
    expect(result.gamesWon).toBe(6);
    expect(result.gamesLost).toBe(3);
    expect(result.setsWon).toBe(1);
    expect(result.setsLost).toBe(0);
  });

  it("computes correct totals when the player is team 2 and wins 6-3", () => {
    // Score string is always from team-1 perspective; isTeam1=false flips the view
    const result = accumulateScoreTotals(["3-6"], [false]);
    expect(result.gamesWon).toBe(6);
    expect(result.gamesLost).toBe(3);
    expect(result.setsWon).toBe(1);
    expect(result.setsLost).toBe(0);
  });

  it("computes correct totals for a 6-3 set loss", () => {
    const result = accumulateScoreTotals(["6-3"], [false]);
    expect(result.gamesWon).toBe(3);
    expect(result.gamesLost).toBe(6);
    expect(result.setsWon).toBe(0);
    expect(result.setsLost).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// accumulateScoreTotals — tiebreak set (7-6)
// ---------------------------------------------------------------------------

describe("accumulateScoreTotals — tiebreak set (7-6)", () => {
  it("caps tiebreak winner's games at 6", () => {
    const result = accumulateScoreTotals(["7-6(4)"], [true]);
    expect(result.gamesWon).toBe(6);   // 7 raw, capped to 6
    expect(result.gamesLost).toBe(6);  // 6 raw, stays 6
    expect(result.setsWon).toBe(1);
    expect(result.setsLost).toBe(0);
  });

  it("caps tiebreak loser's games at 6 when they had 7 raw (tie-break set lost 6-7)", () => {
    const result = accumulateScoreTotals(["6-7(4)"], [true]);
    expect(result.gamesWon).toBe(6);   // 6 raw, stays 6
    expect(result.gamesLost).toBe(6);  // 7 raw, capped to 6
    expect(result.setsWon).toBe(0);
    expect(result.setsLost).toBe(1);
  });

  it("tiebreak winner (7-6) scores the same games as a bagel winner (6-0) for that set", () => {
    const tiebreak = accumulateScoreTotals(["7-6(4)"], [true]);
    const bagel    = accumulateScoreTotals(["6-0"],    [true]);
    expect(tiebreak.gamesWon).toBe(bagel.gamesWon);
  });
});

// ---------------------------------------------------------------------------
// accumulateScoreTotals — bagel set (6-0)
// ---------------------------------------------------------------------------

describe("accumulateScoreTotals — bagel set (6-0)", () => {
  it("computes correct totals for a 6-0 set win", () => {
    const result = accumulateScoreTotals(["6-0"], [true]);
    expect(result.gamesWon).toBe(6);
    expect(result.gamesLost).toBe(0);
    expect(result.setsWon).toBe(1);
    expect(result.setsLost).toBe(0);
  });

  it("computes correct totals for a 6-0 set loss", () => {
    const result = accumulateScoreTotals(["0-6"], [true]);
    expect(result.gamesWon).toBe(0);
    expect(result.gamesLost).toBe(6);
    expect(result.setsWon).toBe(0);
    expect(result.setsLost).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// accumulateScoreTotals — multi-set match
// ---------------------------------------------------------------------------

describe("accumulateScoreTotals — multi-set match scores", () => {
  it("accumulates two sets correctly: '6-3, 7-5'", () => {
    const result = accumulateScoreTotals(["6-3, 7-5"], [true]);
    expect(result.gamesWon).toBe(6 + 6);   // 6 + 7 capped to 6+6 → but 7 is not >6 ... 7>6, cap → 6
    // 7-5: team1=7 → capped to 6, team2=5 → stays 5
    expect(result.gamesWon).toBe(12);   // 6 + 6
    expect(result.gamesLost).toBe(8);   // 3 + 5
    expect(result.setsWon).toBe(2);
    expect(result.setsLost).toBe(0);
  });

  it("accumulates three sets correctly: '6-3, 5-7, 7-6(4)'", () => {
    // Set 1: team1=6, team2=3  → gamesWon+=6, gamesLost+=3, setsWon+=1
    // Set 2: team1=5, team2=7  → 7 capped to 6, gamesWon+=5, gamesLost+=6, setsLost+=1
    // Set 3: team1=7 → capped to 6, team2=6 → gamesWon+=6, gamesLost+=6, setsWon+=1
    const result = accumulateScoreTotals(["6-3, 5-7, 7-6(4)"], [true]);
    expect(result.gamesWon).toBe(6 + 5 + 6);    // 17
    expect(result.gamesLost).toBe(3 + 6 + 6);   // 15
    expect(result.setsWon).toBe(2);
    expect(result.setsLost).toBe(1);
  });

  it("accumulates across multiple separate matches", () => {
    // Match 1 (team1=true): 6-3, 6-4  → gamesWon=12, gamesLost=7, setsWon=2
    // Match 2 (team1=false): 3-6  → perspective flip: gamesWon+=6, gamesLost+=3, setsWon+=1
    const result = accumulateScoreTotals(["6-3, 6-4", "3-6"], [true, false]);
    expect(result.gamesWon).toBe(6 + 6 + 6);   // 18
    expect(result.gamesLost).toBe(3 + 4 + 3);  // 10
    expect(result.setsWon).toBe(3);
    expect(result.setsLost).toBe(0);
  });

  it("skips null/undefined score strings", () => {
    const result = accumulateScoreTotals([null, "6-3", undefined], [true, true, true]);
    expect(result.gamesWon).toBe(6);
    expect(result.gamesLost).toBe(3);
    expect(result.setsWon).toBe(1);
    expect(result.setsLost).toBe(0);
  });

  it("returns all-zero totals when there are no scores", () => {
    const result = accumulateScoreTotals([], []);
    expect(result).toEqual({ gamesWon: 0, gamesLost: 0, setsWon: 0, setsLost: 0 });
  });
});

// ---------------------------------------------------------------------------
// calculatePoints
// ---------------------------------------------------------------------------

describe("calculatePoints", () => {
  it("computes points correctly for a straight-sets win: 6-3, 6-4", () => {
    // gamesWon=12, setsWon=2, wins=1
    // points = 12 + 2×3 + 1×6 = 12 + 6 + 6 = 24
    const totals = accumulateScoreTotals(["6-3, 6-4"], [true]);
    expect(calculatePoints(totals, 1)).toBe(24);
  });

  it("computes points correctly for a three-set win: 6-3, 4-6, 7-6(4)", () => {
    // Set1: gW+=6, gL+=3, sW+=1
    // Set2: gW+=4, gL+=6, sL+=1  (4<6 no cap issue)
    // Set3: gW+=6(cap), gL+=6, sW+=1
    // gamesWon=16, setsWon=2, wins=1
    // points = 16 + 6 + 6 = 28
    const totals = accumulateScoreTotals(["6-3, 4-6, 7-6(4)"], [true]);
    expect(calculatePoints(totals, 1)).toBe(28);
  });

  it("computes points correctly for a tiebreak win: 7-6(3) only", () => {
    // gamesWon=6(cap), gamesLost=6, setsWon=1, wins=1
    // points = 6 + 3 + 6 = 15
    const totals = accumulateScoreTotals(["7-6(3)"], [true]);
    expect(calculatePoints(totals, 1)).toBe(15);
  });

  it("computes points correctly for a bagel win: 6-0 only", () => {
    // gamesWon=6, gamesLost=0, setsWon=1, wins=1
    // points = 6 + 3 + 6 = 15
    const totals = accumulateScoreTotals(["6-0"], [true]);
    expect(calculatePoints(totals, 1)).toBe(15);
  });

  it("tiebreak win (7-6) and bagel win (6-0) produce identical points", () => {
    const tiebreakTotals = accumulateScoreTotals(["7-6(3)"], [true]);
    const bagelTotals    = accumulateScoreTotals(["6-0"],    [true]);
    expect(calculatePoints(tiebreakTotals, 1)).toBe(calculatePoints(bagelTotals, 1));
  });

  it("returns zero points for a player with no matches", () => {
    const totals = accumulateScoreTotals([], []);
    expect(calculatePoints(totals, 0)).toBe(0);
  });

  it("does not add win bonus when wins=0 (unscored match)", () => {
    const totals = accumulateScoreTotals(["6-3"], [true]);
    // gamesWon=6, setsWon=1, wins=0
    // points = 6 + 3 + 0 = 9
    expect(calculatePoints(totals, 0)).toBe(9);
  });

  it("accumulates correctly across multiple match wins", () => {
    // Two matches: "6-3, 6-4" and "6-0, 6-0"
    // Match1 (team1): gW=12, sW=2
    // Match2 (team1): gW=12, sW=2
    // Total: gW=24, sW=4, wins=2
    // points = 24 + 4×3 + 2×6 = 24 + 12 + 12 = 48
    const totals = accumulateScoreTotals(["6-3, 6-4", "6-0, 6-0"], [true, true]);
    expect(calculatePoints(totals, 2)).toBe(48);
  });
});
