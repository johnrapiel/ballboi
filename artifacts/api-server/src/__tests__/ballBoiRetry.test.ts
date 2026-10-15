import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeNextRetryAt, MAX_RETRIES, ML_UNAVAILABLE_MARKER, retryFailedBallBoiSessions } from "../services/ballBoiRetry.js";

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/ballBoiUtils", () => ({
  courtCalibrationFromMetadata: vi.fn().mockReturnValue(null),
}));

const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiSessionsTable: {
    id: {},
    status: {},
    processingStatus: {},
    processingError: {},
    metadata: {},
    videoObjectPath: {},
    matchId: {},
  },
}));

vi.mock("drizzle-orm", () => {
  const sqlTag = (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
    queryChunks: [],
    shouldInlineParams: false,
  });
  return {
    eq: (a: unknown, b: unknown) => ({ a, b }),
    and: (...args: unknown[]) => ({ args }),
    sql: sqlTag,
  };
});

function makeSelectChain(resolveValue: unknown = []) {
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
}

function makeUpdateMock(capturedUpdates: Record<string, unknown>[]) {
  return vi.fn().mockImplementation(() => ({
    set: (data: Record<string, unknown>) => {
      capturedUpdates.push(data);
      return { where: () => Promise.resolve([]) };
    },
  }));
}

