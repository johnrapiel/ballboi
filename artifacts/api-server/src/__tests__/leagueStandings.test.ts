import { describe, it, expect } from "vitest";
import { computeStandings } from "../lib/leagueStandings.js";

// Spec: Leagues > Scores and standings. Wins first (decision 23), then head to
// head, sets and games for players level on wins (John, Nov 6); grace-week
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

  it("splits players level on wins by head to head first (John, Nov 6)", () => {
    // Alex and Blair both have 1 win; Blair beat Alex, so Blair ranks above
    // even though Alex's win was the bigger one.
    const rows = computeStandings(players, [{ ...m(2, 1, 2), score: "7-6(5), 7-6(5)" }, m(1, 3, 1)]);
    expect(rows.map((r) => [r.playerName, r.rank, r.wins])).toEqual([
      ["Blair", 1, 1],
      ["Alex", 2, 1],
      ["Casey", 3, 0],
    ]);
  });

  it("then by share of sets won when head to head doesn't split them", () => {
    // Alex and Blair never met; Alex dropped a set on the way, Blair didn't.
    const rows = computeStandings(players, [
      { ...m(1, 3, 1), score: "6-4, 3-6, 6-2" },
      { ...m(2, 3, 2), score: "6-4, 6-3" },
    ]);
    expect(rows.map((r) => [r.playerName, r.rank])).toEqual([
      ["Blair", 1],
      ["Alex", 2],
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

import { computeTeamStandings, headToHead } from "../lib/leagueStandings.js";

describe("doubles standings (D3)", () => {
  const d = (s1: [number, number], s2: [number, number], side1Won: boolean, extra: Record<string, unknown> = {}) => ({
    ...m(s1[0], s2[0], side1Won ? s1[0] : s2[0]),
    player3Id: s1[1],
    player4Id: s2[1],
    ...extra,
  });

  it("rotating partners: ranks players, both partners credited", () => {
    const four = [1, 2, 3, 5].map((id) => ({ id, name: `P${id}`, leftAt: null }));
    const rows = computeStandings(four, [d([1, 2], [3, 5], true), d([1, 3], [2, 5], true)]);
    expect(rows.map((r) => [r.playerName, r.wins, r.losses])).toEqual([
      ["P1", 2, 0],
      ["P2", 1, 1],
      ["P3", 1, 1],
      ["P5", 0, 2],
    ]);
  });

  it("rotating ties go to head to head: a tied player who beat the other", () => {
    const tied = [2, 3].map((id) => ({ playerId: id, playerName: `P${id}`, wins: 1, setsWon: 2, setsLost: 2, gamesWon: 10, gamesLost: 10 }));
    // P3 was on the winning side against P2; P2's own win was against other players.
    const h2h = headToHead(tied, [d([3, 4], [2, 5], true), d([2, 1], [4, 5], true)]);
    expect(h2h.get(3)).toBe(1);
    expect(h2h.get(2)).toBeUndefined();
  });

  it("fixed partners: ranks teams by name, ties on head to head then sets", () => {
    const names = new Map([[1, "John Rapiel"], [2, "Sam Lee"], [3, "Jo Park"], [4, "Lee King"], [5, "Ana Diaz"], [6, "Bo Chen"]]);
    const teams = [
      { id: 10, playerIds: [1, 2] as [number, number] },
      { id: 11, playerIds: [3, 4] as [number, number] },
      { id: 12, playerIds: [5, 6] as [number, number] },
    ];
    const rows = computeTeamStandings(teams, names, [
      d([3, 4], [1, 2], true, { team1Id: 11, team2Id: 10 }),
      d([1, 2], [5, 6], true, { team1Id: 10, team2Id: 12 }),
      d([5, 6], [3, 4], true, { team1Id: 12, team2Id: 11 }),
    ]);
    // All 1-1: sets and games level too, so they share a rank.
    expect(rows.every((r) => r.wins === 1 && r.losses === 1)).toBe(true);
    const more = computeTeamStandings(teams, names, [
      d([3, 4], [1, 2], true, { team1Id: 11, team2Id: 10 }),
      d([1, 2], [5, 6], true, { team1Id: 10, team2Id: 12 }),
      d([3, 4], [5, 6], true, { team1Id: 11, team2Id: 12 }),
    ]);
    expect(more.map((r) => [r.rank, r.playerName, `${r.wins}-${r.losses}`, r.teamId, r.teamPlayerIds, r.playerId])).toEqual([
      [1, "Jo Park & Lee King", "2-0", 11, [3, 4], 3],
      [2, "John Rapiel & Sam Lee", "1-1", 10, [1, 2], 1],
      [3, "Ana Diaz & Bo Chen", "0-2", 12, [5, 6], 5],
    ]);
  });

  it("D4: a broken team leaves the standings; the re-teamed player's new team starts 0-0", () => {
    const names = new Map([[1, "A One"], [2, "B Two"], [3, "C Three"], [4, "D Four"], [7, "E Five"]]);
    const played = [d([1, 2], [3, 4], true, { team1Id: 10, team2Id: 11 })];
    const now = [
      { id: 11, playerIds: [3, 4] as [number, number] },
      { id: 13, playerIds: [1, 7] as [number, number] },
    ];
    const rows = computeTeamStandings(now, names, played);
    expect(rows.map((r) => [r.playerName, r.wins, r.losses])).toEqual([
      ["A One & E Five", 0, 0],
      ["C Three & D Four", 0, 1],
    ]);
  });
});
