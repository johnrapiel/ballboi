import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

const ADMIN_EMAIL = "admin@example.com";
const NON_ADMIN_EMAIL = "user@example.com";

let mockGetAuth: () => { userId: string | null } = () => ({ userId: "user_admin" });
let mockGetUser: () => Promise<{
  emailAddresses: { id: string; emailAddress: string }[];
  primaryEmailAddressId: string;
}> = async () => ({
  emailAddresses: [{ id: "email_1", emailAddress: ADMIN_EMAIL }],
  primaryEmailAddressId: "email_1",
});

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => mockGetAuth(),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: (_id: string) => mockGetUser(),
    },
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

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  leaguesTable: {
    id: {},
    name: {},
    createdByClerkUserId: {},
    sport: {},
    createdAt: {},
    updatedAt: {},
    status: {},
    format: {},
    startDate: {},
    endDate: {},
    location: {},
    description: {},
    leagueType: {},
  },
  playersTable: {
    id: {},
    clerkUserId: {},
    name: {},
    leagueId: {},
    skillLevel: {},
    wins: {},
    losses: {},
  },
  matchesTable: {
    id: {},
    player1Id: {},
    player2Id: {},
    player3Id: {},
    player4Id: {},
    scheduledAt: {},
    completedAt: {},
    status: {},
    score: {},
    leagueId: {},
    weekOf: {},
    winnerId: {},
    notes: {},
    location: {},
    createdAt: {},
    updatedAt: {},
  },
  scheduleGenerationLogsTable: {
    id: {},
    leagueId: {},
    status: {},
    weekOf: {},
    generatedAt: {},
    confirmedAt: {},
    confirmedByClerkUserId: {},
    data: {},
  },
  ballBoiSessionsTable: { id: {}, createdAt: {}, clerkUserId: {} },
  matchStatisticsTable: { id: {}, matchId: {}, playerId: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
  desc: (a: unknown) => a,
  asc: (a: unknown) => a,
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  count: () => ({ count: 1 }),
  sql: Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
      queryChunks: [],
      shouldInlineParams: false,
    }),
    { raw: (_s: string) => ({ queryChunks: [], shouldInlineParams: false }) }
  ),
  gte: (a: unknown, b: unknown) => ({ a, b }),
  lte: (a: unknown, b: unknown) => ({ a, b }),
  lt: (a: unknown, b: unknown) => ({ a, b }),
  gt: (a: unknown, b: unknown) => ({ a, b }),
  ne: (a: unknown, b: unknown) => ({ a, b }),
  isNull: (a: unknown) => ({ a }),
  isNotNull: (a: unknown) => ({ a }),
  not: (a: unknown) => ({ a }),
}));

