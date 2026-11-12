import { describe, expect, it } from "vitest";

import type { PlayerMatches } from "@workspace/api-client-react";

import { careerResultRow, myResultRows, outcomeSpoken, resultRowText } from "@/lib/resultRow";

// Profile > Results lists every match you played (John, Nov 10): league,
// Discover and Quick match, read from your side.

type Result = PlayerMatches["results"][number];
const result = (o: Partial<Result>): Result => ({
  matchId: 1,
  player1Name: "John Rapiel",
  player2Name: "Sam Patel",
  player1UserId: null,
  player2UserId: 12,
  score: "6-3, 6-4",
  winner: 1,
  context: "Tuesday Flex 3.5",
  playoff: false,
  inGrace: false,
  completedAt: "2026-11-01T18:00:00Z",
  mine: true,
  yours: { won: true, score: "6-3, 6-4", opponentName: "Sam Patel", partnerName: null },
  ...o,
});

describe("your results", () => {
  it("keeps every kind of match, in the order sent, from your side", () => {
    const rows = myResultRows([
      result({ matchId: 3, context: "Quick match", yours: { won: false, score: "4-6, 2-6", opponentName: "Uncle Bob", partnerName: null } }),
      result({ matchId: 2, context: "Discover" }),
      result({ matchId: 1, playoff: true, inGrace: true }),
    ]);
    expect(rows.map((r) => [r.matchId, r.leagueName, r.won, r.score])).toEqual([
      [3, "Quick match", false, "4-6, 2-6"],
      [2, "Discover", true, "6-3, 6-4"],
      [1, "Tuesday Flex 3.5", true, "6-3, 6-4"],
    ]);
    expect(rows[2]).toMatchObject({ playoff: true, inGrace: true });
  });

  it("leaves out a result you weren't in", () => {
    expect(myResultRows([result({ yours: null })])).toEqual([]);
  });

  it("reads a placeholder opponent by the name you typed", () => {
    const [row] = myResultRows([result({ context: "Quick match", yours: { won: true, score: "6-0, 6-0", opponentName: "Uncle Bob", partnerName: null } })]);
    expect(resultRowText(row)).toEqual({ sub: "vs. Uncle Bob · Quick match", label: "Won 6-0, 6-0. versus Uncle Bob, Quick match" });
  });

  it("shows doubles with team names", () => {
    const [row] = myResultRows([result({ yours: { won: false, score: "3-6, 4-6", opponentName: "Jo Park & Lee Kim", partnerName: "Sam Lee" } })]);
    const text = resultRowText(row);
    expect(text.sub).toBe("You and Sam vs. Jo and Lee · Tuesday Flex 3.5");
    expect(text.label).toBe("Lost 3-6, 4-6. You and Sam Lee versus Jo Park and Lee Kim, Tuesday Flex 3.5");
  });

  it("says walkover and double default in words, with no winner for a double default", () => {
    expect(outcomeSpoken({ won: true, score: "W/O" })).toBe("Won by walkover");
    expect(outcomeSpoken({ won: false, score: "W/O" })).toBe("Lost by walkover");
    expect(outcomeSpoken({ won: null, score: "Double default" })).toBe("Double default, no winner");
  });

  it("reads a career result the same way", () => {
    const row = careerResultRow({
      matchId: 9,
      seasonKey: "y:2026",
      opponentName: "Jo Park & Lee Kim",
      partnerName: "Sam Lee",
      won: true,
      score: "6-4, 6-4",
      context: "Discover",
      playoff: false,
      league: false,
      completedAt: null,
    });
    expect(resultRowText(row).sub).toBe("You and Sam vs. Jo and Lee · Discover");
  });
});
