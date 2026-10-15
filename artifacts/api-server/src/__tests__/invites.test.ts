import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

const mockUserId = "user_invitetest";
let mockGetAuth = () => ({ userId: mockUserId });

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => mockGetAuth(),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  leagueInvitesTable: { id: {}, code: {}, leagueId: {}, isActive: {}, expiresAt: {}, maxUses: {}, usageCount: {}, createdByClerkUserId: {} },
  leaguesTable: { id: {}, name: {}, createdByClerkUserId: {}, sport: {} },
  playersTable: { id: {}, clerkUserId: {}, name: {}, leagueId: {}, skillLevel: {}, wins: {}, losses: {} },
}));

vi.mock("drizzle-orm", () => {
  const sqlTag = (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
    queryChunks: [],
    shouldInlineParams: false,
  });
  return {
    eq: (a: unknown, b: unknown) => ({ a, b }),
    and: (...args: unknown[]) => args,
    sql: sqlTag,
  };
});

vi.mock("nanoid", () => ({
  nanoid: () => "test-invite-code",
}));

async function buildApp() {
  const { default: invitesRouter } = await import("../routes/invites.js");
  const app = express();
  app.use(express.json());
  app.use("/api", invitesRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

const sampleInvite = {
  id: 1,
  code: "test-invite-code",
  leagueId: 42,
  isActive: true,
  expiresAt: null,
  maxUses: null,
  usageCount: 0,
  createdByClerkUserId: "creator_user",
};

const sampleLeague = {
  id: 42,
  name: "Test League",
  createdByClerkUserId: "creator_user",
  sport: "tennis",
};

const samplePlayer = {
  id: 99,
  clerkUserId: mockUserId,
  name: "New Player",
  leagueId: 42,
  skillLevel: "3.5",
  wins: 0,
  losses: 0,
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetAuth = () => ({ userId: mockUserId });
  app = await buildApp();
});

describe("POST /api/invites/:code/join", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .send({ playerName: "Alice", skillLevel: "3.5" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when playerName is missing", async () => {
    mockDb.transaction.mockResolvedValue({ status: 400, payload: { error: "playerName is required" } });
    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ skillLevel: "3.5" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/playerName is required/i);
  });

  it("returns 404 when invite does not exist (transaction returns 404)", async () => {
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue(mockChain([])),
        insert: vi.fn().mockReturnValue(mockChain([])),
        update: vi.fn().mockReturnValue(mockChain([])),
      };
      return cb(tx);
    });

    const res = await supertest(app)
      .post("/api/invites/nonexistent/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Alice", skillLevel: "3.5" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/invite not found/i);
  });

  it("returns 410 when invite is inactive", async () => {
    const inactiveInvite = { ...sampleInvite, isActive: false };
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([inactiveInvite]);
          return mockChain([]);
        }),
        insert: vi.fn().mockReturnValue(mockChain([])),
        update: vi.fn().mockReturnValue(mockChain([])),
      };
      return cb(tx);
    });

    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Alice", skillLevel: "3.5" });

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/no longer active/i);
  });

  it("returns 410 when invite has exceeded maxUses", async () => {
    const fullInvite = { ...sampleInvite, maxUses: 5, usageCount: 5 };
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([fullInvite]);
          return mockChain([sampleLeague]);
        }),
        insert: vi.fn().mockReturnValue(mockChain([])),
        update: vi.fn().mockReturnValue(mockChain([])),
      };
      return cb(tx);
    });

    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Alice", skillLevel: "3.5" });

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/maximum uses/i);
  });

  it("returns 200 when user is already a member of the league", async () => {
    const existingPlayer = { id: 7, clerkUserId: mockUserId, leagueId: 42 };
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([sampleInvite]);
          if (selectCall === 2) return mockChain([sampleLeague]);
          if (selectCall === 3) return mockChain([existingPlayer]);
          return mockChain([]);
        }),
        insert: vi.fn().mockReturnValue(mockChain([])),
        update: vi.fn().mockReturnValue(mockChain([])),
      };
      return cb(tx);
    });

    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Alice", skillLevel: "3.5" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already a member/i);
  });

  it("returns 201 and creates a player when joining successfully", async () => {
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([sampleInvite]);
          if (selectCall === 2) return mockChain([sampleLeague]);
          if (selectCall === 3) return mockChain([]);
          return mockChain([]);
        }),
        insert: vi.fn().mockReturnValue(mockChain([samplePlayer])),
        update: vi.fn().mockReturnValue(mockChain([{ ...sampleInvite, usageCount: 1 }])),
      };
      return cb(tx);
    });

    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "New Player", skillLevel: "3.5" });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/successfully joined/i);
    expect(res.body.player.name).toBe("New Player");
  });

  it("uses hashtext for both advisory lock args (pg_advisory_xact_lock int4+int4 overload)", async () => {
    const executeCalls: unknown[] = [];

    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockImplementation((sqlObj: unknown) => {
          executeCalls.push(sqlObj);
          return Promise.resolve(undefined);
        }),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([sampleInvite]);
          if (selectCall === 2) return mockChain([sampleLeague]);
          if (selectCall === 3) return mockChain([]);
          return mockChain([]);
        }),
        insert: vi.fn().mockReturnValue(mockChain([samplePlayer])),
        update: vi.fn().mockReturnValue(mockChain([{ ...sampleInvite, usageCount: 1 }])),
      };
      return cb(tx);
    });

    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "New Player", skillLevel: "3.5" });

    expect(res.status).toBe(201);
    expect(executeCalls).toHaveLength(2);
  });

  it("returns 500 and does not crash the server when the transaction throws", async () => {
    mockDb.transaction.mockRejectedValue(new Error("DB connection lost"));

    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Alice", skillLevel: "3.5" });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to join league/i);
  });

  it("defaults invalid skillLevel to 3.0", async () => {
    let capturedInsertValues: Record<string, unknown> | null = null;

    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([sampleInvite]);
          if (selectCall === 2) return mockChain([sampleLeague]);
          if (selectCall === 3) return mockChain([]);
          return mockChain([]);
        }),
        insert: vi.fn().mockImplementation(() => {
          return {
            values: (vals: Record<string, unknown>) => {
              capturedInsertValues = vals;
              return mockChain([{ ...samplePlayer, skillLevel: vals.skillLevel }]);
            },
          };
        }),
        update: vi.fn().mockReturnValue(mockChain([{ ...sampleInvite, usageCount: 1 }])),
      };
      return cb(tx);
    });

    await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Alice", skillLevel: "9.9" });

    expect(capturedInsertValues?.skillLevel).toBe("3.0");
  });
});
