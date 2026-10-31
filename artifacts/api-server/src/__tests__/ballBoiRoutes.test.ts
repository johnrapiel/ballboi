import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { isMlServiceUnreachable } from "../lib/mlServiceErrors.js";

const mockUserId = "user_test123";
let mockGetAuth: () => { userId: string | null } = () => ({ userId: mockUserId });

vi.mock("@clerk/express", () => ({
  getAuth: (req: unknown) => mockGetAuth(),
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
  ObjectStorageService: class MockObjectStorageService {
    createUploadURL = vi.fn().mockResolvedValue({ uploadURL: "https://storage.example.com/upload", objectPath: "/objects/test-path" });
    getObjectEntityViewURL = vi.fn().mockResolvedValue("https://storage.example.com/signed-view-url");
  },
}));

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

const mockDbState = {
  sessions: [] as Record<string, unknown>[],
  shots: [] as Record<string, unknown>[],
  matches: [] as Record<string, unknown>[],
  players: [] as Record<string, unknown>[],
  statistics: [] as Record<string, unknown>[],
};

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiSessionsTable: { id: {}, matchId: {}, recordedByClerkUserId: {}, status: {}, processingStatus: {} },
  leaguesTable: { id: {}, createdByClerkUserId: {} },
  matchesTable: { id: {}, player1Id: {}, player2Id: {}, player3Id: {}, player4Id: {}, leagueId: {} },
  matchShotsTable: { id: {}, sessionId: {}, sequenceNumber: {}, matchId: {} },
  matchStatisticsTable: { id: {}, sessionId: {}, matchId: {} },
  playersTable: { id: {}, clerkUserId: {}, name: {} },
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

async function buildApp() {
  const { default: ballBoiRouter } = await import("../routes/ballBoi.js");
  const app = express();
  app.use(express.json());
  app.use("/api", ballBoiRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetAuth = () => ({ userId: mockUserId });
  app = await buildApp();

  const sampleSession = {
    id: 1,
    matchId: 10,
    recordedByClerkUserId: mockUserId,
    status: "recording",
    processingStatus: "pending",
    metadata: {},
    createdAt: new Date().toISOString(),
  };

  const sampleMatch = {
    id: 10,
    player1Id: 1,
    player2Id: 2,
    player3Id: null,
    player4Id: null,
    leagueId: null,
  };

  const samplePlayer = { id: 1, clerkUserId: mockUserId, name: "Test Player" };

  mockDb.select.mockImplementation(() =>
    mockChain([sampleMatch]),
  );

  mockDb.insert.mockImplementation(() =>
    mockChain([sampleSession]),
  );

  mockDb.update.mockImplementation(() =>
    mockChain([sampleSession]),
  );

  mockDb.delete.mockImplementation(() => mockChain([]));

  void samplePlayer;
});

