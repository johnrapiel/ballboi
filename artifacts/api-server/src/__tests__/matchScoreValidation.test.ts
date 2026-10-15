import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

let mockGetAuth: () => { userId: string | null } = () => ({ userId: "user_1" });

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

const EXISTING_MATCH = {
  id: 1,
  player1Id: 10,
  player2Id: 20,
  player3Id: null,
  player4Id: null,
  status: "scheduled",
  score: null,
  winnerId: null,
  leagueId: 1,
  weekOf: null,
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

vi.mock("@workspace/db", () => ({
  get db() { return mockDb; },
  matchesTable: {
    id: {}, player1Id: {}, player2Id: {}, player3Id: {}, player4Id: {},
    status: {}, score: {}, winnerId: {}, leagueId: {}, weekOf: {},
    scheduledAt: {}, startedAt: {}, completedAt: {}, location: {}, notes: {},
    durationMinutes: {}, recordedByClerkUserId: {}, recordedAt: {},
    createdAt: {}, updatedAt: {},
  },
  playersTable: { id: {}, clerkUserId: {}, name: {}, leagueId: {}, wins: {}, losses: {}, skillLevel: {} },
  leaguesTable: { id: {}, name: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...args: unknown[]) => args,
  desc: (a: unknown) => a,
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  or: (...args: unknown[]) => args,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@workspace/api-zod", () => ({
  UpdateMatchBody: {
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
  CreateMatchBody: {
    safeParse: (v: unknown) => {
      const body = v as Record<string, unknown>;
      if (!body.player1Id || !body.player2Id) return { success: false, error: { message: "Missing required fields" } };
      return { success: true, data: body };
    },
  },
}));

vi.mock("../routes/notifications.js", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/seasonService.js", () => ({
  getAutoSeason: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/playoffBracket.js", () => ({
  advancePlayoffWinner: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}));

async function buildApp() {
  const { default: matchesRouter } = await import("../routes/matches.js");
  const app = express();
  app.use(express.json());
  app.use("/api", matchesRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

function setupMatchMocks(score: string, winnerId: number) {
  const updatedMatch = { ...EXISTING_MATCH, status: "completed", score, winnerId };
  // select calls: 1) existing match lookup, 2) callerPlayers, then several empty selects
  // (winner player, loser player, allPlayers in notify path, allPlayers + leagues in buildMatchResponse)
  mockDb.select
    .mockReturnValueOnce(makeChain([EXISTING_MATCH]))
    .mockReturnValue(makeChain([]));
  // update returns the single updated row (NOT double-wrapped)
  mockDb.update.mockReturnValue(makeChain([updatedMatch]));
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetAuth = () => ({ userId: "user_1" });
  app = await buildApp();
});

describe("PATCH /api/matches/:id — tiebreak score format", () => {
  it("accepts a score where p1 wins with a first-set tiebreak: 7-6(4), 6-0", async () => {
    setupMatchMocks("7-6(4), 6-0", 10);
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "7-6(4), 6-0", winnerId: 10, status: "completed" });
    expect(res.status).toBe(200);
  });

  it("accepts a score where p2 wins both sets including a tiebreak: 3-6, 6-7(4)", async () => {
    setupMatchMocks("3-6, 6-7(4)", 20);
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "3-6, 6-7(4)", winnerId: 20, status: "completed" });
    expect(res.status).toBe(200);
  });

  it("accepts a score with tiebreak in the second set: 6-3, 7-6(5)", async () => {
    setupMatchMocks("6-3, 7-6(5)", 10);
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "6-3, 7-6(5)", winnerId: 10, status: "completed" });
    expect(res.status).toBe(200);
  });

  it("rejects a genuinely malformed score string", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([EXISTING_MATCH]));
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "bad-score", winnerId: 10, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid set score/i);
  });

  it("rejects a score with no hyphen separator", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([EXISTING_MATCH]));
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "63", winnerId: 10, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid set score/i);
  });

  it("rejects a score with three numbers separated by hyphens", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([EXISTING_MATCH]));
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "6-3-1", winnerId: 10, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid set score/i);
  });

  it("rejects a multi-set score where only one set is malformed", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([EXISTING_MATCH]));
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "6-3, bad", winnerId: 10, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid set score/i);
  });

  it("rejects a score with non-numeric values", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([EXISTING_MATCH]));
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "six-three", winnerId: 10, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid set score/i);
  });

  it("rejects a score inconsistent with the declared winner", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([EXISTING_MATCH]))
      .mockReturnValue(makeChain([]));
    // score says p1 wins but winnerId=20 (p2)
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "7-6(4), 6-0", winnerId: 20, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inconsistent/i);
  });

  it("rejects a plain score with tied sets and no tiebreak", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([EXISTING_MATCH]))
      .mockReturnValue(makeChain([]));
    const res = await supertest(app)
      .patch("/api/matches/1")
      .send({ score: "6-3, 3-6", winnerId: 10, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tied/i);
  });
});

describe("POST /api/matches — create-route score validation", () => {
  const BASE_BODY = { player1Id: 10, player2Id: 20 };

  function setupCreateMocks() {
    const createdMatch = { ...EXISTING_MATCH, status: "completed" };
    mockDb.select.mockReturnValue(makeChain([]));
    mockDb.insert.mockReturnValue(makeChain([createdMatch]));
  }

  it("rejects a non-participant winnerId", async () => {
    const res = await supertest(app)
      .post("/api/matches")
      .send({ ...BASE_BODY, score: "6-3, 6-2", winnerId: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/participant/i);
  });

  it("rejects a score inconsistent with the declared winner on create", async () => {
    // score says player1 (id=10) wins (6-3, 6-2) but winnerId=20 (player2)
    const res = await supertest(app)
      .post("/api/matches")
      .send({ ...BASE_BODY, score: "6-3, 6-2", winnerId: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inconsistent/i);
  });

  it("rejects a malformed score on create", async () => {
    const res = await supertest(app)
      .post("/api/matches")
      .send({ ...BASE_BODY, score: "bad-score", winnerId: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid set score/i);
  });

  it("rejects tied sets on create", async () => {
    const res = await supertest(app)
      .post("/api/matches")
      .send({ ...BASE_BODY, score: "6-3, 3-6", winnerId: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tied/i);
  });

  it("accepts a valid score and matching winner on create", async () => {
    setupCreateMocks();
    // score: player1 wins both sets → winnerId=10 is valid
    const res = await supertest(app)
      .post("/api/matches")
      .send({ ...BASE_BODY, score: "6-3, 6-2", winnerId: 10 });
    expect(res.status).toBe(201);
  });
});
