import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// PR 5: an admin who leaves keeps managing the league (Q4), and a bracket
// player who leaves hands their opponent a walkover (Q5), so the league can
// still finish.

let mockUserId: string | null = "u4";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const rows: Record<string, Row[]> = {};
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguesTable: table("leagues", ["id", "name", "status", "endedAt", "format", "timeZone", "startDate", "seasonWeeks"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "name", "leftAt"]),
    matchesTable: table("matches", [
      "id", "leagueId", "player1Id", "player2Id", "player3Id", "player4Id", "status", "score", "winnerId",
      "voidedAt", "playoffBracketId", "playoffRound", "playoffSlot",
    ]),
    playoffBracketsTable: table("playoff_brackets", ["id", "leagueId", "status"]),
    leagueRoundByesTable: table("league_round_byes", ["id", "playerId"]),
    leagueJoinRequestsTable: table("league_join_requests", ["id", "leagueId", "clerkUserId", "status", "kind"]),
    leagueAdminsTable: table("league_admins", ["id", "leagueId", "clerkUserId", "role"]),
    usersTable: table("users", ["clerkUserId", "displayName"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const push = vi.fn().mockResolvedValue(undefined);
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: (...a: unknown[]) => push(...a) }));
vi.mock("./notifications.js", () => ({ sendPushToUsers: (...a: unknown[]) => push(...a) }));
let mockRole: string | null = "owner";
vi.mock("../lib/leagueAccess.js", () => ({ getLeagueRole: async () => mockRole }));
vi.mock("../middlewares/requireLeagueAdmin.js", () => ({
  requireLeagueAdmin: (req: { params: { leagueId: string } }, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.leagueId = Number(req.params.leagueId);
    next();
  },
}));

async function buildApp() {
  const { default: router } = await import("../routes/leagueMembership.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const semi = (id: number, slot: number, p1: number, p2: number, over: Row = {}): Row => ({
  id,
  leagueId: 1,
  player1Id: p1,
  player2Id: p2,
  player3Id: null,
  player4Id: null,
  status: "scheduled",
  score: null,
  winnerId: null,
  voidedAt: null,
  playoffBracketId: 5,
  playoffRound: "semifinal",
  playoffSlot: slot,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "u4";
  mockRole = "owner";
  for (const k of Object.keys(rows)) delete rows[k];
  rows.leagues = [{ id: 1, name: "Tuesday Flex", status: "active", endedAt: null, format: "flex", timeZone: "America/New_York", startDate: "2026-09-07", seasonWeeks: 8 }];
  rows.players = [1, 2, 3, 4].map((id) => ({ id, leagueId: 1, clerkUserId: `u${id}`, name: `Player ${id}`, leftAt: null }));
  rows.playoff_brackets = [{ id: 5, leagueId: 1, status: "active" }];
  rows.league_round_byes = [];
});

describe("leaving a league (Q4, Q5)", () => {
  it("lets the only admin leave, and they stay admin", async () => {
    rows.matches = [];
    const res = await supertest(await buildApp()).post("/api/leagues/1/leave");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ left: true, voidedMatches: 0, stillAdmin: true });
    expect(rows.players.find((p) => p.id === 4)?.leftAt).toBeTruthy();
  });

  it("gives a semifinalist's opponent a walkover into the final", async () => {
    rows.matches = [semi(10, 1, 1, 4), semi(11, 2, 2, 3, { status: "completed", score: "6-3, 6-4", winnerId: 2 })];
    const res = await supertest(await buildApp()).post("/api/leagues/1/leave");
    expect(res.status).toBe(200);
    expect(res.body.voidedMatches).toBe(0);

    const left = rows.matches.find((m) => m.id === 10)!;
    expect(left).toMatchObject({ status: "completed", score: "W/O", winnerId: 1, voidedAt: null });
    const final = rows.matches.find((m) => m.playoffRound === "final");
    expect(final).toMatchObject({ player1Id: 1, player2Id: 2, status: "scheduled", playoffSlot: 1 });
    expect(push).toHaveBeenCalledWith(["u1"], "Walkover", expect.stringContaining("walkover"), "/league/1");
  });

  it("finishes the league when a finalist leaves", async () => {
    rows.matches = [
      semi(10, 1, 1, 4, { status: "completed", score: "3-6, 4-6", winnerId: 4 }),
      semi(11, 2, 2, 3, { status: "completed", score: "6-3, 6-4", winnerId: 2 }),
      semi(12, 1, 4, 2, { playoffRound: "final" }),
    ];
    await supertest(await buildApp()).post("/api/leagues/1/leave");
    expect(rows.matches.find((m) => m.id === 12)).toMatchObject({ score: "W/O", winnerId: 2, status: "completed" });
    expect(rows.playoff_brackets[0].status).toBe("completed");
  });

  it("gives a walkover when a player who already left reaches the final", async () => {
    rows.players.find((p) => p.id === 4)!.leftAt = new Date();
    rows.matches = [
      semi(10, 1, 1, 4, { status: "completed", score: "3-6, 4-6", winnerId: 4 }),
      semi(11, 2, 2, 3, { status: "completed", score: "6-3, 6-4", winnerId: 2 }),
    ];
    const { advancePlayoff } = await import("../services/leaguePlayoffs.js");
    await advancePlayoff(rows.matches[1] as never, 2);
    const final = rows.matches.find((m) => m.playoffRound === "final");
    expect(final).toMatchObject({ player1Id: 4, player2Id: 2, score: "W/O", winnerId: 2, status: "completed" });
    expect(rows.playoff_brackets[0].status).toBe("completed");
  });

  it("still cancels weekly matches still to play", async () => {
    rows.matches = [semi(20, 0, 4, 3, { playoffBracketId: null, playoffRound: null, playoffSlot: null })];
    const res = await supertest(await buildApp()).post("/api/leagues/1/leave");
    expect(res.body.voidedMatches).toBe(1);
    expect(rows.matches[0]).toMatchObject({ status: "voided" });
  });
});

describe("admin remove (C26)", () => {
  it("won't remove the admin's own row", async () => {
    rows.matches = [];
    const res = await supertest(await buildApp()).post("/api/leagues/1/players/4/remove");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("To stop playing, use Leave league on the league's page.");
    expect(rows.players.find((p) => p.id === 4)?.leftAt).toBeNull();
  });

  it("removes someone else", async () => {
    rows.matches = [];
    const res = await supertest(await buildApp()).post("/api/leagues/1/players/3/remove");
    expect(res.status).toBe(200);
    expect(rows.players.find((p) => p.id === 3)?.leftAt).toBeTruthy();
  });
});

describe("join request to an ended league", () => {
  it("is refused, and the admin gets nothing", async () => {
    mockUserId = "u9";
    rows.leagues[0].endedAt = new Date();
    rows.league_join_requests = [];
    const res = await supertest(await buildApp()).post("/api/leagues/1/join-requests").send({ playerName: "New" });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: "This league has ended", code: "league_ended" });
    expect(rows.league_join_requests).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });
});
