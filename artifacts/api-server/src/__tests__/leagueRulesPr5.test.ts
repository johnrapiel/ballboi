import { describe, it, expect } from "vitest";
import { checkTennisScore, flipScore, isRetiredScore, WALKOVER_SCORE } from "../lib/tennisScore.js";
import { checkScoreEntry, parseMatchScore, scoreFromSide } from "../lib/leagueScoring.js";
import { checkCorrection, checkUndo, FINAL_SCORES_MESSAGE } from "../lib/leagueScoreChanges.js";
import { planDropout, playoffRoundWindow, settleProblem, walkoverResult } from "../lib/playoffs.js";
import { accumulateScoreTotals } from "../lib/scoringUtils.js";
import { pairKey, pairRound, ROUND_ROBIN_WEIGHTS, type PairingPlayer } from "../lib/pairing.js";

// PR 5 (Wave 1 review): league rules. C10 real tennis scores, Q6 retirements,
// Q5 walkovers, Q5b two weeks per playoff round, Q9 final scores, B10 blocks.

describe("checkTennisScore (C10)", () => {
  it("accepts real best-of-three scores and says who won", () => {
    expect(checkTennisScore("6-3, 6-4")).toEqual({ ok: true, sets: ["6-3", "6-4"], winnerSide: 1 });
    expect(checkTennisScore("3-6, 7-6(4), 10-7")).toEqual({ ok: true, sets: ["3-6", "7-6(4)", "10-7"], winnerSide: 1 });
    expect(checkTennisScore("4-6,6-2,3-6")).toMatchObject({ ok: true, winnerSide: 2 });
    expect(checkTennisScore("6-4, 3-6, 12-10")).toMatchObject({ ok: true });
  });

  it("refuses 9-2 and 6-5 with a reason", () => {
    const nine = checkTennisScore("9-2, 6-3");
    expect(nine).toEqual({ ok: false, error: "9-2 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6." });
    const six = checkTennisScore("6-5, 6-3");
    expect(six).toEqual({ ok: false, error: "6-5 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6." });
  });

  it("refuses a tied set", () => {
    expect(checkTennisScore("6-6, 6-3")).toEqual({ ok: false, error: "Set 1 is tied at 6-6. Every set needs a winner." });
  });

  it("has no third set once someone has won two", () => {
    expect(checkTennisScore("6-3, 6-4, 6-2")).toEqual({ ok: false, error: "The match was over after two sets, so there's no third set." });
  });

  it("needs a third set at one set all, and only a match tiebreak there", () => {
    expect(checkTennisScore("6-3, 4-6")).toMatchObject({ ok: false, error: expect.stringMatching(/^The sets are tied/) });
    expect(checkTennisScore("10-7, 6-3")).toMatchObject({ ok: false });
    expect(checkTennisScore("6-3, 4-6, 10-9")).toMatchObject({ ok: false, error: expect.stringMatching(/match tiebreak/) });
  });

  it("refuses a single set, and more than three", () => {
    expect(checkTennisScore("6-3")).toMatchObject({ ok: false, error: "Enter the second set. A match is best of three sets." });
    expect(checkTennisScore("6-3, 3-6, 6-3, 6-1")).toMatchObject({ ok: false, error: "A match is best of three sets." });
  });

  it("only gives a 7-6 set a tiebreak score", () => {
    expect(checkTennisScore("6-3(4), 6-4")).toMatchObject({ ok: false, error: "Set 1: only a 7-6 set has a tiebreak score." });
  });
});

