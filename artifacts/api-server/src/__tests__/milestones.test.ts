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

import { GetMyNewMilestonesResponse } from "@workspace/api-zod";
import type { CareerMatch } from "../lib/career";
import type { CareerData, CareerRepo } from "../lib/careerRepo";
import { awardMilestones, awardMilestonesForMatch, backfillMilestones } from "../lib/milestoneRepo";
import { earnedMilestones } from "../lib/milestones";
import { cardMilestones } from "../lib/playerCard";
import { createCareerRouter } from "../routes/career";
import { MemoryMilestones } from "./milestoneMemoryRepo";

// Milestones (decisions 149 and 150, John, Nov 8): first win, first Ball Boi
// match, 5- and 10-match win streaks. Earned once per player on the server,
// stored with the date, and backfilled idempotently.

/** Player rows: 1 is me, 2 Sam, 8 a Quick match stand-in, 9 a placeholder. */
const PLAYERS = new Map<number, { clerkUserId: string | null; name: string }>([
  [1, { clerkUserId: "me", name: "John Rapiel" }],
  [2, { clerkUserId: "sam", name: "Sam Patel" }],
  [8, { clerkUserId: null, name: "Sam" }],
  [9, { clerkUserId: null, name: "Uncle Bob" }],
]);

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
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T18:00:00Z`;
/** One match a day: W for my win, L for my loss. */
const run = (pattern: string) => [...pattern].map((ch, i) => m({ completedAt: day(i + 1), winnerId: ch === "W" ? 1 : 2 }));
const data = (matches: CareerMatch[]): CareerData => ({ matches, players: PLAYERS, users: new Map(), leagues: new Map(), seasons: [] });

describe("earning milestones", () => {
  it("earns the first win on the first won match, dated by it", () => {
    const matches = run("LLW");
    expect(earnedMilestones({ account: "me", matches, players: PLAYERS }, [])).toEqual([{ kind: "first_win", earnedAt: day(3), matchId: matches[2].id }]);
  });

  it("earns 5- and 10-match win streaks on the match that completes them, once", () => {
    const matches = run("WWWWLWWWWWWWWWWWW");
    const earned = earnedMilestones({ account: "me", matches, players: PLAYERS }, []);
    expect(earned.map((e) => [e.kind, e.earnedAt])).toEqual([
      ["first_win", day(1)],
      ["win_streak_5", day(10)],
      ["win_streak_10", day(15)],
    ]);
  });

  it("breaks a streak on a loss, and counts a walkover win", () => {
    const matches = [...run("WWWW"), m({ completedAt: day(5), score: "W/O" })];
    expect(earnedMilestones({ account: "me", matches, players: PLAYERS }, []).map((e) => e.kind)).toContain("win_streak_5");
    expect(earnedMilestones({ account: "me", matches: run("WWLWW"), players: PLAYERS }, []).map((e) => e.kind)).toEqual(["first_win"]);
  });

  it("never counts unconfirmed Quick matches, placeholders or cancelled matches", () => {
    const matches = [
      m({ player2Id: 8, leagueId: null, generatedFrom: "quick_match" }),
      m({ player2Id: 9 }),
      m({ status: "cancelled" }),
      m({ voidedAt: new Date() }),
    ];
    expect(earnedMilestones({ account: "me", matches, players: PLAYERS }, [])).toEqual([]);
  });

  it("earns the first Ball Boi match from the earliest saved recording", () => {
    const earned = earnedMilestones({ account: "me", matches: [], players: PLAYERS }, [
      { matchId: 40, at: "2026-10-09T15:00:00.000Z" },
      { matchId: 31, at: "2026-10-02T15:00:00.000Z" },
    ]);
    expect(earned).toEqual([{ kind: "first_ball_boi", earnedAt: "2026-10-02T15:00:00.000Z", matchId: 31 }]);
  });
});

describe("awarding and backfill", () => {
  it("adds only what's missing, unseen, when a result is saved", async () => {
    const repo = new MemoryMilestones();
    repo.career.set("me", data(run("W")));
    repo.matchAccounts.set(500, ["me", "sam"]);
    await awardMilestonesForMatch(500, repo);
    await awardMilestonesForMatch(500, repo);
    expect(repo.rows.get("me")?.map((r) => [r.kind, r.seenAt])).toEqual([["first_win", null]]);
    expect(repo.inserts).toBe(1);
  });

  it("awards the opponent too, from their side", async () => {
    const repo = new MemoryMilestones();
    const matches = run("L");
    repo.career.set("me", data(matches));
    repo.career.set("sam", data(matches));
    repo.matchAccounts.set(500, ["me", "sam"]);
    await awardMilestonesForMatch(500, repo);
    expect(repo.rows.get("me")).toBeUndefined();
    expect(repo.rows.get("sam")?.map((r) => r.kind)).toEqual(["first_win"]);
  });

  it("never throws when the database is unavailable", async () => {
    await expect(awardMilestonesForMatch(500)).resolves.toBeUndefined();
  });

  it("backfills existing players as already seen, and is idempotent", async () => {
    const repo = new MemoryMilestones();
    repo.career.set("me", data(run("WWWWW")));
    repo.recordings.set("sam", [{ matchId: 3, at: "2026-09-01T10:00:00.000Z" }]);
    expect(await backfillMilestones(repo)).toEqual({ accounts: 2, added: 3 });
    expect(await backfillMilestones(repo)).toEqual({ accounts: 2, added: 0 });
    expect(repo.rows.get("me")?.every((r) => r.seenAt != null)).toBe(true);
    expect(repo.rows.get("me")?.map((r) => [r.kind, r.earnedAt.toISOString()])).toEqual([
      ["first_win", "2026-10-01T18:00:00.000Z"],
      ["win_streak_5", "2026-10-05T18:00:00.000Z"],
    ]);
    expect(repo.rows.get("sam")?.map((r) => r.kind)).toEqual(["first_ball_boi"]);
  });

  it("keeps a milestone when a later edit would no longer earn it", async () => {
    const repo = new MemoryMilestones();
    repo.career.set("me", data(run("W")));
    await awardMilestones(repo, "me", { seen: false });
    repo.career.set("me", data(run("L")));
    await awardMilestones(repo, "me", { seen: false });
    expect(repo.rows.get("me")?.map((r) => r.kind)).toEqual(["first_win"]);
  });
});

describe("milestones on the card", () => {
  it("keeps known kinds, oldest first", () => {
    expect(
      cardMilestones([
        { kind: "win_streak_5", earnedAt: new Date("2026-10-05T00:00:00Z") },
        { kind: "mystery", earnedAt: new Date("2026-01-01T00:00:00Z") },
        { kind: "first_win", earnedAt: new Date("2026-10-01T00:00:00Z") },
      ]),
    ).toEqual([
      { kind: "first_win", earnedAt: "2026-10-01T00:00:00.000Z" },
      { kind: "win_streak_5", earnedAt: "2026-10-05T00:00:00.000Z" },
    ]);
  });
});

describe("the moment's routes", () => {
  const noCareer: CareerRepo = { data: async () => data([]), blocked: async () => new Set() };
  const app = (repo: MemoryMilestones) => {
    const a = express();
    a.use(express.json());
    a.use(createCareerRouter(noCareer, repo, () => new Date("2026-11-10T12:00:00Z")));
    return supertest(a);
  };

  it("lists milestones whose moment hasn't played, then marks them seen", async () => {
    const repo = new MemoryMilestones();
    repo.rows.set("me", [
      { kind: "first_win", earnedAt: new Date("2026-10-01T18:00:00Z"), seenAt: new Date("2026-10-02T00:00:00Z"), matchId: 1 },
      { kind: "win_streak_5", earnedAt: new Date("2026-10-20T18:00:00Z"), seenAt: null, matchId: 2 },
      { kind: "first_ball_boi", earnedAt: new Date("2026-10-10T18:00:00Z"), seenAt: null, matchId: 3 },
    ]);
    const res = await app(repo).get("/player-cards/me/milestones/new").expect(200);
    expect(GetMyNewMilestonesResponse.parse(res.body)).toBeTruthy();
    expect(res.body.milestones.map((x: { kind: string }) => x.kind)).toEqual(["first_ball_boi", "win_streak_5"]);

    await app(repo).post("/player-cards/me/milestones/seen").send({ kinds: ["win_streak_5", "nonsense"] }).expect(200);
    const after = await app(repo).get("/player-cards/me/milestones/new").expect(200);
    expect(after.body.milestones.map((x: { kind: string }) => x.kind)).toEqual(["first_ball_boi"]);
  });

  it("refuses a bad body and needs you signed in", async () => {
    await app(new MemoryMilestones()).post("/player-cards/me/milestones/seen").send({ kinds: "first_win" }).expect(400);
    mockUserId = null;
    await app(new MemoryMilestones()).get("/player-cards/me/milestones/new").expect(401);
    mockUserId = "me";
  });
});
