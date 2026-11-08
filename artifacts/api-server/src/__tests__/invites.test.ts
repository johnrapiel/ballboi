import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

const mockUserId = "user_invitetest";
let mockGetAuth: () => { userId: string | null } = () => ({ userId: mockUserId });

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
  playersTable: { id: {}, clerkUserId: {}, name: {}, leagueId: {}, skillLevel: {}, wins: {}, losses: {}, leftAt: {} },
  leagueJoinRequestsTable: { leagueId: {}, clerkUserId: {} },
}));

vi.mock("../lib/leagueAccess.js", () => ({ isLeagueAdmin: vi.fn().mockResolvedValue(true) }));

// The signed-in person's profile (users row), read by the route through lib/playerProfile.
const mockProfiles = new Map<string, { displayName: string | null; avatarUrl: string | null; rating: number | null; ratingSource: string | null }>();
vi.mock("../lib/playerProfile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/playerProfile.js")>()),
  loadProfiles: async () => mockProfiles,
  profileNameFor: async (id: string, fallback: string) => mockProfiles.get(id)?.displayName || fallback,
}));

vi.mock("drizzle-orm", () => {
  const sqlTag = (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
    queryChunks: [],
    shouldInlineParams: false,
  });
  return {
    eq: (a: unknown, b: unknown) => ({ a, b }),
    and: (...args: unknown[]) => args,
    isNull: (a: unknown) => ({ isNull: a }),
    sql: sqlTag,
  };
});

vi.mock("nanoid", () => ({
  nanoid: () => "test-invite-code",
  customAlphabet: () => () => "TESTCODE",
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
  mockProfiles.clear();
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

  function lateJoin(visibility: string) {
    const captured: { inserted: Record<string, unknown> | null } = { inserted: null };
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([sampleInvite]);
          if (selectCall === 2) return mockChain([{ ...sampleLeague, startDate: "2020-01-02", visibility }]);
          return mockChain([]);
        }),
        insert: vi.fn().mockImplementation(() => ({
          values: (vals: Record<string, unknown>) => {
            captured.inserted = vals;
            return mockChain([]);
          },
        })),
        update: vi.fn().mockReturnValue(mockChain([])),
      };
      return cb(tx);
    });
    return captured;
  }

  it("puts the player on an Open league's waitlist once the season has started (decisions 26, 30)", async () => {
    const captured = lateJoin("open");
    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Late Larry", skillLevel: "3.5" });

    expect(res.status).toBe(202);
    expect(res.body.waitlisted).toBe(true);
    expect(res.body.message).toMatch(/waitlist for next season/);
    expect(captured.inserted).toMatchObject({ kind: "waitlist", playerName: "Late Larry" });
  });

  it("turns a Private code entered mid-season into a join request (decision 30)", async () => {
    const captured = lateJoin("private");
    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Late Larry", skillLevel: "3.5" });

    expect(res.status).toBe(202);
    expect(res.body.requested).toBe(true);
    expect(res.body.waitlisted).toBe(false);
    expect(res.body.message).toBe(
      "This season's already started, but we've let the organizer know you'd like to join. You'll hear back here.",
    );
    expect(captured.inserted).toMatchObject({ kind: "request", playerName: "Late Larry" });
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

    expect((capturedInsertValues as Record<string, unknown> | null)?.skillLevel).toBe("3.0");
  });

  it("starts the league row from the profile's name and level, never the name the app sent (A1)", async () => {
    mockProfiles.set(mockUserId, { displayName: "Alex Kim", avatarUrl: null, rating: 4.5, ratingSource: "self" });
    let capturedInsertValues: Record<string, unknown> | null = null;
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([sampleInvite]);
          if (selectCall === 2) return mockChain([sampleLeague]);
          return mockChain([]);
        }),
        insert: vi.fn().mockImplementation(() => ({
          values: (vals: Record<string, unknown>) => {
            capturedInsertValues = vals;
            return mockChain([{ ...samplePlayer, ...vals }]);
          },
        })),
        update: vi.fn().mockReturnValue(mockChain([{ ...sampleInvite, usageCount: 1 }])),
      };
      return cb(tx);
    });

    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "akim", skillLevel: "3.0" });

    expect(res.status).toBe(201);
    expect(capturedInsertValues).toMatchObject({ name: "Alex Kim", skillLevel: "4.5" });
  });
});

describe("an ended league's invite (PR 5)", () => {
  const endedLeague = { ...sampleLeague, endedAt: new Date("2026-11-01T12:00:00Z"), status: "completed" };

  it("says the league has ended when the invite is opened", async () => {
    mockDb.select.mockReturnValueOnce(mockChain([sampleInvite])).mockReturnValueOnce(mockChain([endedLeague]));
    const res = await supertest(app).get("/api/invites/test-invite-code").set("Authorization", "Bearer token");
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: "This league has ended", code: "league_ended", leagueName: "Test League" });
  });

  it("refuses to join, and sends the admin no request", async () => {
    const insert = vi.fn().mockReturnValue(mockChain([]));
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      let selectCall = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => {
          selectCall++;
          if (selectCall === 1) return mockChain([sampleInvite]);
          if (selectCall === 2) return mockChain([endedLeague]);
          return mockChain([]);
        }),
        insert,
        update: vi.fn().mockReturnValue(mockChain([])),
      };
      return cb(tx);
    });
    const res = await supertest(app)
      .post("/api/invites/test-invite-code/join")
      .set("Authorization", "Bearer token")
      .send({ playerName: "Alice", skillLevel: "3.5" });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: "This league has ended", code: "league_ended" });
    expect(insert).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
