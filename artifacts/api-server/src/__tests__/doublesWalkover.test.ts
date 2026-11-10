import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Doubles W/O and double default in regular play (John, Nov 9), and RET still working.

let mockUserId: string | null = "user_a";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type Call = { method: string; args: unknown[] };
const chain = (value: unknown, calls?: Call[]) => {
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

const mockDb = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn() };
const table = new Proxy({}, { get: (_t, p) => ({ col: String(p) }) });
// The league lookup (has it ended?) answers from mockLeague, so each test's
// select sequence covers only matches and players.
const leaguesTable = new Proxy({}, { get: (_t, p) => ({ col: String(p) }) });
let mockLeague: Record<string, unknown> = {};
const db = {
  ...mockDb,
  update: (...a: unknown[]) => mockDb.update(...a),
  insert: (...a: unknown[]) => mockDb.insert(...a),
  transaction: (...a: unknown[]) => mockDb.transaction(...a),
  select: (...a: unknown[]) => ({
    from: (t: unknown) => (t === leaguesTable ? chain([mockLeague]) : mockDb.select(...a).from(t)),
  }),
};
vi.mock("@workspace/db", () => ({
  get db() {
    return db;
  },
  leagueRoundsTable: table,
  get leaguesTable() {
    return leaguesTable;
  },
  matchesTable: table,
  playersTable: table,
  usersTable: table,
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: () => ({}),
  isNull: () => ({}),
  ne: () => ({}),
  sql: Object.assign((..._a: unknown[]) => ({ sql: true }), { raw: () => ({}) }),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/playoffBracket.js", () => ({ advancePlayoffWinner: vi.fn() }));
vi.mock("../services/leaguePlayoffs.js", () => ({ advancePlayoff: vi.fn() }));
vi.mock("../services/leagueRounds.js", () => ({ usesWeeklyRounds: () => true }));
const closeChatForScore = vi.fn();
vi.mock("../services/doublesChat.js", () => ({ closeChatForScore: (...a: unknown[]) => closeChatForScore(...a) }));
let mockIsAdmin = true;
vi.mock("../middlewares/requireLeagueAdmin.js", () => ({
  requireLeagueAdmin: (req: { params: { leagueId: string } }, res: { locals: Record<string, unknown>; status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!mockIsAdmin) return res.status(403).json({ error: "Only this league's admins can do that" });
    res.locals.leagueId = Number(req.params.leagueId);
    next();
  },
}));

async function buildApp() {
  const { default: router } = await import("../routes/leagueScores.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

import { resolveMatchResult } from "../lib/leagueScoring.js";
import { computeStandings, computeTeamStandings, type StandingMatch } from "../lib/leagueStandings.js";
import { careerStats } from "../lib/career.js";

// A doubles match: team 1 is players 10 and 30, team 2 is 20 and 40.
const doubles = (over: Record<string, unknown> = {}) => ({
  id: 7,
  leagueId: 1,
  roundId: null,
  player1Id: 10,
  player2Id: 20,
  player3Id: 30,
  player4Id: 40,
  team1Id: 1,
  team2Id: 2,
  status: "scheduled",
  score: null,
  winnerId: null,
  voidedAt: null,
  playoffBracketId: null,
  playoffRound: null,
  playoffSlot: null,
  inGrace: false,
  recordedAt: null,
  recordedByClerkUserId: null,
  correctedAt: null,
  ...over,
});

const four = [
  { id: 10, name: "John Rapiel" },
  { id: 30, name: "Sam Lee" },
  { id: 20, name: "Jo Park" },
  { id: 40, name: "Lee King" },
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(mockDb)) fn.mockReset();
  mockUserId = "user_b";
  mockIsAdmin = true;
  mockLeague = { id: 1, endedAt: null, status: "active", startDate: "2026-10-01", seasonWeeks: 8, timeZone: "America/New_York" };
});

describe("resolveMatchResult", () => {
  const m = doubles();
  it("gives a doubles W/O to the complete team, from any player", () => {
    expect(resolveMatchResult(m, { walkoverWinnerId: 20 }, 1)).toEqual({ ok: true, score: "W/O", winnerSide: 2 });
    expect(resolveMatchResult(m, { walkoverWinnerId: 10 }, 2)).toEqual({ ok: true, score: "W/O", winnerSide: 1 });
  });
  it("records a double default with no winner", () => {
    expect(resolveMatchResult(m, { doubleDefault: true }, 2)).toEqual({ ok: true, score: "Double default", winnerSide: null });
  });
  it("refuses a W/O to someone who isn't a team's first player", () => {
    expect(resolveMatchResult(m, { walkoverWinnerId: 30 }, 1)).toMatchObject({ ok: false, error: "Pick one of the two teams for the walkover." });
  });
  it("refuses W/O and double default together, or W/O with RET", () => {
    expect(resolveMatchResult(m, { walkoverWinnerId: 10, doubleDefault: true }, 1).ok).toBe(false);
    expect(resolveMatchResult(m, { walkoverWinnerId: 10, retired: true }, 1).ok).toBe(false);
  });
  it("keeps singles regular play on scores only", () => {
    const singles = doubles({ player3Id: null, player4Id: null });
    expect(resolveMatchResult(singles, { walkoverWinnerId: 10 }, 1).ok).toBe(false);
    expect(resolveMatchResult(singles, { doubleDefault: true }, 1).ok).toBe(false);
  });
  it("still reads RET from the caller's side", () => {
    expect(resolveMatchResult(m, { score: "6-3, 2-1", retired: true }, 2)).toEqual({ ok: true, score: "3-6, 1-2 RET", winnerSide: 2 });
  });
});

describe("POST /api/leagues/:leagueId/matches/:matchId/score for doubles", () => {
  const caller = [{ id: 20, name: "Jo Park" }];

  it("records a W/O for the complete team, credits that team in the records, and posts it in the chat", async () => {
    const sets: Call[] = [];
    mockDb.select
      .mockReturnValueOnce(chain([doubles()]))
      .mockReturnValueOnce(chain(caller))
      .mockReturnValue(chain(four));
    mockDb.update.mockReturnValue(chain([{ ...doubles(), status: "completed", score: "W/O", winnerId: 20 }], sets));
    const txUpdates: Call[] = [];
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ update: () => chain(undefined, txUpdates) }));

    // Jo's team showed up complete; John's team was a player short.
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({ walkoverWinnerId: 20 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ score: "W/O", winnerId: 20, countsForStandings: true });
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ status: "completed", score: "W/O", winnerId: 20 });
    // One win update for Jo and Lee, one loss update for John and Sam.
    expect(txUpdates.filter((c) => c.method === "set")).toHaveLength(2);
    expect(closeChatForScore).toHaveBeenCalledWith(7, "Jo P. & Lee K. def. John R. & Sam L. W/O");
  });

  it("records a double default: no winner, no records moved, a plain line in the chat", async () => {
    const sets: Call[] = [];
    mockDb.select
      .mockReturnValueOnce(chain([doubles()]))
      .mockReturnValueOnce(chain(caller))
      .mockReturnValue(chain(four));
    mockDb.update.mockReturnValue(chain([{ ...doubles(), status: "completed", score: "Double default", winnerId: null }], sets));

    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({ doubleDefault: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ score: "Double default", winnerId: null, countsForStandings: false });
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ status: "completed", score: "Double default", winnerId: null });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(closeChatForScore).toHaveBeenCalledWith(7, "Double default: John R. & Sam L. and Jo P. & Lee K.");
  });

  it("still takes RET in doubles as a win for the team entering it", async () => {
    const sets: Call[] = [];
    mockDb.select
      .mockReturnValueOnce(chain([doubles()]))
      .mockReturnValueOnce(chain(caller))
      .mockReturnValue(chain(four));
    mockDb.update.mockReturnValue(chain([{ ...doubles(), status: "completed", score: "3-6, 1-2 RET", winnerId: 20 }], sets));
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ update: () => chain(undefined) }));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({ score: "6-3, 2-1", retired: true });
    expect(res.status).toBe(201);
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ score: "3-6, 1-2 RET", winnerId: 20 });
    expect(closeChatForScore).toHaveBeenCalledWith(7, "Jo P. & Lee K. def. John R. & Sam L. 6-3, 2-1 RET");
  });

  it("refuses a W/O in a singles regular-play match", async () => {
    mockDb.select
      .mockReturnValueOnce(chain([doubles({ player3Id: null, player4Id: null })]))
      .mockReturnValueOnce(chain(caller));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({ walkoverWinnerId: 20 });
    expect(res.status).toBe(400);
  });

  it("refuses an empty entry", async () => {
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/leagues/:leagueId/matches/:matchId/score/edit for doubles", () => {
  const people = [
    { id: 10, name: "John Rapiel", clerkUserId: "user_a" },
    { id: 20, name: "Jo Park", clerkUserId: "user_b" },
    { id: 30, name: "Sam Lee", clerkUserId: "user_c" },
    { id: 40, name: "Lee King", clerkUserId: "user_d" },
  ];
  const played = doubles({ status: "completed", score: "6-3, 6-4", winnerId: 10, recordedAt: new Date(Date.now() - 60_000).toISOString(), recordedByClerkUserId: "user_a" });

  it("changes a played score to a double default and takes the win and loss back off", async () => {
    const sets: Call[] = [];
    mockDb.select.mockReturnValueOnce(chain([played])).mockReturnValueOnce(chain(people)).mockReturnValue(chain([]));
    mockDb.update.mockReturnValue(chain([{ ...played, score: "Double default", winnerId: null, scoreEditedAt: new Date() }], sets));
    const txUpdates: Call[] = [];
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ update: () => chain(undefined, txUpdates) }));
    const res = await supertest(await buildApp()).post("/api/leagues/1/matches/7/score/edit").send({ doubleDefault: true });
    expect(res.status).toBe(200);
    expect(sets.find((c) => c.method === "set")?.args[0]).toMatchObject({ score: "Double default", winnerId: null });
    // All four lose the result they had.
    expect(txUpdates.filter((c) => c.method === "set")).toHaveLength(4);
  });
});

