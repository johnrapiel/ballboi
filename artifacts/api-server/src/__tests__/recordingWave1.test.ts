import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// Wave 1 review, PR 6 (recording, upload and analysis), server side:
// - D3: a player in two leagues, and a claimed placeholder, can record.
// - D33: confirming an upload twice starts analysis once.
// - D11: analysis that never hears back is marked failed within an hour.
// - Q16: the failed card's short reason.
// - Q15: both players see the match's card; Remove.
// - D4: multipart uploads.

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

function session(extra: Row = {}): Row {
  return {
    id: 100,
    matchId: 20,
    recordedByClerkUserId: "user_me",
    status: "recording",
    processingStatus: "pending",
    processingError: null,
    metadata: {},
    recordingStartedAt: minutesAgo(60),
    createdAt: minutesAgo(5),
    updatedAt: minutesAgo(5),
    ...extra,
  };
}

describe("D3: who can record a match", () => {
  it("lets a player in two leagues record a match from their second league", async () => {
    const res = await supertest(app).post("/api/ball-boi/matches/20/sessions/start").send({ metadata: { source: "ios" } });
    expect(res.status).toBe(201);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0]).toMatchObject({ matchId: 20, recordedByClerkUserId: "user_me", status: "recording" });
  });

  it("lets a player record from their first league too", async () => {
    const res = await supertest(app).post("/api/ball-boi/matches/10/sessions/start").send({});
    expect(res.status).toBe(201);
  });

  it("lets a placeholder who claimed a Quick match invite record it", async () => {
    const res = await supertest(app).post("/api/ball-boi/matches/30/sessions/start").send({});
    expect(res.status).toBe(201);
  });

  it("keeps out a player who isn't in the match", async () => {
    mockUserId = "user_out";
    const res = await supertest(app).post("/api/ball-boi/matches/20/sessions/start").send({});
    expect(res.status).toBe(403);
  });

  it("takes only the source from the phone's metadata, never server keys", async () => {
    await supertest(app)
      .post("/api/ball-boi/matches/20/sessions/start")
      .send({ metadata: { source: "ios", mlCallbackToken: "forged", statGates: { all: true } } });
    expect(rows.sessions[0].metadata).toEqual({ source: "ios" });
  });

  it("dates the session from when the match was recorded (D19)", async () => {
    const yesterday = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();
    await supertest(app).post("/api/ball-boi/matches/20/sessions/start").send({ recordedAt: yesterday });
    expect((rows.sessions[0].recordingStartedAt as Date).toISOString()).toBe(yesterday);
  });
});