describe("Opponent retired (Q6)", () => {
  it("saves the sets so far as a win for the player entering it", () => {
    expect(checkTennisScore("3-6, 2-1", { retired: true })).toEqual({ ok: true, sets: ["3-6", "2-1"], winnerSide: 1 });
    expect(checkTennisScore("6-3, 5-6", { retired: true })).toMatchObject({ ok: true, winnerSide: 1 });
    expect(checkTennisScore("6-3, 4-6, 8-6", { retired: true })).toMatchObject({ ok: true, winnerSide: 1 });
  });

  it("refuses a finished match or no games", () => {
    expect(checkTennisScore("6-3, 6-4", { retired: true })).toEqual({ ok: false, error: "That match was finished. Turn off Opponent retired to save it." });
    expect(checkTennisScore("0-0", { retired: true })).toEqual({ ok: false, error: "Enter the games played before your opponent retired." });
  });

  it("still refuses impossible games in an unfinished set", () => {
    expect(checkTennisScore("6-3, 9-2", { retired: true })).toMatchObject({ ok: false });
  });

  it("stores RET and flips it for the other side", () => {
    const parsed = parseMatchScore("6-3, 2-1", { retired: true });
    expect(parsed).toEqual({ ok: true, score: "6-3, 2-1 RET", winnerSide: 1 });
    expect(scoreFromSide("6-3, 2-1 RET", 2)).toBe("3-6, 1-2 RET");
    expect(isRetiredScore("3-6, 1-2 RET")).toBe(true);
    expect(isRetiredScore("6-3, 6-2")).toBe(false);
  });

  it("counts a retirement's unfinished set in games but not sets", () => {
    expect(accumulateScoreTotals(["6-3, 2-1 RET"], [true])).toEqual({ gamesWon: 8, gamesLost: 4, setsWon: 1, setsLost: 0 });
    expect(accumulateScoreTotals([WALKOVER_SCORE], [true])).toEqual({ gamesWon: 0, gamesLost: 0, setsWon: 0, setsLost: 0 });
  });

  it("leaves a walkover as W/O from either side", () => {
    expect(flipScore(WALKOVER_SCORE)).toBe(WALKOVER_SCORE);
  });
});

describe("two weeks per playoff round (Q5b)", () => {
  // 8 weeks from Mon Sep 7 runs to Sun Nov 1, so playoffs start Mon Nov 2.
  const league = { startDate: "2026-09-07", seasonWeeks: 8 };

  it("gives each round a play-by date two weeks out", () => {
    expect(playoffRoundWindow(league, 4, "semifinal")).toEqual({ startDate: "2026-11-02", playBy: "2026-11-15" });
    expect(playoffRoundWindow(league, 4, "final")).toEqual({ startDate: "2026-11-16", playBy: "2026-11-29" });
    expect(playoffRoundWindow(league, 8, "quarterfinal")).toEqual({ startDate: "2026-11-02", playBy: "2026-11-15" });
    expect(playoffRoundWindow(league, 8, "final")).toEqual({ startDate: "2026-11-30", playBy: "2026-12-13" });
    expect(playoffRoundWindow(league, 4, "quarterfinal")).toBeNull();
  });

  const playoffMatch = { status: "scheduled", voidedAt: null, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null, playoffBracketId: 3 };

  it("lets players enter a playoff score until the play-by date, then leaves it to the admin", () => {
    const input = { match: playoffMatch, round: null, callerPlayerIds: [1], playoffPlayBy: "2026-11-15" };
    expect(checkScoreEntry({ ...input, today: "2026-11-15" })).toEqual({ ok: true, inGrace: false });
    expect(checkScoreEntry({ ...input, today: "2026-11-16" })).toEqual({
      ok: false,
      status: 409,
      error: "The play-by date for this match was Sun, Nov 15. Your league admin can enter the result.",
    });
  });

  it("lets the admin settle a match only after its play-by date", () => {
    const base = { match: playoffMatch, leagueEnded: false, playBy: "2026-11-15" };
    expect(settleProblem({ ...base, today: "2026-11-15" })).toMatchObject({ status: 409, error: expect.stringMatching(/until Sun, Nov 15 to play/) });
    expect(settleProblem({ ...base, today: "2026-11-16" })).toBeNull();
    expect(settleProblem({ ...base, today: "2026-11-16", leagueEnded: true })).toMatchObject({ error: FINAL_SCORES_MESSAGE });
    expect(settleProblem({ ...base, today: "2026-11-16", match: { ...playoffMatch, status: "completed" } })).toMatchObject({ status: 409 });
    expect(settleProblem({ ...base, today: "2026-11-16", match: { ...playoffMatch, player2Id: null } })).toMatchObject({ status: 409 });
    expect(settleProblem({ ...base, today: "2026-11-16", match: { ...playoffMatch, playoffBracketId: null } })).toMatchObject({ status: 409 });
  });
});

