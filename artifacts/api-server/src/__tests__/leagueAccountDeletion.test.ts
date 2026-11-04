import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// App Store 5.1.1(v): deleting an account removes the league data it created.
// Wave 1 review S4 (John's call): a league whose only admin deletes their
// account goes to the member they picked, or, if they skipped, to the
// longest-standing member. Deletion is never blocked.

let mockUserId: string | null = "user_leaving";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { deleteUser: vi.fn() } },
}));

const { rows } = vi.hoisted(() => ({ rows: {} as Record<string, Row[]> }));
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguesTable: table("leagues", ["id", "name", "createdByClerkUserId", "endedAt"]),
    leagueAdminsTable: table("league_admins", ["id", "leagueId", "clerkUserId", "role"]),
    leagueJoinRequestsTable: table("league_join_requests", ["id", "leagueId", "clerkUserId"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "name", "leftAt", "createdAt"]),
    usersTable: table("users", ["clerkUserId"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("../lib/autoLinkPlayer.js", () => ({ autoLinkPlayersForUser: vi.fn() }));
const { deleteAccountMock } = vi.hoisted(() => ({ deleteAccountMock: vi.fn() }));
vi.mock("../lib/accountDeletion.js", () => ({ deleteAccount: deleteAccountMock }));

import { db } from "@workspace/db";
import {
  deleteLeagueDataFor,
  eligibleSuccessors,
  parseNewAdmins,
  pickSuccessor,
  type LeagueMember,
} from "../lib/leagueAccountDeletion.js";

const jan = (d: number) => new Date(`2026-01-${String(d).padStart(2, "0")}T12:00:00Z`);
const player = (id: number, leagueId: number, clerkUserId: string | null, joinedDay: number, extra: Row = {}) => ({
  id,
  leagueId,
  clerkUserId,
  name: `Player ${id}`,
  leftAt: null,
  createdAt: jan(joinedDay),
  ...extra,
});

function reset() {
  for (const k of Object.keys(rows)) delete rows[k];
  rows.leagues = [];
  rows.league_admins = [];
  rows.league_join_requests = [];
  rows.players = [];
}

beforeEach(() => {
  reset();
  mockUserId = "user_leaving";
  deleteAccountMock.mockReset();
  deleteAccountMock.mockResolvedValue({ playersAnonymized: 0, recordingsDeleted: 0, recordingsKeptForOpponents: 0, videosDeleted: 0, videoDeleteFailures: 0 });
});

const tx = () => db as never;
const adminsOf = (leagueId: number) =>
  rows.league_admins.filter((a) => a.leagueId === leagueId).map((a) => ({ clerkUserId: a.clerkUserId, role: a.role }));

// ─── Pure rules ──────────────────────────────────────────────────────────────

describe("pickSuccessor", () => {
  const m = (playerId: number, clerkUserId: string | null, joinedDay: number, leftAt: Date | null = null): LeagueMember => ({
    playerId,
    clerkUserId,
    name: `P${playerId}`,
    leftAt,
    createdAt: jan(joinedDay),
  });

  it("orders members longest-standing first and skips anyone who can't take over", () => {
    const members = [m(5, "user_c", 9), m(2, "user_b", 3), m(3, null, 1), m(4, "user_gone", 2, jan(20)), m(1, "user_leaving", 1)];
    expect(eligibleSuccessors(members, "user_leaving").map((x) => x.playerId)).toEqual([2, 5]);
  });

  it("breaks a tie on join time by the lower player ID, and lists each person once", () => {
    const members = [m(8, "user_b", 4), m(7, "user_a", 4), m(9, "user_a", 6)];
    expect(eligibleSuccessors(members, "user_leaving").map((x) => x.playerId)).toEqual([7, 8]);
  });

  it("takes the person's pick when that member can take over", () => {
    const members = [m(2, "user_b", 3), m(5, "user_c", 9)];
    expect(pickSuccessor(members, "user_leaving", 5)?.playerId).toBe(5);
  });

  it("falls back to the longest-standing member on Skip or an unusable pick", () => {
    const members = [m(2, "user_b", 3), m(5, "user_c", 9), m(6, null, 1)];
    expect(pickSuccessor(members, "user_leaving")?.playerId).toBe(2);
    expect(pickSuccessor(members, "user_leaving", 6)?.playerId).toBe(2); // no account
    expect(pickSuccessor(members, "user_leaving", 999)?.playerId).toBe(2); // not in the league
  });

  it("returns null when nobody can take over", () => {
    expect(pickSuccessor([m(1, null, 1)], "user_leaving")).toBeNull();
  });
});

describe("parseNewAdmins", () => {
  it("reads league and player IDs and drops anything malformed", () => {
    expect(
      parseNewAdmins([{ leagueId: 1, playerId: 10 }, { leagueId: "2", playerId: "20" }, { leagueId: 3 }, null, "x", { leagueId: 1.5, playerId: 2 }]),
    ).toEqual({ 1: 10, 2: 20 });
    expect(parseNewAdmins(undefined)).toEqual({});
    expect(parseNewAdmins({ leagueId: 1, playerId: 2 })).toEqual({});
  });
});

// ─── deleteLeagueDataFor ─────────────────────────────────────────────────────

describe("deleteLeagueDataFor", () => {
  it("removes admin roles and join requests, and unlinks leagues they created", async () => {
    rows.leagues = [{ id: 1, name: "Tuesday Flex", createdByClerkUserId: "user_leaving", endedAt: null }];
    rows.league_admins = [
      { id: 1, leagueId: 1, clerkUserId: "user_leaving", role: "owner" },
      { id: 2, leagueId: 1, clerkUserId: "user_co", role: "co_admin" },
    ];
    rows.league_join_requests = [
      { id: 1, leagueId: 2, clerkUserId: "user_leaving" },
      { id: 2, leagueId: 2, clerkUserId: "user_other" },
    ];
    const promoted = await deleteLeagueDataFor(tx(), "user_leaving");
    // Another admin already runs it, so nobody new is promoted.
    expect(promoted).toEqual([]);
    expect(adminsOf(1)).toEqual([{ clerkUserId: "user_co", role: "co_admin" }]);
    expect(rows.league_join_requests.map((r) => r.clerkUserId)).toEqual(["user_other"]);
    expect(rows.leagues[0].createdByClerkUserId).toBeNull();
  });

  it("makes the picked member the new admin, with the same role", async () => {
    rows.leagues = [{ id: 1, name: "Tuesday Flex", createdByClerkUserId: "user_leaving", endedAt: null }];
    rows.league_admins = [{ id: 1, leagueId: 1, clerkUserId: "user_leaving", role: "owner" }];
    rows.players = [player(10, 1, "user_early", 1), player(11, 1, "user_picked", 5)];
    const promoted = await deleteLeagueDataFor(tx(), "user_leaving", { 1: 11 });
    expect(promoted).toEqual([{ leagueId: 1, playerId: 11, clerkUserId: "user_picked", role: "owner" }]);
    expect(adminsOf(1)).toEqual([{ clerkUserId: "user_picked", role: "owner" }]);
  });

  it("promotes the longest-standing member when the person skipped", async () => {
    rows.leagues = [{ id: 1, name: "Tuesday Flex", createdByClerkUserId: "user_leaving", endedAt: null }];
    rows.league_admins = [{ id: 1, leagueId: 1, clerkUserId: "user_leaving", role: "owner" }];
    rows.players = [
      player(9, 1, null, 1), // added by name, no account
      player(10, 1, "user_left", 2, { leftAt: jan(10) }), // left the league
      player(12, 1, "user_newer", 8),
      player(11, 1, "user_longest", 3),
      player(13, 2, "user_other_league", 1),
    ];
    await deleteLeagueDataFor(tx(), "user_leaving");
    expect(adminsOf(1)).toEqual([{ clerkUserId: "user_longest", role: "owner" }]);
    expect(adminsOf(2)).toEqual([]);
  });

  it("ignores a pick from outside the league and falls back to the longest-standing member", async () => {
    rows.leagues = [{ id: 1, name: "Tuesday Flex", createdByClerkUserId: "user_leaving", endedAt: null }];
    rows.league_admins = [{ id: 1, leagueId: 1, clerkUserId: "user_leaving", role: "owner" }];
    rows.players = [player(10, 1, "user_longest", 1), player(20, 2, "user_elsewhere", 1)];
    await deleteLeagueDataFor(tx(), "user_leaving", { 1: 20 });
    expect(adminsOf(1)).toEqual([{ clerkUserId: "user_longest", role: "owner" }]);
  });

  it("hands over a league made before co-admins, run by its creator with no admin rows", async () => {
    rows.leagues = [{ id: 3, name: "Old League", createdByClerkUserId: "user_leaving", endedAt: null }];
    rows.players = [player(30, 3, "user_member", 2)];
    await deleteLeagueDataFor(tx(), "user_leaving");
    expect(adminsOf(3)).toEqual([{ clerkUserId: "user_member", role: "owner" }]);
    expect(rows.leagues[0].createdByClerkUserId).toBeNull();
  });

  it("handles each league on its own: picks, skips and leagues with nobody to take over", async () => {
    rows.leagues = [
      { id: 1, name: "A", createdByClerkUserId: "user_leaving", endedAt: null },
      { id: 2, name: "B", createdByClerkUserId: "user_someone", endedAt: null },
      { id: 4, name: "Empty", createdByClerkUserId: "user_leaving", endedAt: null },
    ];
    rows.league_admins = [
      { id: 1, leagueId: 1, clerkUserId: "user_leaving", role: "owner" },
      { id: 2, leagueId: 2, clerkUserId: "user_leaving", role: "co_admin" },
      { id: 3, leagueId: 4, clerkUserId: "user_leaving", role: "owner" },
    ];
    rows.players = [player(10, 1, "user_a1", 1), player(11, 1, "user_a2", 2), player(20, 2, "user_b1", 1), player(40, 4, null, 1)];
    const promoted = await deleteLeagueDataFor(tx(), "user_leaving", { 1: 11 });
    expect(promoted.map((p) => [p.leagueId, p.clerkUserId, p.role])).toEqual([
      [1, "user_a2", "owner"],
      [2, "user_b1", "co_admin"],
    ]);
    // Deletion still goes through for the league nobody can take over.
    expect(adminsOf(4)).toEqual([]);
    expect(rows.league_admins.some((a) => a.clerkUserId === "user_leaving")).toBe(false);
  });

  it("never promotes the person leaving, even through a second player row", async () => {
    rows.leagues = [{ id: 1, name: "A", createdByClerkUserId: "user_leaving", endedAt: null }];
    rows.league_admins = [{ id: 1, leagueId: 1, clerkUserId: "user_leaving", role: "owner" }];
    rows.players = [player(10, 1, "user_leaving", 1), player(11, 1, "user_next", 4)];
    await deleteLeagueDataFor(tx(), "user_leaving", { 1: 10 });
    expect(adminsOf(1)).toEqual([{ clerkUserId: "user_next", role: "owner" }]);
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: usersRouter } = await import("../routes/users.js");
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

describe("GET /api/users/me/league-handoff", () => {
  it("lists active leagues run alone, with who could take over, longest-standing first", async () => {
    rows.leagues = [
      { id: 1, name: "Tuesday Flex", createdByClerkUserId: "user_leaving", endedAt: null },
      { id: 2, name: "Shared", createdByClerkUserId: "user_leaving", endedAt: null },
      { id: 3, name: "Ended", createdByClerkUserId: "user_leaving", endedAt: jan(20) },
      { id: 4, name: "Nobody else", createdByClerkUserId: "user_leaving", endedAt: null },
    ];
    rows.league_admins = [
      { id: 1, leagueId: 1, clerkUserId: "user_leaving", role: "owner" },
      { id: 2, leagueId: 2, clerkUserId: "user_leaving", role: "owner" },
      { id: 3, leagueId: 2, clerkUserId: "user_co", role: "co_admin" },
      { id: 4, leagueId: 3, clerkUserId: "user_leaving", role: "owner" },
      { id: 5, leagueId: 4, clerkUserId: "user_leaving", role: "owner" },
    ];
    rows.players = [
      player(1, 1, "user_leaving", 1),
      player(12, 1, "user_newer", 8),
      player(11, 1, "user_longest", 3),
      player(13, 1, null, 2),
      player(31, 3, "user_x", 1),
    ];
    const res = await supertest(await buildApp()).get("/api/users/me/league-handoff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      leagues: [
        {
          leagueId: 1,
          name: "Tuesday Flex",
          members: [
            { playerId: 11, name: "Player 11", joinedAt: jan(3).toISOString() },
            { playerId: 12, name: "Player 12", joinedAt: jan(8).toISOString() },
          ],
        },
      ],
    });
  });

  it("requires sign-in", async () => {
    mockUserId = null;
    const res = await supertest(await buildApp()).get("/api/users/me/league-handoff");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/users/me with new admins", () => {
  it("passes the picked admins through to the deletion", async () => {
    const res = await supertest(await buildApp())
      .delete("/api/users/me")
      .send({ confirm: "DELETE", newAdmins: [{ leagueId: 1, playerId: 11 }, { leagueId: "bad" }] });
    expect(res.status).toBe(200);
    expect(deleteAccountMock).toHaveBeenCalledWith("user_leaving", expect.anything(), {}, { newAdmins: { 1: 11 } });
  });

  it("still deletes when the person skipped every pick", async () => {
    const res = await supertest(await buildApp()).delete("/api/users/me").send({ confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(deleteAccountMock).toHaveBeenCalledWith("user_leaving", expect.anything(), {}, { newAdmins: {} });
  });
});
