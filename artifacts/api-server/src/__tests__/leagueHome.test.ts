import { describe, it, expect } from "vitest";
import { buildLeagueHome, type HomeInput, type HomeMatch } from "../lib/leagueHome.js";

// Spec: Navigation > Home. This week's matches, pairings, and recent results.

const pub = new Date("2026-11-01T12:00:00Z");
function match(id: number, roundId: number | null, p1: number, p2: number, extra: Partial<HomeMatch> = {}): HomeMatch {
  return {
    id, leagueId: 1, roundId, player1Id: p1, player2Id: p2, player3Id: null, player4Id: null, status: "scheduled",
    score: null, winnerId: null, inGrace: false, voidedAt: null, completedAt: null, scheduledAt: null, location: null,
    playoffBracketId: null, playoffRound: null, ...extra,
  };
}

function input(extra: Partial<HomeInput> = {}): HomeInput {
  return {
    today: "2026-11-13",
    myPlayers: [{ id: 10, leagueId: 1, leftAt: null }],
    leagues: [{ id: 1, name: "Tuesday Flex", leagueType: "singles" }],
    rounds: [
      { id: 1, leagueId: 1, roundNumber: 1, startDate: "2026-11-05", endDate: "2026-11-11", publishedAt: pub }, // grace
      { id: 2, leagueId: 1, roundNumber: 2, startDate: "2026-11-12", endDate: "2026-11-18", publishedAt: pub }, // open
      { id: 3, leagueId: 1, roundNumber: 3, startDate: "2026-11-19", endDate: "2026-11-25", publishedAt: null }, // draft
    ],
    matches: [],
    byes: [],
    names: new Map([[10, "Me"], [20, "Alex"], [30, "Blair"]]),
    adminLeagueIds: [],
    ...extra,
  };
}

describe("buildLeagueHome", () => {
  it("shows this week's match with the opponent, and a grace-week match still to score", () => {
    const home = buildLeagueHome(input({ matches: [match(100, 1, 10, 20), match(101, 2, 30, 10)] }));
    expect(home.thisWeek.map((i) => [i.roundNumber, i.phase, i.opponentName])).toEqual([
      [1, "grace", "Alex"],
      [2, "open", "Blair"],
    ]);
  });

  it("drops a grace-week match once it's scored, and shows a bye", () => {
    const home = buildLeagueHome(
      input({ matches: [match(100, 1, 10, 20, { status: "completed", score: "6-1, 6-1", winnerId: 10 })], byes: [{ roundId: 2, playerId: 10 }] }),
    );
    expect(home.thisWeek.map((i) => [i.roundNumber, i.bye])).toEqual([[2, true]]);
  });

  it("never shows drafts to players, only to admins", () => {
    expect(buildLeagueHome(input()).drafts).toEqual([]);
    expect(buildLeagueHome(input({ adminLeagueIds: [1] })).drafts.map((d) => d.roundNumber)).toEqual([3]);
  });

  it("lists recent results from my side, newest first, voided matches left out", () => {
    const home = buildLeagueHome(
      input({
        matches: [
          match(100, 1, 20, 10, { status: "completed", score: "6-3, 6-4", winnerId: 20, completedAt: "2026-11-06T10:00:00Z" }),
          match(101, 2, 10, 30, { status: "completed", score: "6-2, 3-6, 10-8", winnerId: 10, completedAt: "2026-11-12T10:00:00Z", inGrace: false }),
          match(102, 2, 10, 30, { status: "voided", voidedAt: new Date() }),
        ],
      }),
    );
    expect(home.recent.map((r) => [r.opponentName, r.score, r.won])).toEqual([
      ["Blair", "6-2, 3-6, 10-8", true],
      ["Alex", "3-6, 4-6", false],
    ]);
  });

  it("shows my unscored playoff match", () => {
    const home = buildLeagueHome(input({ matches: [match(200, null, 10, 20, { playoffBracketId: 5, playoffRound: "semifinal" })] }));
    expect(home.playoffs).toEqual([{ leagueId: 1, leagueName: "Tuesday Flex", matchId: 200, round: "semifinal", opponentName: "Alex", singles: true }]);
  });

  it("leaves out leagues I've left", () => {
    const home = buildLeagueHome(input({ myPlayers: [{ id: 10, leagueId: 1, leftAt: new Date() }], matches: [match(101, 2, 30, 10)] }));
    expect(home.thisWeek).toEqual([]);
  });
});
