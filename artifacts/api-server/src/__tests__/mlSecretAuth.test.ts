/**
 * Tests for X-ML-Secret authentication on API server ML callback routes.
 *
 * Covers:
 * - POST /api/shots/:id/ml-callback returns 403 when X-ML-Secret is missing or wrong
 * - POST /api/ball-boi/sessions/:sessionId/ml-callback returns 403 when
 *   X-ML-Secret is missing or wrong (and no valid token fallback)
 * - Both routes accept a request when X-ML-Secret matches the configured secret
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import supertest from "supertest";

const TEST_SECRET = "test-ml-secret-value";

// Must be set before the route modules are imported so they capture the value
// at module initialisation time.
process.env.ML_SECRET = TEST_SECRET;

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    createUploadURL = vi.fn().mockResolvedValue({ uploadURL: "https://storage.example.com/upload", objectPath: "/objects/test-path" });
    getObjectEntityViewURL = vi.fn().mockResolvedValue("https://storage.example.com/signed-view-url");
  },
}));

// Chainable mock helper (mirrors pattern in ballBoiRoutes.test.ts)
const mockChain = (resolveValue: unknown = []) => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve(resolveValue).then(onFulfilled);
      }
      if (prop === "catch") {
        return (onRejected: (e: unknown) => unknown) =>
          Promise.resolve(resolveValue).catch(onRejected);
      }
      if (prop === "finally") {
        return (onFinally: () => void) =>
          Promise.resolve(resolveValue).finally(onFinally);
      }
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
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiSessionsTable: { id: {}, matchId: {}, recordedByClerkUserId: {}, status: {}, processingStatus: {}, metadata: {} },
  leaguesTable: { id: {}, createdByClerkUserId: {} },
  matchesTable: { id: {}, player1Id: {}, player2Id: {}, player3Id: {}, player4Id: {}, leagueId: {} },
  matchShotsTable: { id: {}, sessionId: {}, sequenceNumber: {}, matchId: {} },
  matchStatisticsTable: { id: {}, sessionId: {}, matchId: {} },
  playersTable: { id: {}, clerkUserId: {}, name: {} },
  shotRecordingsTable: { id: {}, userId: {} },
  shotAnalysesTable: { id: {}, recordingId: {} },
}));

vi.mock("drizzle-orm", () => {
  const sqlTag = (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
    queryChunks: [],
    shouldInlineParams: false,
  });
  return {
    desc: (x: unknown) => x,
    eq: (a: unknown, b: unknown) => ({ a, b }),
    inArray: (a: unknown, b: unknown) => ({ a, b }),
    sql: sqlTag,
  };
});

// ─── /shots/:id/ml-callback ───────────────────────────────────────────────────

describe("POST /api/shots/:id/ml-callback — X-ML-Secret auth", () => {
  let app: express.Application;

  beforeAll(async () => {
    const { default: shotsRouter } = await import("../routes/shots.js");
    app = express();
    app.use(express.json());
    app.use("/api", shotsRouter);
  });

  it("returns 403 when X-ML-Secret header is missing", async () => {
    const res = await supertest(app)
      .post("/api/shots/1/ml-callback")
      .send({ status: "failed", error: "test" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when X-ML-Secret header is wrong", async () => {
    const res = await supertest(app)
      .post("/api/shots/1/ml-callback")
      .set("X-ML-Secret", "not-the-right-secret")
      .send({ status: "failed", error: "test" });
    expect(res.status).toBe(403);
  });

  it("returns 200 when X-ML-Secret matches the configured secret", async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    const res = await supertest(app)
      .post("/api/shots/1/ml-callback")
      .set("X-ML-Secret", TEST_SECRET)
      .send({ status: "failed", error: "test error" });
    expect(res.status).toBe(200);
  });
});

// ─── /ball-boi/sessions/:sessionId/ml-callback ───────────────────────────────

const SAMPLE_SESSION = {
  id: 1,
  matchId: 10,
  recordedByClerkUserId: "user_test",
  status: "processing",
  processingStatus: "processing",
  metadata: { mlCallbackToken: "stored-token-abc" },
};

describe("POST /api/ball-boi/sessions/:sessionId/ml-callback — X-ML-Secret auth", () => {
  let app: express.Application;

  beforeAll(async () => {
    const { default: ballBoiRouter } = await import("../routes/ballBoi.js");
    app = express();
    app.use(express.json());
    app.use("/api", ballBoiRouter);
  });

  it("returns 403 when X-ML-Secret header is missing", async () => {
    mockDb.select.mockImplementation(() => mockChain([SAMPLE_SESSION]));
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/ml-callback")
      .send({ status: "failed", error: "test" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when X-ML-Secret header is wrong", async () => {
    mockDb.select.mockImplementation(() => mockChain([SAMPLE_SESSION]));
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/ml-callback")
      .set("X-ML-Secret", "not-the-right-secret")
      .send({ status: "failed", error: "test" });
    expect(res.status).toBe(403);
  });

  it("returns 200 when X-ML-Secret matches the configured secret", async () => {
    mockDb.select.mockImplementation(() => mockChain([SAMPLE_SESSION]));
    mockDb.update.mockImplementation(() => mockChain([SAMPLE_SESSION]));
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/ml-callback")
      .set("X-ML-Secret", TEST_SECRET)
      .send({ status: "failed", error: "test error" });
    expect(res.status).toBe(200);
  });
});
