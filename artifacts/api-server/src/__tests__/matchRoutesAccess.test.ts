import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// C3: the older /matches routes. The app doesn't call POST, PATCH or DELETE
// any more (league matches come from rounds, scores from the league score
// routes), so they're for a league's admins only and never change a result.
// That keeps the league score rules (first score stands, grace week, undo,
// admin correction) the only way a score lands.

let mockGetAuth: () => { userId: string | null } = () => ({ userId: "user_admin" });

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => mockGetAuth(),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const makeChain = (value: unknown = []) => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (f: (v: unknown) => unknown) => Promise.resolve(value).then(f);
      if (prop === "catch") return (f: (e: unknown) => unknown) => Promise.resolve(value).catch(f);
      if (prop === "finally") return (f: () => void) => Promise.resolve(value).finally(f);
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
};

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
};

const MATCH = {
  id: 1,
  player1Id: 10,
  player2Id: 20,
  player3Id: null,
  player4Id: null,
  status: "scheduled",
  score: null,
  winnerId: null,
  leagueId: 5,
  roundId: null,
  playoffBracketId: null,
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  location: null,
  notes: null,
  durationMinutes: null,
  recordedByClerkUserId: null,
  recordedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const cols = (...names: string[]) => Object.fromEntries(names.map((n) => [n, {}]));
vi.mock("@workspace/db", () => ({
  get db() { return mockDb; },
  matchesTable: cols("id", "player1Id", "player2Id", "player3Id", "player4Id", "status", "leagueId", "createdAt"),
  playersTable: cols("id", "clerkUserId", "name", "leagueId", "leftAt"),
  leaguesTable: cols("id", "name"),
  leagueRoundsTable: cols("id", "roundNumber", "endDate"),
  ballBoiSessionsTable: cols("matchId"),
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...args: unknown[]) => args,
  desc: (a: unknown) => a,
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  or: (...args: unknown[]) => args,
  isNull: (a: unknown) => ({ isNull: a }),
}));

vi.mock("@workspace/api-zod", () => ({
  UpdateMatchBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
  CreateMatchBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));

const isLeagueAdmin = vi.fn();
vi.mock("../lib/leagueAccess.js", () => ({ isLeagueAdmin: (...a: unknown[]) => isLeagueAdmin(...a) }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../routes/notifications", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/seasonService.js", () => ({ getAutoSeason: vi.fn().mockResolvedValue(null) }));

async function buildApp() {
  const { default: matchesRouter } = await import("../routes/matches.js");
  const app = express();
  app.use(express.json());
  app.use("/api", matchesRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockDb.select.mockReset();
  mockGetAuth = () => ({ userId: "user_admin" });
  isLeagueAdmin.mockResolvedValue(true);
  mockDb.select.mockReturnValue(makeChain([]));
  app = await buildApp();
});

describe("POST /api/matches", () => {
  const body = { player1Id: 10, player2Id: 20, leagueId: 5 };

  it("needs sign-in", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app).post("/api/matches").send(body);
    expect(res.status).toBe(401);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("is for the league's admins only", async () => {
    isLeagueAdmin.mockResolvedValue(false);
    const res = await supertest(app).post("/api/matches").send(body);
    expect(res.status).toBe(403);
    expect(isLeagueAdmin).toHaveBeenCalledWith(5, "user_admin");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("refuses a match outside a league", async () => {
    const res = await supertest(app).post("/api/matches").send({ player1Id: 10, player2Id: 20 });
    expect(res.status).toBe(403);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("never takes a score, so results go through the league score rules", async () => {
    const res = await supertest(app).post("/api/matches").send({ ...body, score: "6-3, 6-2", winnerId: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/score screen/);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("refuses players from outside the league", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([{ id: 5, leagueType: "singles", endedAt: null }]))
      .mockReturnValueOnce(makeChain([{ id: 10 }]));
    const res = await supertest(app).post("/api/matches").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/in this league/);
  });

  it("lets an admin add a scheduled match between league players", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([{ id: 5, leagueType: "singles", endedAt: null }]))
      .mockReturnValueOnce(makeChain([{ id: 10 }, { id: 20 }]));
    const inserted: unknown[] = [];
    mockDb.insert.mockReturnValue({
      values: (v: unknown) => {
        inserted.push(v);
        return makeChain([{ ...MATCH }]);
      },
    });
    const res = await supertest(app).post("/api/matches").send(body);
    expect(res.status).toBe(201);
    expect(inserted[0]).toMatchObject({ status: "scheduled", leagueId: 5 });
    expect(inserted[0]).not.toHaveProperty("score");
    expect(inserted[0]).not.toHaveProperty("winnerId");
  });
});

describe("PATCH /api/matches/:id", () => {
  it("needs sign-in", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app).patch("/api/matches/1").send({ location: "Court 2" });
    expect(res.status).toBe(401);
  });

  it("is refused for someone who isn't the league's admin, even a player in the match", async () => {
    isLeagueAdmin.mockResolvedValue(false);
    mockDb.select.mockReturnValueOnce(makeChain([MATCH]));
    const res = await supertest(app).patch("/api/matches/1").send({ location: "Court 2" });
    expect(res.status).toBe(403);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("can't enter a score, even for an admin", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([MATCH]));
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "6-3, 6-2", winnerId: 10, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/score screen/);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("can't change a completed match's result or status", async () => {
    for (const change of [{ winnerId: 20 }, { status: "cancelled" }, { score: "2-6, 3-6" }, { recordedAt: "2026-11-01" }]) {
      mockDb.select.mockReturnValueOnce(makeChain([{ ...MATCH, status: "completed", score: "6-3, 6-2", winnerId: 10 }]));
      const res = await supertest(app).patch("/api/matches/1").send(change);
      expect(res.status).toBe(400);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("lets an admin change the time or place", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([MATCH]));
    const set: unknown[] = [];
    mockDb.update.mockReturnValue({
      set: (v: unknown) => {
        set.push(v);
        return makeChain([{ ...MATCH, location: "Court 2" }]);
      },
    });
    const res = await supertest(app).patch("/api/matches/1").send({ location: "Court 2" });
    expect(res.status).toBe(200);
    expect(set).toEqual([{ location: "Court 2" }]);
  });

  it("refuses a match outside a league", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([{ ...MATCH, leagueId: null }]));
    const res = await supertest(app).patch("/api/matches/1").send({ location: "Court 2" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/matches/:id", () => {
  it("needs sign-in", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app).delete("/api/matches/1");
    expect(res.status).toBe(401);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("is for the league's admins only", async () => {
    isLeagueAdmin.mockResolvedValue(false);
    mockDb.select.mockReturnValueOnce(makeChain([MATCH]));
    const res = await supertest(app).delete("/api/matches/1");
    expect(res.status).toBe(403);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("keeps a played match: its score is corrected, not deleted", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([{ ...MATCH, status: "completed", score: "6-3, 6-2", winnerId: 10 }]));
    const res = await supertest(app).delete("/api/matches/1");
    expect(res.status).toBe(409);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("keeps playoff matches", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([{ ...MATCH, playoffBracketId: 3 }]));
    const res = await supertest(app).delete("/api/matches/1");
    expect(res.status).toBe(409);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("lets an admin delete an unplayed match", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([MATCH]));
    mockDb.delete.mockReturnValue(makeChain(undefined));
    const res = await supertest(app).delete("/api/matches/1");
    expect(res.status).toBe(204);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("answers 404 for a match that doesn't exist", async () => {
    const res = await supertest(app).delete("/api/matches/999");
    expect(res.status).toBe(404);
  });
});