describe("standings and career", () => {
  const base: Omit<StandingMatch, "winnerId" | "score"> = {
    status: "completed",
    player1Id: 10,
    player2Id: 20,
    player3Id: 30,
    player4Id: 40,
    season: null,
    voidedAt: null,
    inGrace: false,
    playoffBracketId: null,
    team1Id: 1,
    team2Id: 2,
  };
  const players = [10, 20, 30, 40].map((id) => ({ id, name: `P${id}`, leftAt: null }));
  const names = new Map(four.map((p) => [p.id, p.name]));
  const teams = [{ id: 1, playerIds: [10, 30] as [number, number] }, { id: 2, playerIds: [20, 40] as [number, number] }];

  it("counts a doubles W/O as a win for the team, with no sets or games", () => {
    const rows = computeTeamStandings(teams, names, [{ ...base, score: "W/O", winnerId: 20 }]);
    const jo = rows.find((r) => r.teamId === 2)!;
    const john = rows.find((r) => r.teamId === 1)!;
    expect(jo).toMatchObject({ rank: 1, wins: 1, losses: 0, setsWon: 0, gamesWon: 0 });
    expect(john).toMatchObject({ wins: 0, losses: 1 });
    // Rotating leagues credit both partners.
    const byPlayer = computeStandings(players, [{ ...base, score: "W/O", winnerId: 20 }]);
    expect(byPlayer.filter((r) => r.wins === 1).map((r) => r.playerId).sort()).toEqual([20, 40]);
  });

  it("gives no points to either team for a double default", () => {
    const rows = computeTeamStandings(teams, names, [{ ...base, score: "Double default", winnerId: null }]);
    for (const r of rows) expect(r).toMatchObject({ wins: 0, losses: 0, matchesPlayed: 0, points: 0 });
    const byPlayer = computeStandings(players, [{ ...base, score: "Double default", winnerId: null }]);
    for (const r of byPlayer) expect(r).toMatchObject({ wins: 0, losses: 0, matchesPlayed: 0 });
  });

  it("keeps a double default out of the career record", () => {
    const stats = careerStats({
      account: "user_a",
      players: new Map([
        [10, { clerkUserId: "user_a", name: "John Rapiel" }],
        [20, { clerkUserId: "user_b", name: "Jo Park" }],
        [30, { clerkUserId: "user_c", name: "Sam Lee" }],
        [40, { clerkUserId: "user_d", name: "Lee King" }],
      ]),
      users: new Map(),
      leagues: new Map([[1, { name: "Doubles" }]]),
      seasons: [],
      blocked: new Set(),
      matches: [
        { ...base, id: 1, leagueId: 1, generatedFrom: null, score: "Double default", winnerId: null, completedAt: "2026-11-01T10:00:00Z" },
        { ...base, id: 2, leagueId: 1, generatedFrom: null, score: "W/O", winnerId: 10, completedAt: "2026-11-02T10:00:00Z" },
      ],
    });
    // The W/O counts in the record; the double default doesn't.
    expect(stats).toMatchObject({ wins: 1, losses: 0, played: 1 });
  });
});
