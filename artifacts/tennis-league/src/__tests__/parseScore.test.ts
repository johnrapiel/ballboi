import { describe, it, expect } from "vitest";
import { parseScore } from "@/lib/tennisScore";

describe("parseScore — null / empty input", () => {
  it("returns three blank sets for null", () => {
    expect(parseScore(null)).toEqual([
      { p1: "", p2: "" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ]);
  });

  it("returns three blank sets for an empty string", () => {
    expect(parseScore("")).toEqual([
      { p1: "", p2: "" },
      { p1: "", p2: "" },
      { p1: "", p2: "" },
    ]);
  });
});

describe("parseScore — standard sets", () => {
  it("parses a two-set score '6-3, 7-5'", () => {
    const result = parseScore("6-3, 7-5");
    expect(result[0]).toEqual({ p1: "6", p2: "3" });
    expect(result[1]).toEqual({ p1: "7", p2: "5" });
    expect(result[2]).toEqual({ p1: "", p2: "" });
  });

  it("parses a one-set score and pads with two blank sets", () => {
    const result = parseScore("6-4");
    expect(result[0]).toEqual({ p1: "6", p2: "4" });
    expect(result[1]).toEqual({ p1: "", p2: "" });
    expect(result[2]).toEqual({ p1: "", p2: "" });
  });

  it("parses a three-set score without tiebreaks", () => {
    const result = parseScore("6-3, 4-6, 6-2");
    expect(result[0]).toEqual({ p1: "6", p2: "3" });
    expect(result[1]).toEqual({ p1: "4", p2: "6" });
    expect(result[2]).toEqual({ p1: "6", p2: "2" });
  });
});

describe("parseScore — tiebreak sets stored as '7-6(loser)'", () => {
  it("converts '7-6(4)' (p1 wins) to p1='6', p2='6', tb2='4'", () => {
    const result = parseScore("7-6(4)");
    expect(result[0]).toEqual({ p1: "6", p2: "6", tb2: "4" });
  });

  it("converts '6-7(3)' (p2 wins) to p1='6', p2='6', tb1='3'", () => {
    const result = parseScore("6-7(3)");
    expect(result[0]).toEqual({ p1: "6", p2: "6", tb1: "3" });
  });

  it("handles a tiebreak set in the third position", () => {
    const result = parseScore("6-3, 4-6, 7-6(4)");
    expect(result[0]).toEqual({ p1: "6", p2: "3" });
    expect(result[1]).toEqual({ p1: "4", p2: "6" });
    expect(result[2]).toEqual({ p1: "6", p2: "6", tb2: "4" });
  });

  it("handles a 7-6 with no parens — leaves as-is without tiebreak keys", () => {
    const result = parseScore("7-6");
    expect(result[0]).toEqual({ p1: "6", p2: "6", tb2: "" });
  });

  it("handles a 6-7 with no parens — leaves as-is without tiebreak keys", () => {
    const result = parseScore("6-7");
    expect(result[0]).toEqual({ p1: "6", p2: "6", tb1: "" });
  });
});

describe("parseScore — blank padding", () => {
  it("always returns exactly 3 sets", () => {
    expect(parseScore("6-3")).toHaveLength(3);
    expect(parseScore("6-3, 7-5")).toHaveLength(3);
    expect(parseScore("6-3, 7-5, 6-4")).toHaveLength(3);
  });

  it("pads missing sets with blank { p1: '', p2: '' }", () => {
    const result = parseScore("6-3");
    expect(result[1]).toEqual({ p1: "", p2: "" });
    expect(result[2]).toEqual({ p1: "", p2: "" });
  });

  it("truncates extra sets beyond three", () => {
    const result = parseScore("6-3, 7-5, 6-4, 6-0");
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ p1: "6", p2: "4" });
  });
});