describe("isMlServiceUnreachable — unit tests", () => {
  it("returns false for non-Error values", () => {
    expect(isMlServiceUnreachable(null)).toBe(false);
    expect(isMlServiceUnreachable(undefined)).toBe(false);
    expect(isMlServiceUnreachable("ECONNREFUSED")).toBe(false);
    expect(isMlServiceUnreachable(42)).toBe(false);
    expect(isMlServiceUnreachable({ message: "ECONNREFUSED" })).toBe(false);
  });

  it("returns true for TypeError instances", () => {
    expect(isMlServiceUnreachable(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("returns true for AbortError", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(isMlServiceUnreachable(err)).toBe(true);
  });

  it("returns true for TimeoutError", () => {
    const err = new Error("The operation timed out");
    err.name = "TimeoutError";
    expect(isMlServiceUnreachable(err)).toBe(true);
  });

  it("returns true when message includes 'fetch failed'", () => {
    expect(isMlServiceUnreachable(new Error("fetch failed"))).toBe(true);
  });

  it("returns true when message includes ECONNREFUSED", () => {
    expect(isMlServiceUnreachable(new Error("connect ECONNREFUSED 127.0.0.1:8090"))).toBe(true);
  });

  it("returns true when message includes ENOTFOUND", () => {
    expect(isMlServiceUnreachable(new Error("getaddrinfo ENOTFOUND ml-service.internal"))).toBe(true);
  });

  it("returns true when message includes ETIMEDOUT", () => {
    expect(isMlServiceUnreachable(new Error("connect ETIMEDOUT 10.0.0.1:8090"))).toBe(true);
  });

  it("returns true for ML service HTTP 502", () => {
    expect(isMlServiceUnreachable(new Error("ML service returned 502"))).toBe(true);
  });

  it("returns true for ML service HTTP 503", () => {
    expect(isMlServiceUnreachable(new Error("ML service returned 503"))).toBe(true);
  });

  it("returns true for ML service HTTP 504", () => {
    expect(isMlServiceUnreachable(new Error("ML service returned 504"))).toBe(true);
  });

  it("returns false for ML service HTTP 500 (internal server error is not treated as unreachable)", () => {
    expect(isMlServiceUnreachable(new Error("ML service returned 500"))).toBe(false);
  });

  it("returns false for a plain generic Error with no special properties", () => {
    expect(isMlServiceUnreachable(new Error("Something went wrong in the ML pipeline"))).toBe(false);
  });
});

describe("POST /api/ball-boi/matches/:matchId/sessions/start", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app)
      .post("/api/ball-boi/matches/10/sessions/start")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it("returns 400 for a non-numeric matchId", async () => {
    const res = await supertest(app)
      .post("/api/ball-boi/matches/not-a-number/sessions/start")
      .set("Authorization", "Bearer token")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid match id/i);
  });

  it("returns 404 when match does not exist", async () => {
    mockDb.select.mockImplementation(() => mockChain([]));
    const res = await supertest(app)
      .post("/api/ball-boi/matches/999/sessions/start")
      .set("Authorization", "Bearer token")
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/match not found/i);
  });

  it("creates and returns a session with status 201", async () => {
    const sampleMatch = { id: 10, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null, leagueId: null };
    const samplePlayer = { id: 1, clerkUserId: mockUserId, name: "Test Player" };
    const newSession = { id: 7, matchId: 10, status: "recording", processingStatus: "pending", recordedByClerkUserId: mockUserId, metadata: {} };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([sampleMatch]);
      if (selectCall === 2) return mockChain([samplePlayer]);
      return mockChain([]);
    });
    mockDb.insert.mockImplementation(() => mockChain([newSession]));

    const res = await supertest(app)
      .post("/api/ball-boi/matches/10/sessions/start")
      .set("Authorization", "Bearer token")
      .send({ metadata: { source: "browser-camera" } });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("recording");
    expect(res.body.processingStatus).toBe("pending");
    expect(res.body.matchId).toBe(10);
  });
});

describe("POST /api/ball-boi/sessions/:sessionId/live-shot", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/live-shot")
      .send({ timestampSeconds: 10 });
    expect(res.status).toBe(401);
  });

  it("returns 404 when session does not exist", async () => {
    mockDb.select.mockImplementation(() => mockChain([]));
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/999/live-shot")
      .set("Authorization", "Bearer token")
      .send({ timestampSeconds: 10 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/session not found/i);
  });

  it("returns 204 when ML service returns no shot result", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const countRow = [{ count: 0 }];

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([session]);
      if (selectCall === 2) return mockChain(countRow);
      return mockChain([{ id: 10, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null }]);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: null }),
      }),
    );

    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/live-shot")
      .set("Authorization", "Bearer token")
      .send({ timestampSeconds: 10, frameImage: null });

    expect(res.status).toBe(204);
    vi.unstubAllGlobals();
  });

  it("returns 201 when ML service detects a shot", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const countRow = [{ count: 2 }];
    const savedShot = { id: 99, sessionId: 1, matchId: 10, sequenceNumber: 3, shotType: "forehand", outcome: "winner", speedMph: 75 };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([session]);
      if (selectCall === 2) return mockChain(countRow);
      return mockChain([{ id: 10, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null }]);
    });
    mockDb.insert.mockImplementation(() => mockChain([savedShot]));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            shotType: "forehand",
            outcome: "winner",
            shotTypeConfidence: 0.92,
            outcomeConfidence: 0.88,
            ballTrajectory: { estimatedSpeedMph: 75 },
          },
        }),
      }),
    );

    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/live-shot")
      .set("Authorization", "Bearer token")
      .send({ timestampSeconds: 10, frameImage: "data:image/jpeg;base64,..." });

    expect(res.status).toBe(201);
    expect(res.body.shotType).toBe("forehand");
    vi.unstubAllGlobals();
  });
});

