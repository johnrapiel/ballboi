import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { deletedNotice, deleteNameMatches, leaveCheck, splitMatchesForDelete } from "../lib/leagueLifecycle.js";

// Oct 31 review: C8 (only admin can't leave), C9 (end league), C10 (delete league). Decision 31.

describe("leaveCheck", () => {
  it("stops the only admin", () => {
    const out = leaveCheck({ isAdmin: true, adminCount: 1 });
    expect(out).toMatchObject({ ok: false, status: 409, code: "only_admin" });
    if (!out.ok) expect(out.error).toMatch(/^Make someone a co-admin first/);
  });
  it("lets an admin leave when there's another", () => {
    expect(leaveCheck({ isAdmin: true, adminCount: 2 })).toEqual({ ok: true });
  });
  it("lets players leave as before", () => {
    expect(leaveCheck({ isAdmin: false, adminCount: 1 })).toEqual({ ok: true });
  });
});

describe("deleteNameMatches", () => {
  it("ignores case and spacing", () => {
    expect(deleteNameMatches("  tuesday   flex ", "Tuesday Flex")).toBe(true);
  });
  it("needs the whole name", () => {
    expect(deleteNameMatches("Tuesday", "Tuesday Flex")).toBe(false);
    expect(deleteNameMatches("", "Tuesday Flex")).toBe(false);
    expect(deleteNameMatches(undefined, "Tuesday Flex")).toBe(false);
  });
});

describe("splitMatchesForDelete", () => {
  it("keeps matches with a Ball Boi recording", () => {
    expect(splitMatchesForDelete([1, 2, 3], new Set([2]))).toEqual({ remove: [1, 3], keep: [2] });
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

let mockUserId: string | null = "user_admin";
let mockIsAdmin = true;
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireLeagueAdmin.js", () => ({
  requireLeagueAdmin: (req: { params: { leagueId: string } }, res: { locals: Record<string, unknown>; status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!mockIsAdmin) return res.status(403).json({ error: "Only this league's admins can do that" });
    res.locals.leagueId = Number(req.params.leagueId);
    next();
  },
}));

type Call = { table?: string; method: string; args: unknown[] };
const chain = (value: unknown, calls?: Call[], table?: string) => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok);
      return (...args: unknown[]) => {
        calls?.push({ table, method: String(prop), args });
        return new Proxy({}, handler);
      };
    },
  };
  return new Proxy({}, handler);
};
const tableNamed = (name: string) => new Proxy({ __name: name }, { get: (t, p) => (p === "__name" ? name : { col: `${name}.${String(p)}` }) });
const mockDb = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(), transaction: vi.fn() };
vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiSessionsTable: tableNamed("ball_boi_sessions"),
  leagueAdminsTable: tableNamed("league_admins"),
  leagueNoticesTable: tableNamed("league_notices"),
  leagueRoundsTable: tableNamed("league_rounds"),
  leaguesTable: tableNamed("leagues"),
  matchesTable: tableNamed("matches"),
  playersTable: tableNamed("players"),
}));

async function buildApp() {
  const { default: router } = await import("../routes/leagueLifecycle.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const league = { id: 1, name: "Tuesday Flex", createdByClerkUserId: "user_admin", endedAt: null };

function recordingTx(calls: Call[]) {
  mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      select: () => chain([{ id: 31 }], calls, "select"),
      delete: (t: { __name: string }) => chain(undefined, calls, `delete:${t.__name}`),
      update: (t: { __name: string }) => chain(undefined, calls, `update:${t.__name}`),
      insert: (t: { __name: string }) => chain(undefined, calls, `insert:${t.__name}`),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "user_admin";
  mockIsAdmin = true;
});

describe("POST /api/leagues/:leagueId/end", () => {
  it("ends the league and cancels its draft round", async () => {
    mockDb.select.mockReturnValue(chain([league]));
    const calls: Call[] = [];
    recordingTx(calls);
    const res = await supertest(await buildApp()).post("/api/leagues/1/end");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ leagueId: 1, status: "completed", cancelledRounds: 1 });
    expect(calls.some((c) => c.table === "delete:league_rounds")).toBe(true);
    const set = calls.find((c) => c.table === "update:leagues" && c.method === "set");
    expect(set?.args[0]).toMatchObject({ status: "completed" });
    expect((set?.args[0] as { endedAt: unknown }).endedAt).toBeInstanceOf(Date);
  });

  it("refuses a league that already ended", async () => {
    mockDb.select.mockReturnValue(chain([{ ...league, endedAt: new Date() }]));
    const res = await supertest(await buildApp()).post("/api/leagues/1/end");
    expect(res.status).toBe(409);
  });

  it("is for league admins", async () => {
    mockIsAdmin = false;
    const res = await supertest(await buildApp()).post("/api/leagues/1/end");
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/leagues/:leagueId", () => {
  it("needs the league's name typed", async () => {
    mockDb.select.mockReturnValue(chain([league]));
    const res = await supertest(await buildApp()).delete("/api/leagues/1").send({ confirmName: "Tuesday" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Type Tuesday Flex to delete it.");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("deletes the league, keeps recorded matches, and notes every other member", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([league]))
      .mockReturnValueOnce(chain([
        { id: 10, clerkUserId: "user_admin", leftAt: null },
        { id: 11, clerkUserId: "user_b", leftAt: null },
        { id: 12, clerkUserId: "user_gone", leftAt: new Date() },
      ]))
      .mockReturnValueOnce(chain([{ clerkUserId: "user_admin" }, { clerkUserId: "user_co" }]))
      .mockReturnValueOnce(chain([{ id: 100 }, { id: 101 }]))
      .mockReturnValueOnce(chain([{ matchId: 101 }]));
    const calls: Call[] = [];
    recordingTx(calls);

    const res = await supertest(await buildApp()).delete("/api/leagues/1").send({ confirmName: "tuesday flex" });
    expect(res.status).toBe(204);
    expect(calls.some((c) => c.table === "delete:matches")).toBe(true);
    const detach = calls.find((c) => c.table === "update:matches" && c.method === "set");
    expect(detach?.args[0]).toMatchObject({ leagueId: null, roundId: null });
    expect(calls.some((c) => c.table === "delete:leagues")).toBe(true);
    const notes = calls.find((c) => c.table === "insert:league_notices" && c.method === "values");
    expect(notes?.args[0]).toEqual([
      { clerkUserId: "user_b", message: deletedNotice("Tuesday Flex") },
      { clerkUserId: "user_co", message: deletedNotice("Tuesday Flex") },
    ]);
  });

  it("is for league admins, not players", async () => {
    mockIsAdmin = false;
    const res = await supertest(await buildApp()).delete("/api/leagues/1").send({ confirmName: "Tuesday Flex" });
    expect(res.status).toBe(403);
  });
});

describe("league notices", () => {
  it("lists notes the player hasn't cleared", async () => {
    const at = new Date("2026-11-08T10:00:00Z");
    mockDb.select.mockReturnValue(chain([{ id: 5, message: "Tuesday Flex was deleted by its organizer", createdAt: at }]));
    const res = await supertest(await buildApp()).get("/api/me/league-notices");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 5, message: "Tuesday Flex was deleted by its organizer", createdAt: at.toISOString() }]);
  });

  it("clears one", async () => {
    mockDb.update.mockReturnValue(chain(undefined));
    const res = await supertest(await buildApp()).post("/api/me/league-notices/5/dismiss");
    expect(res.status).toBe(204);
  });
});
