import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Oct 31 review: C4 undo route and C5 admin correction route.

let mockUserId: string | null = "user_a";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type Call = { method: string; args: unknown[] };
const chain = (value: unknown, calls?: Call[]) => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok);
      return (...args: unknown[]) => {
        calls?.push({ method: String(prop), args });
        return new Proxy({}, handler);
      };
    },
  };
  return new Proxy({}, handler);
};

const mockDb = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn() };
const table = new Proxy({}, { get: (_t, p) => ({ col: String(p) }) });
vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  leagueRoundsTable: table,
  leaguesTable: table,
  matchesTable: table,
  playersTable: table,
  usersTable: table,
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: () => ({}),
  isNull: () => ({}),
  ne: () => ({}),
  sql: Object.assign((..._a: unknown[]) => ({ sql: true }), { raw: () => ({}) }),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/playoffBracket.js", () => ({ advancePlayoffWinner: vi.fn() }));
vi.mock("../services/leaguePlayoffs.js", () => ({ advancePlayoff: vi.fn() }));
vi.mock("../services/leagueRounds.js", () => ({ usesWeeklyRounds: () => true }));
let mockIsAdmin = true;
vi.mock("../middlewares/requireLeagueAdmin.js", () => ({
  requireLeagueAdmin: (req: { params: { leagueId: string } }, res: { locals: Record<string, unknown>; status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!mockIsAdmin) return res.status(403).json({ error: "Only this league's admins can do that" });
    res.locals.leagueId = Number(req.params.leagueId);
    next();
  },
}));

async function buildApp() {
  const { default: router } = await import("../routes/leagueScores.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const match = (over: Record<string, unknown> = {}) => ({
  id: 7,
  leagueId: 1,
  player1Id: 10,
  player2Id: 20,
  player3Id: null,
  player4Id: null,
  status: "completed",
  score: "6-3, 6-4",
  winnerId: 10,
  voidedAt: null,
  playoffBracketId: null,
  inGrace: false,
  recordedAt: new Date(Date.now() - 60_000).toISOString(),
  recordedByClerkUserId: "user_a",
  correctedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "user_a";
  mockIsAdmin = true;
});

describe("POST /api/leagues/:leagueId/matches/:matchId/score/undo", () => {
  it("clears the score and takes the win and loss back", async () => {
    const sets: Call[] = [];
    mockDb.select.mockReturnValue(chain([match()]));
    mockDb.update.mockReturnValue(chain([{ ...match(), status: "scheduled", score: null, winnerId: null }], sets));
    const txUpdates: Call[] = [];
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ update: () => chain(undefined, txUpdates) }));

    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/undo");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matchId: 7, status: "scheduled", score: null, winnerId: null });
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ status: "scheduled", score: null, winnerId: null });
    expect(txUpdates.filter((c) => c.method === "set")).toHaveLength(2);
  });

  it("refuses the opponent", async () => {
    mockUserId = "user_b";
    mockDb.select.mockReturnValue(chain([match()]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/undo");
    expect(res.status).toBe(403);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("lets the score stand after 10 minutes", async () => {
    mockDb.select.mockReturnValue(chain([match({ recordedAt: new Date(Date.now() - 11 * 60_000).toISOString() })]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/undo");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/stands/);
  });

  it("doesn't touch standings records for a grace-week score", async () => {
    mockDb.select.mockReturnValue(chain([match({ inGrace: true })]));
    mockDb.update.mockReturnValue(chain([{ ...match(), status: "scheduled" }]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/undo");
    expect(res.status).toBe(200);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

describe("PUT /api/leagues/:leagueId/matches/:matchId/score", () => {
  it("stores the corrected score from player 1's side with the admin's name", async () => {
    const sets: Call[] = [];
    const correctedAt = new Date("2026-11-08T12:00:00Z");
    mockDb.select
      .mockReturnValueOnce(chain([match()]))
      .mockReturnValueOnce(chain([{ name: "Sam Lee" }]))
      .mockReturnValueOnce(chain([]));
    mockDb.update.mockReturnValue(
      chain([{ ...match(), score: "3-6, 4-6", winnerId: 20, correctedAt, correctedByName: "Sam Lee" }], sets),
    );
    const txUpdates: Call[] = [];
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ update: () => chain(undefined, txUpdates) }));

    const res = await supertest(await buildApp()).put("/api/leagues/1/matches/7/score").send({ score: "3-6, 4-6" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matchId: 7, score: "3-6, 4-6", winnerId: 20, correctedAt: correctedAt.toISOString(), correctedBy: "Sam Lee" });
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ score: "3-6, 4-6", winnerId: 20, correctedByName: "Sam Lee" });
    // The winner flipped, so both players' records move.
    expect(txUpdates.filter((c) => c.method === "set")).toHaveLength(2);
  });

  it("is for league admins only", async () => {
    mockIsAdmin = false;
    const res = await supertest(await buildApp()).put("/api/leagues/1/matches/7/score").send({ score: "6-1, 6-1" });
    expect(res.status).toBe(403);
  });

  it("only corrects played matches", async () => {
    mockDb.select.mockReturnValueOnce(chain([match({ status: "scheduled", score: null, winnerId: null })]));
    const res = await supertest(await buildApp()).put("/api/leagues/1/matches/7/score").send({ score: "6-1, 6-1" });
    expect(res.status).toBe(409);
  });

  it("checks the score", async () => {
    mockDb.select.mockReturnValueOnce(chain([match()]));
    const res = await supertest(await buildApp()).put("/api/leagues/1/matches/7/score").send({ score: "6-6" });
    expect(res.status).toBe(400);
  });
});