describe("D33: confirming an upload twice", () => {
  it("starts analysis once", async () => {
    rows.sessions = [session()];
    const body = { objectPath: "/objects/uploads/one", contentType: "video/quicktime", sizeBytes: 1000, durationSeconds: 60 };
    const first = await supertest(app).post("/api/ball-boi/sessions/100/complete").send(body);
    const second = await supertest(app).post("/api/ball-boi/sessions/100/complete").send(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("processing");
    const dispatches = fetchMock.mock.calls.filter(([url]) => String(url).includes("/analyze-match-batch"));
    expect(dispatches).toHaveLength(1);
  });

  it("records when analysis started, for the stuck-analysis sweep", async () => {
    rows.sessions = [session()];
    await supertest(app)
      .post("/api/ball-boi/sessions/100/complete")
      .send({ objectPath: "/objects/uploads/one", contentType: "video/quicktime", sizeBytes: 1000, durationSeconds: 60 });
    expect(typeof (rows.sessions[0].metadata as Row).analysisStartedAt).toBe("string");
  });

  it("sends every piece of an interrupted match to the analysis server, in order", async () => {
    rows.sessions = [
      session({
        metadata: {
          uploads: {
            "0": { uploadId: "a", objectPath: "/objects/uploads/a", sizeBytes: 10, partSize: 64 * MIB, completedAt: "x" },
            "1": { uploadId: "b", objectPath: "/objects/uploads/b", sizeBytes: 5, partSize: 64 * MIB, completedAt: "x" },
          },
        },
      }),
    ];
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/100/complete")
      .send({
        objectPath: "/objects/uploads/a",
        contentType: "video/quicktime",
        sizeBytes: 15,
        durationSeconds: 90,
        segments: [
          { objectPath: "/objects/uploads/a", sizeBytes: 10, durationSeconds: 60 },
          { objectPath: "/objects/uploads/b", sizeBytes: 5, durationSeconds: 30 },
        ],
      });
    expect(res.status).toBe(200);
    expect(rows.sessions[0]).toMatchObject({ videoObjectPath: "/objects/uploads/a", durationSeconds: 90 });
    expect((rows.sessions[0].metadata as Row).segmentPaths).toEqual(["/objects/uploads/b"]);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.video_urls).toEqual([
      expect.stringContaining("/api/storage/objects/uploads/a"),
      expect.stringContaining("/api/storage/objects/uploads/b"),
    ]);
  });

  it("refuses a piece that never finished uploading", async () => {
    rows.sessions = [
      session({
        metadata: { uploads: { "0": { uploadId: "a", objectPath: "/objects/uploads/a", sizeBytes: 10, partSize: 64 * MIB } } },
      }),
    ];
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/100/complete")
      .send({ objectPath: "/objects/uploads/a", contentType: "video/quicktime", sizeBytes: 10, durationSeconds: 60 });
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("D4: multipart uploads", () => {
  it("starts, lists what's missing, joins once every part is in, and picks up where it left off", async () => {
    rows.sessions = [session()];
    const size = 150 * MIB;
    const start = await supertest(app).post("/api/ball-boi/sessions/100/multipart").send({ segment: 0, sizeBytes: size });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ partSize: 64 * MIB, partCount: 3, missingParts: [1, 2, 3], completed: false });
    const path = start.body.objectPath as string;

    const url = await supertest(app).post("/api/ball-boi/sessions/100/multipart/part-url").send({ segment: 0, partNumber: 2 });
    expect(url.status).toBe(200);
    expect(url.body.url).toContain("part=2");

    // Two parts arrive, then the app closes. Starting again lists only the missing one.
    storage.parts.set(path, [
      { partNumber: 1, etag: "e1", size: 64 * MIB },
      { partNumber: 2, etag: "e2", size: 64 * MIB },
    ]);
    const again = await supertest(app).post("/api/ball-boi/sessions/100/multipart").send({ segment: 0, sizeBytes: size });
    expect(again.body.objectPath).toBe(path);
    expect(again.body.missingParts).toEqual([3]);
    expect(storage.created).toBe(1);

    const early = await supertest(app).post("/api/ball-boi/sessions/100/multipart/complete").send({ segment: 0 });
    expect(early.status).toBe(409);
    expect(early.body.missingParts).toEqual([3]);

    storage.parts.get(path)!.push({ partNumber: 3, etag: "e3", size: 22 * MIB });
    const done = await supertest(app).post("/api/ball-boi/sessions/100/multipart/complete").send({ segment: 0 });
    expect(done.status).toBe(200);
    expect(done.body.objectPath).toBe(path);
    expect(storage.completed).toEqual([path]);

    // Asking again is safe.
    const repeat = await supertest(app).post("/api/ball-boi/sessions/100/multipart/complete").send({ segment: 0 });
    expect(repeat.status).toBe(200);
  });

  it("takes a file over 5 GB, the old single-upload limit", async () => {
    rows.sessions = [session()];
    const res = await supertest(app).post("/api/ball-boi/sessions/100/multipart").send({ segment: 0, sizeBytes: 6 * 1024 * MIB });
    expect(res.status).toBe(200);
    expect(res.body.partCount).toBe(96);
  });

  it("tells the phone when the recording is already uploaded", async () => {
    rows.sessions = [session({ status: "processing" })];
    const res = await supertest(app).post("/api/ball-boi/sessions/100/multipart").send({ segment: 0, sizeBytes: 10 });
    expect(res.status).toBe(409);
    expect(res.body.uploaded).toBe(true);
  });

  it("is the recorder's only", async () => {
    rows.sessions = [session()];
    mockUserId = "user_six";
    const res = await supertest(app).post("/api/ball-boi/sessions/100/multipart").send({ segment: 0, sizeBytes: 10 });
    expect(res.status).toBe(403);
  });
});

describe("D11: analysis that never hears back", () => {
  it("is marked failed by the sweep within an hour, and only once it's waited 50 minutes", async () => {
    const { failStuckAnalyses } = await import("../services/ballBoiStuck.js");
    rows.sessions = [
      session({ id: 1, status: "processing", processingStatus: "processing", metadata: { analysisStartedAt: minutesAgo(51).toISOString() } }),
      session({ id: 2, status: "processing", processingStatus: "processing", metadata: { analysisStartedAt: minutesAgo(10).toISOString() } }),
      // Older sessions without analysisStartedAt go by their last update.
      session({ id: 3, status: "processing", processingStatus: "processing", metadata: {}, updatedAt: minutesAgo(70) }),
      session({ id: 4, status: "completed", processingStatus: "completed", updatedAt: minutesAgo(500) }),
    ];
    expect(await failStuckAnalyses(now)).toBe(2);
    const byId = Object.fromEntries(rows.sessions.map((s) => [s.id, s]));
    expect(byId[1]).toMatchObject({ status: "failed", processingStatus: "failed" });
    expect(byId[2]).toMatchObject({ status: "processing" });
    expect(byId[3]).toMatchObject({ status: "failed" });
    expect(byId[4]).toMatchObject({ status: "completed" });
  });

  it("shows the failed card with its reason", async () => {
    const { failStuckAnalyses } = await import("../services/ballBoiStuck.js");
    rows.sessions = [session({ status: "processing", processingStatus: "processing", metadata: { analysisStartedAt: minutesAgo(55).toISOString() } })];
    await failStuckAnalyses(now);
    const res = await supertest(app).get("/api/recording/sessions");
    expect(res.body[0]).toMatchObject({ stage: "failed", failedReason: "The analysis didn't finish." });
  });
});

describe("Q15 and Q16: Your recordings", () => {
  it("shows the match's card to the recorder, the league opponent and a claimed placeholder", async () => {
    rows.sessions = [
      session({ id: 1, matchId: 10, recordedByClerkUserId: "user_opp", status: "processing", processingStatus: "processing" }),
      session({ id: 2, matchId: 30, recordedByClerkUserId: "user_rec", status: "completed", processingStatus: "completed" }),
      session({ id: 3, matchId: 20, recordedByClerkUserId: "user_me", status: "processing", processingStatus: "processing" }),
    ];
    const mine = await supertest(app).get("/api/recording/sessions");
    expect(mine.status).toBe(200);
    expect(mine.body.map((r: Row) => r.sessionId).sort()).toEqual([1, 2, 3]);
    const byId = Object.fromEntries(mine.body.map((r: Row) => [r.sessionId, r]));
    expect(byId[1]).toMatchObject({ opponentName: "Opp", recordedByYou: false, stage: "analyzing", leagueId: 1 });
    expect(byId[2]).toMatchObject({ opponentName: "Rec", recordedByYou: false, stage: "ready", leagueId: null });
    expect(byId[3]).toMatchObject({ opponentName: "Six", recordedByYou: true });

    mockUserId = "user_opp";
    const theirs = await supertest(app).get("/api/recording/sessions");
    expect(theirs.body.map((r: Row) => r.sessionId)).toEqual([1]);
  });

  it("gives a failed card a short reason", async () => {
    rows.sessions = [
      session({ id: 1, status: "failed", processingStatus: "failed", processingError: "ML analysis completed without detected shots" }),
      session({ id: 2, status: "failed", processingStatus: "failed", processingError: "Could not find the court in the video" }),
      session({ id: 3, status: "failed", processingStatus: "failed", processingError: "Video too short to analyze" }),
      session({ id: 4, status: "failed", processingStatus: "failed", processingError: "Something odd" }),
    ];
    const res = await supertest(app).get("/api/recording/sessions");
    const reasons = Object.fromEntries(res.body.map((r: Row) => [r.sessionId, r.failedReason]));
    expect(reasons).toEqual({
      1: "We couldn't see the court.",
      2: "We couldn't see the court.",
      3: "The recording is too short.",
      4: "Something went wrong on our side.",
    });
  });

  it("shows a match waiting for an automatic retry as analyzing, not failed", async () => {
    rows.sessions = [
      session({
        status: "failed",
        processingStatus: "failed",
        processingError: "Analysis service is temporarily unavailable — your video has been saved.",
        metadata: { retryCount: 1, nextRetryAt: new Date(now.getTime() + 60_000).toISOString() },
      }),
    ];
    const res = await supertest(app).get("/api/recording/sessions");
    expect(res.body[0]).toMatchObject({ stage: "analyzing", failedReason: null });
  });

  it("Remove by the opponent takes it off their list only", async () => {
    rows.sessions = [session({ id: 1, matchId: 10, recordedByClerkUserId: "user_opp", status: "failed", processingStatus: "failed" })];
    const res = await supertest(app).post("/api/recording/sessions/1/remove").send({});
    expect(res.status).toBe(200);
    expect(rows.sessions).toHaveLength(1);
    expect((await supertest(app).get("/api/recording/sessions")).body).toEqual([]);
    mockUserId = "user_opp";
    expect((await supertest(app).get("/api/recording/sessions")).body).toHaveLength(1);
  });

  it("Remove by the recorder deletes the recording and its video", async () => {
    rows.sessions = [
      session({
        id: 1,
        status: "failed",
        processingStatus: "failed",
        videoObjectPath: "/objects/uploads/a",
        metadata: { segmentPaths: ["/objects/uploads/b"] },
      }),
    ];
    const res = await supertest(app).post("/api/recording/sessions/1/remove").send({});
    expect(res.status).toBe(200);
    expect(rows.sessions).toHaveLength(0);
    expect(storage.deleted.sort()).toEqual(["/objects/uploads/a", "/objects/uploads/b"]);
  });

  it("Remove isn't offered on a match that's analyzing", async () => {
    rows.sessions = [session({ id: 1, status: "processing", processingStatus: "processing" })];
    const res = await supertest(app).post("/api/recording/sessions/1/remove").send({});
    expect(res.status).toBe(409);
    expect(rows.sessions).toHaveLength(1);
  });

  it("Remove is refused to someone outside the match", async () => {
    rows.sessions = [session({ id: 1, status: "failed", processingStatus: "failed" })];
    mockUserId = "user_out";
    const res = await supertest(app).post("/api/recording/sessions/1/remove").send({});
    expect(res.status).toBe(403);
  });
});

describe("Q18: a Quick match left before recording", () => {
  beforeEach(() => {
    rows.players.push({ id: 40, clerkUserId: null, name: "Sam", leagueId: null });
    rows.matches.push({ id: 41, player1Id: 7, player2Id: 40, player3Id: null, player4Id: null, leagueId: null, score: null, generatedFrom: "quick_match", status: "scheduled" });
    rows.invites = [{ id: 1, matchId: 41, placeholderPlayerId: 40, claimedByClerkUserId: null }];
  });

  it("is removed, with its placeholder opponent", async () => {
    const res = await supertest(app).post("/api/recording/quick-matches/41/abandon").send({});
    expect(res.status).toBe(200);
    expect(rows.matches.some((m) => m.id === 41)).toBe(false);
    expect(rows.players.some((p) => p.id === 40)).toBe(false);
  });

  it("stays once it has a recording", async () => {
    rows.sessions = [session({ matchId: 41 })];
    const res = await supertest(app).post("/api/recording/quick-matches/41/abandon").send({});
    expect(res.status).toBe(409);
    expect(rows.matches.some((m) => m.id === 41)).toBe(true);
  });

  it("stays once it has a score", async () => {
    rows.matches.find((m) => m.id === 41)!.score = "6-4 6-3";
    const res = await supertest(app).post("/api/recording/quick-matches/41/abandon").send({});
    expect(res.status).toBe(409);
  });

  it("can only be removed by the player who started it", async () => {
    mockUserId = "user_opp";
    const res = await supertest(app).post("/api/recording/quick-matches/41/abandon").send({});
    expect(res.status).toBe(403);
  });

  it("never removes a league match", async () => {
    const res = await supertest(app).post("/api/recording/quick-matches/20/abandon").send({});
    expect(res.status).toBe(409);
    expect(rows.matches.some((m) => m.id === 20)).toBe(true);
  });

  it("is already gone: fine", async () => {
    const res = await supertest(app).post("/api/recording/quick-matches/999/abandon").send({});
    expect(res.status).toBe(200);
  });
});
