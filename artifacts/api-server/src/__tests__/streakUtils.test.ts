import { describe, it, expect } from "vitest";
import { calculateStreaks } from "../lib/streakUtils";

const PLAYER = 1;
const OPPONENT = 2;

function win() {
  return { winnerId: PLAYER };
}

function loss() {
  return { winnerId: OPPONENT };
}

describe("calculateStreaks — no matches", () => {
  it("returns currentStreak=0 and longestWinStreak=0 when there are no decided matches", () => {
    const result = calculateStreaks([], PLAYER);
    expect(result.currentStreak).toBe(0);
    expect(result.longestWinStreak).toBe(0);
  });
});

describe("calculateStreaks — single match", () => {
  it("returns currentStreak=1 and longestWinStreak=1 for a single win", () => {
    const result = calculateStreaks([win()], PLAYER);
    expect(result.currentStreak).toBe(1);
    expect(result.longestWinStreak).toBe(1);
  });

  it("returns currentStreak=-1 and longestWinStreak=0 for a single loss", () => {
    const result = calculateStreaks([loss()], PLAYER);
    expect(result.currentStreak).toBe(-1);
    expect(result.longestWinStreak).toBe(0);
  });
});

describe("calculateStreaks — win streak", () => {
  it("counts a streak of consecutive wins (newest first)", () => {
    const matches = [win(), win(), win()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(3);
    expect(result.longestWinStreak).toBe(3);
  });

  it("stops the current streak at the first loss", () => {
    // Newest first: W, W, L, W
    const matches = [win(), win(), loss(), win()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(2);
    expect(result.longestWinStreak).toBe(2);
  });
});

describe("calculateStreaks — loss streak", () => {
  it("counts a streak of consecutive losses as a negative number", () => {
    const matches = [loss(), loss(), loss()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(-3);
    expect(result.longestWinStreak).toBe(0);
  });

  it("stops the current loss streak at the first win", () => {
    // Newest first: L, L, W, L
    const matches = [loss(), loss(), win(), loss()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(-2);
    expect(result.longestWinStreak).toBe(1);
  });
});

describe("calculateStreaks — alternating results", () => {
  it("currentStreak is 1 when the most recent match is a win after alternating results", () => {
    // Newest first: W, L, W, L
    const matches = [win(), loss(), win(), loss()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(1);
    expect(result.longestWinStreak).toBe(1);
  });

  it("currentStreak is -1 when the most recent match is a loss after alternating results", () => {
    // Newest first: L, W, L, W
    const matches = [loss(), win(), loss(), win()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(-1);
    expect(result.longestWinStreak).toBe(1);
  });
});

describe("calculateStreaks — longestWinStreak across gaps", () => {
  it("finds the longest win streak even when it is not the most recent run", () => {
    // Newest first: L, W, W, W, L, W
    // Current streak = -1 (most recent is a loss)
    // Longest win streak = 3 (the run of three older wins)
    const matches = [loss(), win(), win(), win(), loss(), win()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(-1);
    expect(result.longestWinStreak).toBe(3);
  });

  it("picks the later longest run when two equal-length win runs exist", () => {
    // Newest first: W, W, L, W, W
    // Both runs have length 2; longestWinStreak should be 2
    const matches = [win(), win(), loss(), win(), win()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(2);
    expect(result.longestWinStreak).toBe(2);
  });

  it("handles a single win surrounded by losses correctly", () => {
    // Newest first: L, L, W, L, L
    const matches = [loss(), loss(), win(), loss(), loss()];
    const result = calculateStreaks(matches, PLAYER);
    expect(result.currentStreak).toBe(-2);
    expect(result.longestWinStreak).toBe(1);
  });
});

describe("calculateStreaks — undecided matches are excluded by the caller", () => {
  it("only considers decided matches (winnerId !== null) passed in", () => {
    // The route pre-filters to decided matches before calling calculateStreaks.
    // Passing only decided results should give the correct streak.
    const decidedOnly = [win(), win()];
    const result = calculateStreaks(decidedOnly, PLAYER);
    expect(result.currentStreak).toBe(2);
    expect(result.longestWinStreak).toBe(2);
  });
});
