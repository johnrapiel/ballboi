import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// D13: top players, recent activity and head-to-head need sign-in, and only
// show matches in leagues the caller belongs to or matches they played in.

let mockUserId: string | null = "user_me";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const rows: Record<string, Row[]> = {};
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguesTable: table("leagues", ["id", "name", "createdByClerkUserId"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "name"]),
    matchesTable: table("matches", ["id", "leagueId", "status", "season", "player1Id", "player2Id", "player3Id", "player4Id", "updatedAt", "completedAt"]),
    leagueAdminsTable: table("league_admins", ["leagueId", "clerkUserId"]),
    leagueRoundsTable: table("league_rounds", ["id"]),
    scheduleGenerationLogsTable: table("schedule_generation_logs", ["id"]),
    ballBoiSessionsTable: table("ball_boi_sessions", ["id"]),
    matchStatisticsTable: table("match_statistics", ["id"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("../middlewares/requireAdmin", () => ({ requireAdmin: vi.fn() }));

const at = new Date("2026-10-01T00:00:00Z");
const match = (id: number, leagueId: number | null, p1: number, p2: number) => ({
  id, leagueId, status: "completed", season: null, player1Id: p1, player2Id: p2, player3Id: null, player4Id: null,
  winnerId: p1, score: "6-3, 6-2", completedAt: "2026-10-01", scheduledAt: null, location: null, notes: null,
  createdAt: at, updatedAt: at,
});

async function app() {
  const { default: router } = await import("../routes/stats.js");
  const a = express();
  a.use("/api", router);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_me";
  rows.leagues = [
    { id: 1, name: "My League", createdByClerkUserId: "user_owner" },
    { id: 2, name: "Private Elsewhere", createdByClerkUserId: "user_owner" },
  ];
  rows.players = [
    { id: 11, leagueId: 1, clerkUserId: "user_me", name: "Me", skillLevel: "3.5" },
    { id: 12, leagueId: 1, clerkUserId: "user_b", name: "Teammate", skillLevel: "3.5" },
    { id: 21, leagueId: 2, clerkUserId: "user_x", name: "Stranger X", skillLevel: "3.5" },
    { id: 22, leagueId: 2, clerkUserId: "user_y", name: "Stranger Y", skillLevel: "3.5" },
  ];
  rows.league_admins = [];
  rows.matches = [match(100, 1, 11, 12), match(200, 2, 21, 22)];
});

describe("stats need sign-in", () => {
  for (const path of ["/api/stats/top-players", "/api/stats/recent-activity", "/api/stats/head-to-head?player1Id=11&player2Id=12"]) {
    it(path, async () => {
      mockUserId = null;
      expect((await (await app()).get(path)).status).toBe(401);
    });
  }
});

describe("GET /stats/top-players", () => {
  it("ranks only players in my leagues", async () => {
    const res = await (await app()).get("/api/stats/top-players");
    expect(res.status).toBe(200);
    expect(res.body.map((p: { name: string }) => p.name).sort()).toEqual(["Me", "Teammate"]);
  });

  it("refuses a league I'm not in", async () => {
    expect((await (await app()).get("/api/stats/top-players?leagueId=2")).status).toBe(403);
  });

  it("is empty when I'm in no league", async () => {
    mockUserId = "user_nobody";
    const res = await (await app()).get("/api/stats/top-players");
    expect(res.body).toEqual([]);
  });
});

describe("GET /stats/recent-activity", () => {
  it("shows only matches in my leagues or that I played", async () => {
    rows.matches.push(match(300, null, 11, 21)); // a quick match I played with someone outside my league
    const res = await (await app()).get("/api/stats/recent-activity");
    expect(res.body.map((m: { matchId: number }) => m.matchId).sort()).toEqual([100, 300]);
    expect(JSON.stringify(res.body)).not.toContain("Stranger Y");
  });
});

describe("GET /stats/head-to-head", () => {
  it("works for players I can see", async () => {
    const res = await (await app()).get("/api/stats/head-to-head?player1Id=11&player2Id=12");
    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(1);
  });

  it("won't reveal players from a league I'm not in", async () => {
    const res = await (await app()).get("/api/stats/head-to-head?player1Id=21&player2Id=22");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Stranger");
  });
});
