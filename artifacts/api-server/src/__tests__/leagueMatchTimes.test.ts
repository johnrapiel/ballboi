import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

// PR 4: League match times. Admins can set a weekly match day and time for a
// club league; otherwise either player sets a time inside the match's week.

let mockUserId: string | null = "user_me";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Rows by table; select().from(t) reads them, filtered by any eq() on id.
type Row = Record<string, unknown>;
let rows: Record<string, Row[]> = {};
const inserted: { table: string; values: Row[] }[] = [];
const updated: { table: string; values: Row }[] = [];

function table(name: string) {
  return new Proxy({ __name: name } as Record<string, unknown>, {
    get: (t, p) => (p === "__name" ? t.__name : { table: name, col: String(p) }),
  });
}
type Filter = { eq?: [{ col: string }, unknown]; and?: Filter[]; any?: true };
const passes = (r: Row, f?: Filter): boolean =>
  !f || f.any ? true : f.and ? f.and.every((x) => passes(r, x)) : f.eq ? r[f.eq[0].col] === f.eq[1] : true;

function select() {
  return {
    from: (t: { __name: string }) => {
      let filter: Filter | undefined;
      const q: Record<string, unknown> = {
        where: (f: Filter) => {
          filter = f;
          return q;
        },
        orderBy: () => q,
        innerJoin: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve((rows[t.__name] ?? []).filter((r) => passes(r, filter))).then(ok),
      };
      return q;
    },
  };
}
const mockDb = {
  select,
  insert: (t: { __name: string }) => ({
    values: (v: Row | Row[]) => {
      const list = Array.isArray(v) ? v : [v];
      inserted.push({ table: t.__name, values: list });
      const out = list.map((r, i) => ({ id: 500 + i, ...r }));
      (rows[t.__name] ??= []).push(...out);
      const p = Promise.resolve(out);
      return { returning: () => p, onConflictDoNothing: () => p, then: (ok: (x: unknown) => unknown) => p.then(ok) };
    },
  }),
  update: (t: { __name: string }) => ({
    set: (values: Row) => ({
      where: () => {
        updated.push({ table: t.__name, values });
        const p = Promise.resolve([{ id: 7, matchDay: values.matchDay, matchTime: values.matchTime, timeZone: "America/Los_Angeles" }]);
        return { returning: () => p, then: (ok: (x: unknown) => unknown) => p.then(ok) };
      },
    }),
  }),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  leagueAdminsTable: table("league_admins"),
  leagueRoundByesTable: table("league_round_byes"),
  leagueRoundsTable: table("league_rounds"),
  leaguesTable: table("leagues"),
  matchesTable: table("matches"),
  playerAvailabilityTable: table("player_availability"),
  playersTable: table("players"),
  playoffBracketsTable: table("playoff_brackets"),
  usersTable: table("users"),
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: Filter[]) => ({ and: a.filter(Boolean) }),
  eq: (a: { col: string }, b: unknown) => ({ eq: [a, b] }),
  inArray: () => ({ any: true }),
  isNull: () => ({ any: true }),
  isNotNull: () => ({ any: true }),
  asc: (x: unknown) => x,
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../lib/blocks.js", () => ({ blockedPlayerPairs: async () => new Set<string>() }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/seasonService.js", () => ({ getAutoSeason: vi.fn().mockResolvedValue(null) }));
vi.mock("../services/leaguePlayoffs.js", () => ({ startPlayoffs: vi.fn() }));
let mockRole: string | null = null;
vi.mock("../lib/leagueAccess.js", () => ({ getLeagueRole: async () => mockRole }));

const pub = new Date("2026-11-01T12:00:00Z");
const league = (over: Row = {}) => ({
  id: 7,
  name: "Tuesday Flex",
  format: "flex",
  leagueType: "singles",
  startDate: "2026-11-05",
  seasonWeeks: 8,
  timeZone: "America/Los_Angeles",
  matchDay: null,
  matchTime: null,
  endedAt: null,
  ...over,
});
const players = [10, 20, 30, 40].map((id) => ({ id, leagueId: 7, name: `P${id}`, clerkUserId: `user_${id}`, skillLevel: "3.5", leftAt: null }));

beforeEach(() => {
  mockUserId = "user_me";
  mockRole = null;
  rows = {};
  inserted.length = 0;
  updated.length = 0;
  vi.useRealTimers();
});

describe("new rounds get the league's match day and time", () => {
  it("sets scheduledAt on every match from the weekly day and time, in the league's time zone", async () => {
    const { ensureDraft } = await import("../services/leagueRounds.js");
    rows.players = players;
    // Season starts Thursday Nov 5; matches are Tuesdays at 6:30 PM Los Angeles time.
    const result = await ensureDraft(league({ matchDay: 2, matchTime: "18:30" }) as never, 1);
    expect(result?.drafted).toBe(true);
    const matches = inserted.find((i) => i.table === "matches")!.values;
    expect(matches).toHaveLength(2);
    // Tue Nov 10, 6:30 PM PST is 02:30 UTC on Nov 11.
    expect(matches.map((m) => m.scheduledAt)).toEqual(["2026-11-11T02:30:00.000Z", "2026-11-11T02:30:00.000Z"]);
  });

  it("leaves scheduledAt empty when the admin set no time, so players pick", async () => {
    const { ensureDraft } = await import("../services/leagueRounds.js");
    rows.players = players;
    await ensureDraft(league() as never, 1);
    const matches = inserted.find((i) => i.table === "matches")!.values;
    expect(matches.every((m) => m.scheduledAt === undefined)).toBe(true);
  });
});

