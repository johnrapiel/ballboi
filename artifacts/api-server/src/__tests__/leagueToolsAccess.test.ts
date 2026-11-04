import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// Wave 1 follow-up: a league's rounds, playoffs, shot leaderboards, drills,
// availability, scheduling and admin list need sign-in and, for a Private
// league, membership (its players and admins). Admin tools (availability
// participation and reminders, the scheduling log) are for league admins.
// DELETE /players/:id is for league admins, and never for a player who has
// matches.

let mockUserId: string | null = "user_member";
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
    leaguesTable: table("leagues", ["id", "name", "createdByClerkUserId", "visibility", "leagueType", "seasonWeeks"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "name", "skillLevel", "leftAt"]),
    matchesTable: table("matches", ["id", "leagueId", "status", "player1Id", "player2Id", "player3Id", "player4Id", "weekOf", "completedAt"]),
    leagueAdminsTable: table("league_admins", ["leagueId", "clerkUserId", "role"]),
    leagueJoinRequestsTable: table("league_join_requests", ["id", "leagueId", "clerkUserId"]),
    leagueRoundsTable: table("league_rounds", ["id", "leagueId", "status", "roundNumber", "startDate", "endDate"]),
    playoffBracketsTable: table("playoff_brackets", ["id", "leagueId", "createdAt"]),
    playerAvailabilityTable: table("player_availability", ["id", "playerId", "leagueId", "weekOf", "slots"]),
    scheduleGenerationLogsTable: table("schedule_generation_logs", ["id", "leagueId", "weekOf", "status", "generatedAt"]),
    seasonsTable: table("seasons", ["id", "leagueId"]),
    usersTable: table("users", ["clerkUserId", "displayName"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("@workspace/api-zod", () => ({
  UpdatePlayerBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));
vi.mock("../lib/blocks.js", () => ({ blockedAccountsFor: async () => new Set<string>() }));
vi.mock("../lib/lookups.js", () => ({ getPlayerNameMap: async () => new Map() }));
vi.mock("../routes/notifications", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/roundPairing", () => ({ generateAllRounds: vi.fn(), buildRoundResponse: vi.fn().mockResolvedValue({ status: "completed", matchups: [] }) }));
vi.mock("../services/playoffBracket", () => ({
  generatePlayoffBracket: vi.fn(), buildBracketResponse: vi.fn(), MIN_COMPLETED_ROUNDS_FOR_PLAYOFFS: 3,
}));
vi.mock("../services/matchGeneration", () => ({ generateWeeklyMatches: vi.fn(), saveGeneratedMatches: vi.fn() }));
vi.mock("../middlewares/requireAdmin", () => ({ requireAdmin: vi.fn() }));

async function app() {
  const routers = await Promise.all([
    import("../routes/rounds.js"),
    import("../routes/playoffs.js"),
    import("../routes/shotLeaderboards.js"),
    import("../routes/drills.js"),
    import("../routes/availability.js"),
    import("../routes/scheduling.js"),
    import("../routes/leagueAdmins.js"),
    import("../routes/players.js"),
  ]);
  const a = express();
  a.use(express.json());
  for (const r of routers) a.use("/api", r.default);
  return supertest(a);
}

// League 1 is Private, run by user_owner with co-admin user_coadmin, and
// user_member plays in it. user_stranger has nothing to do with it.
// League 2 is Open.
const WEEK = "2026-11-02";
beforeEach(() => {
  mockUserId = "user_member";
  for (const k of Object.keys(rows)) delete rows[k];
  Object.assign(rows, {
    leagues: [
      { id: 1, name: "Private", createdByClerkUserId: "user_owner", visibility: "private", leagueType: "singles", seasonWeeks: 8 },
      { id: 2, name: "Open", createdByClerkUserId: "user_other", visibility: "open", leagueType: "singles", seasonWeeks: 8 },
    ],
    league_admins: [
      { leagueId: 1, clerkUserId: "user_owner", role: "owner" },
      { leagueId: 1, clerkUserId: "user_coadmin", role: "co_admin" },
    ],
    players: [
      { id: 10, leagueId: 1, clerkUserId: "user_member", name: "Mia Member", skillLevel: "3.5", leftAt: null },
      { id: 11, leagueId: 1, clerkUserId: "user_teammate", name: "Tom Teammate", skillLevel: "3.5", leftAt: null },
      { id: 12, leagueId: 1, clerkUserId: null, name: "Una Unlinked", skillLevel: "3.0", leftAt: null },
      { id: 20, leagueId: 2, clerkUserId: "user_other", name: "Olly Open", skillLevel: "4.0", leftAt: null },
    ],
    matches: [
      { id: 100, leagueId: 1, status: "completed", player1Id: 10, player2Id: 11, player3Id: null, player4Id: null, weekOf: WEEK, completedAt: "2026-10-01", location: null, createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z") },
    ],
    league_rounds: [{ id: 1, leagueId: 1, status: "completed", roundNumber: 1, startDate: "2026-10-01", endDate: "2026-10-07" }],
    player_availability: [
      { id: 1, playerId: 10, leagueId: 1, weekOf: WEEK, slots: ["mon-am"] },
      { id: 2, playerId: 11, leagueId: 1, weekOf: WEEK, slots: ["tue-pm"] },
    ],
    schedule_generation_logs: [],
    users: [],
  });
});

const viewerRoutes = [
  "/api/leagues/1/rounds",
  "/api/leagues/1/rounds/current",
  "/api/leagues/1/playoffs",
  "/api/shot-leaderboards/1/serve-accuracy",
  "/api/shot-leaderboards/1/consistency",
  "/api/shot-leaderboards/1/aces",
  "/api/shot-leaderboards/1/winners",
  "/api/shot-leaderboards/1/efficiency",
  "/api/drills/1",
  `/api/availability/1/${WEEK}`,
  `/api/availability/me/1/${WEEK}`,
  "/api/scheduling/1/suggestions",
  `/api/scheduling/1/${WEEK}`,
  "/api/leagues/1/admins",
];

describe("league pages need membership for a Private league", () => {
  it.each(viewerRoutes)("%s: signed out gets 401", async (path) => {
    mockUserId = null;
    expect((await (await app()).get(path)).status).toBe(401);
  });

  it.each(viewerRoutes)("%s: a stranger gets 403", async (path) => {
    mockUserId = "user_stranger";
    const res = await (await app()).get(path);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/private/i);
  });

  it.each(viewerRoutes)("%s: a player in the league gets 200", async (path) => {
    expect((await (await app()).get(path)).status).toBe(200);
  });

  it.each(viewerRoutes)("%s: a co-admin gets 200", async (path) => {
    mockUserId = "user_coadmin";
    expect((await (await app()).get(path)).status).toBe(200);
  });

  it("an Open league stays readable to anyone signed in", async () => {
    mockUserId = "user_stranger";
    const api = await app();
    for (const path of ["/api/leagues/2/rounds/current", "/api/leagues/2/admins", "/api/drills/2", "/api/shot-leaderboards/2/aces"]) {
      expect((await api.get(path)).status).toBe(200);
    }
  });

  it("a league that doesn't exist is 404", async () => {
    expect((await (await app()).get("/api/leagues/99/admins")).status).toBe(404);
  });
});

describe("availability", () => {
  it("league admins see everyone's availability; a player sees only their own", async () => {
    const api = await app();
    mockUserId = "user_coadmin";
    const all = await api.get(`/api/availability/1/${WEEK}`);
    expect(all.body.map((r: Row) => r.playerId).sort()).toEqual([10, 11]);

    mockUserId = "user_member";
    const mine = await api.get(`/api/availability/1/${WEEK}`);
    expect(mine.body.map((r: Row) => r.playerId)).toEqual([10]);
  });

  it("/availability/me returns the caller's own row (no longer caught by /:leagueId/:weekOf)", async () => {
    const res = await (await app()).get(`/api/availability/me/1/${WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe(10);
    expect(res.body.slots).toEqual(["mon-am"]);
  });

  it("participation and reminders are for league admins only", async () => {
    const api = await app();
    for (const who of ["user_member", "user_stranger"]) {
      mockUserId = who;
      expect((await api.get(`/api/availability/participation/1/${WEEK}`)).status).toBe(403);
      expect((await api.post(`/api/availability/remind/1/${WEEK}`)).status).toBe(403);
    }
    mockUserId = "user_coadmin";
    const part = await api.get(`/api/availability/participation/1/${WEEK}`);
    expect(part.status).toBe(200);
    expect(part.body.players).toHaveLength(3);
    const remind = await api.post(`/api/availability/remind/1/${WEEK}`);
    expect(remind.status).toBe(200);
    expect(remind.body.missingCount).toBe(1);
  });

  it("a league with no creator no longer counts everyone as its admin", async () => {
    rows.leagues.push({ id: 3, name: "Legacy", createdByClerkUserId: null, visibility: "open", leagueType: "singles", seasonWeeks: 8 });
    mockUserId = "user_stranger";
    expect((await (await app()).get(`/api/availability/participation/3/${WEEK}`)).status).toBe(403);
  });

  it("a player saves their own availability", async () => {
    const res = await (await app()).post("/api/availability").send({ leagueId: 1, weekOf: WEEK, slots: ["wed-pm"] });
    expect(res.status).toBe(200);
    expect(rows.player_availability.find((r) => r.playerId === 10)?.slots).toEqual(["wed-pm"]);
  });

  it("a player can't save someone else's availability", async () => {
    const res = await (await app()).post("/api/availability").send({ leagueId: 1, weekOf: WEEK, slots: [], playerId: 11 });
    expect(res.status).toBe(403);
    expect(rows.player_availability.find((r) => r.playerId === 11)?.slots).toEqual(["tue-pm"]);
  });

  it("a league admin can set a player's availability, but only for a player in that league", async () => {
    mockUserId = "user_coadmin";
    const api = await app();
    expect((await api.post("/api/availability").send({ leagueId: 1, weekOf: WEEK, slots: ["fri-am"], playerId: 12 })).status).toBe(201);
    expect((await api.post("/api/availability").send({ leagueId: 1, weekOf: WEEK, slots: [], playerId: 20 })).status).toBe(404);
  });

  it("a stranger can't post into a Private league", async () => {
    mockUserId = "user_stranger";
    expect((await (await app()).post("/api/availability").send({ leagueId: 1, weekOf: WEEK, slots: [] })).status).toBe(403);
  });
});

describe("scheduling log", () => {
  it("is for league admins only", async () => {
    const api = await app();
    mockUserId = "user_member";
    expect((await api.get("/api/scheduling/1/log")).status).toBe(403);
    mockUserId = "user_owner";
    expect((await api.get("/api/scheduling/1/log")).status).toBe(200);
  });
});

describe("DELETE /players/:id", () => {
  it("signed out is 401", async () => {
    mockUserId = null;
    expect((await (await app()).delete("/api/players/12")).status).toBe(401);
  });

  it("a player can't delete themselves or others", async () => {
    const api = await app();
    expect((await api.delete("/api/players/10")).status).toBe(403);
    expect((await api.delete("/api/players/12")).status).toBe(403);
    expect(rows.players).toHaveLength(4);
  });

  it("a league admin can delete a player with no matches", async () => {
    mockUserId = "user_coadmin";
    expect((await (await app()).delete("/api/players/12")).status).toBe(204);
    expect(rows.players.map((p) => p.id)).not.toContain(12);
  });

  it("a player who has matches is refused with 409, pointing to the remove-player flow", async () => {
    mockUserId = "user_owner";
    for (const id of [10, 11]) {
      const res = await (await app()).delete(`/api/players/${id}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Manage/);
      expect(res.body.removePath).toBe(`/api/leagues/1/players/${id}/remove`);
    }
    expect(rows.players).toHaveLength(4);
  });

  it("an admin of another league can't delete this league's players", async () => {
    mockUserId = "user_other";
    expect((await (await app()).delete("/api/players/12")).status).toBe(403);
  });
});
