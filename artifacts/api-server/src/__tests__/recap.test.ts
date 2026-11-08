import { describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: { select: () => { throw new Error("No database in this test"); } } };
});

import { GetMatchRecapResponse } from "@workspace/api-zod";
import { buildRecap, type RecapInput, type RecapMatch } from "../lib/recap";
import type { RecapRepo } from "../lib/recapRepo";
import { createRecapRouter } from "../routes/recap";

// The match recap (decision 148): the facts the shareable image shows.

const PLAYERS = new Map<number, { name: string; clerkUserId: string | null }>([
  [1, { name: "John Rapiel", clerkUserId: "me" }],
  [2, { name: "Sam Patel", clerkUserId: "sam" }],
  [3, { name: "Alex Kim", clerkUserId: "alex" }],
  [4, { name: "Priya Shah", clerkUserId: "priya" }],
]);
const match = (o: Partial<RecapMatch> = {}): RecapMatch => ({
  id: 50,
  leagueId: 7,
  player1Id: 2,
  player2Id: 1,
  player3Id: null,
  player4Id: null,
  winnerId: 1,
  status: "completed",
  score: "3-6, 6-7(4)",
  completedAt: "2026-11-07T18:00:00Z",
  location: "Beacon Courts · Court 3",
  voidedAt: null,
  generatedFrom: "round",
  ...o,
});
const input = (o: Partial<RecapInput> = {}): RecapInput => ({
  viewer: "me",
  match: match(),
  players: PLAYERS,
  leagueName: "Tuesday Flex 3.5",
  planCourt: null,
  season: { name: "Fall 2026", wins: 5, losses: 2 },
  ...o,
});

describe("building a recap", () => {
  it("sends both sides, your side, the stored score, the winner, court, league and season", () => {
    const r = buildRecap(input());
    expect(r).toEqual({
      ok: true,
      recap: {
        matchId: 50,
        you: 2,
        side1: ["Sam Patel"],
        side2: ["John Rapiel"],
        score: "3-6, 6-7(4)",
        winner: 2,
        playedAt: "2026-11-07T18:00:00Z",
        court: "Beacon Courts · Court 3",
        context: "Tuesday Flex 3.5",
        season: { name: "Fall 2026", wins: 5, losses: 2 },
      },
    });
  });

  it("names Discover and Quick matches, and uses the match card's court", () => {
    const discover = buildRecap(input({ match: match({ leagueId: null, generatedFrom: "discover", location: null }), leagueName: null, planCourt: "Beacon Courts" }));
    expect(discover.ok && [discover.recap.context, discover.recap.court]).toEqual(["Discover", "Beacon Courts"]);
    const quick = buildRecap(input({ match: match({ leagueId: null, generatedFrom: "quick_match", location: null }), leagueName: null }));
    expect(quick.ok && [quick.recap.context, quick.recap.court]).toEqual(["Quick match", null]);
  });

  it("puts doubles teams on their sides", () => {
    const r = buildRecap(input({ match: match({ player3Id: 4, player4Id: 3 }) }));
    expect(r.ok && [r.recap.side1, r.recap.side2]).toEqual([
      ["Sam Patel", "Priya Shah"],
      ["John Rapiel", "Alex Kim"],
    ]);
  });

  it("is only for the players in the match, once it has a score", () => {
    expect(buildRecap(input({ viewer: "stranger" }))).toMatchObject({ ok: false, status: 403 });
    expect(buildRecap(input({ match: match({ status: "scheduled", score: null }) }))).toMatchObject({ ok: false, status: 409 });
    expect(buildRecap(input({ match: match({ voidedAt: new Date() }) }))).toMatchObject({ ok: false, status: 409 });
  });
});

describe("GET /me/matches/:matchId/recap", () => {
  const repo = (found: boolean): RecapRepo & { days: string[] } => {
    const days: string[] = [];
    return {
      days,
      load: async () => (found ? { match: match(), players: PLAYERS, leagueName: "Tuesday Flex 3.5", planCourt: null } : null),
      season: async (_who, day) => {
        days.push(day);
        return { name: "Fall 2026", wins: 5, losses: 2 };
      },
    };
  };
  const app = (r: RecapRepo) => {
    const a = express();
    a.use(createRecapRouter(r, () => new Date("2026-11-10T12:00:00Z")));
    return supertest(a);
  };

  it("sends the recap in the contract's shape, with the record for that match's season", async () => {
    const r = repo(true);
    const res = await app(r).get("/me/matches/50/recap").expect(200);
    expect(GetMatchRecapResponse.parse(res.body)).toBeTruthy();
    expect(res.body.season).toEqual({ name: "Fall 2026", wins: 5, losses: 2 });
    expect(r.days).toEqual(["2026-11-07"]);
  });

  it("refuses strangers, unknown matches and signed-out callers", async () => {
    mockUserId = "stranger";
    await app(repo(true)).get("/me/matches/50/recap").expect(403);
    mockUserId = "me";
    await app(repo(false)).get("/me/matches/50/recap").expect(404);
    await app(repo(true)).get("/me/matches/abc/recap").expect(400);
    mockUserId = null;
    await app(repo(true)).get("/me/matches/50/recap").expect(401);
    mockUserId = "me";
  });
});
