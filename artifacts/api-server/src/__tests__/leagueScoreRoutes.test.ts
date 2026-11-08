import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Finding 7: the 24-hour score edit route. C5: the admin correction route.

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
// The league lookup (has it ended?) answers from mockLeague, so each test's
// select sequence covers only matches and players.
const leaguesTable = new Proxy({}, { get: (_t, p) => ({ col: String(p) }) });
let mockLeague: Record<string, unknown> = {};
const db = {
  ...mockDb,
  update: (...a: unknown[]) => mockDb.update(...a),
  insert: (...a: unknown[]) => mockDb.insert(...a),
  transaction: (...a: unknown[]) => mockDb.transaction(...a),
  select: (...a: unknown[]) => ({
    from: (t: unknown) => (t === leaguesTable ? chain([mockLeague]) : mockDb.select(...a).from(t)),
  }),
};
vi.mock("@workspace/db", () => ({
  get db() {
    return db;
  },
  leagueRoundsTable: table,
  get leaguesTable() {
    return leaguesTable;
  },
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
  playoffRound: null,
  playoffSlot: null,
  inGrace: false,
  recordedAt: new Date(Date.now() - 60_000).toISOString(),
  recordedByClerkUserId: "user_a",
  correctedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(mockDb)) fn.mockReset();
  mockUserId = "user_a";
  mockIsAdmin = true;
  mockLeague = { id: 1, endedAt: null, status: "active", startDate: "2026-10-01", seasonWeeks: 8, timeZone: "America/New_York" };
});