describe("POST /api/ball-boi/sessions/:sessionId/complete", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/complete")
      .send({ objectPath: "/objects/video.webm" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when objectPath is missing", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    mockDb.select.mockImplementation(() => mockChain([session]));

    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/complete")
      .set("Authorization", "Bearer token")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/objectpath required/i);
  });

  it("transitions session to processing status", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const updatedSession = { ...session, status: "processing", processingStatus: "processing", videoObjectPath: "/objects/video.webm" };

    mockDb.select.mockImplementation(() => mockChain([session]));
    mockDb.update.mockImplementation(() => mockChain([updatedSession]));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );

    const res = await supertest(app)
      .post("/api/ball-boi/sessions/1/complete")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", contentType: "video/webm", sizeBytes: 1024, durationSeconds: 120 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("processing");
    vi.unstubAllGlobals();
  });

  const ML_UNAVAILABLE_MESSAGE =
    "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.";

  async function buildCompleteRouteApp() {
    vi.resetModules();
    const { default: ballBoiRouter } = await import("../routes/ballBoi.js");
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use("/api", ballBoiRouter);
    return freshApp;
  }

  function setupCompleteRouteNoLiveShots(session: Record<string, unknown>) {
    const updatedSession = { ...session, status: "processing", processingStatus: "processing", videoObjectPath: "/objects/video.webm" };
    const capturedSetArgs: Record<string, unknown>[] = [];

    mockDb.select.mockImplementation(() => mockChain([session]));
    mockDb.update.mockImplementation(() => {
      const chain = {
        set: (data: Record<string, unknown>) => {
          capturedSetArgs.push(data);
          return { where: () => ({ returning: () => Promise.resolve([updatedSession]) }) };
        },
      };
      return chain;
    });
    mockDb.insert.mockImplementation(() => mockChain([]));

    return capturedSetArgs;
  }

  it("sets processingError to the ML unavailable message when fetch throws TypeError (network failure)", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupCompleteRouteNoLiveShots(session);

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([session]);
      return mockChain([]);
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const freshApp = await buildCompleteRouteApp();
    const res = await supertest(freshApp)
      .post("/api/ball-boi/sessions/1/complete")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).toBe(ML_UNAVAILABLE_MESSAGE);
    vi.unstubAllGlobals();
  });

  it("sets processingError to the ML unavailable message when fetch throws AbortError", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupCompleteRouteNoLiveShots(session);

    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([session]);
      return mockChain([]);
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const freshApp = await buildCompleteRouteApp();
    const res = await supertest(freshApp)
      .post("/api/ball-boi/sessions/1/complete")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).toBe(ML_UNAVAILABLE_MESSAGE);
    vi.unstubAllGlobals();
  });

  it("sets processingError to the ML unavailable message when ML returns HTTP 503", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupCompleteRouteNoLiveShots(session);

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([session]);
      return mockChain([]);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );

    const freshApp = await buildCompleteRouteApp();
    const res = await supertest(freshApp)
      .post("/api/ball-boi/sessions/1/complete")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).toBe(ML_UNAVAILABLE_MESSAGE);
    vi.unstubAllGlobals();
  });

  it("sets a generic processingError when fetch throws a non-network error", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupCompleteRouteNoLiveShots(session);

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([session]);
      return mockChain([]);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const freshApp = await buildCompleteRouteApp();
    const res = await supertest(freshApp)
      .post("/api/ball-boi/sessions/1/complete")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).not.toBe(ML_UNAVAILABLE_MESSAGE);
    expect(typeof errorUpdate?.processingError).toBe("string");
    vi.unstubAllGlobals();
  });
});

