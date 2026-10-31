import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_reporter";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middlewares/requireAdmin", () => ({
  requireAdmin: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(403).json({ error: "Forbidden" }),
}));

const { restrictCalls } = vi.hoisted(() => ({ restrictCalls: [] as unknown[] }));
vi.mock("../messaging", () => ({
  getAutoRestrict: () => ({ evaluate: async (...a: unknown[]) => void restrictCalls.push(a) }),
}));

vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

// Minimal query-builder fakes. Each test queues what selects return.
const selectQueue: unknown[][] = [];
const inserted: { table: string; values: unknown }[] = [];
const deleted: string[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok);
  return c;
}

const mockDb = {
  select: () => chain(() => selectQueue.shift() ?? []),
  insert: (t: { __name: string }) => ({
    values: (values: unknown) => {
      inserted.push({ table: t.__name, values });
      const done = Promise.resolve([{ id: 42 }]);
      return {
        returning: () => done,
        onConflictDoNothing: () => Promise.resolve(),
      };
    },
  }),
  delete: (t: { __name: string }) => ({
    where: async () => void deleted.push(t.__name),
  }),
  update: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  contentReportsTable: { __name: "content_reports", id: {}, status: {}, createdAt: {} },
  userBlocksTable: { __name: "user_blocks", blockerClerkUserId: {}, blockedClerkUserId: {}, createdAt: {} },
  playersTable: { __name: "players", id: {}, name: {}, clerkUserId: {} },
  REPORT_TARGET_TYPES: ["player", "league", "ball_boi_session", "match", "message", "account"],
  REPORT_REASONS: ["harassment", "inappropriate_content", "impersonation", "spam", "cheating", "other"],
  REPORT_STATUSES: ["open", "reviewed", "actioned", "dismissed"],
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...a: unknown[]) => a,
  desc: (a: unknown) => a,
  inArray: (a: unknown, b: unknown) => ({ a, b }),
}));

async function buildApp() {
  const { default: safetyRouter } = await import("../routes/safety.js");
  const app = express();
  app.use(express.json());
  app.use("/api", safetyRouter);
  return app;
}

beforeEach(() => {
  mockUserId = "user_reporter";
  selectQueue.length = 0;
  inserted.length = 0;
  deleted.length = 0;
  restrictCalls.length = 0;
});

describe("parseReport", () => {
  it("accepts a valid report and trims details", async () => {
    const { parseReport } = await import("../routes/safety.js");
    expect(parseReport({ targetType: "player", targetId: 12, reason: "harassment", details: "  rude  " })).toEqual({
      targetType: "player",
      targetId: "12",
      reason: "harassment",
      details: "rude",
    });
  });

  it("rejects unknown targets, reasons and missing ids", async () => {
    const { parseReport } = await import("../routes/safety.js");
    expect(parseReport({ targetType: "court", targetId: 1, reason: "spam" })).toHaveProperty("error");
    expect(parseReport({ targetType: "player", targetId: 1, reason: "meh" })).toHaveProperty("error");
    expect(parseReport({ targetType: "player", targetId: " ", reason: "spam" })).toHaveProperty("error");
    expect(parseReport(undefined)).toHaveProperty("error");
  });
});

