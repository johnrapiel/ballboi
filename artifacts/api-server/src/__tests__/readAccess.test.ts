import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// Wave 1 follow-up: reading matches, players, a league's schedule, bracket
// and seasons needs sign-in, and shows only what the caller can see: matches
// they played or in leagues they can see, players in those leagues, and
// Private leagues only to their players and admins. PATCH /players/:id is for
// the player themselves or their league's admins, and never moves a player
// between leagues or changes which account a record belongs to.

let mockUserId: string | null = "user_me";
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
    leaguesTable: table("leagues", ["id", "name", "createdByClerkUserId", "visibility", "leagueType", "createdAt"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "name", "email", "phone", "wins", "leftAt"]),
    matchesTable: table("matches", ["id", "leagueId", "status", "player1Id", "player2Id", "player3Id", "player4Id", "roundId", "createdAt", "completedAt"]),
    leagueAdminsTable: table("league_admins", ["leagueId", "clerkUserId", "role"]),
    leagueRoundsTable: table("league_rounds", ["id", "leagueId", "roundNumber", "endDate"]),
    leagueRoundByesTable: table("league_round_byes", ["roundId"]),
    usersTable: table("users", ["clerkUserId", "rating", "ratingSource"]),
    ballBoiSessionsTable: table("ball_boi_sessions", ["matchId"]),
    seasonsTable: table("seasons", ["id", "leagueId"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("@workspace/api-zod", () => ({
  UpdatePlayerBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
  UpdateMatchBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
  CreateMatchBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));
vi.mock("../lib/blocks.js", () => ({ blockedAccountsFor: async () => new Set<string>() }));
vi.mock("../routes/notifications", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/seasonService.js", () => ({
  getAutoSeason: vi.fn().mockResolvedValue(null),
  getSeasonsForLeague: vi.fn().mockResolvedValue([{ id: 1, name: "Fall" }]),
  findOverlappingSeason: vi.fn(),
}));
vi.mock("../services/leagueRounds.js", () => ({
  usesWeeklyRounds: () => false,
  draftNextRound: vi.fn(), loadDraftRound: vi.fn(), publishRound: vi.fn(), repairRound: vi.fn(),
}));
vi.mock("../services/leaguePlayoffs.js", () => ({ bracketFor: vi.fn().mockResolvedValue(null) }));
vi.mock("../middlewares/requireAdmin.js", () => ({ requireAdmin: vi.fn() }));

async function app() {
  const routers = await Promise.all([
    import("../routes/matches.js"),
    import("../routes/players.js"),
    import("../routes/leagueSchedule.js"),
    import("../routes/seasons.js"),
  ]);
  const a = express();
  a.use(express.json());
  for (const r of routers) a.use("/api", r.default);
  return supertest(a);
}

const at = new Date("2026-10-01T00:00:00Z");
const player = (id: number, leagueId: number | null, clerkUserId: string | null, name: string) => ({
  id, leagueId, clerkUserId, name, email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`, phone: "555-0100",
  bio: null, wins: 0, losses: 0, skillLevel: "3.5", dominantHand: "right", dayBeforeMatchReminderEnabled: true,
  leftAt: null, createdAt: at, updatedAt: at,
});
const match = (id: number, leagueId: number | null, p1: number, p2: number) => ({
  id, leagueId, status: "completed", player1Id: p1, player2Id: p2, player3Id: null, player4Id: null, roundId: null,
  winnerId: p1, score: "6-3, 6-2", completedAt: "2026-10-01", createdAt: at, updatedAt: at,
});

beforeEach(() => {
  mockUserId = "user_me";
  rows.leagues = [
    { id: 1, name: "Mine", visibility: "private", createdByClerkUserId: "user_owner", leagueType: "singles", createdAt: at },
    { id: 2, name: "Elsewhere", visibility: "private", createdByClerkUserId: "user_owner", leagueType: "singles", createdAt: at },
    { id: 3, name: "Open", visibility: "open", createdByClerkUserId: "user_owner", leagueType: "singles", createdAt: at },
    { id: 4, name: "I run it", visibility: "private", createdByClerkUserId: "user_me", leagueType: "singles", createdAt: at },
  ];
  rows.players = [
    player(11, 1, "user_me", "Me"),
    player(12, 1, "user_b", "Teammate"),
    player(21, 2, "user_x", "Stranger"),
    player(31, 3, "user_o", "Open Player"),
    player(41, 4, null, "Added By Me"),
    player(42, 4, "user_c", "Linked In My League"),
    player(50, 4, null, "Deleted player"),
    player(60, null, null, "Quick Opponent"),
  ];
  rows.league_admins = [];
  rows.matches = [match(100, 1, 11, 12), match(200, 2, 21, 21), match(300, 3, 31, 31), match(400, null, 11, 60)];
  rows.league_rounds = [];
  rows.league_round_byes = [];
  rows.users = [];
  rows.ball_boi_sessions = [];
  rows.seasons = [];
});

describe("sign-in is required", () => {
  for (const path of [
    "/api/matches", "/api/matches/100", "/api/players", "/api/players/11", "/api/players/11/stats",
    "/api/leagues/1/schedule", "/api/leagues/1/bracket", "/api/leagues/1/seasons", "/api/leagues/1/seasons/active",
  ]) {
    it(path, async () => {
      mockUserId = null;
      expect((await (await app()).get(path)).status).toBe(401);
    });
  }
});

describe("GET /matches", () => {
  it("lists my matches and matches in leagues I can see, not Private leagues I'm not in", async () => {
    const res = await (await app()).get("/api/matches");
    expect(res.status).toBe(200);
    expect(res.body.map((m: { id: number }) => m.id).sort()).toEqual([100, 300, 400]);
  });

  it("filtering by someone else's Private league returns nothing", async () => {
    const res = await (await app()).get("/api/matches?leagueId=2");
    expect(res.body).toEqual([]);
  });

  it("GET /matches/:id hides a match I can't see", async () => {
    expect((await (await app()).get("/api/matches/100")).status).toBe(200);
    expect((await (await app()).get("/api/matches/400")).status).toBe(200);
    const res = await (await app()).get("/api/matches/200");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Stranger");
  });
});

describe("GET /players", () => {
  it("lists players in leagues I can see and my own records", async () => {
    const res = await (await app()).get("/api/players");
    const names = res.body.map((p: { name: string }) => p.name);
    expect(names).toContain("Teammate");
    expect(names).toContain("Open Player");
    expect(names).not.toContain("Stranger");
  });

  it("refuses the roster of a Private league I'm not in", async () => {
    expect((await (await app()).get("/api/players?leagueId=2")).status).toBe(403);
  });

  it("shows contact details only to the player and their league's admins", async () => {
    const res = await (await app()).get("/api/players");
    const by = (name: string) => res.body.find((p: { name: string }) => p.name === name);
    expect(by("Me").email).toBe("me@example.com");
    expect(by("Teammate").email).toBeNull();
    expect(by("Teammate").phone).toBeNull();
    expect(by("Open Player").email).toBeNull();
    expect(by("Added By Me").email).toBe("added.by.me@example.com"); // I run league 4
  });

  it("GET /players/:id hides a player I can't see", async () => {
    expect((await (await app()).get("/api/players/12")).status).toBe(200);
    expect((await (await app()).get("/api/players/21")).status).toBe(404);
  });

  it("GET /players/:id/stats hides a player I can't see", async () => {
    expect((await (await app()).get("/api/players/12/stats")).status).toBe(200);
    expect((await (await app()).get("/api/players/21/stats")).status).toBe(404);
  });
});

describe("PATCH /players/:id", () => {
  it("a stranger can't change a player", async () => {
    const res = await (await app()).patch("/api/players/21").send({ name: "Hacked" });
    expect(res.status).toBe(403);
    expect(rows.players.find((p) => p.id === 21)!.name).toBe("Stranger");
  });

  it("a player can update their own reminders", async () => {
    const res = await (await app()).patch("/api/players/11").send({ dayBeforeMatchReminderEnabled: false });
    expect(res.status).toBe(200);
    expect(rows.players.find((p) => p.id === 11)).toMatchObject({ dayBeforeMatchReminderEnabled: false });
  });

  it("a signed-up player's name and level come from Edit profile, never from here", async () => {
    expect((await (await app()).patch("/api/players/11").send({ name: "Me Again" })).status).toBe(403);
    expect((await (await app()).patch("/api/players/11").send({ skillLevel: "4.5" })).status).toBe(403);
    expect(rows.players.find((p) => p.id === 11)!.name).toBe("Me");
  });

  it("never moves a player to another league or relinks them", async () => {
    expect((await (await app()).patch("/api/players/11").send({ leagueId: 2 })).status).toBe(400);
    expect((await (await app()).patch("/api/players/41").send({ clerkUserId: "user_me" })).status).toBe(400);
    expect(rows.players.find((p) => p.id === 11)!.leagueId).toBe(1);
    expect(rows.players.find((p) => p.id === 41)!.clerkUserId).toBeNull();
  });

  it("a league admin can edit a player they added, including contact details", async () => {
    const res = await (await app()).patch("/api/players/41").send({ name: "Added", email: "new@example.com" });
    expect(res.status).toBe(200);
    expect(rows.players.find((p) => p.id === 41)).toMatchObject({ name: "Added", email: "new@example.com" });
  });

  it("a co-admin counts as an admin", async () => {
    rows.league_admins = [{ leagueId: 4, clerkUserId: "user_b", role: "co_admin" }];
    mockUserId = "user_b";
    expect((await (await app()).patch("/api/players/41").send({ skillLevel: "4.0" })).status).toBe(200);
  });

  it("an admin can't change a signed-up player's contact details, reminders, name or level", async () => {
    expect((await (await app()).patch("/api/players/42").send({ email: "x@example.com" })).status).toBe(403);
    expect((await (await app()).patch("/api/players/42").send({ dayBeforeMatchReminderEnabled: false })).status).toBe(403);
    expect((await (await app()).patch("/api/players/42").send({ name: "Renamed" })).status).toBe(403);
    const res = await (await app()).patch("/api/players/42").send({ skillLevel: "4.0" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Edit profile/);
  });

  it("a Deleted player record can't be edited", async () => {
    expect((await (await app()).patch("/api/players/50").send({ name: "Someone" })).status).toBe(409);
  });
});

describe("league schedule, bracket and seasons", () => {
  for (const sub of ["schedule", "bracket", "seasons", "seasons/active"]) {
    it(`${sub}: my league and an Open one load, someone else's Private one doesn't`, async () => {
      const c = await app();
      const ok = 200;
      expect((await c.get(`/api/leagues/1/${sub}`)).status).toBe(ok);
      expect((await c.get(`/api/leagues/3/${sub}`)).status).toBe(ok);
      expect((await c.get(`/api/leagues/4/${sub}`)).status).toBe(ok); // I created it
      expect((await c.get(`/api/leagues/2/${sub}`)).status).toBe(403);
    });
  }
});