const BASE_SESSION = {
  id: 1,
  matchId: 10,
  recordedByClerkUserId: "user_abc",
  status: "failed",
  processingStatus: "failed",
  processingError: `Analysis service is ${ML_UNAVAILABLE_MARKER}`,
  videoObjectPath: "/objects/uploads/match.webm",
  metadata: {
    retryCount: 0,
    nextRetryAt: new Date(Date.now() - 60_000).toISOString(),
    mlCallbackToken: "tok_secret",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("computeNextRetryAt — backoff schedule", () => {
  it("returns ~1 minute delay when retryCount is 0", () => {
    const before = Date.now();
    const result = computeNextRetryAt(0);
    const after = Date.now();
    const diffMs = result.getTime() - before;
    expect(diffMs).toBeGreaterThanOrEqual(60_000 - 10);
    expect(result.getTime()).toBeLessThanOrEqual(after + 60_000 + 10);
  });

  it("returns ~5 minute delay when retryCount is 1", () => {
    const before = Date.now();
    const result = computeNextRetryAt(1);
    const after = Date.now();
    const diffMs = result.getTime() - before;
    expect(diffMs).toBeGreaterThanOrEqual(5 * 60_000 - 10);
    expect(result.getTime()).toBeLessThanOrEqual(after + 5 * 60_000 + 10);
  });

  it("returns ~15 minute delay when retryCount is 2", () => {
    const before = Date.now();
    const result = computeNextRetryAt(2);
    const after = Date.now();
    const diffMs = result.getTime() - before;
    expect(diffMs).toBeGreaterThanOrEqual(15 * 60_000 - 10);
    expect(result.getTime()).toBeLessThanOrEqual(after + 15 * 60_000 + 10);
  });

  it("MAX_RETRIES equals 3 (matching the backoff table length)", () => {
    expect(MAX_RETRIES).toBe(3);
  });
});

describe("retryFailedBallBoiSessions — session filtering", () => {
  it("does nothing and calls no updates when DB returns zero sessions", async () => {
    mockDb.select.mockImplementation(() => makeSelectChain([]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    await retryFailedBallBoiSessions();

    expect(capturedUpdates).toHaveLength(0);
  });

  it("skips a session whose in-memory retryCount >= MAX_RETRIES even if returned by DB", async () => {
    const overMaxSession = {
      ...BASE_SESSION,
      metadata: { ...BASE_SESSION.metadata, retryCount: MAX_RETRIES },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([overMaxSession]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal("fetch", vi.fn());

    await retryFailedBallBoiSessions();

    expect(capturedUpdates).toHaveLength(0);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("skips a session that has no videoObjectPath", async () => {
    const noVideoSession = { ...BASE_SESSION, videoObjectPath: null };
    mockDb.select.mockImplementation(() => makeSelectChain([noVideoSession]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal("fetch", vi.fn());

    await retryFailedBallBoiSessions();

    expect(capturedUpdates).toHaveLength(0);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("skips a session whose nextRetryAt is in the future", async () => {
    const futureRetrySession = {
      ...BASE_SESSION,
      metadata: {
        ...BASE_SESSION.metadata,
        nextRetryAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([futureRetrySession]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal("fetch", vi.fn());

    await retryFailedBallBoiSessions();

    expect(capturedUpdates).toHaveLength(0);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("skips a session whose nextRetryAt is missing from metadata", async () => {
    const noNextRetrySession = {
      ...BASE_SESSION,
      metadata: { ...BASE_SESSION.metadata, nextRetryAt: null },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([noNextRetrySession]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal("fetch", vi.fn());

    await retryFailedBallBoiSessions();

    expect(capturedUpdates).toHaveLength(0);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("skips a session that has no mlCallbackToken in metadata", async () => {
    const noTokenSession = {
      ...BASE_SESSION,
      metadata: { ...BASE_SESSION.metadata, mlCallbackToken: undefined },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([noTokenSession]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal("fetch", vi.fn());

    await retryFailedBallBoiSessions();

    expect(capturedUpdates).toHaveLength(0);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

describe("retryFailedBallBoiSessions — ML dispatch success", () => {
  it("sets session to 'processing' and calls ML service when session is retryable", async () => {
    mockDb.select.mockImplementation(() => makeSelectChain([BASE_SESSION]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    await retryFailedBallBoiSessions();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce();
    const [mlUrl] = vi.mocked(global.fetch).mock.calls[0] as [string, ...unknown[]];
    expect(mlUrl).toMatch(/analyze-match-batch/);

    const processingUpdate = capturedUpdates.find((u) => u.status === "processing");
    expect(processingUpdate).toBeDefined();
    expect(processingUpdate?.processingError).toBeNull();
  });

  it("clears nextRetryAt when setting session to 'processing'", async () => {
    mockDb.select.mockImplementation(() => makeSelectChain([BASE_SESSION]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    await retryFailedBallBoiSessions();

    const processingUpdate = capturedUpdates.find((u) => u.status === "processing");
    const meta = processingUpdate?.metadata as Record<string, unknown> | undefined;
    expect(meta?.nextRetryAt).toBeNull();
  });

  it("passes the correct session_id and callback_url to the ML service", async () => {
    mockDb.select.mockImplementation(() => makeSelectChain([BASE_SESSION]));
    mockDb.update = makeUpdateMock([]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    await retryFailedBallBoiSessions();

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
    expect(body.session_id).toBe(BASE_SESSION.id);
    expect(body.callback_url).toMatch(new RegExp(`sessions/${BASE_SESSION.id}/ml-callback`));
    expect(body.callback_url).toMatch(/token=tok_secret/);
  });
});

describe("retryFailedBallBoiSessions — ML dispatch failure before max retries", () => {
  it("increments retryCount and sets a future nextRetryAt when ML fetch fails", async () => {
    mockDb.select.mockImplementation(() => makeSelectChain([BASE_SESSION]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const beforeCall = Date.now();
    await retryFailedBallBoiSessions();

    const failedUpdate = capturedUpdates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    const meta = failedUpdate?.metadata as Record<string, unknown>;
    expect(meta.retryCount).toBe(1);
    expect(typeof meta.nextRetryAt).toBe("string");
    const nextRetryAt = new Date(meta.nextRetryAt as string).getTime();
    expect(nextRetryAt).toBeGreaterThan(beforeCall + 4 * 60_000);
  });

  it("keeps processingError set to the ML-unavailable message on retry failure", async () => {
    mockDb.select.mockImplementation(() => makeSelectChain([BASE_SESSION]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await retryFailedBallBoiSessions();

    const failedUpdate = capturedUpdates.find((u) => u.status === "failed");
    expect(typeof failedUpdate?.processingError).toBe("string");
    expect(failedUpdate?.processingError as string).toMatch(/temporarily unavailable/i);
  });

  it("handles HTTP 503 response from ML service as a retryable failure", async () => {
    mockDb.select.mockImplementation(() => makeSelectChain([BASE_SESSION]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );

    await retryFailedBallBoiSessions();

    const failedUpdate = capturedUpdates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    const meta = failedUpdate?.metadata as Record<string, unknown>;
    expect(meta.retryCount).toBe(1);
    expect(typeof meta.nextRetryAt).toBe("string");
  });

  it("retries correctly from retryCount=1 (5-minute → 15-minute step)", async () => {
    const sessionAtRetry1 = {
      ...BASE_SESSION,
      metadata: {
        ...BASE_SESSION.metadata,
        retryCount: 1,
        nextRetryAt: new Date(Date.now() - 60_000).toISOString(),
      },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([sessionAtRetry1]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const beforeCall = Date.now();
    await retryFailedBallBoiSessions();

    const failedUpdate = capturedUpdates.find((u) => u.status === "failed");
    const meta = failedUpdate?.metadata as Record<string, unknown>;
    expect(meta.retryCount).toBe(2);
    const nextRetryAt = new Date(meta.nextRetryAt as string).getTime();
    expect(nextRetryAt).toBeGreaterThan(beforeCall + 14 * 60_000);
  });
});

describe("retryFailedBallBoiSessions — ML dispatch failure at max retries", () => {
  it("permanently marks session failed with exhausted-retries message when nextRetryCount reaches MAX_RETRIES", async () => {
    const sessionAtLastAttempt = {
      ...BASE_SESSION,
      metadata: {
        ...BASE_SESSION.metadata,
        retryCount: MAX_RETRIES - 1,
        nextRetryAt: new Date(Date.now() - 60_000).toISOString(),
      },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([sessionAtLastAttempt]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await retryFailedBallBoiSessions();

    const permanentFailUpdate = capturedUpdates.find((u) => u.status === "failed");
    expect(permanentFailUpdate).toBeDefined();
    expect(permanentFailUpdate?.processingError as string).toMatch(/exhausted/i);
    const meta = permanentFailUpdate?.metadata as Record<string, unknown>;
    expect(meta.retryCount).toBe(MAX_RETRIES);
    expect(meta.nextRetryAt).toBeNull();
  });

  it("does NOT schedule another nextRetryAt after max retries are exhausted", async () => {
    const sessionAtLastAttempt = {
      ...BASE_SESSION,
      metadata: {
        ...BASE_SESSION.metadata,
        retryCount: MAX_RETRIES - 1,
        nextRetryAt: new Date(Date.now() - 60_000).toISOString(),
      },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([sessionAtLastAttempt]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await retryFailedBallBoiSessions();

    const permanentFailUpdate = capturedUpdates.find((u) => u.status === "failed");
    const meta = permanentFailUpdate?.metadata as Record<string, unknown>;
    expect(meta.nextRetryAt).toBeNull();
  });

  it("handles HTTP 502 response from ML service as exhausted failure at final attempt", async () => {
    const sessionAtLastAttempt = {
      ...BASE_SESSION,
      metadata: {
        ...BASE_SESSION.metadata,
        retryCount: MAX_RETRIES - 1,
        nextRetryAt: new Date(Date.now() - 60_000).toISOString(),
      },
    };
    mockDb.select.mockImplementation(() => makeSelectChain([sessionAtLastAttempt]));
    const capturedUpdates: Record<string, unknown>[] = [];
    mockDb.update = makeUpdateMock(capturedUpdates);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }),
    );

    await retryFailedBallBoiSessions();

    const permanentFailUpdate = capturedUpdates.find((u) => u.status === "failed");
    expect(permanentFailUpdate?.processingError as string).toMatch(/exhausted/i);
  });
});

describe("retryFailedBallBoiSessions — DB error handling", () => {
  it("returns early without throwing when the DB query itself throws", async () => {
    mockDb.select.mockImplementation(() => {
      throw new Error("DB connection lost");
    });

    await expect(retryFailedBallBoiSessions()).resolves.toBeUndefined();
  });
});
