import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Finding 6: only the players in a match can open its Match detail.

let mockUserId: string | null = "user_a";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const chain = (value: unknown) => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok);
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
};
const select = vi.fn();
const table = new Proxy({}, { get: (_t, p) => ({ col: String(p) }) });
vi.mock("@workspace/db", () => ({
  db: { select: (...a: unknown[]) => select(...a) },
  ballBoiSessionsTable: table,
  leagueRoundsTable: table,
  leaguesTable: table,
  matchesTable: table,
  matchShotsTable: table,
  playersTable: table,
  usersTable: table,
}));
const blocked = vi.fn(async () => new Set<string>());
vi.mock("../lib/blocks.js", () => ({ blockedAccountsFor: (...a: unknown[]) => blocked(...(a as [])) }));
vi.mock("drizzle-orm", () => ({ and: () => ({}), count: () => ({}), desc: () => ({}), eq: () => ({}), inArray: () => ({}) }));

async function buildApp() {
  const { default: router } = await import("../routes/matchDetail.js");
  const app = express();
  app.use("/api", router);
  return app;
}

const match = {
  id: 7, leagueId: 1, roundId: 3, player1Id: 10, player2Id: 20, player3Id: null, player4Id: null,
  status: "completed", score: "6-4, 7-5", winnerId: 10, inGrace: false, voidedAt: null,
  scheduledAt: null, completedAt: new Date().toISOString(), location: null, playoffBracketId: null, playoffRound: null,
  recordedAt: new Date().toISOString(), recordedByClerkUserId: "user_a", correctedAt: null, correctedByName: null,
  scoreEditedAt: null, scoreEditedByName: null,
};
const players = [
  { id: 10, name: "John", clerkUserId: "user_a", displayName: "John Rapiel" },
  { id: 20, name: "Ray", clerkUserId: "user_b", displayName: null },
];

beforeEach(() => {
  select.mockReset();
  blocked.mockReset();
  blocked.mockResolvedValue(new Set<string>());
  mockUserId = "user_a";
});

describe("GET /api/me/matches/:matchId", () => {
  it("shows a player their match, with the profile name and a replay once analysed", async () => {
    select
      .mockReturnValueOnce(chain([match]))
      .mockReturnValueOnce(chain(players))
      .mockReturnValueOnce(chain([{ id: 1, name: "Men's 3.5", leagueType: "singles", endedAt: null }]))
      .mockReturnValueOnce(chain([{ roundNumber: 3 }]))
      .mockReturnValueOnce(chain([{ id: 9, durationSeconds: 5520 }]))
      .mockReturnValueOnce(chain([{ n: 412 }]));
    const res = await supertest(await buildApp()).get("/api/me/matches/7");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matchId: 7, leagueName: "Men's 3.5", roundNumber: 3, score: "6-4, 7-5", replay: { shotCount: 412 } });
    expect(res.body.you.players[0].name).toBe("John Rapiel");
    expect(res.body.editUntil).toBeTruthy();
  });

  it("refuses someone who didn't play in it", async () => {
    mockUserId = "user_c";
    select.mockReturnValueOnce(chain([match])).mockReturnValueOnce(chain(players));
    const res = await supertest(await buildApp()).get("/api/me/matches/7");
    expect(res.status).toBe(403);
  });

  it("sends each player's photo, none for a placeholder or someone with a block", async () => {
    const doubles = { ...match, player3Id: 30, player4Id: 40 };
    const four = [
      { id: 10, name: "John", clerkUserId: "user_a", displayName: "John Rapiel", avatarUrl: "/objects/uploads/john" },
      { id: 20, name: "Ray", clerkUserId: "user_b", displayName: "Ray", avatarUrl: "/objects/uploads/ray" },
      { id: 30, name: "Sam", clerkUserId: null, displayName: null, avatarUrl: null },
      { id: 40, name: "Kim", clerkUserId: "user_d", displayName: "Kim", avatarUrl: "/objects/uploads/kim" },
    ];
    const load = (players: unknown[]) =>
      select
        .mockReturnValueOnce(chain([doubles]))
        .mockReturnValueOnce(chain(players))
        .mockReturnValueOnce(chain([{ id: 1, name: "Men's 3.5", leagueType: "doubles", endedAt: null }]))
        .mockReturnValueOnce(chain([{ roundNumber: 3 }]))
        .mockReturnValueOnce(chain([]));
    load(four);
    const res = await supertest(await buildApp()).get("/api/me/matches/7");
    expect(res.status).toBe(200);
    const photo = (body: { you: { players: { playerId: number; avatarUrl: string | null }[] }; opponents: { players: { playerId: number; avatarUrl: string | null }[] } }, id: number) =>
      [...body.you.players, ...body.opponents.players].find((p) => p.playerId === id)?.avatarUrl;
    expect(photo(res.body, 10)).toBe("/objects/uploads/john");
    expect(photo(res.body, 20)).toBe("/objects/uploads/ray");
    expect(photo(res.body, 30)).toBeNull();
    expect(photo(res.body, 40)).toBe("/objects/uploads/kim");

    // Kim blocked John (or John blocked Kim): no photo either way.
    blocked.mockResolvedValue(new Set(["user_d"]));
    load(four);
    const after = await supertest(await buildApp()).get("/api/me/matches/7");
    expect(photo(after.body, 40)).toBeNull();
    expect(photo(after.body, 20)).toBe("/objects/uploads/ray");
  });

  it("404s a match that doesn't exist or isn't a league match", async () => {
    select.mockReturnValueOnce(chain([]));
    expect((await supertest(await buildApp()).get("/api/me/matches/8")).status).toBe(404);
    select.mockReturnValueOnce(chain([{ ...match, leagueId: null }]));
    expect((await supertest(await buildApp()).get("/api/me/matches/7")).status).toBe(404);
  });
});
