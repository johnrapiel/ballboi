/**
 * Integration tests: GET /players/:playerId/stats — streak values end-to-end
 *
 * Exercises the full HTTP handler with a mocked database, verifying that
 * `currentStreak` and `longestWinStreak` in the response are computed and
 * serialised correctly for a variety of match history shapes.
 *
 * Scenarios:
 *  1. Win streak   — N consecutive wins → currentStreak=+N, longestWinStreak=N
 *  2. Loss streak  — N consecutive losses → currentStreak=-N, longestWinStreak=0
 *  3. Alternating  — W-L-W-L → currentStreak=+1, longestWinStreak=1
 *  4. No matches   — empty history → currentStreak=0, longestWinStreak=0
 *  5. Null-winner  — tied/walkover/voided matches don't inflate wins, losses, or streaks
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => ({ userId: null }),
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
  playersTable: {
    id: {},
    clerkUserId: {},
    leagueId: {},
    name: {},
    email: {},
    phone: {},
    bio: {},
    wins: {},
    losses: {},
    skillLevel: {},
    dominantHand: {},
    dayBeforeMatchReminderEnabled: {},
    createdAt: {},
    updatedAt: {},
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
  leaguesTable: { id: {}, name: {}, status: {}, createdByClerkUserId: {} },
  scheduleGenerationLogsTable: { id: {}, leagueId: {}, weekOf: {}, status: {} },
  ballBoiSessionsTable: { id: {}, matchId: {}, createdAt: {} },
  matchStatisticsTable: { id: {}, matchId: {}, totalShots: {}, avgShotSpeedMph: {} },
}));

vi.mock("drizzle-orm", () => ({
  desc: (x: unknown) => x,
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
}));

vi.mock("@workspace/api-zod", () => ({
  UpdatePlayerBody: { safeParse: vi.fn(() => ({ success: true, data: {} })) },
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

async function buildApp() {
  const { default: playersRouter } = await import("../routes/players.js");
  const app = express();
  app.use(express.json());
  app.use("/api", playersRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

const PLAYER_ID = 42;
const OPPONENT_ID = 99;
const PARTNER_ID = 77;
const OPPONENT2_ID = 88;

const basePlayer = {
  id: PLAYER_ID,
  clerkUserId: "user_abc",
  leagueId: 1,
  name: "Alice",
  email: null,
  phone: null,
  bio: null,
  wins: 0,
  losses: 0,
  skillLevel: "intermediate",
  dominantHand: null,
  dayBeforeMatchReminderEnabled: false,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

const baseLeague = { id: 1, name: "Test League", status: "active", createdByClerkUserId: "admin" };

function makeMatch(id: number, winnerId: number | null, daysAgo: number) {
  const completedAt = new Date(Date.now() - daysAgo * 86_400_000);
  return {
    id,
    player1Id: PLAYER_ID,
    player2Id: OPPONENT_ID,
    player3Id: null,
    player4Id: null,
    leagueId: 1,
    status: "completed",
    scheduledAt: completedAt,
    completedAt,
    weekOf: "2025-01-06",
    winnerId,
    score: winnerId === PLAYER_ID ? "6-3, 6-4" : (winnerId === null ? null : "3-6, 4-6"),
    location: null,
    notes: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

/**
 * Doubles match where PLAYER_ID is player3 (team 1 with PARTNER_ID as player1).
 * Team 1 wins when winnerId === PARTNER_ID; team 2 wins when winnerId === OPPONENT_ID.
 */
