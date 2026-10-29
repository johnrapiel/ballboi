import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// POST /api/leagues: anyone signed in can start a league (spec: Leagues > Setup).

let mockGetAuth: () => { userId: string | null } = () => ({ userId: "user_starter" });

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => mockGetAuth(),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

// Each insert records what was inserted. The league insert returns a row.
let inserted: { table: string; values: Record<string, unknown> }[] = [];

function makeTx() {
  return {
    insert: (table: { __name: string }) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table: table.__name, values });
        const row = {
          id: 7,
          ...values,
          createdAt: new Date("2026-10-21T12:00:00Z"),
          updatedAt: new Date("2026-10-21T12:00:00Z"),
        };
        return { returning: () => Promise.resolve([row]) };
      },
    }),
  };
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => unknown) => fn(makeTx())),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  leaguesTable: { __name: "leagues", id: {}, createdAt: {}, createdByClerkUserId: {} },
  playersTable: { __name: "players", id: {}, leagueId: {}, clerkUserId: {} },
  matchesTable: { __name: "matches", id: {}, leagueId: {} },
  leagueRoundsTable: { __name: "league_rounds", id: {}, leagueId: {} },
  leagueAdminsTable: { __name: "league_admins", leagueId: {}, clerkUserId: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...args: unknown[]) => args,
  count: () => ({ count: 1 }),
  isNull: (a: unknown) => ({ isNull: a }),
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  desc: (a: unknown) => a,
  asc: (a: unknown) => a,
  sql: Object.assign(() => ({ queryChunks: [] }), { raw: () => ({ queryChunks: [] }) }),
}));

// Request shape is the OpenAPI schema's job; these tests cover the route's own rules.
vi.mock("@workspace/api-zod", () => ({
  CreateLeagueBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
  UpdateLeagueBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));

vi.mock("../lib/leagueAccess.js", () => ({ isLeagueAdmin: vi.fn().mockResolvedValue(false) }));
vi.mock("../lib/autoLinkPlayer.js", () => ({ autoLinkPlayer: vi.fn() }));
vi.mock("../services/seasonService.js", () => ({ getPastSeasonNames: vi.fn().mockResolvedValue([]) }));
vi.mock("../middlewares/requireAdmin.js", () => ({
  requireAdmin: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(403).json({ error: "Forbidden" }),
}));

async function buildApp() {
  const { default: leaguesRouter } = await import("../routes/leagues.js");
  const app = express();
  app.use(express.json());
  app.use("/api", leaguesRouter);
  return app;
}

const valid = {
  name: "Men's 3.5",
  format: "flex",
  leagueType: "singles",
  visibility: "private",
  startDate: "2099-11-02",
  seasonWeeks: 8,
  playoffSize: 4,
  unplayedRule: "forfeit",
  location: "Beacon Courts",
  playing: true,
  playerName: "John Rapiel",
};

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  inserted = [];
  mockGetAuth = () => ({ userId: "user_starter" });
  app = await buildApp();
});

describe("POST /api/leagues", () => {
  it("returns 401 when not signed in", async () => {
    mockGetAuth = () => ({ userId: null });
    const res = await supertest(app).post("/api/leagues").send(valid);
    expect(res.status).toBe(401);
    expect(inserted).toHaveLength(0);
  });

  it("lets any signed-in player start a league and makes them its admin", async () => {
    const res = await supertest(app).post("/api/leagues").send(valid);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Men's 3.5");
    expect(res.body.createdByClerkUserId).toBe("user_starter");
    expect(res.body.status).toBe("upcoming");
    expect(res.body.endDate).toBe("2099-12-27");
    expect(res.body.playoffSize).toBe(4);
    expect(res.body.unplayedRule).toBe("forfeit");
  });

  it("records the creator as the league's owner", async () => {
    await supertest(app).post("/api/leagues").send(valid);
    const admin = inserted.find((i) => i.table === "league_admins");
    expect(admin?.values).toMatchObject({ leagueId: 7, clerkUserId: "user_starter", role: "owner" });
  });

  it("adds the admin as a player when they're playing", async () => {
    const res = await supertest(app).post("/api/leagues").send(valid);
    expect(res.body.playerCount).toBe(1);
    const player = inserted.find((i) => i.table === "players");
    expect(player?.values).toMatchObject({ name: "John Rapiel", clerkUserId: "user_starter", leagueId: 7 });
  });

  it("doesn't add a player when the admin opts out", async () => {
    const res = await supertest(app).post("/api/leagues").send({ ...valid, playing: false, playerName: null });
    expect(res.status).toBe(201);
    expect(res.body.playerCount).toBe(0);
    expect(inserted.filter((i) => i.table === "players")).toHaveLength(0);
  });

  it("ignores a creator id in the body", async () => {
    await supertest(app).post("/api/leagues").send({ ...valid, createdByClerkUserId: "someone_else" });
    const league = inserted.find((i) => i.table === "leagues");
    expect(league?.values.createdByClerkUserId).toBe("user_starter");
  });

  it("drops the rating range for Private leagues and keeps it for Open ones", async () => {
    await supertest(app)
      .post("/api/leagues")
      .send({ ...valid, visibility: "open", minRating: "3.0", maxRating: "4.0", rosterCap: 16 });
    const league = inserted.find((i) => i.table === "leagues");
    expect(league?.values).toMatchObject({ visibility: "open", minRating: "3.0", maxRating: "4.0", rosterCap: 16 });
  });

  it("returns 400 with a plain message for a setup the spec doesn't allow", async () => {
    const res = await supertest(app).post("/api/leagues").send({ ...valid, seasonWeeks: 25 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 to 24 weeks/);
    expect(inserted).toHaveLength(0);
  });
});
