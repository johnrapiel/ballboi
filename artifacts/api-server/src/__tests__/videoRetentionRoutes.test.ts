import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// The routes' side of video retention: the ML request says whether to make a
// training copy, and a finished analysis settles the session's video.

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "user_a" }) }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    createUploadURL = vi.fn();
    getObjectEntityViewURL = vi.fn();
  },
}));
const settle = vi.fn().mockResolvedValue(undefined);
const keep = vi.fn().mockResolvedValue(true);
vi.mock("../lib/videoRetention", () => ({
  settleSessionVideo: (...a: unknown[]) => settle(...a),
  keepForTraining: (...a: unknown[]) => keep(...a),
}));

let rows: Record<string, unknown>[][] = [];
const chain = (value: unknown): unknown =>
  new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (f: (v: unknown) => unknown) => Promise.resolve(value).then(f);
      return () => chain(value);
    },
  });
const db = {
  select: vi.fn(() => chain(rows.shift() ?? [])),
  insert: vi.fn(() => chain([{ id: 1 }])),
  update: vi.fn(() => chain([{ id: 1, status: "processing" }])),
  delete: vi.fn(() => chain([])),
};
vi.mock("@workspace/db", () => ({
  get db() { return db; },
  ballBoiSessionsTable: {}, leaguesTable: {}, matchesTable: {}, matchShotsTable: {}, matchStatisticsTable: {}, playersTable: {},
}));

const session = { id: 5, matchId: 10, recordedByClerkUserId: "user_a", status: "processing", metadata: { mlCallbackToken: "tok" } };

async function app() {
  const { default: router } = await import("../routes/ballBoi.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ML_SECRET;
  rows = [];
});

describe("video retention in the Ball Boi routes", () => {
  it("asks the ML server for a training copy only when every player left training on", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    rows = [[session]];
    await supertest(await app()).post("/api/ball-boi/sessions/5/complete").send({ objectPath: "/objects/uploads/raw" });
    vi.unstubAllGlobals();
    expect(keep).toHaveBeenCalledWith(10);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).keep_for_training).toBe(true);
  });

  it("settles the video once a completed analysis is saved", async () => {
    const done = { ...session, status: "completed" };
    // callback session, existing shots, match, players, inserted names, then the re-read
    rows = [[session], [], [{ id: 10, player1Id: 1, player2Id: 2 }], [], [], [done]];
    const res = await supertest(await app())
      .post("/api/ball-boi/sessions/5/ml-callback?token=tok")
      .send({ status: "completed", result: { shots: [{ shotType: "serve" }], trainingVideoKey: "/objects/training/session-5.mp4" } });
    expect(res.status).toBe(200);
    expect(settle).toHaveBeenCalledWith(done, "/objects/training/session-5.mp4");
  });

  it("leaves the video alone when the analysis failed", async () => {
    rows = [[session]];
    await supertest(await app()).post("/api/ball-boi/sessions/5/ml-callback?token=tok").send({ status: "failed", error: "x" });
    expect(settle).not.toHaveBeenCalled();
  });
});