describe("POST /api/matches/:matchId/ball-boi/end — ML-unavailable fallback", () => {
  const ML_UNAVAILABLE_MESSAGE =
    "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.";

  const sampleMatch = { id: 10, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null, leagueId: null };
  const samplePlayer = { id: 1, clerkUserId: mockUserId, name: "Test Player" };

  async function buildMatchEndApp() {
    vi.resetModules();
    const { default: ballBoiRouter } = await import("../routes/ballBoi.js");
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use("/api", ballBoiRouter);
    return freshApp;
  }

  function setupMatchEndNoLiveShots(session: Record<string, unknown>) {
    const updatedSession = { ...session, status: "processing", processingStatus: "processing", videoObjectPath: "/objects/video.webm" };
    const capturedSetArgs: Record<string, unknown>[] = [];

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([sampleMatch]);
      if (selectCall === 2) return mockChain([samplePlayer]);
      if (selectCall === 3) return mockChain([session]);
      return mockChain([]);
    });

    mockDb.update.mockImplementation(() => {
      const chain = {
        set: (data: Record<string, unknown>) => {
          capturedSetArgs.push(data);
          return { where: () => ({ returning: () => Promise.resolve([updatedSession]) }) };
        },
      };
      return chain;
    });

    mockDb.insert.mockImplementation(() => mockChain([]));

    return capturedSetArgs;
  }

  it("sets processingError to the ML unavailable message when fetch throws TypeError (network failure)", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupMatchEndNoLiveShots(session);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const freshApp = await buildMatchEndApp();
    const res = await supertest(freshApp)
      .post("/api/matches/10/ball-boi/end")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).toBe(ML_UNAVAILABLE_MESSAGE);
    vi.unstubAllGlobals();
  });

  it("sets processingError to the ML unavailable message when fetch throws AbortError", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupMatchEndNoLiveShots(session);

    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const freshApp = await buildMatchEndApp();
    const res = await supertest(freshApp)
      .post("/api/matches/10/ball-boi/end")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).toBe(ML_UNAVAILABLE_MESSAGE);
    vi.unstubAllGlobals();
  });

  it("sets processingError to the ML unavailable message when ML returns HTTP 503", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupMatchEndNoLiveShots(session);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );

    const freshApp = await buildMatchEndApp();
    const res = await supertest(freshApp)
      .post("/api/matches/10/ball-boi/end")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).toBe(ML_UNAVAILABLE_MESSAGE);
    vi.unstubAllGlobals();
  });

  it("sets a generic processingError when fetch returns a non-network error (HTTP 500)", async () => {
    const session = { id: 1, matchId: 10, recordedByClerkUserId: mockUserId, status: "recording", metadata: {} };
    const capturedSetArgs = setupMatchEndNoLiveShots(session);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const freshApp = await buildMatchEndApp();
    const res = await supertest(freshApp)
      .post("/api/matches/10/ball-boi/end")
      .set("Authorization", "Bearer token")
      .send({ objectPath: "/objects/video.webm", durationSeconds: 0 });

    expect(res.status).toBe(200);
    const errorUpdate = capturedSetArgs.find((args) => typeof args.processingError === "string");
    expect(errorUpdate?.processingError).toBe("Analysis service could not process this recording. Please try again.");
    vi.unstubAllGlobals();
  });
});

describe("GET /api/ball-boi/matches/:matchId/replay", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app).get("/api/ball-boi/matches/10/replay");
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-numeric matchId", async () => {
    const res = await supertest(app).get("/api/ball-boi/matches/abc/replay");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid match id/i);
  });

  it("returns 404 when match does not exist", async () => {
    mockDb.select.mockImplementation(() => mockChain([]));
    const res = await supertest(app).get("/api/ball-boi/matches/999/replay");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/match not found/i);
  });

  it("returns session null payload when no sessions exist for match", async () => {
    const sampleMatch = { id: 10, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null, leagueId: null };
    const samplePlayer = { id: 1, clerkUserId: mockUserId, name: "Test Player" };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([sampleMatch]);
      if (selectCall === 2) return mockChain([samplePlayer]);
      if (selectCall === 3) return mockChain([]);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/ball-boi/matches/10/replay");
    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull();
    expect(res.body.shots).toEqual([]);
    expect(res.body.statistics).toBeNull();
  });

  it("returns session, shots, and statistics when replay exists", async () => {
    const sampleMatch = { id: 10, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null, leagueId: null };
    const samplePlayer = { id: 1, clerkUserId: mockUserId, name: "Test Player" };
    const sampleSession = { id: 3, matchId: 10, status: "completed", processingStatus: "completed", recordedByClerkUserId: mockUserId };
    const sampleShots = [{ id: 1, sessionId: 3, shotType: "forehand", outcome: "winner", speedMph: 80 }];
    const sampleStats = { id: 1, sessionId: 3, matchId: 10, totalShots: 1, winners: 1 };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([sampleMatch]);
      if (selectCall === 2) return mockChain([samplePlayer]);
      if (selectCall === 3) return mockChain([sampleSession]);
      if (selectCall === 4) return mockChain(sampleShots);
      if (selectCall === 5) return mockChain([sampleStats]);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/ball-boi/matches/10/replay");
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(3);
    expect(res.body.shots).toHaveLength(1);
    expect(res.body.statistics.totalShots).toBe(1);
  });
});

