import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// PR 8, rows 1 and 2 (decision 29). A round an admin hasn't sent yet stays
// with the league's admins: no route that shows rounds or pairings to players
// returns it. And reading a league's rounds never makes new ones; only the
// 7am league job (and an admin's own actions) create rounds.

let mockUserId: string | null = "user_player";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const rows: Record<string, Row[]> = {};
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguesTable: table("leagues", ["id", "name", "createdByClerkUserId", "visibility", "leagueType", "seasonWeeks", "createdAt"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "name", "leftAt"]),
    matchesTable: table("matches", ["id", "leagueId", "roundId", "status", "player1Id", "player2Id", "player3Id", "player4Id", "weekOf", "scheduledAt", "createdAt", "completedAt"]),
    leagueAdminsTable: table("league_admins", ["leagueId", "clerkUserId", "role"]),
    leagueRoundsTable: table("league_rounds", ["id", "leagueId", "roundNumber", "status", "startDate", "endDate", "publishedAt"]),
    leagueRoundByesTable: table("league_round_byes", ["roundId"]),
    usersTable: table("users", ["clerkUserId", "displayName", "rating", "ratingSource"]),
    ballBoiSessionsTable: table("ball_boi_sessions", ["matchId"]),
    matchStatisticsTable: table("match_statistics", ["matchId"]),
    scheduleGenerationLogsTable: table("schedule_generation_logs", ["id", "leagueId", "weekOf", "status"]),
    seasonsTable: table("seasons", ["id", "leagueId"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("@workspace/api-zod", () => ({
  UpdateMatchBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
  CreateMatchBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));
vi.mock("../lib/blocks.js", () => ({ blockedAccountsFor: async () => new Set<string>() }));
vi.mock("../routes/notifications", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./notifications", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/seasonService.js", () => ({ getAutoSeason: vi.fn().mockResolvedValue(null) }));
vi.mock("../services/seasonService", () => ({ getAutoSeason: vi.fn().mockResolvedValue(null) }));
const generateAllRounds = vi.fn();
vi.mock("../services/roundPairing", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateAllRounds: (...args: unknown[]) => generateAllRounds(...args),
}));
vi.mock("../services/leagueRounds.js", () => ({
  usesWeeklyRounds: () => true,
  draftNextRound: vi.fn(), loadDraftRound: vi.fn(), publishRound: vi.fn(), repairRound: vi.fn(),
}));
vi.mock("../services/leaguePlayoffs.js", () => ({ bracketFor: vi.fn().mockResolvedValue(null) }));
vi.mock("../services/matchGeneration", () => ({ generateWeeklyMatches: vi.fn(), saveGeneratedMatches: vi.fn() }));
vi.mock("../middlewares/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("../middlewares/requireAdmin.js", () => ({ requireAdmin: vi.fn() }));

async function app() {
  const routers = await Promise.all([
    import("../routes/rounds.js"),
    import("../routes/matches.js"),
    import("../routes/stats.js"),
    import("../routes/scheduling.js"),
    import("../routes/leagueSchedule.js"),
  ]);
  const a = express();
  a.use(express.json());
  for (const r of routers) a.use("/api", r.default);
  return supertest(a);
}

// This week's Monday, as /stats/my-schedule works it out.
function currentWeekOf(): string {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
  return monday.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);
const WEEK = currentWeekOf();
const at = new Date("2026-10-01T00:00:00Z");
const match = (id: number, roundId: number | null, p1: number, p2: number) => ({
  id, leagueId: 1, roundId, status: "scheduled", player1Id: p1, player2Id: p2, player3Id: null, player4Id: null,
  winnerId: null, score: null, weekOf: WEEK, scheduledAt: null, completedAt: null, location: null, notes: null,
  voidedAt: null, locked: false, inGrace: false, correctedAt: null, scoreClearedByName: null,
  createdAt: at, updatedAt: at,
});

// League 1: run by user_admin; user_player plays in it. Round 1 went out and
// is on now; round 2 is the admin's draft for next week. user_player is paired
// with Tom in round 1 and with Una in the draft.
beforeEach(() => {
  mockUserId = "user_player";
  generateAllRounds.mockReset();
  for (const k of Object.keys(rows)) delete rows[k];
  Object.assign(rows, {
    leagues: [{ id: 1, name: "Club", createdByClerkUserId: "user_admin", visibility: "private", leagueType: "singles", seasonWeeks: 8, timeZone: "America/New_York", startDate: today, createdAt: at }],
    league_admins: [{ leagueId: 1, clerkUserId: "user_admin", role: "owner" }],
    players: [
      { id: 10, leagueId: 1, clerkUserId: "user_player", name: "Pat Player", leftAt: null },
      { id: 11, leagueId: 1, clerkUserId: "user_tom", name: "Tom", leftAt: null },
      { id: 12, leagueId: 1, clerkUserId: "user_una", name: "Una", leftAt: null },
      { id: 13, leagueId: 1, clerkUserId: null, name: "Vic", leftAt: null },
    ],
    league_rounds: [
      { id: 1, leagueId: 1, roundNumber: 1, status: "active", startDate: today, endDate: "2999-01-01", publishedAt: at },
      { id: 2, leagueId: 1, roundNumber: 2, status: "upcoming", startDate: "2999-01-02", endDate: "2999-01-09", publishedAt: null },
    ],
    matches: [match(100, 1, 10, 11), match(200, 2, 10, 12), match(201, 2, 11, 13)],
    league_round_byes: [],
    users: [],
    ball_boi_sessions: [],
    match_statistics: [],
    schedule_generation_logs: [{ id: 1, leagueId: 1, weekOf: WEEK, status: "confirmed" }],
  });
});

const ids = (list: { matchId?: number; id?: number }[]) => list.map((m) => m.matchId ?? m.id);

describe("draft rounds stay private (row 1)", () => {
  it("GET /leagues/:id/rounds: a player sees only rounds that went out", async () => {
    const res = await (await app()).get("/api/leagues/1/rounds");
    expect(res.status).toBe(200);
    expect(res.body.map((r: { roundId: number }) => r.roundId)).toEqual([1]);
    expect(JSON.stringify(res.body)).not.toContain('"matchId":200');
  });

  it("GET /leagues/:id/rounds: the league's admin also sees the draft", async () => {
    mockUserId = "user_admin";
    const res = await (await app()).get("/api/leagues/1/rounds");
    expect(res.body.map((r: { roundId: number }) => r.roundId)).toEqual([1, 2]);
  });

  it("GET /leagues/:id/rounds/current never falls through to a draft for a player", async () => {
    const res = await (await app()).get("/api/leagues/1/rounds/current");
    expect(res.body.roundId).toBe(1);
    // With round 1 over, the next round is still a draft: a player gets nothing.
    (rows.league_rounds[0] as Row).status = "completed";
    (rows.matches[0] as Row).status = "completed";
    const after = await (await app()).get("/api/leagues/1/rounds/current");
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
    mockUserId = "user_admin";
    expect((await (await app()).get("/api/leagues/1/rounds/current")).body.roundId).toBe(2);
  });

  it("GET /leagues/:id/schedule shows the draft to admins only", async () => {
    const player = await (await app()).get("/api/leagues/1/schedule");
    expect(player.body.rounds.map((r: { roundId: number }) => r.roundId)).toEqual([1]);
    mockUserId = "user_admin";
    const admin = await (await app()).get("/api/leagues/1/schedule");
    expect(admin.body.rounds.map((r: { roundId: number }) => r.roundId)).toEqual([1, 2]);
  });

  it("GET /matches leaves out pairings in a draft round, even the player's own", async () => {
    const res = await (await app()).get("/api/matches?leagueId=1");
    expect(ids(res.body)).toEqual([100]);
    mockUserId = "user_admin";
    expect(ids((await (await app()).get("/api/matches?leagueId=1")).body).sort()).toEqual([100, 200, 201]);
  });

  it("GET /matches/:id answers 404 for a draft pairing, as for a match that doesn't exist", async () => {
    expect((await (await app()).get("/api/matches/200")).status).toBe(404);
    expect((await (await app()).get("/api/matches/100")).status).toBe(200);
    mockUserId = "user_admin";
    expect((await (await app()).get("/api/matches/200")).status).toBe(200);
  });

  it("GET /stats/my-matches doesn't list a draft pairing as upcoming", async () => {
    const res = await (await app()).get("/api/stats/my-matches");
    expect(ids(res.body.upcoming)).toEqual([100]);
  });

  it("GET /stats/my-schedule never picks a draft pairing as this week's match", async () => {
    rows.matches = [match(200, 2, 10, 12)];
    const res = await (await app()).get("/api/stats/my-schedule");
    expect(res.body.match).toBeNull();
    rows.matches = [match(200, 2, 10, 12), match(100, 1, 10, 11)];
    expect((await (await app()).get("/api/stats/my-schedule")).body.match.matchId).toBe(100);
  });

  it("GET /scheduling/:leagueId/:weekOf shows a draft's pairings to admins only", async () => {
    const player = await (await app()).get(`/api/scheduling/1/${WEEK}`);
    expect(player.status).toBe(200);
    expect(ids(player.body.matches)).toEqual([100]);
    mockUserId = "user_admin";
    expect(ids((await (await app()).get(`/api/scheduling/1/${WEEK}`)).body.matches).sort()).toEqual([100, 200, 201]);
  });
});

describe("reading a schedule doesn't create rounds (row 2)", () => {
  it("GET /leagues/:id/rounds with fewer than 6 rounds makes none", async () => {
    // An older league (no season length) used to get its missing rounds made here.
    (rows.leagues[0] as Row).seasonWeeks = null;
    const before = { rounds: rows.league_rounds.length, matches: rows.matches.length };
    for (const user of ["user_player", "user_admin"]) {
      mockUserId = user;
      expect((await (await app()).get("/api/leagues/1/rounds")).status).toBe(200);
      expect((await (await app()).get("/api/leagues/1/rounds/current")).status).toBe(200);
    }
    expect(generateAllRounds).not.toHaveBeenCalled();
    expect(rows.league_rounds.length).toBe(before.rounds);
    expect(rows.matches.length).toBe(before.matches);
  });

  it("an older league with no rounds yet gets none from being read", async () => {
    (rows.leagues[0] as Row).seasonWeeks = null;
    rows.league_rounds = [];
    rows.matches = [];
    mockUserId = "user_admin";
    const res = await (await app()).get("/api/leagues/1/rounds");
    expect(res.body).toEqual([]);
    expect(generateAllRounds).not.toHaveBeenCalled();
    expect(rows.league_rounds).toEqual([]);
  });

  it("repeat pairings in upcoming rounds are left for an admin, not re-paired on read", async () => {
    rows.league_rounds = [
      { id: 1, leagueId: 1, roundNumber: 1, status: "active", startDate: today, endDate: "2999-01-01", publishedAt: at },
      { id: 3, leagueId: 1, roundNumber: 2, status: "upcoming", startDate: "2999-01-02", endDate: "2999-01-09", publishedAt: at },
    ];
    rows.matches = [match(100, 1, 10, 11), match(101, 1, 12, 13), match(300, 3, 10, 11), match(301, 3, 12, 13)];
    const res = await (await app()).get("/api/leagues/1/rounds");
    expect(res.body.map((r: { roundId: number }) => r.roundId)).toEqual([1, 3]);
    expect(rows.matches.map((m) => m.id)).toEqual([100, 101, 300, 301]);
    expect(rows.league_rounds.map((r) => r.id)).toEqual([1, 3]);
    expect(generateAllRounds).not.toHaveBeenCalled();
  });
});
