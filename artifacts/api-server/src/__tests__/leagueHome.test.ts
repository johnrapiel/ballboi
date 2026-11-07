import { describe, it, expect } from "vitest";
import { buildLeagueHome, homeLeagues, seasonFrom, type HomeInput, type HomeMatch } from "../lib/leagueHome.js";

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
    now: new Date("2026-11-13T17:00:00Z"),
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
    expect(home.playoffs).toEqual([{ leagueId: 1, leagueName: "Tuesday Flex", matchId: 200, round: "semifinal", opponentName: "Alex", singles: true, timeZone: "America/New_York", playBy: null, pastPlayBy: false, scheduledAt: null, location: null }]);
  });

  it("leaves out leagues I've left", () => {
    const home = buildLeagueHome(input({ myPlayers: [{ id: 10, leagueId: 1, leftAt: new Date() }], matches: [match(101, 2, 30, 10)] }));
    expect(home.thisWeek).toEqual([]);
  });
});

describe("buildLeagueHome time zones and played matches (PR 4)", () => {
  it("runs each league's week on its own time zone", () => {
    // 06:00 UTC on Nov 12 is Nov 12 in New York but still Nov 11 in Los Angeles,
    // so the Los Angeles league's round 2 hasn't started there yet.
    const at = new Date("2026-11-12T06:00:00Z");
    const east = buildLeagueHome(input({ now: at, matches: [match(101, 2, 10, 20)] }));
    expect(east.thisWeek.find((i) => i.roundId === 2)?.phase).toBe("open");
    const west = buildLeagueHome(
      input({
        now: at,
        leagues: [{ id: 1, name: "Tuesday Flex", leagueType: "singles", timeZone: "America/Los_Angeles" }],
        matches: [match(101, 2, 10, 20)],
      }),
    );
    const item = west.thisWeek.find((i) => i.roundId === 2);
    expect(item?.phase).toBe("upcoming");
    expect(item?.timeZone).toBe("America/Los_Angeles");
  });

  it("marks a match with a score as played, so it offers nothing to enter or record", () => {
    const home = buildLeagueHome(
      input({ matches: [match(101, 2, 10, 20, { status: "completed", score: "6-3, 6-4", winnerId: 10 }), match(102, 1, 10, 30)] }),
    );
    expect(home.thisWeek.map((i) => [i.matchId, i.played])).toEqual([
      [102, false],
      [101, true],
    ]);
  });
});

describe("buildLeagueHome playoffs (PR 5)", () => {
  const semi = match(200, null, 10, 20, { playoffBracketId: 5, playoffRound: "semifinal" });

  it("offers no playoff match from an ended league (C15)", () => {
    const ended = input({ leagues: [{ id: 1, name: "Tuesday Flex", leagueType: "singles", endedAt: new Date() }], matches: [semi] });
    expect(buildLeagueHome(ended).playoffs).toEqual([]);
    const finished = input({ leagues: [{ id: 1, name: "Tuesday Flex", leagueType: "singles", status: "completed" }], matches: [semi] });
    expect(buildLeagueHome(finished).playoffs).toEqual([]);
  });

  it("shows the round's play-by date, and when it has passed (Q5b)", () => {
    const home = buildLeagueHome(input({ matches: [semi], playoffPlayBy: new Map([[200, "2026-11-12"]]) }));
    expect(home.playoffs[0]).toMatchObject({ playBy: "2026-11-12", pastPlayBy: true });
    const later = buildLeagueHome(input({ matches: [semi], playoffPlayBy: new Map([[200, "2026-11-29"]]) }));
    expect(later.playoffs[0]).toMatchObject({ playBy: "2026-11-29", pastPlayBy: false });
  });

  it("shows a retirement from my side", () => {
    const home = buildLeagueHome(
      input({ matches: [match(101, 2, 20, 10, { status: "completed", score: "6-3, 2-1 RET", winnerId: 20, completedAt: "2026-11-12T10:00:00Z" })] }),
    );
    expect(home.recent[0]).toMatchObject({ score: "3-6, 1-2 RET", won: false });
  });
});

describe("season stats, all results and your leagues (finding 14)", () => {
  const done = (id: number, winner: number, completedAt: string, extra: Partial<HomeMatch> = {}) =>
    match(id, 2, 10, 20, { status: "completed", score: winner === 10 ? "6-3, 6-4" : "3-6, 4-6", winnerId: winner, completedAt, ...extra });

  it("counts wins, losses and the current streak, newest first", () => {
    expect(seasonFrom([{ won: true }, { won: true }, { won: false }, { won: true }])).toEqual({ wins: 3, losses: 1, played: 4, streak: { won: true, count: 2 } });
    expect(seasonFrom([{ won: false }, { won: true }])).toMatchObject({ streak: { won: false, count: 1 } });
    expect(seasonFrom([])).toEqual({ wins: 0, losses: 0, played: 0, streak: null });
  });

  it("keeps every result for My matches and the last five for Home", () => {
    const matches = Array.from({ length: 7 }, (_, i) => done(300 + i, i % 2 ? 10 : 20, `2026-11-0${i + 1}T10:00:00Z`));
    const home = buildLeagueHome(input({ matches }));
    expect(home.results).toHaveLength(7);
    expect(home.recent).toHaveLength(5);
    expect(home.recent[0].matchId).toBe(306);
    expect(home.season).toMatchObject({ wins: 3, losses: 4, played: 7, streak: { won: false, count: 1 } });
  });

  it("leaves an ended league's results out of the season stats", () => {
    const home = buildLeagueHome(
      input({ leagues: [{ id: 1, name: "Tuesday Flex", leagueType: "singles", endedAt: new Date() }], matches: [done(300, 10, "2026-11-01T10:00:00Z")] }),
    );
    expect(home.results).toHaveLength(1);
    expect(home.season.played).toBe(0);
  });

  it("summarises each running league: your rank, record, and the top three plus you", () => {
    const table = [1, 2, 3, 4, 5].map((rank) => ({ rank, playerId: rank === 5 ? 10 : 100 + rank, playerName: `P${rank}`, wins: 6 - rank, losses: rank - 1 }));
    const out = homeLeagues({
      myPlayers: [{ id: 10, leagueId: 1, leftAt: null }, { id: 11, leagueId: 2, leftAt: null }, { id: 12, leagueId: 3, leftAt: new Date() }],
      leagues: [
        { id: 1, name: "Tuesday Flex", location: "Beacon Courts" },
        { id: 2, name: "Old league", endedAt: new Date() },
        { id: 3, name: "Left league" },
      ],
      standings: new Map([[1, table]]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ leagueName: "Tuesday Flex", location: "Beacon Courts", rank: 5, playerCount: 5, wins: 1, losses: 4 });
    expect(out[0].rows.map((r) => [r.rank, r.you])).toEqual([[1, false], [2, false], [3, false], [5, true]]);
  });
});