describe("GET /api/ball-boi/sessions/:sessionId/video-url", () => {
  const sessionWithVideo = {
    id: 1,
    matchId: 10,
    recordedByClerkUserId: mockUserId,
    status: "completed",
    processingStatus: "completed",
    videoObjectPath: "/objects/uploads/test-video.webm",
    metadata: {},
  };

  const sessionWithoutVideo = {
    id: 2,
    matchId: 10,
    recordedByClerkUserId: mockUserId,
    status: "recording",
    processingStatus: "pending",
    videoObjectPath: null,
    metadata: {},
  };

  const sampleMatch = {
    id: 10,
    player1Id: 1,
    player2Id: 2,
    player3Id: null,
    player4Id: null,
    leagueId: null,
  };

  it("returns 401 when not authenticated", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app).get("/api/ball-boi/sessions/1/video-url");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it("returns 404 when the session does not exist", async () => {
    mockDb.select.mockImplementation(() => mockChain([]));
    const res = await supertest(app)
      .get("/api/ball-boi/sessions/999/video-url")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/session not found/i);
  });

  it("returns 403 when the requesting user does not own the session and is not a match participant", async () => {
    const foreignSession = { ...sessionWithVideo, recordedByClerkUserId: "user_other" };
    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([foreignSession]);
      if (selectCall === 2) return mockChain([sampleMatch]);
      if (selectCall === 3) return mockChain([{ id: 99, clerkUserId: "user_other", name: "Stranger" }]);
      return mockChain([]);
    });

    const res = await supertest(app)
      .get("/api/ball-boi/sessions/1/video-url")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it("returns 404 when the session has no video uploaded yet", async () => {
    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([sessionWithoutVideo]);
      if (selectCall === 2) return mockChain([sampleMatch]);
      if (selectCall === 3) return mockChain([{ id: 1, clerkUserId: mockUserId, name: "Test Player" }]);
      return mockChain([]);
    });

    const res = await supertest(app)
      .get("/api/ball-boi/sessions/2/video-url")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no video available/i);
  });

  it("returns a signed video URL on success", async () => {
    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([sessionWithVideo]);
      if (selectCall === 2) return mockChain([sampleMatch]);
      if (selectCall === 3) return mockChain([{ id: 1, clerkUserId: mockUserId, name: "Test Player" }]);
      return mockChain([]);
    });

    const res = await supertest(app)
      .get("/api/ball-boi/sessions/1/video-url")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(1);
    expect(res.body.videoUrl).toBe("https://storage.example.com/signed-view-url");
  });
});

