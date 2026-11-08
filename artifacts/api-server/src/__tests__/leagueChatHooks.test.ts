import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// The league routes tell the league chat about leaving and removal (decision
// 145): leaving or being removed takes you out of the league's chat, and a
// removal from the chat's admin tools goes to the moderation queue.

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
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/leagueAccess.js", () => ({ getLeagueRole: async () => "owner" }));
vi.mock("../middlewares/requireLeagueAdmin.js", () => ({
  requireLeagueAdmin: (req: { params: { leagueId: string } }, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.leagueId = Number(req.params.leagueId);
    next();
  },
}));

import { setLeagueChatEvents, type LeagueChatEvents } from "../messaging/leagueChatEvents";

const events = { leagueChanged: vi.fn(), roundPublished: vi.fn(), resultEntered: vi.fn(), removedFromChat: vi.fn() } satisfies LeagueChatEvents;

async function buildApp() {
  const { default: router } = await import("../routes/leagueMembership.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return supertest(app);
}

beforeEach(() => {
  vi.clearAllMocks();
  setLeagueChatEvents(events);
  mockUserId = "u4";
  for (const k of Object.keys(rows)) delete rows[k];
  rows.leagues = [{ id: 1, name: "Tuesday Flex", status: "active", endedAt: null, format: "flex", timeZone: "America/New_York", startDate: "2026-09-07", seasonWeeks: 8 }];
  rows.players = [1, 2, 3, 4].map((id) => ({ id, leagueId: 1, clerkUserId: `u${id}`, name: `Player ${id}`, leftAt: null }));
  rows.playoff_brackets = [];
  rows.league_round_byes = [];
  rows.matches = [];
});
afterEach(() => setLeagueChatEvents(null));

describe("league chat membership from the league routes", () => {
  it("leaving the league updates its chat", async () => {
    expect((await (await buildApp()).post("/api/leagues/1/leave")).status).toBe(200);
    expect(events.leagueChanged).toHaveBeenCalledWith(1);
    expect(events.removedFromChat).not.toHaveBeenCalled();
  });

  it("an admin removing a player updates its chat", async () => {
    expect((await (await buildApp()).post("/api/leagues/1/players/2/remove")).status).toBe(200);
    expect(events.leagueChanged).toHaveBeenCalledWith(1);
    expect(events.removedFromChat).not.toHaveBeenCalled();
  });

  it("a removal from the chat's admin tools is logged for moderation", async () => {
    expect((await (await buildApp()).post("/api/leagues/1/players/2/remove").send({ fromChat: true })).status).toBe(200);
    expect(events.removedFromChat).toHaveBeenCalledWith(1, "u4", "u2");
  });
});