describe("POST /api/leagues/:leagueId/matches/:matchId/score/edit", () => {
  const people = [
    { id: 10, name: "Alex Kim", clerkUserId: "user_a" },
    { id: 20, name: "Sam Lee", clerkUserId: "user_b" },
  ];

  it("lets the other player edit it from their side, and moves the win and loss", async () => {
    mockUserId = "user_b";
    const sets: Call[] = [];
    mockDb.select.mockReturnValueOnce(chain([match()])).mockReturnValueOnce(chain(people));
    mockDb.update.mockReturnValue(chain([{ ...match(), score: "3-6, 4-6", winnerId: 20, scoreEditedAt: new Date() }], sets));
    const txUpdates: Call[] = [];
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ update: () => chain(undefined, txUpdates) }));

    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "6-3, 6-4" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matchId: 7, winnerId: 20, editedBy: "Sam Lee" });
    // Sam typed their own games first; it's stored from player 1's side.
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ score: "3-6, 4-6", winnerId: 20, scoreEditedByName: "Sam Lee" });
    // Alex loses a win and gains a loss; Sam the other way round.
    expect(txUpdates.filter((c) => c.method === "set")).toHaveLength(2);
  });

  it("tells the other player who edited it", async () => {
    const { sendPushToUsers } = await import("../routes/notifications.js");
    mockDb.select.mockReturnValueOnce(chain([match()])).mockReturnValueOnce(chain(people));
    mockDb.update.mockReturnValue(chain([{ ...match(), score: "6-3, 6-2", scoreEditedAt: new Date() }]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "6-3, 6-2" });
    expect(res.status).toBe(200);
    expect(sendPushToUsers).toHaveBeenCalledWith(["user_b"], "Score edited", "Score edited by Alex Kim: 3-6, 2-6.", "/match/7");
  });

  it("refuses someone not in the match", async () => {
    mockUserId = "user_c";
    mockDb.select.mockReturnValueOnce(chain([match()])).mockReturnValueOnce(chain(people));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "6-3, 6-4" });
    expect(res.status).toBe(403);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("locks after 24 hours", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([match({ recordedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString() })]))
      .mockReturnValueOnce(chain(people));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "6-3, 6-4" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/locked/);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("refuses a score the admin corrected", async () => {
    mockDb.select.mockReturnValueOnce(chain([match({ correctedAt: new Date() })])).mockReturnValueOnce(chain(people));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "6-3, 6-4" });
    expect(res.status).toBe(409);
  });

  it("refuses a score that isn't a real tennis score", async () => {
    mockDb.select.mockReturnValueOnce(chain([match()])).mockReturnValueOnce(chain(people));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "6-5" });
    expect(res.status).toBe(400);
  });

  it("doesn't touch standings records for a grace-week score", async () => {
    mockDb.select.mockReturnValueOnce(chain([match({ inGrace: true })])).mockReturnValueOnce(chain(people));
    mockDb.update.mockReturnValue(chain([{ ...match(), score: "3-6, 4-6", winnerId: 20, scoreEditedAt: new Date() }]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "3-6, 4-6" });
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

  it("corrects a playoff score and moves the new winner into the next round", async () => {
    const sets: Call[] = [];
    const po = match({ playoffBracketId: 3, playoffRound: "semifinal", playoffSlot: 1 });
    mockDb.select
      .mockReturnValueOnce(chain([po]))
      .mockReturnValueOnce(chain([{ id: 99, status: "scheduled" }])) // the final, unplayed
      .mockReturnValueOnce(chain([{ name: "Sam Lee" }]))
      .mockReturnValueOnce(chain([]));
    mockDb.update.mockReturnValue(chain([{ ...po, score: "3-6, 4-6", winnerId: 20, correctedAt: new Date(), correctedByName: "Sam Lee" }], sets));
    const res = await supertest(await buildApp()).put("/api/leagues/1/matches/7/score").send({ score: "3-6, 4-6" });
    expect(res.status).toBe(200);
    // Second update is the final's slot: slot 1 feeds player 1.
    const slot = sets.filter((c) => c.method === "set")[1];
    expect(slot?.args[0]).toEqual({ player1Id: 20 });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("refuses a playoff correction once the next round is played", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([match({ playoffBracketId: 3, playoffRound: "semifinal", playoffSlot: 1 })]))
      .mockReturnValueOnce(chain([{ id: 99, status: "completed" }]));
    const res = await supertest(await buildApp()).put("/api/leagues/1/matches/7/score").send({ score: "3-6, 4-6" });
    expect(res.status).toBe(409);
    expect(mockDb.update).not.toHaveBeenCalled();
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

describe("scores are final once the league ends (Q9)", () => {
  it("refuses a correction", async () => {
    mockLeague = { ...mockLeague, endedAt: new Date(), status: "completed" };
    mockDb.select.mockReturnValueOnce(chain([match()]));
    const res = await supertest(await buildApp()).put("/api/leagues/1/matches/7/score").send({ score: "3-6, 4-6" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This league has ended, so its scores are final.");
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("refuses an edit", async () => {
    mockLeague = { ...mockLeague, endedAt: new Date() };
    mockDb.select.mockReturnValueOnce(chain([match()])).mockReturnValueOnce(chain([{ id: 10, name: "Alex Kim", clerkUserId: "user_a" }]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ score: "6-3, 6-4" });
    expect(res.status).toBe(409);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("refuses a new score", async () => {
    mockLeague = { ...mockLeague, endedAt: new Date() };
    mockDb.select.mockReturnValueOnce(chain([match({ status: "scheduled", score: null, winnerId: null })]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({ score: "6-3, 6-4" });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/leagues/:leagueId/matches/:matchId/score with Opponent retired (Q6)", () => {
  it("stores the sets so far with RET, as a win for the player entering it", async () => {
    mockUserId = "user_b";
    const sets: Call[] = [];
    mockDb.select
      .mockReturnValueOnce(chain([match({ status: "scheduled", score: null, winnerId: null })]))
      .mockReturnValueOnce(chain([{ id: 20, name: "Sam Lee" }]))
      .mockReturnValue(chain([]));
    mockDb.update.mockReturnValue(chain([{ ...match(), score: "3-6, 1-2 RET", winnerId: 20 }], sets));
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ update: () => chain(undefined) }));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({ score: "6-3, 2-1", retired: true });
    expect(res.status).toBe(201);
    // Player 2 entered it, so it's stored from player 1's side.
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ score: "3-6, 1-2 RET", winnerId: 20 });
  });

  it("refuses a bad score with a reason", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([match({ status: "scheduled", score: null, winnerId: null })]))
      .mockReturnValueOnce(chain([{ id: 10, name: "Alex Kim" }]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({ score: "9-2, 6-5" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("9-2 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6.");
  });
});
