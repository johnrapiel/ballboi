import { describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: { select: () => { throw new Error("No database in this test"); } } };
});

import { GetMyCareerResponse } from "@workspace/api-zod";
import { careerStats, contextFor, scoreTotals, type CareerInput, type CareerMatch } from "../lib/career";
import type { CareerData, CareerRepo } from "../lib/careerRepo";
import { createCareerRouter } from "../routes/career";
import { MemoryMilestones } from "./milestoneMemoryRepo";

// Career (decision 147, John, Nov 8): all-time record, best win streak, sets,
// games and tiebreaks, seasons and head-to-head.

/** Player rows: 1 is me, 2 Sam, 3 Priya, 4 Theo (blocked), 8 a Quick match stand-in, 9 a placeholder. */
const PLAYERS = new Map<number, { clerkUserId: string | null; name: string }>([
  [1, { clerkUserId: "me", name: "John Rapiel" }],
  [2, { clerkUserId: "sam", name: "Sam Patel" }],
  [3, { clerkUserId: "priya", name: "Priya Shah" }],
  [4, { clerkUserId: "theo", name: "Theo Park" }],
  [8, { clerkUserId: null, name: "Sam" }],
  [9, { clerkUserId: null, name: "Uncle Bob" }],
]);
const USERS = new Map([
  ["me", { userId: 101, name: "John Rapiel" }],
  ["sam", { userId: 102, name: "Sam Patel" }],
  ["priya", { userId: 103, name: "Priya Shah" }],
  ["theo", { userId: 104, name: "Theo Park" }],
]);
const SEASONS = [
  { name: "Summer 2026", startDate: "2026-05-01", endDate: "2026-08-31" },
  { name: "Fall 2026", startDate: "2026-09-01", endDate: "2026-12-31" },
];

let nextId = 1;
const m = (o: Partial<CareerMatch>): CareerMatch => ({
  id: nextId++,
  leagueId: 7,
  player1Id: 1,
  player2Id: 2,
  player3Id: null,
  player4Id: null,
  winnerId: 1,
  status: "completed",
  score: "6-3, 6-4",
  completedAt: "2026-10-01T18:00:00Z",
  voidedAt: null,
  generatedFrom: "round",
  playoffBracketId: null,
  ...o,
});

const input = (matches: CareerMatch[], blocked: string[] = []): CareerInput => ({
  account: "me",
  matches,
  players: PLAYERS,
  users: USERS,
  leagues: new Map([[7, { name: "Tuesday Flex 3.5" }]]),
  seasons: SEASONS,
  blocked: new Set(blocked),
});

describe("score totals", () => {
  it("counts sets, games and set tiebreaks from your side", () => {
    expect(scoreTotals("6-3, 6-7(4), 7-6(5)")).toEqual({
      sets: { won: 2, lost: 1 },
      games: { won: 19, lost: 16 },
      tiebreaks: { won: 1, lost: 1 },
    });
  });

  it("counts a match tiebreak as one game and one tiebreak", () => {
    expect(scoreTotals("6-4, 3-6, 10-8")).toEqual({
      sets: { won: 2, lost: 1 },
      games: { won: 10, lost: 10 },
      tiebreaks: { won: 1, lost: 0 },
    });
  });

  it("counts a retirement's games but not its unfinished set", () => {
    expect(scoreTotals("6-3, 2-1 RET")).toEqual({
      sets: { won: 1, lost: 0 },
      games: { won: 8, lost: 4 },
      tiebreaks: { won: 0, lost: 0 },
    });
  });

  it("gives a walkover no sets or games", () => {
    expect(scoreTotals("W/O")).toEqual({ sets: { won: 0, lost: 0 }, games: { won: 0, lost: 0 }, tiebreaks: { won: 0, lost: 0 } });
  });
});

