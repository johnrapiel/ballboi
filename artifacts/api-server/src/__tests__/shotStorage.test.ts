import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// The shot callback stores every shot as structured data (spec: Ball Boi >
// Data foundation for later coaching), straight from the pipeline's result.

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {} }));

let rows: unknown[][] = [];
const inserted: unknown[] = [];
const chain = (value: unknown): unknown =>
  new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (f: (v: unknown) => unknown) => Promise.resolve(value).then(f);
      return () => chain(value);
    },
  });
const db = {
  select: vi.fn(() => chain(rows.shift() ?? [])),
  insert: vi.fn(() => ({
    values: (v: unknown) => {
      inserted.push(v);
      const list = Array.isArray(v) ? v.map((s, i) => ({ id: i + 1, ...(s as object) })) : [v];
      return Object.assign(chain(list) as object, { returning: () => Promise.resolve(list) });
    },
  })),
  update: vi.fn(() => chain([])),
  delete: vi.fn(() => chain([])),
};
vi.mock("@workspace/db", () => ({
  get db() { return db; },
  ballBoiSessionsTable: {}, leaguesTable: {}, matchesTable: {}, matchShotsTable: {}, matchStatisticsTable: {}, playersTable: {},
}));

const session = { id: 5, matchId: 10, status: "processing", metadata: { mlCallbackToken: "tok" } };
const match = { id: 10, player1Id: 1, player2Id: 2 };

const result = {
  durationSeconds: 60,
  model: { version: "v-abc", degraded: false },
  shots: [
    { hitter: "near", type: "serve", shotType: "serve", timestampSeconds: 3.1, serveNumber: 1, sequenceNumber: 1, rallyNumber: 1,
      bounce: { time: 3.6, court: [1.1, 5.2] }, result: "in", resultConfidence: 0.97, closeCall: false, lineDistanceMeters: 0.9,
      serveZone: "deuce_wide", pointEnd: null, ballTrajectory: { estimatedSpeedMph: null } },
    { hitter: "far", type: "forehand", shotType: "forehand", timestampSeconds: 4.4, sequenceNumber: 2, rallyNumber: 1,
      bounce: { time: 5.0, court: [-4.2, -11.95] }, result: "out", resultConfidence: 0.62, closeCall: true, lineDistanceMeters: -0.04,
      pointEnd: "unforced_error" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ML_SECRET;
  inserted.length = 0;
});

describe("shot callback storage", () => {
  it("stores type, landing spot, outcome and time for every shot, and guesses no player", async () => {
    rows = [[session], [], [match], [], []];
    const { default: router } = await import("../routes/ballBoi.js");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    const res = await supertest(app)
      .post("/api/matches/10/ball-boi/shot-callback?token=tok")
      .send({ sessionId: 5, status: "completed", result });
    expect(res.status).toBe(200);
    const shots = inserted[0] as Record<string, unknown>[];
    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({
      shotType: "serve", timestampSeconds: 3.1, hitterSide: "near", playerId: null,
      landingXM: 1.1, landingYM: 5.2, lineCall: "in", serveNumber: 1, serveZone: "deuce_wide",
      closeCall: false, speedMph: null, modelVersion: "v-abc",
    });
    expect(shots[1]).toMatchObject({
      shotType: "forehand", hitterSide: "far", playerId: null, lineCall: "out", closeCall: true,
      lineDistanceM: -0.04, landingYM: -11.95, pointEnd: "unforced_error",
    });
  });
});
