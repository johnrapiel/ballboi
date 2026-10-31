import { describe, it, expect } from "vitest";
import { computeStandings } from "../lib/leagueStandings.js";

// Spec: Leagues > Scores and standings. Wins only (decision 23); grace-week
// matches don't count (decision 25); dropouts leave standings (decision 27).

const players = [
  { id: 1, name: "Alex", leftAt: null },
  { id: 2, name: "Blair", leftAt: null },
  { id: 3, name: "Casey", leftAt: null },
  { id: 4, name: "Drew", leftAt: new Date("2026-11-10") },
];

function m(p1: number, p2: number, winner: number, extra: Partial<Parameters<typeof computeStandings>[1][number]> = {}) {
  return {
    status: "completed",
    winnerId: winner,
    player1Id: p1,
    player2Id: p2,
    player3Id: null,
    player4Id: null,
    score: winner === p1 ? "6-0, 6-0" : "0-6, 0-6",
    season: null,
    voidedAt: null,
    inGrace: false,
    playoffBracketId: null,
    ...extra,
  };
}

describe("computeStandings", () => {
  it("ranks on wins, not games or sets", () => {
    // Blair wins two close matches; Alex wins one 6-0 6-0.
    const rows = computeStandings(players, [
      { ...m(2, 3, 2), score: "7-6(5), 7-6(5)" },
      { ...m(2, 3, 2), score: "7-6(5), 7-6(5)" },
      m(1, 3, 1),
    ]);
    expect(rows.map((r) => [r.playerName, r.rank, r.wins])).toEqual([
      ["Blair", 1, 2],
      ["Alex", 2, 1],
      ["Casey", 3, 0],
    ]);
  });

  it("gives tied players the same rank", () => {
    const rows = computeStandings(players, [m(1, 3, 1), m(2, 3, 2)]);
    expect(rows.map((r) => [r.playerName, r.rank])).toEqual([
      ["Alex", 1],
      ["Blair", 1],
      ["Casey", 3],
    ]);
  });

  it("leaves out grace-week, voided, playoff, and unfinished matches", () => {
    const rows = computeStandings(players, [
      m(1, 2, 1, { inGrace: true }),
      m(1, 2, 1, { voidedAt: new Date() }),
      m(1, 2, 1, { playoffBracketId: 5 }),
      m(1, 2, 1, { status: "scheduled" }),
    ]);
    expect(rows.every((r) => r.matchesPlayed === 0)).toBe(true);
  });

  it("removes players who left, while their opponents keep those results", () => {
    const rows = computeStandings(players, [m(1, 4, 1)]);
    expect(rows.find((r) => r.playerId === 4)).toBeUndefined();
    expect(rows.find((r) => r.playerId === 1)?.wins).toBe(1);
  });

  it("credits both doubles partners", () => {
    const rows = computeStandings(players, [{ ...m(1, 2, 1), player3Id: 3, player4Id: null }]);
    expect(rows.find((r) => r.playerId === 3)?.wins).toBe(1);
  });

  it("filters by season", () => {
    const rows = computeStandings(players, [m(1, 2, 1, { season: "Fall 2026" }), m(2, 1, 2, { season: "Spring 2026" })], (s) => s === "Fall 2026");
    expect(rows.find((r) => r.playerId === 1)?.wins).toBe(1);
    expect(rows.find((r) => r.playerId === 2)?.wins).toBe(0);
  });
});
