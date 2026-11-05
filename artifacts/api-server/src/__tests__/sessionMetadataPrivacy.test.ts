import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// A session's metadata holds the server's own keys: the ML callback token
// (whoever has it can post analysis results for the session), upload ids,
// stat gates, retry state and who hid the card. No response sends them to the
// phone, the recorder's or the opponent's (lib/sessionMetadata.ts).

let mockUserId: string | null = "user_me";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { rows } = vi.hoisted(() => ({ rows: {} as Record<string, Row[]> }));
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    ballBoiSessionsTable: table("sessions", [
      "id",
      "matchId",
      "recordedByClerkUserId",
      "status",
      "processingStatus",
      "processingError",
      "metadata",
      "recordingStartedAt",
      "createdAt",
      "updatedAt",
    ]),
    ballBoiDoublesViewsTable: table("doubles_views", ["id"]),
    leaguesTable: table("leagues", ["id", "createdByClerkUserId"]),
    leagueRoundsTable: table("league_rounds", ["id"]),
    playoffBracketsTable: table("brackets", ["id"]),
    matchesTable: table("matches", ["id", "player1Id", "player2Id", "player3Id", "player4Id", "leagueId", "score", "generatedFrom", "status"]),
    matchInvitesTable: table("invites", ["id", "matchId", "placeholderPlayerId", "claimedByClerkUserId"]),
    matchShotsTable: table("shots", ["id", "sessionId", "sequenceNumber", "matchId"]),
    matchStatisticsTable: table("stats", ["id", "sessionId", "matchId"]),
    playersTable: table("players", ["id", "clerkUserId", "name", "leagueId"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("../lib/blocks", () => ({ blockedAccountsFor: vi.fn().mockResolvedValue(new Set()) }));

const storage = vi.hoisted(() => ({
  parts: new Map<string, { partNumber: number; etag: string; size: number }[]>(),
  created: 0,
  completed: [] as string[],
  deleted: [] as string[],
  aborted: [] as string[],
}));
vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  return {
    ObjectNotFoundError,
    ObjectStorageService: class {
      createUploadURL = vi.fn().mockResolvedValue({ uploadURL: "https://storage.example/put", objectPath: "/objects/uploads/one" });
      createMultipartUpload = vi.fn(async () => {
        storage.created++;
        const objectPath = `/objects/uploads/mp-${storage.created}`;
        storage.parts.set(objectPath, []);
        return { uploadId: `up-${storage.created}`, objectPath };
      });
      createUploadPartURL = vi.fn(async (path: string, _id: string, n: number) => `https://storage.example${path}?part=${n}`);
      listUploadedParts = vi.fn(async (path: string) => {
        const parts = storage.parts.get(path);
        if (!parts) throw new ObjectNotFoundError();
        return parts;
      });
      completeMultipartUpload = vi.fn(async (path: string) => {
        storage.completed.push(path);
        storage.parts.delete(path);
      });
      abortMultipartUpload = vi.fn(async (path: string) => {
        storage.aborted.push(path);
      });
      headObject = vi.fn(async () => null);
      deleteObject = vi.fn(async (path: string) => {
        storage.deleted.push(path);
      });
    },
  };
});
vi.mock("../lib/videoRetention", () => ({
  keepForTraining: vi.fn().mockResolvedValue(false),
  settleSessionVideo: vi.fn().mockResolvedValue(undefined),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { MIB } from "../lib/multipartUpload.js";

async function buildApp() {
  const { default: ballBoi } = await import("../routes/ballBoi.js");
  const { default: recording } = await import("../routes/recording.js");
  const { default: quickMatch } = await import("../routes/quickMatch.js");
  const app = express();
  app.use(express.json());
  app.use("/api", ballBoi);
  app.use("/api", recording);
  app.use("/api", quickMatch);
  return app;
}

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function reset() {
  for (const k of Object.keys(rows)) delete rows[k];
  rows.players = [
    // Me in league 1 and league 2, plus a Quick match placeholder I claimed.
    { id: 1, clerkUserId: "user_me", name: "Me", leagueId: 1 },
    { id: 5, clerkUserId: "user_me", name: "Me", leagueId: 2 },
    { id: 7, clerkUserId: "user_me", name: "Me", leagueId: null },
    { id: 2, clerkUserId: "user_opp", name: "Opp", leagueId: 1 },
    { id: 6, clerkUserId: "user_six", name: "Six", leagueId: 2 },
    { id: 8, clerkUserId: "user_rec", name: "Rec", leagueId: null },
    { id: 9, clerkUserId: "user_out", name: "Out", leagueId: 3 },
  ];
  rows.leagues = [
    { id: 1, createdByClerkUserId: "user_admin" },
    { id: 2, createdByClerkUserId: "user_admin" },
  ];
  rows.matches = [
    { id: 10, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null, leagueId: 1, score: null },
    { id: 20, player1Id: 5, player2Id: 6, player3Id: null, player4Id: null, leagueId: 2, score: null },
    { id: 30, player1Id: 8, player2Id: 7, player3Id: null, player4Id: null, leagueId: null, score: null },
  ];
  rows.sessions = [];
  rows.shots = [];
  rows.stats = [];
  rows.invites = [];
  storage.parts.clear();
  storage.created = 0;
  storage.completed = [];
  storage.deleted = [];
  storage.aborted = [];
}

let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  reset();
  mockUserId = "user_me";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  app = await buildApp();
});

const TOKEN = "tok-secret-0001";

/** A session the way the server keeps it, with its own keys in metadata. */
function session(extra: Row = {}): Row {
  return {
    id: 100,
    matchId: 20,
    recordedByClerkUserId: "user_me",
    status: "completed",
    processingStatus: "completed",
    processingError: null,
    aiNarrative: "A close one.",
    metadata: {
      source: "ios",
      mlCallbackToken: TOKEN,
      uploads: { "0": { uploadId: "up-secret", objectPath: "/objects/uploads/a", sizeBytes: 10, partSize: 5 } },
      statGates: { stats: { serve_speed: { shown: true } } },
      retryCount: 1,
      nextRetryAt: "2026-11-05T00:00:00.000Z",
      hiddenFor: ["user_hidden"],
      chunks: [],
    },
    recordingStartedAt: minutesAgo(60),
    createdAt: minutesAgo(5),
    updatedAt: minutesAgo(5),
    ...extra,
  };
}

/** Nothing of the server's own metadata in the body; metadata, where sent, is the phone's own. */
function expectNoServerKeys(body: unknown) {
  const text = JSON.stringify(body);
  for (const secret of [TOKEN, "mlCallbackToken", "up-secret", "statGates", "user_hidden", "nextRetryAt", "hiddenFor"]) {
    expect(text).not.toContain(secret);
  }
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if ("metadata" in o && o.metadata != null && "recordedByClerkUserId" in o) expect(o.metadata).toEqual({ source: "ios" });
    for (const x of Object.values(o)) visit(x);
  };
  visit(body);
}

