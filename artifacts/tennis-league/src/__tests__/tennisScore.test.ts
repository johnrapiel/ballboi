import { describe, it, expect } from "vitest";
import { validateTennisScore, validateScoreFormat } from "@/lib/tennisScore";

describe("validateScoreFormat", () => {
  it("accepts a standard set score", () => {
    expect(validateScoreFormat("6-4").valid).toBe(true);
  });

  it("accepts a tiebreak set score (7-6)", () => {
    expect(validateScoreFormat("7-6").valid).toBe(true);
  });

  it("accepts a reversed tiebreak set score (6-7)", () => {
    expect(validateScoreFormat("6-7").valid).toBe(true);
  });

  it("accepts a super-tiebreak score (10-7)", () => {
    expect(validateScoreFormat("10-7").valid).toBe(true);
  });

  it("accepts a super-tiebreak score where opponent wins (7-10)", () => {
    expect(validateScoreFormat("7-10").valid).toBe(true);
  });

  it("accepts a multi-set score including a tiebreak set", () => {
    expect(validateScoreFormat("7-6, 6-4").valid).toBe(true);
  });

  it("accepts a full three-set match with super-tiebreak", () => {
    expect(validateScoreFormat("7-6, 6-7, 10-7").valid).toBe(true);
  });

  it("rejects a score with non-numeric characters", () => {
    const result = validateScoreFormat("6-four");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects a score with missing hyphen", () => {
    const result = validateScoreFormat("64");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns valid for empty string", () => {
    expect(validateScoreFormat("").valid).toBe(true);
  });
});

describe("validateTennisScore — tiebreak sets (7-6)", () => {
  it("accepts 7-6, 6-4 when player wins", () => {
    const result = validateTennisScore("7-6, 6-4", "me");
    expect(result.valid).toBe(true);
  });

  it("rejects 4-6, 4-6 when player is selected as winner but opponent wins both sets", () => {
    const result = validateTennisScore("4-6, 4-6", "me");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/opponent.*winning more sets/i);
  });

  it("accepts 6-7, 4-6 as opponent winning", () => {
    const result = validateTennisScore("6-7, 4-6", "opponent");
    expect(result.valid).toBe(true);
  });

  it("rejects 7-6, 6-7 as tied sets without super-tiebreak", () => {
    const result = validateTennisScore("7-6, 6-7", "me");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/tied|tiebreak/i);
  });
});

describe("validateTennisScore — super-tiebreaks (10-x)", () => {
  it("accepts 7-6, 6-7, 10-7 when player wins", () => {
    const result = validateTennisScore("7-6, 6-7, 10-7", "me");
    expect(result.valid).toBe(true);
  });

  it("accepts 6-7, 7-6, 7-10 when opponent wins", () => {
    const result = validateTennisScore("6-7, 7-6, 7-10", "opponent");
    expect(result.valid).toBe(true);
  });

  it("rejects 7-6, 6-7, 10-7 when opponent is selected as winner", () => {
    const result = validateTennisScore("7-6, 6-7, 10-7", "opponent");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/you.*winning more sets/i);
  });

  it("rejects 6-7, 7-6, 7-10 when player is selected as winner", () => {
    const result = validateTennisScore("6-7, 7-6, 7-10", "me");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/opponent.*winning more sets/i);
  });
});

describe("validateTennisScore — tied-set error path", () => {
  it("rejects 6-4, 4-6 as tied sets", () => {
    const result = validateTennisScore("6-4, 4-6", "me");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/tied|tiebreak/i);
  });

  it("rejects 3-6, 6-3 as tied sets", () => {
    const result = validateTennisScore("3-6, 6-3", "opponent");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/tied|tiebreak/i);
  });

  it("rejects 6-2, 2-6 as tied sets regardless of selected winner", () => {
    const meResult = validateTennisScore("6-2, 2-6", "me");
    const oppResult = validateTennisScore("6-2, 2-6", "opponent");
    expect(meResult.valid).toBe(false);
    expect(oppResult.valid).toBe(false);
  });
});

describe("validateTennisScore — full tiebreak match (7-6, 6-7, 10-7)", () => {
  it("correctly identifies player as winner", () => {
    const result = validateTennisScore("7-6, 6-7, 10-7", "me");
    expect(result.valid).toBe(true);
  });

  it("correctly identifies opponent as winner in mirror match", () => {
    const result = validateTennisScore("6-7, 7-6, 7-10", "opponent");
    expect(result.valid).toBe(true);
  });

  it("rejects mismatched winner selection in full tiebreak match", () => {
    const result = validateTennisScore("7-6, 6-7, 10-7", "opponent");
    expect(result.valid).toBe(false);
  });

  it("returns valid for empty score string", () => {
    const result = validateTennisScore("", "me");
    expect(result.valid).toBe(true);
  });

  it("rejects malformed set within a tiebreak match", () => {
    const result = validateTennisScore("7-6, bad, 10-7", "me");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/isn't a valid set score/i);
  });
});
