import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Decision 30: a player's Leagues tab shows leagues they've asked to join as
// "Requested" until the organizer decides; a decline is a note they clear.

let mockUserId: string | null = "user_requester";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const chain = (value: unknown, calls?: { method: string; args: unknown[] }[]) => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok);
      return (...args: unknown[]) => {
        calls?.push({ method: String(prop), args });
        return new Proxy({}, handler);
      };
    },
  };
  return new Proxy({}, handler);
};

const mockDb = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(), transaction: vi.fn() };
const table = new Proxy({}, { get: (_t, p) => ({ col: String(p) }) });

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  leagueJoinRequestsTable: table,
  leagueRoundByesTable: table,
  leaguesTable: table,
  matchesTable: table,
  playersTable: table,
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../middlewares/requireLeagueAdmin.js", () => ({
  requireLeagueAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

async function buildApp() {
  const { default: router } = await import("../routes/leagueMembership.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "user_requester";
});

describe("GET /api/me/join-requests", () => {
  it("lists pending and declined requests with the league name", async () => {
    const created = new Date("2026-11-06T10:00:00Z");
    const decided = new Date("2026-11-07T10:00:00Z");
    mockDb.select.mockReturnValue(
      chain([
        { id: 2, leagueId: 9, leagueName: "Tuesday Flex", kind: "request", status: "pending", createdAt: created, decidedAt: null },
        { id: 1, leagueId: 4, leagueName: "Oak Park", kind: "request", status: "declined", createdAt: created, decidedAt: decided },
      ]),
    );
    const res = await supertest(await buildApp()).get("/api/me/join-requests");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 2, leagueId: 9, leagueName: "Tuesday Flex", kind: "request", status: "pending", createdAt: created.toISOString(), decidedAt: null },
      { id: 1, leagueId: 4, leagueName: "Oak Park", kind: "request", status: "declined", createdAt: created.toISOString(), decidedAt: decided.toISOString() },
    ]);
  });

  it("needs a signed-in player", async () => {
    mockUserId = null;
    const res = await supertest(await buildApp()).get("/api/me/join-requests");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/me/join-requests/:requestId/dismiss", () => {
  it("clears a declined note for the player who asked", async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    mockDb.update.mockReturnValue(chain(undefined, calls));
    const res = await supertest(await buildApp()).post("/api/me/join-requests/1/dismiss");
    expect(res.status).toBe(204);
    const set = calls.find((c) => c.method === "set");
    expect(set?.args[0]).toHaveProperty("playerDismissedAt");
  });

  it("rejects a bad id", async () => {
    const res = await supertest(await buildApp()).post("/api/me/join-requests/abc/dismiss");
    expect(res.status).toBe(400);
  });
});