function makeDoublesMatch(id: number, team1Won: boolean, daysAgo: number) {
  const completedAt = new Date(Date.now() - daysAgo * 86_400_000);
  const winnerId = team1Won ? PARTNER_ID : OPPONENT_ID;
  return {
    id,
    player1Id: PARTNER_ID,
    player2Id: OPPONENT_ID,
    player3Id: PLAYER_ID,
    player4Id: OPPONENT2_ID,
    leagueId: 1,
    status: "completed",
    scheduledAt: completedAt,
    completedAt,
    weekOf: "2025-01-06",
    winnerId,
    score: team1Won ? "6-3, 6-4" : "3-6, 4-6",
    location: null,
    notes: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

/**
 * Set up the select mock for the stats route.
 * DB call order:
 *   1. player lookup (single player)
 *   2. completed matches query
 *   3. player names lookup (only if matches exist)
 *   4. all leagues lookup
 *
 * When there are no matches, call 3 becomes the leagues lookup.
 */
function setupStatsMock(matches: Array<ReturnType<typeof makeMatch> | ReturnType<typeof makeDoublesMatch>>) {
  let selectCall = 0;
  mockDb.select.mockImplementation(() => {
    selectCall++;
    if (selectCall === 1) return mockChain([basePlayer]);
    if (selectCall === 2) return mockChain(matches);
    if (matches.length > 0) {
      if (selectCall === 3)
        return mockChain([
          basePlayer,
          { id: OPPONENT_ID, name: "Bob", leagueId: 1, clerkUserId: null },
        ]);
      if (selectCall === 4) return mockChain([baseLeague]);
    } else {
      if (selectCall === 3) return mockChain([baseLeague]);
    }
    return mockChain([]);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

// ---------------------------------------------------------------------------
// Streak scenarios
// ---------------------------------------------------------------------------

describe("GET /api/players/:playerId/stats — streak fields", () => {
  it("returns currentStreak=+3 and longestWinStreak=3 for three consecutive wins", async () => {
    const matches = [
      makeMatch(1, PLAYER_ID, 1),
      makeMatch(2, PLAYER_ID, 8),
      makeMatch(3, PLAYER_ID, 15),
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(3);
    expect(res.body.longestWinStreak).toBe(3);
  });

  it("returns currentStreak=-3 and longestWinStreak=0 for three consecutive losses", async () => {
    const matches = [
      makeMatch(1, OPPONENT_ID, 1),
      makeMatch(2, OPPONENT_ID, 8),
      makeMatch(3, OPPONENT_ID, 15),
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(-3);
    expect(res.body.longestWinStreak).toBe(0);
  });

  it("returns currentStreak=+1 and longestWinStreak=1 for alternating W-L-W-L", async () => {
    const matches = [
      makeMatch(1, PLAYER_ID, 1),   // newest — win
      makeMatch(2, OPPONENT_ID, 8), // loss
      makeMatch(3, PLAYER_ID, 15),  // win
      makeMatch(4, OPPONENT_ID, 22), // oldest — loss
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(1);
    expect(res.body.longestWinStreak).toBe(1);
  });

  it("returns currentStreak=0 and longestWinStreak=0 when there are no matches", async () => {
    setupStatsMock([]);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(0);
    expect(res.body.longestWinStreak).toBe(0);
  });

  it("tracks the longest win streak correctly when a loss interrupts a longer earlier streak", async () => {
    // History newest→oldest: L, W, W, W, L, W
    // Current streak: -1 (loss). Longest win streak: 3.
    const matches = [
      makeMatch(1, OPPONENT_ID, 1),  // newest — loss
      makeMatch(2, PLAYER_ID, 8),    // win
      makeMatch(3, PLAYER_ID, 15),   // win
      makeMatch(4, PLAYER_ID, 22),   // win
      makeMatch(5, OPPONENT_ID, 29), // loss
      makeMatch(6, PLAYER_ID, 36),   // oldest — win
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(-1);
    expect(res.body.longestWinStreak).toBe(3);
  });

  it("returns 404 when the player does not exist", async () => {
    let selectCall = 0;
    mockDb.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([]);
      return mockChain([]);
    });

    const res = await supertest(app).get(`/api/players/9999/stats`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it("includes the streak fields alongside the standard stats fields in the response", async () => {
    const matches = [makeMatch(1, PLAYER_ID, 1)];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("currentStreak");
    expect(res.body).toHaveProperty("longestWinStreak");
    expect(res.body).toHaveProperty("wins");
    expect(res.body).toHaveProperty("losses");
    expect(res.body).toHaveProperty("winRate");
    expect(res.body).toHaveProperty("totalMatches");
    expect(res.body.playerId).toBe(PLAYER_ID);
  });

  it("returns currentStreak=+1 and longestWinStreak=1 for a single win", async () => {
    const matches = [makeMatch(1, PLAYER_ID, 3)];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(1);
    expect(res.body.longestWinStreak).toBe(1);
  });

  it("returns currentStreak=-1 and longestWinStreak=0 for a single loss", async () => {
    const matches = [makeMatch(1, OPPONENT_ID, 3)];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(-1);
    expect(res.body.longestWinStreak).toBe(0);
  });

  it("counts a doubles win (player as player3 on the winning team) as a win", async () => {
    const matches = [makeDoublesMatch(1, true, 3)];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(0);
    expect(res.body.currentStreak).toBe(1);
    expect(res.body.longestWinStreak).toBe(1);
  });

  it("counts a doubles loss (player as player3 on the losing team) as a loss", async () => {
    const matches = [makeDoublesMatch(1, false, 3)];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.wins).toBe(0);
    expect(res.body.losses).toBe(1);
    expect(res.body.currentStreak).toBe(-1);
    expect(res.body.longestWinStreak).toBe(0);
  });

  it("computes correct streaks and record for a mixed singles/doubles history", async () => {
    // Chronological order (oldest → newest):
    //   1. singles win   (daysAgo=22)
    //   2. doubles win   (daysAgo=15)
    //   3. singles loss  (daysAgo=8)
    //   4. doubles loss  (daysAgo=1)  ← most recent
    //
    // DB returns newest-first, so array order below mirrors that.
    const matches = [
      makeDoublesMatch(4, false, 1),  // newest — doubles loss
      makeMatch(3, OPPONENT_ID, 8),   // singles loss
      makeDoublesMatch(2, true, 15),  // doubles win
      makeMatch(1, PLAYER_ID, 22),    // oldest — singles win
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.wins).toBe(2);
    expect(res.body.losses).toBe(2);
    // Two most-recent results are both losses → current loss streak of 2
    expect(res.body.currentStreak).toBe(-2);
    // The two oldest matches were consecutive wins → longest win streak of 2
    expect(res.body.longestWinStreak).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Null-winner (tied / walkover / admin-voided) scenarios
// ---------------------------------------------------------------------------

describe("GET /api/players/:playerId/stats — null-winner matches", () => {
  it("counts null-winner matches in totalMatches but not in wins or losses", async () => {
    // One win, one null-winner match (walkover/tie), one loss
    const matches = [
      makeMatch(1, PLAYER_ID, 1),  // win
      makeMatch(2, null, 8),       // null winner — should be ignored in wins/losses
      makeMatch(3, OPPONENT_ID, 15), // loss
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(3);
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(1);
  });

  it("does not count null-winner matches in win/loss streak calculations", async () => {
    // Newest-first: null (voided), win, win, loss
    // After filtering nulls: win, win, loss → currentStreak=+2, longestWinStreak=2
    const matches = [
      makeMatch(1, null, 1),       // most recent — null winner, must be ignored
      makeMatch(2, PLAYER_ID, 8),  // win
      makeMatch(3, PLAYER_ID, 15), // win
      makeMatch(4, OPPONENT_ID, 22), // loss
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(4);
    expect(res.body.wins).toBe(2);
    expect(res.body.losses).toBe(1);
    expect(res.body.currentStreak).toBe(2);
    expect(res.body.longestWinStreak).toBe(2);
  });

  it("returns wins=0, losses=0, currentStreak=0, longestWinStreak=0 when all matches have null winners", async () => {
    const matches = [
      makeMatch(1, null, 1),
      makeMatch(2, null, 8),
      makeMatch(3, null, 15),
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(3);
    expect(res.body.wins).toBe(0);
    expect(res.body.losses).toBe(0);
    expect(res.body.currentStreak).toBe(0);
    expect(res.body.longestWinStreak).toBe(0);
  });

  it("computes winRate as wins/(wins+losses), excluding null-winner matches from the denominator", async () => {
    // 2 wins, 1 null-winner (voided), 1 loss → winRate should be 2/3, not 2/4
    const matches = [
      makeMatch(1, PLAYER_ID, 1),    // win
      makeMatch(2, PLAYER_ID, 8),    // win
      makeMatch(3, null, 15),        // null — excluded from win-rate denominator
      makeMatch(4, OPPONENT_ID, 22), // loss
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(4);
    expect(res.body.wins).toBe(2);
    expect(res.body.losses).toBe(1);
    // winRate = 2 / (2+1) = 0.666…, not 2/4 = 0.5
    expect(res.body.winRate).toBeCloseTo(2 / 3, 5);
  });

  it("returns winRate=0 when all matches have null winners", async () => {
    const matches = [
      makeMatch(1, null, 1),
      makeMatch(2, null, 8),
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.wins).toBe(0);
    expect(res.body.losses).toBe(0);
    expect(res.body.winRate).toBe(0);
  });

  it("preserves the win streak when null-winner matches appear between wins", async () => {
    // Newest-first: win, null, win, win
    // After filtering nulls: win, win, win → currentStreak=+3, longestWinStreak=3
    const matches = [
      makeMatch(1, PLAYER_ID, 1),  // win
      makeMatch(2, null, 8),       // null — skipped
      makeMatch(3, PLAYER_ID, 15), // win
      makeMatch(4, PLAYER_ID, 22), // win
    ];
    setupStatsMock(matches);

    const res = await supertest(app).get(`/api/players/${PLAYER_ID}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.totalMatches).toBe(4);
    expect(res.body.wins).toBe(3);
    expect(res.body.losses).toBe(0);
    expect(res.body.currentStreak).toBe(3);
    expect(res.body.longestWinStreak).toBe(3);
  });
});