describe("career stats", () => {
  it("counts league, Discover and confirmed Quick matches, from your side", () => {
    const c = careerStats(
      input([
        m({ completedAt: "2026-06-01T18:00:00Z", score: "6-3, 6-4" }),
        // I'm player 2 and lost: stored from player 1's side.
        m({ completedAt: "2026-06-08T18:00:00Z", player1Id: 3, player2Id: 1, winnerId: 3, score: "6-2, 7-6(3)", leagueId: null, generatedFrom: "discover" }),
        // A Quick match Sam confirmed: he's on his own row now.
        m({ completedAt: "2026-09-10T18:00:00Z", leagueId: null, generatedFrom: "quick_match", score: "7-5, 6-4" }),
      ]),
    );
    expect(c.wins).toBe(2);
    expect(c.losses).toBe(1);
    expect(c.played).toBe(3);
    expect(c.sets).toEqual({ won: 4, lost: 2 });
    expect(c.games).toEqual({ won: 6 + 6 + 2 + 6 + 7 + 6, lost: 3 + 4 + 6 + 7 + 5 + 4 });
    expect(c.tiebreaks).toEqual({ won: 0, lost: 1 });
    expect(c.results.map((r) => [r.context, r.score, r.won])).toEqual([
      ["Quick match", "7-5, 6-4", true],
      ["Discover", "2-6, 6-7(3)", false],
      ["Tuesday Flex 3.5", "6-3, 6-4", true],
    ]);
  });

  it("never counts unconfirmed Quick matches, placeholders, cancelled or voided matches", () => {
    const c = careerStats(
      input([
        m({ player2Id: 8, leagueId: null, generatedFrom: "quick_match" }),
        m({ player2Id: 9 }),
        m({ status: "cancelled" }),
        m({ voidedAt: new Date("2026-10-02T00:00:00Z") }),
        m({ status: "scheduled", score: null }),
      ]),
    );
    expect(c).toMatchObject({ wins: 0, losses: 0, played: 0, results: [], headToHead: [], seasons: [] });
  });

  it("counts a walkover in the record but not its games", () => {
    const c = careerStats(input([m({ score: "W/O", winnerId: 1 }), m({ score: "6-0, 6-0" })]));
    expect(c.wins).toBe(2);
    expect(c.games).toEqual({ won: 12, lost: 0 });
    expect(c.sets).toEqual({ won: 2, lost: 0 });
  });

  it("finds the best win streak in date order", () => {
    const days = ["01", "02", "03", "04", "05", "06", "07", "08"];
    const wonBy = [1, 1, 2, 1, 1, 1, 2, 1];
    const c = careerStats(input(days.map((d, i) => m({ completedAt: `2026-10-${d}T18:00:00Z`, winnerId: wonBy[i] })).reverse()));
    expect(c.bestWinStreak).toBe(3);
  });

  it("groups results by season, newest first, with the calendar year outside a season", () => {
    const c = careerStats(
      input([
        m({ completedAt: "2026-06-01T18:00:00Z" }),
        m({ completedAt: "2026-10-01T18:00:00Z", winnerId: 2 }),
        m({ completedAt: "2026-10-05T18:00:00Z" }),
        m({ completedAt: "2026-02-01T18:00:00Z" }),
      ]),
    );
    expect(c.seasons.map((s) => [s.name, s.wins, s.losses, s.played])).toEqual([
      ["Fall 2026", 1, 1, 2],
      ["Summer 2026", 1, 0, 1],
      ["2026", 1, 0, 1],
    ]);
    const fall = c.seasons[0].key;
    expect(c.results.filter((r) => r.seasonKey === fall)).toHaveLength(2);
  });

  it("lists head-to-head by most played, with links, and never a blocked player", () => {
    const c = careerStats(
      input(
        [
          m({}),
          m({ winnerId: 2 }),
          m({}),
          m({ player2Id: 3 }),
          m({ player2Id: 4 }),
          // Doubles: each opponent counts.
          m({ player3Id: 9, player2Id: 2, player4Id: 3, winnerId: 2 }),
        ],
        ["theo"],
      ),
    );
    expect(c.headToHead).toEqual([
      { userId: 102, name: "Sam Patel", wins: 2, losses: 2 },
      { userId: 103, name: "Priya Shah", wins: 1, losses: 1 },
    ]);
    // Theo's match still counts in the totals.
    expect(c.wins).toBe(4);
    expect(c.results[0].opponentName).toBe("Sam Patel & Priya Shah");
  });

  it("names where a match was played", () => {
    const leagues = new Map([[7, { name: "Tuesday Flex 3.5" }]]);
    expect(contextFor({ leagueId: 7, generatedFrom: "round" }, leagues)).toBe("Tuesday Flex 3.5");
    expect(contextFor({ leagueId: null, generatedFrom: "discover_open_match" }, leagues)).toBe("Discover");
    expect(contextFor({ leagueId: null, generatedFrom: "quick_match" }, leagues)).toBe("Quick match");
  });
});

describe("GET /player-cards/me/career", () => {
  class MemoryCareer implements CareerRepo {
    constructor(private readonly matches: CareerMatch[], private readonly blocks: string[] = []) {}
    async data(): Promise<CareerData> {
      return { matches: this.matches, players: PLAYERS, users: USERS, leagues: new Map([[7, { name: "Tuesday Flex 3.5" }]]), seasons: SEASONS };
    }
    async blocked() {
      return new Set(this.blocks);
    }
  }
  const app = (repo: CareerRepo, milestones = new MemoryMilestones()) => {
    const a = express();
    a.use(express.json());
    a.use(createCareerRouter(repo, milestones, () => new Date("2026-11-10T12:00:00Z")));
    return a;
  };

  it("needs you signed in", async () => {
    mockUserId = null;
    await supertest(app(new MemoryCareer([]))).get("/player-cards/me/career").expect(401);
    mockUserId = "me";
  });

  it("sends your career in the contract's shape", async () => {
    const res = await supertest(app(new MemoryCareer([m({}), m({ player2Id: 4 })], ["theo"])))
      .get("/player-cards/me/career")
      .expect(200);
    expect(GetMyCareerResponse.parse(res.body)).toBeTruthy();
    expect(res.body.played).toBe(2);
    expect(res.body.headToHead).toEqual([{ userId: 102, name: "Sam Patel", wins: 1, losses: 0 }]);
    expect(res.body.milestones).toEqual([]);
  });

  it("lists your milestones with the date each was earned, oldest first", async () => {
    const ms = new MemoryMilestones();
    ms.rows.set("me", [
      { kind: "win_streak_5", earnedAt: new Date("2026-10-20T18:00:00Z"), seenAt: null, matchId: 9 },
      { kind: "first_win", earnedAt: new Date("2026-06-01T18:00:00Z"), seenAt: new Date(), matchId: 1 },
    ]);
    const res = await supertest(app(new MemoryCareer([m({})]), ms)).get("/player-cards/me/career").expect(200);
    expect(GetMyCareerResponse.parse(res.body)).toBeTruthy();
    expect(res.body.milestones).toEqual([
      { kind: "first_win", earnedAt: "2026-06-01T18:00:00.000Z" },
      { kind: "win_streak_5", earnedAt: "2026-10-20T18:00:00.000Z" },
    ]);
  });
});
