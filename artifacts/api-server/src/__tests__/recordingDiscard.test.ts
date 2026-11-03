import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { planDiscard, type DiscardInput } from "../lib/recordingDiscard";

const league = { leagueId: 7, player1Id: 10, player2Id: 20, player3Id: null, player4Id: null };
const quick = { ...league, leagueId: null };

function input(over: Partial<DiscardInput> = {}): DiscardInput {
  return {
    match: league,
    matchId: 5,
    callerPlayerIds: [10],
    callerClerkUserId: "user_me",
    session: { id: 99, matchId: 5, recordedByClerkUserId: "user_me", status: "recording" },
    sessionRequested: true,
    unclaimedPlaceholderPlayerId: null,
    otherSessionCount: 0,
    ...over,
  };
}

describe("planDiscard", () => {
  it("D3: a league match keeps the match; only the recording goes", () => {
    expect(planDiscard(input())).toEqual({ ok: true, deleteSessionId: 99, removePlaceholderPlayerId: null });
  });

  it("D3: a Quick match against a placeholder goes with the recording", () => {
    expect(planDiscard(input({ match: quick, unclaimedPlaceholderPlayerId: 20 }))).toEqual({
      ok: true,
      deleteSessionId: 99,
      removePlaceholderPlayerId: 20,
    });
  });

  it("keeps a Quick match against a real player, or one with another recording", () => {
    expect(planDiscard(input({ match: quick })).ok && planDiscard(input({ match: quick }))).toMatchObject({
      removePlaceholderPlayerId: null,
    });
    expect(planDiscard(input({ match: quick, unclaimedPlaceholderPlayerId: 20, otherSessionCount: 1 }))).toMatchObject({
      removePlaceholderPlayerId: null,
    });
  });

  it("D1: with no session (discarded before upload), only a placeholder match is removed", () => {
    expect(planDiscard(input({ session: null, sessionRequested: false }))).toEqual({
      ok: true,
      deleteSessionId: null,
      removePlaceholderPlayerId: null,
    });
    expect(
      planDiscard(input({ session: null, sessionRequested: false, match: quick, unclaimedPlaceholderPlayerId: 20 })),
    ).toMatchObject({ removePlaceholderPlayerId: 20 });
  });

  it("D2: refuses once the upload has finished", () => {
    expect(planDiscard(input({ session: { id: 99, matchId: 5, recordedByClerkUserId: "user_me", status: "processing" } })))
      .toMatchObject({ ok: false, status: 409 });
  });

  it("only the recorder, and only a player in the match", () => {
    expect(planDiscard(input({ session: { id: 99, matchId: 5, recordedByClerkUserId: "someone", status: "recording" } })))
      .toMatchObject({ ok: false, status: 403 });
    expect(planDiscard(input({ callerPlayerIds: [99] }))).toMatchObject({ ok: false, status: 403 });
    expect(planDiscard(input({ session: { id: 99, matchId: 6, recordedByClerkUserId: "user_me", status: "recording" } })))
      .toMatchObject({ ok: false, status: 403 });
  });

  it("treats a session that's already gone as discarded, so a retry succeeds", () => {
    expect(planDiscard(input({ session: null }))).toEqual({ ok: true, deleteSessionId: null, removePlaceholderPlayerId: null });
  });
});

// ─── Route ──────────────────────────────────────────────────────────────────

let mockUserId: string | null = "user_me";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

const selectQueue: unknown[][] = [];
const deleted: string[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return c;
}

const tx = { delete: (t: { __name: string }) => ({ where: async () => void deleted.push(t.__name) }) };
const mockDb = {
  select: () => chain(() => selectQueue.shift() ?? []),
  transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
};
const t = (name: string) => new Proxy({ __name: name } as Record<string, unknown>, { get: (o, k) => (k in o ? o[k as string] : {}) });

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiDoublesViewsTable: t("ball_boi_doubles_views"),
  ballBoiSessionsTable: t("ball_boi_sessions"),
  leaguesTable: t("leagues"),
  matchesTable: t("matches"),
  matchInvitesTable: t("match_invites"),
  playersTable: t("players"),
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  desc: (a: unknown) => a,
  eq: (a: unknown, b: unknown) => ({ a, b }),
  gte: (a: unknown, b: unknown) => ({ a, b }),
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  isNull: (a: unknown) => a,
  ne: (a: unknown, b: unknown) => ({ a, b }),
  or: (...a: unknown[]) => a,
}));

async function app() {
  const { default: router } = await import("../routes/recording.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_me";
  selectQueue.length = 0;
  deleted.length = 0;
});

describe("POST /recording/discard", () => {
  it("deletes the session and the placeholder Quick match together", async () => {
    selectQueue.push(
      [{ id: 5, ...quick }],
      [{ id: 10 }],
      [{ id: 99, matchId: 5, recordedByClerkUserId: "user_me", status: "recording" }],
      [{ placeholderPlayerId: 20 }],
      [],
    );
    const res = await (await app()).post("/api/recording/discard").send({ matchId: 5, sessionId: 99 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionDeleted: true, matchRemoved: true });
    expect(deleted).toEqual(["ball_boi_sessions", "players"]);
  });

  it("leaves a league match alone", async () => {
    selectQueue.push(
      [{ id: 5, ...league }],
      [{ id: 10 }],
      [{ id: 99, matchId: 5, recordedByClerkUserId: "user_me", status: "recording" }],
      [],
      [],
    );
    const res = await (await app()).post("/api/recording/discard").send({ matchId: 5, sessionId: 99 });
    expect(res.body).toEqual({ sessionDeleted: true, matchRemoved: false });
    expect(deleted).toEqual(["ball_boi_sessions"]);
  });

  it("refuses an uploaded recording without deleting anything", async () => {
    selectQueue.push(
      [{ id: 5, ...league }],
      [{ id: 10 }],
      [{ id: 99, matchId: 5, recordedByClerkUserId: "user_me", status: "processing" }],
      [],
      [],
    );
    const res = await (await app()).post("/api/recording/discard").send({ matchId: 5, sessionId: 99 });
    expect(res.status).toBe(409);
    expect(deleted).toEqual([]);
  });

  it("validates input and needs sign-in", async () => {
    expect((await (await app()).post("/api/recording/discard").send({})).status).toBe(400);
    expect((await (await app()).post("/api/recording/discard").send({ matchId: 5, sessionId: "x" })).status).toBe(400);
    mockUserId = null;
    expect((await (await app()).post("/api/recording/discard").send({ matchId: 5 })).status).toBe(401);
  });
});