vi.mock("@workspace/api-zod", () => ({
  CreateLeagueBody: {
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
  UpdateLeagueBody: {
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
}));

vi.mock("../lib/autoLinkPlayer.js", () => ({
  autoLinkPlayer: vi.fn(),
}));

const mockGenerateWeeklyMatches = vi.fn();
const mockSaveGeneratedMatches = vi.fn();

vi.mock("../services/matchGeneration", () => ({
  get generateWeeklyMatches() {
    return mockGenerateWeeklyMatches;
  },
  get saveGeneratedMatches() {
    return mockSaveGeneratedMatches;
  },
}));

vi.mock("./notifications", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

async function buildApp() {
  const [
    { default: leaguesRouter },
    { default: schedulingRouter },
    { default: drillsRouter },
    { default: statsRouter },
  ] = await Promise.all([
    import("../routes/leagues.js"),
    import("../routes/scheduling.js"),
    import("../routes/drills.js"),
    import("../routes/stats.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api", leaguesRouter);
  app.use("/api", schedulingRouter);
  app.use("/api", drillsRouter);
  app.use("/api", statsRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;

  mockGetAuth = () => ({ userId: "user_admin" });
  mockGetUser = async () => ({
    emailAddresses: [{ id: "email_1", emailAddress: ADMIN_EMAIL }],
    primaryEmailAddressId: "email_1",
  });

  mockDb.select.mockReturnValue(mockChain([]));
  mockDb.insert.mockReturnValue(mockChain([]));
  mockDb.update.mockReturnValue(mockChain([]));
  mockDb.delete.mockReturnValue(mockChain([]));
  mockDb.execute.mockResolvedValue({ rows: [] });

  mockGenerateWeeklyMatches.mockResolvedValue({ matches: [], stats: { total: 0 } });
  mockSaveGeneratedMatches.mockResolvedValue([]);

  app = await buildApp();
});

const adminRoutes = [
  { method: "post", path: "/api/scheduling/1/generate", body: {} },
  { method: "post", path: "/api/scheduling/1/confirm", body: {} },
  { method: "post", path: "/api/leagues", body: { name: "Test League", sport: "tennis" } },
  { method: "patch", path: "/api/leagues/1", body: { name: "Updated League" } },
  { method: "delete", path: "/api/leagues/1", body: {} },
  { method: "post", path: "/api/drills", body: { leagueId: 1, name: "Test Drill" } },
  { method: "delete", path: "/api/drills/1", body: {} },
  { method: "get", path: "/api/stats/dashboard", body: {} },
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// 401 — unauthenticated requests must be rejected before reaching the handler
// ──────────────────────────────────────────────────────────────────────────────
describe("requireAdmin middleware — unauthenticated requests return 401", () => {
  beforeEach(() => {
    mockGetAuth = () => ({ userId: null });
  });

  for (const route of adminRoutes) {
    it(`${route.method.toUpperCase()} ${route.path}`, async () => {
      const req = supertest(app)[route.method](route.path);
      if (route.method !== "get" && route.method !== "delete") {
        req.send(route.body);
      }
      const res = await req;
      expect(res.status).toBe(401);
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 403 — authenticated non-admin requests must be blocked with a clear message
// ──────────────────────────────────────────────────────────────────────────────
describe("requireAdmin middleware — non-admin authenticated requests return 403", () => {
  beforeEach(() => {
    mockGetAuth = () => ({ userId: "user_nonadmin" });
    mockGetUser = async () => ({
      emailAddresses: [{ id: "email_2", emailAddress: NON_ADMIN_EMAIL }],
      primaryEmailAddressId: "email_2",
    });
  });

  for (const route of adminRoutes) {
    it(`${route.method.toUpperCase()} ${route.path}`, async () => {
      const req = supertest(app)[route.method](route.path);
      if (route.method !== "get" && route.method !== "delete") {
        req.send(route.body);
      }
      const res = await req;
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin access required/i);
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Admin passthrough — middleware passes and each handler reaches its logic
// ──────────────────────────────────────────────────────────────────────────────
describe("requireAdmin middleware — admin requests pass through to the handler", () => {
  const sampleLeague = {
    id: 1,
    name: "Test League",
    sport: "tennis",
    createdByClerkUserId: "user_admin",
    status: "active",
    format: "round_robin",
    leagueType: "singles",
    startDate: null,
    endDate: null,
    location: null,
    description: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };

  it("POST /api/scheduling/1/generate — returns 200 with generated schedule data", async () => {
    const res = await supertest(app)
      .post("/api/scheduling/1/generate")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("matchesGenerated");
  });

  it("POST /api/scheduling/1/confirm — returns 404 when no schedule exists (handler reached)", async () => {
    mockDb.select.mockReturnValue(mockChain([]));
    const res = await supertest(app)
      .post("/api/scheduling/1/confirm")
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no schedule found/i);
  });

  it("POST /api/leagues — returns 201 with the created league", async () => {
    mockDb.insert.mockReturnValue(mockChain([sampleLeague]));
    const res = await supertest(app)
      .post("/api/leagues")
      .send({ name: "Test League", sport: "tennis" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test League");
  });

  it("PATCH /api/leagues/1 — returns 200 with the updated league", async () => {
    const updatedLeague = { ...sampleLeague, name: "Updated League" };
    mockDb.update.mockReturnValue(mockChain([updatedLeague]));
    mockDb.select.mockReturnValue(mockChain([{ count: 0 }]));
    const res = await supertest(app)
      .patch("/api/leagues/1")
      .send({ name: "Updated League" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated League");
  });

  it("DELETE /api/leagues/1 — returns 204 after deletion", async () => {
    const res = await supertest(app).delete("/api/leagues/1");
    expect(res.status).toBe(204);
  });

  it("POST /api/drills — returns 201 with the created drill", async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ id: 1, name: "Test Drill", league_id: 1 }] });
    const res = await supertest(app)
      .post("/api/drills")
      .send({ leagueId: 1, name: "Test Drill" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Drill");
  });

  it("DELETE /api/drills/1 — returns 200 with ok confirmation", async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    const res = await supertest(app).delete("/api/drills/1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /api/stats/dashboard — returns 200 with summary stats", async () => {
    mockDb.select.mockReturnValue(mockChain([]));
    const res = await supertest(app).get("/api/stats/dashboard");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalLeagues");
    expect(res.body).toHaveProperty("totalPlayers");
    expect(res.body).toHaveProperty("totalMatches");
  });
});