describe("POST /api/reports", () => {
  it("requires sign-in", async () => {
    mockUserId = null;
    const res = await supertest(await buildApp()).post("/api/reports").send({ targetType: "player", targetId: 1, reason: "spam" });
    expect(res.status).toBe(401);
  });

  it("stores the report against the reporter", async () => {
    const res = await supertest(await buildApp()).post("/api/reports").send({ targetType: "player", targetId: 7, reason: "spam" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 42, status: "open" });
    expect(inserted[0]).toEqual({
      table: "content_reports",
      values: {
        reporterClerkUserId: "user_reporter",
        targetType: "player",
        targetId: "7",
        reason: "spam",
        details: undefined,
        source: "user",
        subjectClerkUserId: null,
      },
    });
  });

  it("records who the report is about and checks auto-restrict", async () => {
    selectQueue.push([{ clerkUserId: "user_target" }]);
    const res = await supertest(await buildApp()).post("/api/reports").send({ targetType: "player", targetId: 7, reason: "harassment" });
    expect(res.status).toBe(201);
    expect((inserted[0].values as { subjectClerkUserId: string }).subjectClerkUserId).toBe("user_target");
    expect(restrictCalls).toEqual([["user_target", { kind: "report" }]]);
  });

  it("won't take message or account reports here", async () => {
    for (const targetType of ["message", "account"]) {
      const res = await supertest(await buildApp()).post("/api/reports").send({ targetType, targetId: "x", reason: "spam" });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a bad report", async () => {
    const res = await supertest(await buildApp()).post("/api/reports").send({ targetType: "player", reason: "spam" });
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });
});

describe("admin report queue", () => {
  it("is admin only", async () => {
    const res = await supertest(await buildApp()).get("/api/admin/reports");
    expect(res.status).toBe(403);
  });
});

describe("blocking", () => {
  it("blocks the account behind a player", async () => {
    selectQueue.push([{ clerkUserId: "user_target" }]);
    const res = await supertest(await buildApp()).post("/api/players/5/block");
    expect(res.status).toBe(201);
    expect(inserted[0]).toEqual({
      table: "user_blocks",
      values: { blockerClerkUserId: "user_reporter", blockedClerkUserId: "user_target" },
    });
    expect(restrictCalls).toEqual([["user_target", { kind: "block" }]]);
  });

  it("won't block yourself", async () => {
    selectQueue.push([{ clerkUserId: "user_reporter" }]);
    const res = await supertest(await buildApp()).post("/api/players/5/block");
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("explains when a player has no account", async () => {
    selectQueue.push([{ clerkUserId: null }]);
    const res = await supertest(await buildApp()).post("/api/players/5/block");
    expect(res.status).toBe(404);
  });

  it("unblocks", async () => {
    selectQueue.push([{ clerkUserId: "user_target" }]);
    const res = await supertest(await buildApp()).delete("/api/players/5/block");
    expect(res.status).toBe(204);
    expect(deleted).toEqual(["user_blocks"]);
  });

  it("lists who you blocked", async () => {
    const at = new Date("2026-10-21T12:00:00Z");
    selectQueue.push([{ blockedClerkUserId: "user_target", createdAt: at }]);
    selectQueue.push([{ id: 5, name: "Mike Okafor", clerkUserId: "user_target" }]);
    const res = await supertest(await buildApp()).get("/api/blocks");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ playerId: 5, name: "Mike Okafor", blockedAt: at.toISOString() }]);
  });
});

describe("blockedPlayerPairs", () => {
  it("pairs every player record of two accounts where one blocked the other", async () => {
    const { blockedPlayerPairs, pairKey } = await import("../lib/blocks.js");
    // Players 9 and 10 are one account (two leagues); player 2 is another; 3 has no account.
    selectQueue.push([
      { id: 9, clerkUserId: "a" },
      { id: 10, clerkUserId: "a" },
      { id: 2, clerkUserId: "b" },
      { id: 3, clerkUserId: null },
    ]);
    selectQueue.push([{ a: "b", b: "a" }]);
    const pairs = await blockedPlayerPairs([9, 10, 2, 3]);
    expect([...pairs].sort()).toEqual([pairKey(2, 9), pairKey(2, 10)].sort());
    expect(pairKey(10, 9)).toBe("9-10");
  });

  it("does nothing for fewer than two accounts", async () => {
    const { blockedPlayerPairs } = await import("../lib/blocks.js");
    expect((await blockedPlayerPairs([1])).size).toBe(0);
    selectQueue.push([{ id: 1, clerkUserId: "a" }, { id: 2, clerkUserId: null }]);
    expect((await blockedPlayerPairs([1, 2])).size).toBe(0);
  });
});