describe("heatmap data round-trip: POST /ml-callback → GET /replay", () => {
  const CALLBACK_TOKEN = "heatmap-round-trip-token-xyz";
  const SESSION_ID = 5;
  const MATCH_ID = 10;

  function mlCallbackHeaders(): Record<string, string> {
    if (process.env.ML_SECRET) {
      return { "x-ml-secret": process.env.ML_SECRET };
    }
    return {};
  }

  const processingSession = {
    id: SESSION_ID,
    matchId: MATCH_ID,
    recordedByClerkUserId: mockUserId,
    status: "processing",
    processingStatus: "processing",
    metadata: { mlCallbackToken: CALLBACK_TOKEN },
  };

  const match = {
    id: MATCH_ID,
    player1Id: 1,
    player2Id: 2,
    player3Id: null,
    player4Id: null,
    leagueId: null,
  };

  const player1 = { id: 1, clerkUserId: mockUserId, name: "Alice" };
  const player2 = { id: 2, clerkUserId: "user_other", name: "Bob" };

  it("preserves courtZone x/y coordinates in heatmapData exactly through the full API round-trip", async () => {
    const mlResult = {
      shots: [
        {
          shotType: "forehand",
          outcome: "winner",
          courtZone: { x: 0.25, y: 0.65 },
          ballTrajectory: { estimatedSpeedMph: 80 },
        },
        {
          shotType: "backhand",
          outcome: "rally_continuation",
          courtZone: { x: 0.75, y: 0.35 },
          ballTrajectory: { estimatedSpeedMph: 60 },
        },
      ],
    };

    let capturedShotInsertValues: unknown[] = [];
    let capturedStatisticsInsert: Record<string, unknown> | null = null;
    let insertCallNumber = 0;

    let cbSelectCall = 0;
    mockDb.select.mockImplementation(() => {
      cbSelectCall++;
      if (cbSelectCall === 1) return mockChain([processingSession]);
      if (cbSelectCall === 2) return mockChain([]);
      if (cbSelectCall === 3) return mockChain([match]);
      if (cbSelectCall === 4) return mockChain([player1, player2]);
      if (cbSelectCall === 5) return mockChain([player1, player2]);
      return mockChain([]);
    });

    mockDb.insert.mockImplementation(() => ({
      values: (data: unknown) => {
        insertCallNumber++;
        if (insertCallNumber === 1) {
          capturedShotInsertValues = Array.isArray(data) ? data : [data];
          const returnedShots = capturedShotInsertValues.map((shot, i) => ({
            id: 100 + i,
            ...(shot as object),
          }));
          return { returning: () => Promise.resolve(returnedShots) };
        }
        capturedStatisticsInsert = data as Record<string, unknown>;
        return { returning: () => Promise.resolve([{ id: 99, ...capturedStatisticsInsert }]) };
      },
    }));

    mockDb.delete.mockImplementation(() => mockChain([]));
    mockDb.update.mockImplementation(() =>
      mockChain([{ ...processingSession, status: "completed", processingStatus: "completed" }]),
    );

    const callbackRes = await supertest(app)
      .post(`/api/ball-boi/sessions/${SESSION_ID}/ml-callback?token=${CALLBACK_TOKEN}`)
      .set(mlCallbackHeaders())
      .send({ status: "completed", result: mlResult });

    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.ok).toBe(true);
    expect(capturedStatisticsInsert).not.toBeNull();

    const heatmapFromStats = (capturedStatisticsInsert as unknown as { heatmapData?: unknown[] }).heatmapData;
    expect(Array.isArray(heatmapFromStats)).toBe(true);
    expect(heatmapFromStats).toHaveLength(2);

    // Heatmaps are shown only once the eval clears them (lib/statGates.ts).
    const completedSession = {
      ...processingSession,
      status: "completed",
      processingStatus: "completed",
      metadata: { ...processingSession.metadata, statGates: { stats: { placement_heatmap: { shown: true } } } },
    };
    const insertedShots = capturedShotInsertValues.map((shot, i) => ({
      id: 100 + i,
      ...(shot as object),
    }));

    let replaySelectCall = 0;
    mockDb.select.mockImplementation(() => {
      replaySelectCall++;
      if (replaySelectCall === 1) return mockChain([match]);
      if (replaySelectCall === 2) return mockChain([player1]);
      if (replaySelectCall === 3) return mockChain([completedSession]);
      if (replaySelectCall === 4) return mockChain(insertedShots);
      if (replaySelectCall === 5) return mockChain([{ id: 99, ...capturedStatisticsInsert }]);
      return mockChain([]);
    });

    const replayRes = await supertest(app)
      .get(`/api/ball-boi/matches/${MATCH_ID}/replay`)
      .set("Authorization", "Bearer token");

    expect(replayRes.status).toBe(200);
    const { statistics } = replayRes.body;
    expect(statistics).not.toBeNull();
    expect(Array.isArray(statistics.heatmapData)).toBe(true);
    expect(statistics.heatmapData).toHaveLength(2);

    expect(statistics.heatmapData[0].x).toBe(mlResult.shots[0].courtZone.x);
    expect(statistics.heatmapData[0].y).toBe(mlResult.shots[0].courtZone.y);
    expect(statistics.heatmapData[1].x).toBe(mlResult.shots[1].courtZone.x);
    expect(statistics.heatmapData[1].y).toBe(mlResult.shots[1].courtZone.y);
  });

  it("hides the heatmap when the eval hasn't cleared it", async () => {
    const completedSession = { ...processingSession, status: "completed", processingStatus: "completed" };
    const statistics = { id: 99, sessionId: SESSION_ID, matchId: MATCH_ID, totalShots: 2, winners: 1, heatmapData: [{ x: 0.25, y: 0.65 }] };
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return mockChain([match]);
      if (call === 2) return mockChain([player1]);
      if (call === 3) return mockChain([completedSession]);
      if (call === 4) return mockChain([{ id: 100, shotType: "forehand", courtZoneX: 0.25 }]);
      if (call === 5) return mockChain([statistics]);
      return mockChain([]);
    });
    const res = await supertest(app).get(`/api/ball-boi/matches/${MATCH_ID}/replay`).set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.statistics).toMatchObject({ totalShots: 2, heatmapData: null, winners: null });
    expect(res.body.shots[0]).toMatchObject({ id: 100, shotType: null, courtZoneX: null });
    expect(res.body.hiddenStats).toContain("placement_heatmap");
  });

  it("uses the default 0.5 fallback for x/y when courtZone is missing from the ML payload", async () => {
    const mlResultNoZone = {
      shots: [
        {
          shotType: "serve",
          outcome: "winner",
          ballTrajectory: { estimatedSpeedMph: 120 },
        },
      ],
    };

    let capturedStatisticsInsert: Record<string, unknown> | null = null;
    let insertCallNumber = 0;

    let cbSelectCall = 0;
    mockDb.select.mockImplementation(() => {
      cbSelectCall++;
      if (cbSelectCall === 1) return mockChain([processingSession]);
      if (cbSelectCall === 2) return mockChain([]);
      if (cbSelectCall === 3) return mockChain([match]);
      if (cbSelectCall === 4) return mockChain([player1, player2]);
      if (cbSelectCall === 5) return mockChain([player1, player2]);
      return mockChain([]);
    });

    let capturedShotInsertValues: unknown[] = [];
    mockDb.insert.mockImplementation(() => ({
      values: (data: unknown) => {
        insertCallNumber++;
        if (insertCallNumber === 1) {
          capturedShotInsertValues = Array.isArray(data) ? data : [data];
          const returnedShots = capturedShotInsertValues.map((shot, i) => ({
            id: 200 + i,
            ...(shot as object),
          }));
          return { returning: () => Promise.resolve(returnedShots) };
        }
        capturedStatisticsInsert = data as Record<string, unknown>;
        return { returning: () => Promise.resolve([{ id: 98, ...capturedStatisticsInsert }]) };
      },
    }));

    mockDb.delete.mockImplementation(() => mockChain([]));
    mockDb.update.mockImplementation(() =>
      mockChain([{ ...processingSession, status: "completed", processingStatus: "completed" }]),
    );

    const callbackRes = await supertest(app)
      .post(`/api/ball-boi/sessions/${SESSION_ID}/ml-callback?token=${CALLBACK_TOKEN}`)
      .set(mlCallbackHeaders())
      .send({ status: "completed", result: mlResultNoZone });

    expect(callbackRes.status).toBe(200);
    expect(capturedStatisticsInsert).not.toBeNull();

    const heatmap = (capturedStatisticsInsert as unknown as { heatmapData?: unknown[] }).heatmapData;
    expect(heatmap).toHaveLength(1);
    expect((heatmap![0] as { x: number }).x).toBe(0.5);
    expect((heatmap![0] as { y: number }).y).toBe(0.5);
  });

  it("returns 403 when the ml-callback token does not match", async () => {
    mockDb.select.mockImplementation(() => mockChain([processingSession]));

    const res = await supertest(app)
      .post(`/api/ball-boi/sessions/${SESSION_ID}/ml-callback?token=wrong-token`)
      .send({ status: "completed", result: {} });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it("returns 403 when no token is provided in the ml-callback request", async () => {
    mockDb.select.mockImplementation(() => mockChain([processingSession]));

    const res = await supertest(app)
      .post(`/api/ball-boi/sessions/${SESSION_ID}/ml-callback`)
      .send({ status: "completed", result: {} });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });
});