describe("session responses leave out the server's own metadata", () => {
  it("start: forged keys are dropped and none come back", async () => {
    const res = await supertest(app)
      .post("/api/ball-boi/matches/20/sessions/start")
      .send({ metadata: { source: "ios", mlCallbackToken: TOKEN, statGates: { all: true } } });
    expect(res.status).toBe(201);
    expect(res.body.metadata).toEqual({ source: "ios" });
    expectNoServerKeys(res.body);
  });

  it("complete: the token it makes isn't in the answer, the first time or the second", async () => {
    rows.sessions = [session({ status: "recording", processingStatus: "pending", metadata: { source: "ios" } })];
    const body = { objectPath: "/objects/uploads/one", contentType: "video/quicktime", sizeBytes: 1000, durationSeconds: 60 };
    const first = await supertest(app).post("/api/ball-boi/sessions/100/complete").send(body);
    expect(first.status).toBe(200);
    const made = (rows.sessions[0].metadata as Row).mlCallbackToken as string;
    expect(made).toEqual(expect.any(String));
    expect(JSON.stringify(first.body)).not.toContain(made);
    expect(first.body.metadata).toEqual({ source: "ios" });
    const second = await supertest(app).post("/api/ball-boi/sessions/100/complete").send(body);
    expect(second.status).toBe(200);
    expect(JSON.stringify(second.body)).not.toContain(made);
    expectNoServerKeys(second.body);
  });

  it("end (match-scoped finish)", async () => {
    rows.sessions = [session({ status: "recording", processingStatus: "pending" })];
    const res = await supertest(app).post("/api/matches/20/ball-boi/end").send({ objectPath: "/objects/uploads/one" });
    expect(res.status).toBe(200);
    expectNoServerKeys(res.body);
  });

  it("cancel", async () => {
    rows.sessions = [session({ status: "recording", processingStatus: "pending" })];
    const res = await supertest(app).post("/api/ball-boi/sessions/100/cancel").send({});
    expect(res.status).toBe(200);
    expectNoServerKeys(res.body);
  });

  it("replay, to the opponent too, at both addresses", async () => {
    rows.sessions = [session()];
    for (const user of ["user_me", "user_six"]) {
      mockUserId = user;
      for (const path of ["/api/ball-boi/matches/20/replay", "/api/matches/20/ball-boi/replay"]) {
        const res = await supertest(app).get(path);
        expect(res.status).toBe(200);
        expect(res.body.session).toMatchObject({ id: 100 });
        expectNoServerKeys(res.body);
      }
    }
  });

  it("replay metadata and the match's session list", async () => {
    rows.sessions = [session()];
    mockUserId = "user_six";
    const meta = await supertest(app).get("/api/ball-boi/sessions/100/replay-metadata");
    expect(meta.status).toBe(200);
    expect(meta.body.session).toMatchObject({ id: 100 });
    expectNoServerKeys(meta.body);
    const byMatch = await supertest(app).get("/api/matches/20/ball-boi/replay-metadata");
    expect(byMatch.status).toBe(200);
    expect(byMatch.body.session).toMatchObject({ id: 100 });
    expectNoServerKeys(byMatch.body);
    const list = await supertest(app).get("/api/ball-boi/matches/20/sessions");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expectNoServerKeys(list.body);
  });

  it("stat gates still apply after the keys are cut", async () => {
    rows.sessions = [session({ metadata: { source: "ios", mlCallbackToken: TOKEN } })];
    const res = await supertest(app).get("/api/ball-boi/matches/20/replay");
    // No statGates kept: every gated stat stays hidden.
    expect(res.body.hiddenStats.length).toBeGreaterThan(0);
    rows.sessions = [session()];
    const shown = await supertest(app).get("/api/ball-boi/matches/20/replay");
    expect(shown.body.hiddenStats).not.toContain("serve_speed");
  });

  it("the recordings list", async () => {
    rows.sessions = [session()];
    const res = await supertest(app).get("/api/recording/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expectNoServerKeys(res.body);
  });
});
