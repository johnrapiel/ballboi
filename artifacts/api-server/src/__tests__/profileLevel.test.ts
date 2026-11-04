import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import type { Row } from "./fakeDb";

// Wave 1 review A1, S6, C7: the profile is the one source of a signed-up
// player's name and level. Rosters, join requests, pairings and Manage read the
// current profile through the player's account; the copy on the league row is
// used only for placeholder players an admin added. Nobody changes a signed-up
// player's level from a league (the player changes it in Edit profile), and a
// placeholder's admin-set level gives way to the claimer's own level.

let mockUserId: string | null = "user_admin";
const getUser = vi.fn();
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: (id: string) => getUser(id), getUserList: vi.fn() } },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const rows: Record<string, Row[]> = {};
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguesTable: table("leagues", ["id", "name", "createdByClerkUserId", "visibility", "format", "seasonWeeks", "startDate"]),
    playersTable: table("players", ["id", "leagueId", "clerkUserId", "name", "email", "skillLevel", "leftAt"]),
    usersTable: table("users", ["clerkUserId", "displayName", "avatarUrl", "rating", "ratingSource"]),
    leagueAdminsTable: table("league_admins", ["id", "leagueId", "clerkUserId", "role"]),
    leagueJoinRequestsTable: table("league_join_requests", ["id", "leagueId", "clerkUserId", "playerName", "skillLevel", "kind", "status", "createdAt"]),
    matchesTable: table("matches", ["id", "leagueId", "roundId", "player1Id", "player2Id", "locked", "voidedAt", "playoffBracketId"]),
    leagueRoundsTable: table("league_rounds", ["id", "leagueId"]),
    leagueRoundByesTable: table("league_round_byes", ["id", "roundId", "playerId", "setByAdmin"]),
    playerAvailabilityTable: table("player_availability", ["id", "playerId", "leagueId", "weekOf", "slots"]),
    playoffBracketsTable: table("playoff_brackets", ["id", "leagueId"]),
    matchInvitesTable: table("match_invites", ["code", "placeholderPlayerId"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);
vi.mock("@workspace/api-zod", () => ({
  UpdatePlayerBody: { safeParse: (v: unknown) => ({ success: true, data: v }) },
}));
vi.mock("../lib/blocks.js", () => ({ blockedAccountsFor: async () => new Set<string>() }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/seasonService.js", () => ({ getAutoSeason: vi.fn().mockResolvedValue(null) }));
vi.mock("../services/leaguePlayoffs.js", () => ({ startPlayoffs: vi.fn() }));
vi.mock("../lib/profilePhoto.js", () => ({ newPhotoProblem: async () => null, deleteOldPhoto: async () => undefined }));
vi.mock("../lib/accountDeletion.js", () => ({ deleteAccount: vi.fn() }));

async function app() {
  const routers = await Promise.all([
    import("../routes/leagueAdmins.js"),
    import("../routes/leagueMembership.js"),
    import("../routes/players.js"),
    import("../routes/users.js"),
  ]);
  const a = express();
  a.use(express.json());
  for (const r of routers) a.use("/api", r.default);
  return supertest(a);
}

type Roster = { playerId: number; name: string; skillLevel: string; rating: { rating: number; source: string } | null; hasAccount: boolean };

async function roster(): Promise<Roster[]> {
  const res = await (await app()).get("/api/leagues/1/roster");
  expect(res.status).toBe(200);
  return res.body;
}

const byId = (list: Roster[], id: number) => list.find((p) => p.playerId === id)!;

// League 1 is a Flex league run by user_admin. Alex joined with the old app,
// which sent the email prefix "akim" and no level, so the row says 3.0. Alex's
// profile says "Alex Kim", 4.5 self-rated. Una is a placeholder the admin added.
beforeEach(() => {
  mockUserId = "user_admin";
  getUser.mockReset();
  for (const k of Object.keys(rows)) delete rows[k];
  Object.assign(rows, {
    leagues: [{ id: 1, name: "Tuesday Flex", createdByClerkUserId: "user_admin", visibility: "private", format: "flex", seasonWeeks: 8, startDate: "2026-11-02" }],
    league_admins: [{ id: 1, leagueId: 1, clerkUserId: "user_admin", role: "owner" }],
    users: [
      { clerkUserId: "user_admin", displayName: "Ada Admin", avatarUrl: null, rating: 3.0, ratingSource: "self" },
      { clerkUserId: "user_alex", displayName: "Alex Kim", avatarUrl: "/objects/alex.jpg", rating: 4.5, ratingSource: "self" },
    ],
    players: ([
      { id: 10, leagueId: 1, clerkUserId: "user_admin", name: "Ada Admin", email: null, skillLevel: "3.0", leftAt: null },
      { id: 11, leagueId: 1, clerkUserId: "user_alex", name: "akim", email: null, skillLevel: "3.0", leftAt: null },
      { id: 12, leagueId: 1, clerkUserId: null, name: "Una Placeholder", email: "una@example.com", skillLevel: "3.0", leftAt: null },
    ] as Row[]).map((p) => ({ ...p, createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z") })),
    league_join_requests: [],
    matches: [],
    league_rounds: [],
    league_round_byes: [],
    player_availability: [],
    match_invites: [],
  });
});

describe("rosters and Manage read the current profile", () => {
  it("shows a signed-up player's profile name and level, never the copy on the league row", async () => {
    const alex = byId(await roster(), 11);
    expect(alex).toMatchObject({ name: "Alex Kim", skillLevel: "4.5", rating: { rating: 4.5, source: "self" }, hasAccount: true });
    expect(JSON.stringify(alex)).not.toContain("akim");
  });

  it("shows a placeholder's admin-set level with no source", async () => {
    expect(byId(await roster(), 12)).toMatchObject({ name: "Una Placeholder", skillLevel: "3.0", rating: null, hasAccount: false });
  });

  it("an Edit profile change shows in every league right away", async () => {
    rows.players.push({ id: 20, leagueId: 2, clerkUserId: "user_alex", name: "akim", email: null, skillLevel: "3.0", leftAt: null });
    rows.leagues.push({ id: 2, name: "Sunday Flex", createdByClerkUserId: "user_admin", visibility: "private", format: "flex", seasonWeeks: 8, startDate: "2026-11-02" });

    mockUserId = "user_alex";
    const api = await app();
    expect((await api.put("/api/users/me").send({ displayName: "Alex Kim-Lee" })).status).toBe(200);
    // Edit profile > Self-rated level saves to the profile (routes/ratings.ts).
    rows.users.find((u) => u.clerkUserId === "user_alex")!.rating = 3.5;

    mockUserId = "user_admin";
    expect(byId(await roster(), 11)).toMatchObject({ name: "Alex Kim-Lee", skillLevel: "3.5" });
    // The row copy that standings and scores read follows the profile in both leagues.
    expect(rows.players.filter((p) => p.clerkUserId === "user_alex").map((p) => p.name)).toEqual(["Alex Kim-Lee", "Alex Kim-Lee"]);
  });

  it("join requests show the asker's current profile name and level", async () => {
    rows.users.push({ clerkUserId: "user_req", displayName: "Riley Request", avatarUrl: null, rating: 4.0, ratingSource: "self" });
    rows.league_join_requests.push({
      id: 5, leagueId: 1, clerkUserId: "user_req", playerName: "riley", skillLevel: "3.0", kind: "request", status: "pending", createdAt: new Date("2026-11-01T12:00:00Z"),
    });
    const res = await (await app()).get("/api/leagues/1/join-requests");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ playerName: "Riley Request", skillLevel: "4.0", rating: { rating: 4, source: "self" } });
  });
});

describe("only the player sets their level", () => {
  it("refuses an admin's level change for a signed-up player and keeps the level", async () => {
    const res = await (await app()).patch("/api/players/11").send({ skillLevel: "3.0" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("This player sets their own level in Edit profile.");
    expect(byId(await roster(), 11).skillLevel).toBe("4.5");
  });

  it("refuses the player's own change there too: Edit profile is the only place", async () => {
    mockUserId = "user_alex";
    const res = await (await app()).patch("/api/players/11").send({ skillLevel: "5.0" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Change your level in Edit profile.");
    expect(rows.users.find((u) => u.clerkUserId === "user_alex")!.rating).toBe(4.5);
  });
});

describe("placeholder players", () => {
  it("use the admin-set level until claimed, then the claimer's own profile level", async () => {
    expect((await (await app()).patch("/api/players/12").send({ skillLevel: "4.0" })).status).toBe(200);
    expect(byId(await roster(), 12)).toMatchObject({ skillLevel: "4.0", rating: null, hasAccount: false });

    // Una signs up with the email the admin used, so her spot links to her account.
    rows.users.push({ clerkUserId: "user_una", displayName: "Una Ortiz", avatarUrl: null, rating: 2.5, ratingSource: "self" });
    getUser.mockResolvedValue({
      id: "user_una",
      primaryEmailAddressId: "e1",
      emailAddresses: [{ id: "e1", emailAddress: "una@example.com", verification: { status: "verified" } }],
    });
    const { autoLinkPlayersForUser } = await import("../lib/autoLinkPlayer.js");
    expect(await autoLinkPlayersForUser("user_una")).toBe(1);

    expect(byId(await roster(), 12)).toMatchObject({ name: "Una Ortiz", skillLevel: "2.5", rating: { rating: 2.5, source: "self" }, hasAccount: true });
    // Now it's hers: the admin can't change it.
    expect((await (await app()).patch("/api/players/12").send({ skillLevel: "4.0" })).status).toBe(403);
  });
});

describe("Flex pairing uses profile levels (C7)", () => {
  it("pairs players by their profile level, not the 3.0 on every league row", async () => {
    // Four players whose rows all say 3.0. Profiles: 3.0, 4.5, 3.0, 4.5.
    rows.users.push(
      { clerkUserId: "user_b", displayName: "Bo", avatarUrl: null, rating: 3.0, ratingSource: "self" },
      { clerkUserId: "user_d", displayName: "Di", avatarUrl: null, rating: 4.5, ratingSource: "self" },
    );
    rows.players = [
      { id: 1, leagueId: 1, clerkUserId: "user_admin", name: "Ada", skillLevel: "3.0", leftAt: null },
      { id: 2, leagueId: 1, clerkUserId: "user_alex", name: "akim", skillLevel: "3.0", leftAt: null },
      { id: 3, leagueId: 1, clerkUserId: "user_b", name: "Bo", skillLevel: "3.0", leftAt: null },
      { id: 4, leagueId: 1, clerkUserId: "user_d", name: "Di", skillLevel: "3.0", leftAt: null },
    ];
    const { repairRound } = await import("../services/leagueRounds.js");
    const league = rows.leagues[0] as never;
    await repairRound(league, { id: 9, leagueId: 1, roundNumber: 1, startDate: "2026-11-02", endDate: "2026-11-08", publishedAt: null } as never);

    const pairs = rows.matches.map((m) => [m.player1Id, m.player2Id].sort().join("-")).sort();
    expect(pairs).toEqual(["1-3", "2-4"]);
  });

  it("pairs a placeholder on the level its admin set", async () => {
    rows.players = [
      { id: 1, leagueId: 1, clerkUserId: "user_admin", name: "Ada", skillLevel: "4.5", leftAt: null },
      { id: 2, leagueId: 1, clerkUserId: "user_alex", name: "akim", skillLevel: "3.0", leftAt: null },
      { id: 3, leagueId: 1, clerkUserId: null, name: "Pat Placeholder", skillLevel: "3.0", leftAt: null },
      { id: 4, leagueId: 1, clerkUserId: null, name: "Sam Placeholder", skillLevel: "4.5", leftAt: null },
    ];
    const { repairRound } = await import("../services/leagueRounds.js");
    await repairRound(rows.leagues[0] as never, { id: 9, leagueId: 1, roundNumber: 1, startDate: "2026-11-02", endDate: "2026-11-08", publishedAt: null } as never);

    // Ada's profile says 3.0 (her row's 4.5 is ignored); Alex's says 4.5.
    const pairs = rows.matches.map((m) => [m.player1Id, m.player2Id].sort().join("-")).sort();
    expect(pairs).toEqual(["1-3", "2-4"]);
  });
});