async function app() {
  const { default: router } = await import("../routes/matchTimes.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

describe("PUT /leagues/:leagueId/matches/:matchId/time", () => {
  const setUp = (leagueOver: Row = {}, matchOver: Row = {}) => {
    rows.leagues = [league(leagueOver)];
    rows.matches = [{ id: 50, leagueId: 7, roundId: 1, player1Id: 10, player2Id: 20, player3Id: null, player4Id: null, status: "scheduled", score: null, voidedAt: null, scheduledAt: null, ...matchOver }];
    rows.league_rounds = [{ id: 1, leagueId: 7, roundNumber: 1, startDate: "2026-11-05", endDate: "2026-11-11", publishedAt: pub }];
    rows.players = [{ id: 10, leagueId: 7, clerkUserId: "user_me" }, { id: 20, leagueId: 7, clerkUserId: "user_them" }, { id: 30, leagueId: 7, clerkUserId: "user_other" }];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T18:00:00Z"));
  };
  const put = async (scheduledAt: unknown) => (await app()).put("/api/leagues/7/matches/50/time").send({ scheduledAt });

  it("lets either player set a time inside the match's week, and both see it on the match", async () => {
    setUp();
    // Mon Nov 9, 6 PM in Los Angeles.
    const res = await put("2026-11-10T02:00:00.000Z");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matchId: 50, scheduledAt: "2026-11-10T02:00:00.000Z", timeZone: "America/Los_Angeles" });
    expect(updated).toEqual([{ table: "matches", values: { scheduledAt: "2026-11-10T02:00:00.000Z" } }]);

    mockUserId = "user_them";
    const changed = await put("2026-11-11T01:00:00.000Z");
    expect(changed.status).toBe(200);
  });

  it("refuses anyone who isn't in the match or a league admin", async () => {
    setUp();
    mockUserId = "user_other";
    const res = await put("2026-11-10T02:00:00.000Z");
    expect(res.status).toBe(403);
    expect(updated).toEqual([]);
  });

  it("lets a league admin set it", async () => {
    setUp();
    mockUserId = "user_admin";
    mockRole = "owner";
    expect((await put("2026-11-10T02:00:00.000Z")).status).toBe(200);
  });

  it("checks the day falls in the round's week, in the league's time zone", async () => {
    setUp();
    // Thu Nov 12, 1 AM UTC is still Wed Nov 11 in Los Angeles: the deadline day.
    expect((await put("2026-11-12T01:00:00.000Z")).status).toBe(200);
    // Thu Nov 12, 6 PM in Los Angeles is the next week.
    const late = await put("2026-11-13T02:00:00.000Z");
    expect(late.status).toBe(400);
    expect(late.body.error).toBe("Pick a day from Thu, Nov 5 to Wed, Nov 11.");
    // Wed Nov 4 is before the round starts.
    expect((await put("2026-11-04T20:00:00.000Z")).status).toBe(400);
    expect((await put("tomorrow")).status).toBe(400);
  });

  it("leaves a club league's set time to its admins", async () => {
    setUp({ matchDay: 2, matchTime: "18:30" });
    const res = await put("2026-11-10T02:00:00.000Z");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/set time/);
  });

  it("won't change a played or cancelled match", async () => {
    setUp({}, { status: "completed", score: "6-3, 6-4" });
    expect((await put("2026-11-10T02:00:00.000Z")).status).toBe(409);
    setUp({}, { voidedAt: new Date() });
    expect((await put("2026-11-10T02:00:00.000Z")).status).toBe(409);
  });
});

describe("PUT /leagues/:leagueId/match-time", () => {
  it("is for league admins, and saves both day and time or neither", async () => {
    rows.league_rounds = [];
    const r = await app();
    expect((await r.put("/api/leagues/7/match-time").send({ matchDay: 2, matchTime: "18:30" })).status).toBe(403);
    mockRole = "owner";
    expect((await r.put("/api/leagues/7/match-time").send({ matchDay: 2, matchTime: null })).status).toBe(400);
    expect((await r.put("/api/leagues/7/match-time").send({ matchDay: 9, matchTime: "18:30" })).status).toBe(400);
    const ok = await r.put("/api/leagues/7/match-time").send({ matchDay: 2, matchTime: "18:30" });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ matchDay: 2, matchTime: "18:30", timeZone: "America/Los_Angeles" });
    expect((await r.put("/api/leagues/7/match-time").send({ matchDay: null, matchTime: null })).status).toBe(200);
  });
});
