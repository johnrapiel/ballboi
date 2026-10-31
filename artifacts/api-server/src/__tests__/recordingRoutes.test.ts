import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_me";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

const selectQueue: unknown[][] = [];
const inserted: { table: string; values: unknown }[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return c;
}

const mockDb = {
  select: () => chain(() => selectQueue.shift() ?? []),
  insert: (t: { __name: string }) => ({
    values: (values: unknown) => {
      inserted.push({ table: t.__name, values });
      return { onConflictDoNothing: () => Promise.resolve(), returning: () => Promise.resolve([{ id: 1 }]) };
    },
  }),
};

function table(name: string, cols: string[]) {
  const t: Record<string, unknown> = { __name: name };
  for (const c of cols) t[c] = { table: name, col: c };
  return t;
}

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiDoublesViewsTable: table("ball_boi_doubles_views", ["clerkUserId", "matchId"]),
  leaguesTable: table("leagues", ["id", "name"]),
  matchesTable: table("matches", ["id", "player1Id", "player2Id", "player3Id", "player4Id"]),
  playersTable: table("players", ["id", "name", "clerkUserId"]),
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
  inArray: (a: unknown, b: unknown) => ({ a, b }),
}));

async function app() {
  const { default: router } = await import("../routes/recording.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

const from = "2026-10-29T04:00:00.000Z";
const to = "2026-10-30T04:00:00.000Z";

beforeEach(() => {
  mockUserId = "user_me";
  selectQueue.length = 0;
  inserted.length = 0;
});

describe("GET /recording/todays-matches", () => {
  it("needs a signed-in user", async () => {
    mockUserId = null;
    const res = await (await app()).get(`/api/recording/todays-matches?from=${from}&to=${to}`);
    expect(res.status).toBe(401);
  });

  it("rejects a missing or oversized window", async () => {
    const r = await app();
    expect((await r.get("/api/recording/todays-matches")).status).toBe(400);
    expect((await r.get(`/api/recording/todays-matches?from=${to}&to=${from}`)).status).toBe(400);
    expect((await r.get(`/api/recording/todays-matches?from=${from}&to=2026-11-05T04:00:00.000Z`)).status).toBe(400);
  });

  it("returns an empty list for someone with no player record", async () => {
    selectQueue.push([]);
    const res = await (await app()).get(`/api/recording/todays-matches?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("lists today's unplayed matches from the caller's side", async () => {
    selectQueue.push([{ id: 10 }]);
    selectQueue.push([
      { id: 1, leagueId: 7, player1Id: 10, player2Id: 20, player3Id: null, player4Id: null, status: "scheduled", scheduledAt: "2026-10-29T22:00:00.000Z", location: null },
      { id: 2, leagueId: 7, player1Id: 20, player2Id: 10, player3Id: null, player4Id: null, status: "completed", scheduledAt: "2026-10-29T15:00:00.000Z", location: null },
      { id: 3, leagueId: null, player1Id: 10, player2Id: 30, player3Id: null, player4Id: null, status: "scheduled", scheduledAt: "2026-10-31T15:00:00.000Z", location: null },
    ]);
    selectQueue.push([
      { id: 10, name: "John" },
      { id: 20, name: "Alex Kim" },
    ]);
    selectQueue.push([{ id: 7, name: "Tuesday Flex" }]);
    const res = await (await app()).get(`/api/recording/todays-matches?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: 1, opponentName: "Alex Kim", leagueName: "Tuesday Flex", format: "singles" }),
    ]);
  });
});

describe("POST /recording/doubles-views", () => {
  it("logs one view per person per match", async () => {
    const res = await (await app()).post("/api/recording/doubles-views").send({ matchId: 5 });
    expect(res.status).toBe(204);
    expect(inserted).toEqual([{ table: "ball_boi_doubles_views", values: { clerkUserId: "user_me", matchId: 5 } }]);
  });

  it("needs a match id", async () => {
    const res = await (await app()).post("/api/recording/doubles-views").send({});
    expect(res.status).toBe(400);
    expect(inserted).toEqual([]);
  });
});
