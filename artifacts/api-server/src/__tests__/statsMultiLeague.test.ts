/**
 * Tests: multi-league invite schedule safety
 *
 * Covers an account that accepted invites into two different leagues, verifying:
 * - GET /stats/my-schedule returns the next upcoming match from either joined league
 * - GET /stats/my-matches returns matches from all invite-created player records
 * - Win/loss summary uses the match-specific player profile (correct playerId per match)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

const mockUserId = "user_multi_league";
let mockGetAuth = () => ({ userId: mockUserId });

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => mockGetAuth(),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  matchesTable: {
    id: {},
    player1Id: {},
    player2Id: {},
    player3Id: {},
    player4Id: {},
    leagueId: {},
    status: {},
    scheduledAt: {},
    completedAt: {},
    weekOf: {},
    winnerId: {},
    score: {},
    location: {},
    notes: {},
    createdAt: {},
    updatedAt: {},
  },
  playersTable: { id: {}, clerkUserId: {}, leagueId: {}, name: {}, wins: {}, losses: {}, skillLevel: {} },
  leaguesTable: { id: {}, name: {}, status: {} },
  scheduleGenerationLogsTable: { id: {}, leagueId: {}, weekOf: {}, status: {} },
  ballBoiSessionsTable: { id: {}, matchId: {}, createdAt: {} },
  matchStatisticsTable: { id: {}, matchId: {}, totalShots: {}, avgShotSpeedMph: {} },
  leagueRoundsTable: { id: {}, leagueId: {}, roundNumber: {}, startDate: {}, endDate: {}, status: {}, createdAt: {} },
}));

vi.mock("drizzle-orm", () => ({
  desc: (x: unknown) => x,
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
}));

async function buildApp() {
  const { default: statsRouter } = await import("../routes/stats.js");
  const app = express();
  app.use(express.json());
  app.use("/api", statsRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

// Shared fixture data
const leagueA = { id: 10, name: "League Alpha", status: "active" };
const leagueB = { id: 20, name: "League Beta", status: "active" };

// The same Clerk user has two player profiles — one per league (invite-created)
const playerInLeagueA = { id: 101, clerkUserId: mockUserId, leagueId: 10, name: "Alice (Alpha)", wins: 3, losses: 1, skillLevel: "intermediate" };
const playerInLeagueB = { id: 202, clerkUserId: mockUserId, leagueId: 20, name: "Alice (Beta)",  wins: 1, losses: 2, skillLevel: "intermediate" };

const opponentA = { id: 102, clerkUserId: null, leagueId: 10, name: "Bob", wins: 2, losses: 2, skillLevel: "intermediate" };
const opponentB = { id: 203, clerkUserId: null, leagueId: 20, name: "Carol", wins: 0, losses: 3, skillLevel: "beginner" };

const allPlayers = [playerInLeagueA, playerInLeagueB, opponentA, opponentB];
const allLeagues = [leagueA, leagueB];

// Current Monday in YYYY-MM-DD (mirrors the server-side calculation)
function currentWeekOf(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetAuth = () => ({ userId: mockUserId });
  app = await buildApp();
});

// ---------------------------------------------------------------------------
// GET /stats/my-schedule — multi-league
// ---------------------------------------------------------------------------
describe("GET /api/stats/my-schedule — multi-league account", () => {
  it("returns the upcoming match from League A when player is scheduled there this week", async () => {
    const weekOf = currentWeekOf();
    const matchInLeagueA = {
      id: 1001,
      player1Id: playerInLeagueA.id,
      player2Id: opponentA.id,
      player3Id: null,
      player4Id: null,
      leagueId: leagueA.id,
      status: "scheduled",
      scheduledAt: futureIso(2),
      completedAt: null,
      weekOf,
      winnerId: null,
      score: null,
      location: "Court 1",
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      // 1: players for this userId
      if (selectCall === 1) return mockChain([playerInLeagueA, playerInLeagueB]);
      // 2: confirmed schedule logs for current weekOf
      if (selectCall === 2) return mockChain([{ id: 1, leagueId: leagueA.id, weekOf, status: "confirmed" }]);
      // 3: weekOf matches
      if (selectCall === 3) return mockChain([matchInLeagueA]);
      // 4: all leagues
      if (selectCall === 4) return mockChain(allLeagues);
      // 5: all players
      if (selectCall === 5) return mockChain(allPlayers);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/stats/my-schedule");

    expect(res.status).toBe(200);
    expect(res.body.playerIds).toContain(playerInLeagueA.id);
    expect(res.body.playerIds).toContain(playerInLeagueB.id);
    expect(res.body.match).not.toBeNull();
    expect(res.body.match.matchId).toBe(matchInLeagueA.id);
    expect(res.body.match.leagueName).toBe(leagueA.name);
    expect(res.body.match.playerId).toBe(playerInLeagueA.id);
    expect(res.body.match.opponentName).toBe(opponentA.name);
  });

  it("returns the upcoming match from League B when only a League B match exists this week", async () => {
    const weekOf = currentWeekOf();
    const matchInLeagueB = {
      id: 2001,
      player1Id: opponentB.id,
      player2Id: playerInLeagueB.id,
      player3Id: null,
      player4Id: null,
      leagueId: leagueB.id,
      status: "scheduled",
      scheduledAt: futureIso(4),
      completedAt: null,
      weekOf,
      winnerId: null,
      score: null,
      location: "Court 3",
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([playerInLeagueA, playerInLeagueB]);
      if (selectCall === 2) return mockChain([{ id: 2, leagueId: leagueB.id, weekOf, status: "confirmed" }]);
      if (selectCall === 3) return mockChain([matchInLeagueB]);
      if (selectCall === 4) return mockChain(allLeagues);
      if (selectCall === 5) return mockChain(allPlayers);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/stats/my-schedule");

    expect(res.status).toBe(200);
    expect(res.body.match).not.toBeNull();
    expect(res.body.match.matchId).toBe(matchInLeagueB.id);
    expect(res.body.match.leagueName).toBe(leagueB.name);
    // player2Id is the user's profile in this match
    expect(res.body.match.playerId).toBe(playerInLeagueB.id);
    expect(res.body.match.opponentName).toBe(opponentB.name);
  });

  it("returns null match when neither league has a match this week", async () => {
    const weekOf = currentWeekOf();

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([playerInLeagueA, playerInLeagueB]);
      if (selectCall === 2) return mockChain([
        { id: 1, leagueId: leagueA.id, weekOf, status: "confirmed" },
        { id: 2, leagueId: leagueB.id, weekOf, status: "confirmed" },
      ]);
      // No matches this week for either league
      if (selectCall === 3) return mockChain([]);
      // Fallback query also returns nothing
      if (selectCall === 4) return mockChain([]);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/stats/my-schedule");

    expect(res.status).toBe(200);
    expect(res.body.match).toBeNull();
    expect(res.body.playerIds).toHaveLength(2);
  });

  it("returns 200 with empty playerIds when user has no player profiles", async () => {
    mockDb.select.mockImplementation(() => mockChain([]));

    const res = await supertest(app).get("/api/stats/my-schedule");

    expect(res.status).toBe(200);
    expect(res.body.playerId).toBeNull();
    expect(res.body.playerIds).toEqual([]);
    expect(res.body.match).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /stats/my-matches — multi-league
// ---------------------------------------------------------------------------
describe("GET /api/stats/my-matches — multi-league account", () => {
  const completedMatchLeagueA = {
    id: 3001,
    player1Id: playerInLeagueA.id,
    player2Id: opponentA.id,
    player3Id: null,
    player4Id: null,
    leagueId: leagueA.id,
    status: "completed",
    scheduledAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    completedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    weekOf: "2025-01-06",
    winnerId: playerInLeagueA.id,
    score: "6-3, 6-4",
    location: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const completedMatchLeagueB = {
    id: 4001,
    player1Id: opponentB.id,
    player2Id: playerInLeagueB.id,
    player3Id: null,
    player4Id: null,
    leagueId: leagueB.id,
    status: "completed",
    scheduledAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    completedAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    weekOf: "2024-12-30",
    winnerId: opponentB.id,
    score: "6-1, 6-2",
    location: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const upcomingMatchLeagueB = {
    id: 5001,
    player1Id: playerInLeagueB.id,
    player2Id: opponentB.id,
    player3Id: null,
    player4Id: null,
    leagueId: leagueB.id,
    status: "scheduled",
    scheduledAt: futureIso(48),
    completedAt: null,
    weekOf: currentWeekOf(),
    winnerId: null,
    score: null,
    location: "Court 5",
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function setupSelectMock(allMatches: unknown[]) {
    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      // 1: players linked to userId
      if (selectCall === 1) return mockChain([playerInLeagueA, playerInLeagueB]);
      // 2: matches for all linked playerIds
      if (selectCall === 2) return mockChain(allMatches);
      // 3: leagues
      if (selectCall === 3) return mockChain(allLeagues);
      // 4: players (for names)
      if (selectCall === 4) return mockChain(allPlayers);
      // 5: ballBoi sessions
      if (selectCall === 5) return mockChain([]);
      // 6: match statistics
      if (selectCall === 6) return mockChain([]);
      return mockChain([]);
    });
  }

  it("includes matches from both leagues in the response", async () => {
    setupSelectMock([completedMatchLeagueA, completedMatchLeagueB, upcomingMatchLeagueB]);

    const res = await supertest(app).get("/api/stats/my-matches");

    expect(res.status).toBe(200);
    expect(res.body.playerIds).toContain(playerInLeagueA.id);
    expect(res.body.playerIds).toContain(playerInLeagueB.id);

    const allMatchIds = [
      ...res.body.upcoming.map((m: { matchId: number }) => m.matchId),
      ...res.body.past.map((m: { matchId: number }) => m.matchId),
    ];
    expect(allMatchIds).toContain(completedMatchLeagueA.id);
    expect(allMatchIds).toContain(completedMatchLeagueB.id);
    expect(allMatchIds).toContain(upcomingMatchLeagueB.id);
  });

  it("assigns the correct match-specific playerId for League A matches", async () => {
    setupSelectMock([completedMatchLeagueA]);

    const res = await supertest(app).get("/api/stats/my-matches");

    expect(res.status).toBe(200);
    const pastMatch = res.body.past.find((m: { matchId: number }) => m.matchId === completedMatchLeagueA.id);
    expect(pastMatch).toBeDefined();
    // The user was player1 in this match (League A profile)
    expect(pastMatch.playerId).toBe(playerInLeagueA.id);
    expect(pastMatch.leagueName).toBe(leagueA.name);
  });

  it("assigns the correct match-specific playerId for League B matches", async () => {
    setupSelectMock([completedMatchLeagueB]);

    const res = await supertest(app).get("/api/stats/my-matches");

    expect(res.status).toBe(200);
    const pastMatch = res.body.past.find((m: { matchId: number }) => m.matchId === completedMatchLeagueB.id);
    expect(pastMatch).toBeDefined();
    // The user was player2 in this match (League B profile)
    expect(pastMatch.playerId).toBe(playerInLeagueB.id);
    expect(pastMatch.leagueName).toBe(leagueB.name);
  });

  it("correctly identifies a win in League A using the League A player profile", async () => {
    setupSelectMock([completedMatchLeagueA]);

    const res = await supertest(app).get("/api/stats/my-matches");

    const pastMatch = res.body.past.find((m: { matchId: number }) => m.matchId === completedMatchLeagueA.id);
    expect(pastMatch).toBeDefined();
    // winnerId === playerInLeagueA.id (the match-specific profile) means the user won
    expect(pastMatch.winnerId).toBe(playerInLeagueA.id);
    expect(pastMatch.playerId).toBe(playerInLeagueA.id);
  });

  it("correctly identifies a loss in League B using the League B player profile", async () => {
    setupSelectMock([completedMatchLeagueB]);

    const res = await supertest(app).get("/api/stats/my-matches");

    const pastMatch = res.body.past.find((m: { matchId: number }) => m.matchId === completedMatchLeagueB.id);
    expect(pastMatch).toBeDefined();
    // winnerId === opponentB.id, user's League B profile is player2 → user lost
    expect(pastMatch.winnerId).toBe(opponentB.id);
    expect(pastMatch.playerId).toBe(playerInLeagueB.id);
  });

  it("separates upcoming matches from past matches correctly across leagues", async () => {
    setupSelectMock([completedMatchLeagueA, completedMatchLeagueB, upcomingMatchLeagueB]);

    const res = await supertest(app).get("/api/stats/my-matches");

    expect(res.status).toBe(200);
    expect(res.body.upcoming).toHaveLength(1);
    expect(res.body.upcoming[0].matchId).toBe(upcomingMatchLeagueB.id);
    expect(res.body.past).toHaveLength(2);
    const pastIds = res.body.past.map((m: { matchId: number }) => m.matchId);
    expect(pastIds).toContain(completedMatchLeagueA.id);
    expect(pastIds).toContain(completedMatchLeagueB.id);
  });

  it("returns empty arrays when user has no matches in either league", async () => {
    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([playerInLeagueA, playerInLeagueB]);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/stats/my-matches");

    expect(res.status).toBe(200);
    expect(res.body.upcoming).toEqual([]);
    expect(res.body.past).toEqual([]);
    expect(res.body.playerIds).toHaveLength(2);
  });

  it("returns empty state when user has no linked player profiles", async () => {
    mockDb.select.mockImplementation(() => mockChain([]));

    const res = await supertest(app).get("/api/stats/my-matches");

    expect(res.status).toBe(200);
    expect(res.body.playerId).toBeNull();
    expect(res.body.playerIds).toEqual([]);
    expect(res.body.upcoming).toEqual([]);
    expect(res.body.past).toEqual([]);
  });

  it("returns data that allows computing a correct W-L summary across both leagues", async () => {
    // League A: user wins. League B: user loses.
    // The summary (wins=1, losses=1) can only be correct if each match exposes
    // the match-specific playerId so the caller can compare it with winnerId.
    setupSelectMock([completedMatchLeagueA, completedMatchLeagueB]);

    const res = await supertest(app).get("/api/stats/my-matches");

    expect(res.status).toBe(200);
    const past: Array<{ matchId: number; playerId: number; winnerId: number | null }> = res.body.past;

    // Replicate getResultForMe logic used in MyMatches.tsx
    function getResultForMe(m: typeof past[0], opponentId: number): "win" | "loss" | null {
      if (m.winnerId == null) return null;
      const myTeamAnchorId = opponentId === (m as unknown as { player2Id: number }).player2Id
        ? (m as unknown as { player1Id: number }).player1Id
        : (m as unknown as { player2Id: number }).player2Id;
      return m.winnerId === m.playerId || m.winnerId === myTeamAnchorId ? "win" : "loss";
    }

    const leagueAMatch = past.find((m) => m.matchId === completedMatchLeagueA.id)!;
    const leagueBMatch = past.find((m) => m.matchId === completedMatchLeagueB.id)!;

    expect(leagueAMatch).toBeDefined();
    expect(leagueBMatch).toBeDefined();

    // League A win: winnerId === playerInLeagueA.id, playerId === playerInLeagueA.id
    expect(leagueAMatch.winnerId).toBe(playerInLeagueA.id);
    expect(leagueAMatch.playerId).toBe(playerInLeagueA.id);
    const resultA = leagueAMatch.winnerId === leagueAMatch.playerId ? "win" : "loss";
    expect(resultA).toBe("win");

    // League B loss: winnerId === opponentB.id, playerId === playerInLeagueB.id
    expect(leagueBMatch.winnerId).toBe(opponentB.id);
    expect(leagueBMatch.playerId).toBe(playerInLeagueB.id);
    const resultB = leagueBMatch.winnerId === leagueBMatch.playerId ? "win" : "loss";
    expect(resultB).toBe("loss");

    // Summary across both leagues: 1 win, 1 loss
    const allCompleted = past.filter((m) => m.winnerId != null);
    const wins = allCompleted.filter((m) => m.winnerId === m.playerId).length;
    const losses = allCompleted.length - wins;
    expect(wins).toBe(1);
    expect(losses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /stats/my-schedule — both leagues have matches this week
// ---------------------------------------------------------------------------
describe("GET /api/stats/my-schedule — both leagues have upcoming matches", () => {
  it("returns the soonest upcoming match when both leagues have one scheduled this week", async () => {
    const weekOf = currentWeekOf();
    const soonerMatchLeagueA = {
      id: 6001,
      player1Id: playerInLeagueA.id,
      player2Id: opponentA.id,
      player3Id: null,
      player4Id: null,
      leagueId: leagueA.id,
      status: "scheduled",
      scheduledAt: futureIso(1),
      completedAt: null,
      weekOf,
      winnerId: null,
      score: null,
      location: "Court 1",
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const laterMatchLeagueB = {
      id: 7001,
      player1Id: playerInLeagueB.id,
      player2Id: opponentB.id,
      player3Id: null,
      player4Id: null,
      leagueId: leagueB.id,
      status: "scheduled",
      scheduledAt: futureIso(6),
      completedAt: null,
      weekOf,
      winnerId: null,
      score: null,
      location: "Court 5",
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([playerInLeagueA, playerInLeagueB]);
      if (selectCall === 2) return mockChain([
        { id: 1, leagueId: leagueA.id, weekOf, status: "confirmed" },
        { id: 2, leagueId: leagueB.id, weekOf, status: "confirmed" },
      ]);
      // Return matches ordered soonest-first (as the DB query does)
      if (selectCall === 3) return mockChain([soonerMatchLeagueA, laterMatchLeagueB]);
      if (selectCall === 4) return mockChain(allLeagues);
      if (selectCall === 5) return mockChain(allPlayers);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/stats/my-schedule");

    expect(res.status).toBe(200);
    expect(res.body.match).not.toBeNull();
    // The sooner League A match should be selected
    expect(res.body.match.matchId).toBe(soonerMatchLeagueA.id);
    expect(res.body.match.leagueName).toBe(leagueA.name);
    expect(res.body.match.playerId).toBe(playerInLeagueA.id);
  });

  it("prefers an in-progress match over a sooner-scheduled one from the other league", async () => {
    const weekOf = currentWeekOf();
    const inProgressLeagueB = {
      id: 8001,
      player1Id: opponentB.id,
      player2Id: playerInLeagueB.id,
      player3Id: null,
      player4Id: null,
      leagueId: leagueB.id,
      status: "in_progress",
      scheduledAt: futureIso(-1),
      completedAt: null,
      weekOf,
      winnerId: null,
      score: null,
      location: "Court 3",
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const scheduledLeagueA = {
      id: 9001,
      player1Id: playerInLeagueA.id,
      player2Id: opponentA.id,
      player3Id: null,
      player4Id: null,
      leagueId: leagueA.id,
      status: "scheduled",
      scheduledAt: futureIso(2),
      completedAt: null,
      weekOf,
      winnerId: null,
      score: null,
      location: "Court 1",
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([playerInLeagueA, playerInLeagueB]);
      if (selectCall === 2) return mockChain([
        { id: 1, leagueId: leagueA.id, weekOf, status: "confirmed" },
        { id: 2, leagueId: leagueB.id, weekOf, status: "confirmed" },
      ]);
      // in_progress match listed first since DB orders by scheduledAt ascending
      if (selectCall === 3) return mockChain([inProgressLeagueB, scheduledLeagueA]);
      if (selectCall === 4) return mockChain(allLeagues);
      if (selectCall === 5) return mockChain(allPlayers);
      return mockChain([]);
    });

    const res = await supertest(app).get("/api/stats/my-schedule");

    expect(res.status).toBe(200);
    expect(res.body.match).not.toBeNull();
    // in_progress takes priority over scheduled regardless of league
    expect(res.body.match.matchId).toBe(inProgressLeagueB.id);
    expect(res.body.match.status).toBe("in_progress");
    expect(res.body.match.playerId).toBe(playerInLeagueB.id);
  });
});