describe("walkovers when a player leaves (Q5)", () => {
  const m = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    status: "scheduled",
    voidedAt: null,
    player1Id: 1,
    player2Id: 2,
    playoffBracketId: null,
    ...over,
  });

  it("gives an unplayed playoff match to the opponent and cancels weekly ones", () => {
    const plan = planDropout(
      [m(1), m(2, { playoffBracketId: 5 }), m(3, { status: "completed" }), m(4, { playoffBracketId: 5, player1Id: 3, player2Id: 1 })],
      1,
      () => true,
    );
    expect(plan).toEqual({ voidIds: [1], walkovers: [{ matchId: 2, winnerId: 2 }, { matchId: 4, winnerId: 3 }] });
  });

  it("cancels a playoff match when the opponent has left too", () => {
    expect(planDropout([m(2, { playoffBracketId: 5 })], 1, () => false)).toEqual({ voidIds: [2], walkovers: [] });
  });

  it("writes W/O as a finished result for the opponent", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(walkoverResult(2, now)).toEqual({
      status: "completed",
      score: "W/O",
      winnerId: 2,
      completedAt: now.toISOString(),
      recordedAt: now.toISOString(),
      inGrace: false,
    });
  });
});

describe("final scores after End (Q9)", () => {
  const played = {
    id: 7,
    status: "completed",
    score: "6-3, 6-4",
    winnerId: 1,
    voidedAt: null,
    playoffBracketId: null,
    inGrace: false,
    recordedAt: new Date().toISOString(),
    recordedByClerkUserId: "u1",
    correctedAt: null,
    player1Id: 1,
    player2Id: 2,
    player3Id: null,
    player4Id: null,
  };

  it("refuses corrections and undo once the league has ended", () => {
    expect(checkCorrection(played, null, true)).toEqual({ ok: false, status: 409, error: FINAL_SCORES_MESSAGE });
    expect(checkUndo(played, "u1", new Date(), true)).toEqual({ ok: false, status: 409, error: FINAL_SCORES_MESSAGE });
    expect(checkCorrection(played, null, false)).toEqual({ ok: true });
  });
});

describe("blocked players are never paired (B10)", () => {
  const p = (id: number): PairingPlayer => ({ id, rating: 3.5, slots: null, byes: 0 });

  it("pairs around a block in Round robin, even when it costs a rematch", () => {
    const players = [p(1), p(2), p(3), p(4)];
    // 1 and 3, and 2 and 4, have played, so the cheapest round is 1-3 and 2-4
    // except that 1 and 2 haven't, and 1 blocked 4.
    const history = new Map([[pairKey(1, 2), 1], [pairKey(3, 4), 1]]);
    const blocked = new Set([pairKey(1, 4)]);
    for (let round = 1; round <= 6; round++) {
      const { pairs } = pairRound({ players, history, weights: ROUND_ROBIN_WEIGHTS, roundNumber: round, blocked });
      expect(pairs.map(([a, b]) => pairKey(a, b))).not.toContain(pairKey(1, 4));
      expect(pairs).toHaveLength(2);
    }
  });

  it("picks a sitter who leaves no blocked pair, with an odd number", () => {
    const players = [p(1), p(2), p(3)];
    const blocked = new Set([pairKey(1, 2)]);
    for (let round = 1; round <= 6; round++) {
      const { pairs, byes } = pairRound({ players, history: new Map(), weights: ROUND_ROBIN_WEIGHTS, roundNumber: round, blocked });
      expect(pairs.map(([a, b]) => pairKey(a, b))).not.toContain(pairKey(1, 2));
      expect(pairs).toHaveLength(1);
      expect(byes).toHaveLength(1);
    }
  });

  it("sits both out when there's no other way", () => {
    const { pairs, byes } = pairRound({
      players: [p(1), p(2)],
      history: new Map(),
      weights: ROUND_ROBIN_WEIGHTS,
      roundNumber: 1,
      blocked: new Set([pairKey(1, 2)]),
    });
    expect(pairs).toEqual([]);
    expect([...byes].sort()).toEqual([1, 2]);
  });
});
