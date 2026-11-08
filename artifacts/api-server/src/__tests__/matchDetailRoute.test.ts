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

  it("404s a match that doesn't exist or isn't a league match", async () => {
    select.mockReturnValueOnce(chain([]));
    expect((await supertest(await buildApp()).get("/api/me/matches/8")).status).toBe(404);
    select.mockReturnValueOnce(chain([{ ...match, leagueId: null }]));
    expect((await supertest(await buildApp()).get("/api/me/matches/7")).status).toBe(404);
  });
});
