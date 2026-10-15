import { describe, it, expect } from "vitest";
import { formatScore, type SetScore } from "@/lib/tennisScore";

describe("formatScore — basic sets", () => {
  it("formats a fully-entered set (6-3)", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "3" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("6-3");
  });

  it("treats a missing p2 as 0, so { p1: '6', p2: '' } → '6-0'", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("6-0");
  });

  it("treats a missing p1 as 0, so { p1: '', p2: '0' } → '0-0'", () => {
    const sets: SetScore[] = [
      { p1: "", p2: "0" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("0-0");
  });

  it("filters out sets where BOTH fields are empty", () => {
    const sets: SetScore[] = [
      { p1: "", p2: "" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("");
  });

  it("uses OR logic — a set is kept when only one side is non-empty", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    const result = formatScore(sets);
    expect(result).not.toBe("");
    expect(result).toBe("6-0");
  });
});

describe("formatScore — tiebreak sets", () => {
  it("formats a tiebreak where p1 wins (6-6, tb1=7, tb2=4) → '7-6(4)'", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "6", tb1: "7", tb2: "4" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("7-6(4)");
  });

  it("formats a tiebreak where p2 wins (6-6, tb1=3, tb2=7) → '6-7(3)'", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "6", tb1: "3", tb2: "7" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("6-7(3)");
  });

  it("falls back to '6-6' when tb scores are absent", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "6" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("6-6");
  });
});

describe("formatScore — multi-set scores", () => {
  it("formats a two-set score (6-3, 7-5)", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "3" },
      { p1: "7", p2: "5" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("6-3, 7-5");
  });

  it("formats a three-set score with a tiebreak in the third (6-3, 4-6, 7-6(4))", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "3" },
      { p1: "4", p2: "6" },
      { p1: "6", p2: "6", tb1: "7", tb2: "4" },
    ];
    expect(formatScore(sets)).toBe("6-3, 4-6, 7-6(4)");
  });

  it("skips blank trailing sets in a multi-set score", () => {
    const sets: SetScore[] = [
      { p1: "6", p2: "3" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ];
    expect(formatScore(sets)).toBe("6-3");
  });
});
