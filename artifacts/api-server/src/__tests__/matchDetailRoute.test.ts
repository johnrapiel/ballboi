import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Match detail (finding 6; decision 151): every match you played, league,
// Discover or Quick match. Only its players can open it; a Quick match
// stranger only after Yes to "Was that you?"; blocks open nothing new; and
// either player can edit a Discover or Quick score for 24 hours without
// touching standings.

let mockUserId: string | null = "user_a";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const none = () => {
    throw new Error("No database in this test");
  };
  return { ...actual, db: { select: none, update: none, insert: none, delete: none, transaction: none } };
});

import type { Match } from "@workspace/db";
import { EditMyMatchScoreResponse, GetMyMatchResponse } from "@workspace/api-zod";
import { computeStandings } from "../lib/leagueStandings.js";
import type { MatchDetailData, MatchDetailRepo } from "../lib/matchDetailRepo.js";
import { createMatchDetailRouter, type MatchDetailDeps } from "../routes/matchDetail.js";

const NOW = new Date("2026-11-08T20:00:00Z");
const ENTERED = "2026-11-08T12:00:00.000Z";

const row = (o: Partial<Match> = {}): Match =>
  ({
    id: 7,
    leagueId: 1,
    roundId: 3,
    player1Id: 10,
    player2Id: 20,
    player3Id: null,
    player4Id: null,
    winnerId: 10,
    status: "completed",
    scheduledAt: "2026-11-08T10:00:00.000Z",
    startedAt: null,
    completedAt: ENTERED,
    location: null,
    score: "6-3, 6-4",
    notes: null,
    durationMinutes: null,
    recordedByClerkUserId: "user_a",
    recordedAt: ENTERED,
    courtId: null,
    weekOf: null,
    generatedFrom: "round",
    estimatedDistanceP1: null,
    estimatedDistanceP2: null,
    playoffBracketId: null,
    playoffRound: null,
    playoffSlot: null,
    season: null,
    locked: false,
    voidedAt: null,
    inGrace: false,
    correctedAt: null,
    correctedByClerkUserId: null,
    correctedByName: null,
    scoreClearedAt: null,
    scoreClearedByName: null,
    scoreEditedAt: null,
    scoreEditedByClerkUserId: null,
    scoreEditedByName: null,
    createdAt: new Date(ENTERED),
    updatedAt: new Date(ENTERED),
    ...o,
  }) as Match;

const JOHN = { id: 10, name: "John Rapiel", clerkUserId: "user_a" };
const RAY = { id: 20, name: "Ray Alvarez", clerkUserId: "user_b" };
const LEAGUE = { id: 1, name: "Men's 3.5", leagueType: "singles", timeZone: "America/New_York", endedAt: null, status: "active" };

const league = (): MatchDetailData => ({ match: row(), players: [JOHN, RAY], league: LEAGUE, roundNumber: 3, round: null, plan: null, replay: null });
const discover = (o: Partial<Match> = {}): MatchDetailData => ({
  match: row({ leagueId: null, roundId: null, generatedFrom: "discover", ...o }),
  players: [JOHN, RAY],
  league: null,
  roundNumber: null,
  round: null,
  plan: { courtName: "Beacon Courts", timeZone: "America/New_York" },
  replay: null,
});
const quick = (o: Partial<Match> = {}, opponent: { id: number; name: string; clerkUserId: string | null } = RAY): MatchDetailData => ({
  match: row({ leagueId: null, roundId: null, generatedFrom: "quick_match", player2Id: opponent.id, ...o }),
  players: [JOHN, opponent],
  league: null,
  roundNumber: null,
  round: null,
  plan: null,
  replay: null,
});

class MemoryRepo implements MatchDetailRepo {
  saves: { matchId: number; previous: string; edit: Parameters<MatchDetailRepo["saveEdit"]>[2] }[] = [];
  constructor(
    public data: MatchDetailData | null,
    public blocks: Set<string> = new Set(),
  ) {}
  async load() {
    return this.data;
  }
  async blocked() {
    return this.blocks;
  }
  async saveEdit(matchId: number, previous: string, edit: Parameters<MatchDetailRepo["saveEdit"]>[2]) {
    this.saves.push({ matchId, previous, edit });
    if (!this.data || this.data.match.score !== previous) return null;
    return { ...this.data.match, score: edit.score, winnerId: edit.winnerId, scoreEditedAt: edit.at, scoreEditedByName: edit.byName };
  }
}

function app(repo: MatchDetailRepo, now = NOW) {
  const deps: MatchDetailDeps & { pushes: unknown[][]; awarded: number[] } = {
    pushes: [],
    awarded: [],
    now: () => now,
    push: async (...a) => {
      deps.pushes.push(a);
    },
    awardMilestones: async (id) => {
      deps.awarded.push(id);
    },
  };
  const a = express();
  a.use(express.json());
  a.use("/api", createMatchDetailRouter(repo, deps));
  return { app: a, deps };
}

beforeEach(() => {
  mockUserId = "user_a";
});

describe("GET /api/me/matches/:matchId by match type", () => {
  it("opens a league match with its league and round", async () => {
    const res = await supertest(app(new MemoryRepo({ ...league(), replay: { durationSeconds: 5520, shotCount: 412 } })).app).get("/api/me/matches/7");
    expect(res.status).toBe(200);
    expect(GetMyMatchResponse.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ source: "league", leagueId: 1, leagueName: "Men's 3.5", context: "Men's 3.5", roundNumber: 3, score: "6-3, 6-4", replay: { shotCount: 412 } });
    expect(res.body.editUntil).toBe("2026-11-09T12:00:00.000Z");
  });

  it("opens a Discover match, with the court from its match card", async () => {
    const res = await supertest(app(new MemoryRepo(discover())).app).get("/api/me/matches/7");
    expect(res.status).toBe(200);
    expect(GetMyMatchResponse.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ source: "discover", leagueId: null, leagueName: null, context: "Discover", location: "Beacon Courts", timeZone: "America/New_York", leagueEnded: false });
    expect(res.body.editUntil).toBe("2026-11-09T12:00:00.000Z");
  });

  it("opens a Discover open match the same way", async () => {
    const res = await supertest(app(new MemoryRepo(discover({ generatedFrom: "discover_open_match" }))).app).get("/api/me/matches/7");
    expect(res.body).toMatchObject({ source: "discover", context: "Discover" });
  });

  it("opens a Quick match, for both players, from each side", async () => {
    const mine = await supertest(app(new MemoryRepo(quick())).app).get("/api/me/matches/7");
    expect(mine.status).toBe(200);
    expect(GetMyMatchResponse.safeParse(mine.body).success).toBe(true);
    expect(mine.body).toMatchObject({ source: "quick_match", context: "Quick match", score: "6-3, 6-4", you: { won: true } });
    mockUserId = "user_b";
    const theirs = await supertest(app(new MemoryRepo(quick())).app).get("/api/me/matches/7");
    expect(theirs.body).toMatchObject({ score: "3-6, 4-6", you: { won: false }, opponents: { won: true } });
    expect(theirs.body.editUntil).toBe("2026-11-09T12:00:00.000Z");
  });

  it("shows a placeholder opponent by name, with no account", async () => {
    const res = await supertest(app(new MemoryRepo(quick({}, { id: 30, name: "Sam", clerkUserId: null }))).app).get("/api/me/matches/7");
    expect(res.body.opponents.players).toEqual([{ playerId: 30, name: "Sam", you: false, hasAccount: false, avatarUrl: null }]);
  });

  it("refuses anyone who didn't play in it, whatever the match type", async () => {
    mockUserId = "user_c";
    for (const data of [league(), discover(), quick()]) {
      expect((await supertest(app(new MemoryRepo(data)).app).get("/api/me/matches/7")).status).toBe(403);
    }
  });

  it("shows a league match past its week as late, with its real Play by date (decision 152)", async () => {
    const unplayed = { status: "scheduled", score: null, winnerId: null, recordedAt: null, recordedByClerkUserId: null };
    const round = { publishedAt: new Date("2026-10-26T00:00:00Z"), startDate: "2026-10-30", endDate: "2026-11-05" };
    const res = await supertest(app(new MemoryRepo({ ...league(), match: row(unplayed), round })).app).get("/api/me/matches/7");
    expect(res.status).toBe(200);
    expect(GetMyMatchResponse.safeParse(res.body).success).toBe(true);
    expect(res.body.lateUntil).toBe("2026-11-12");
    // Discover and Quick matches have no round, so they're never late.
    const casual = await supertest(app(new MemoryRepo(discover(unplayed))).app).get("/api/me/matches/7");
    expect(casual.body.lateUntil).toBeNull();
  });

  it("404s a match that doesn't exist", async () => {
    expect((await supertest(app(new MemoryRepo(null)).app).get("/api/me/matches/8")).status).toBe(404);
  });
});

describe("the Quick match Yes gate (G2)", () => {
  // Before Yes to "Was that you?", the match is on an unlinked stand-in row.
  const standIn = { id: 30, name: "Ray Alvarez", clerkUserId: null };

  it("keeps a stranger out until they answer Yes", async () => {
    mockUserId = "user_b";
    const res = await supertest(app(new MemoryRepo(quick({}, standIn))).app).get("/api/me/matches/7");
    expect(res.status).toBe(403);
  });

  it("opens it once Yes links the stand-in to their account", async () => {
    mockUserId = "user_b";
    const res = await supertest(app(new MemoryRepo(quick({}, { ...standIn, clerkUserId: "user_b" }))).app).get("/api/me/matches/7");
    expect(res.status).toBe(200);
  });

  it("lets the recorder open it either way", async () => {
    expect((await supertest(app(new MemoryRepo(quick({}, standIn))).app).get("/api/me/matches/7")).status).toBe(200);
  });

  it("doesn't let a stranger edit the score before Yes", async () => {
    mockUserId = "user_b";
    const res = await supertest(app(new MemoryRepo(quick({}, standIn))).app).post("/api/me/matches/7/score/edit").send({ score: "6-4, 6-4" });
    expect(res.status).toBe(403);
  });
});

describe("blocks", () => {
  it("never opens a match to a blocked player who wasn't in it", async () => {
    mockUserId = "user_c";
    const res = await supertest(app(new MemoryRepo(discover(), new Set(["user_a"]))).app).get("/api/me/matches/7");
    expect(res.status).toBe(403);
  });

  it("keeps a match you both played yours, as shared matches already are", async () => {
    const res = await supertest(app(new MemoryRepo(discover(), new Set(["user_b"]))).app).get("/api/me/matches/7");
    expect(res.status).toBe(200);
  });

  it("doesn't push a score edit to someone blocked with the editor", async () => {
    const { app: a, deps } = app(new MemoryRepo(discover(), new Set(["user_b"])));
    const res = await supertest(a).post("/api/me/matches/7/score/edit").send({ score: "6-4, 6-4" });
    expect(res.status).toBe(200);
    expect(deps.pushes).toEqual([]);
  });
});

describe("POST /api/me/matches/:matchId/score/edit", () => {
  it("lets either player edit a Discover score within 24 hours, from their own side", async () => {
    mockUserId = "user_b";
    const repo = new MemoryRepo(discover());
    const { app: a, deps } = app(repo);
    // Ray had lost 3-6, 4-6; he corrects it to a win, written from his side.
    const res = await supertest(a).post("/api/me/matches/7/score/edit").send({ score: "6-3, 6-4" });
    expect(res.status).toBe(200);
    expect(EditMyMatchScoreResponse.safeParse(res.body).success).toBe(true);
    expect(repo.saves).toEqual([
      { matchId: 7, previous: "6-3, 6-4", edit: { score: "3-6, 4-6", winnerId: 20, byClerkUserId: "user_b", byName: "Ray Alvarez", at: NOW } },
    ]);
    expect(deps.pushes).toEqual([[["user_a"], "Score edited", "Score edited by Ray Alvarez: 3-6, 4-6.", "/match/7"]]);
    expect(deps.awarded).toEqual([7]);
  });

  it("lets either player edit a Quick match score within 24 hours", async () => {
    const repo = new MemoryRepo(quick());
    const res = await supertest(app(repo).app).post("/api/me/matches/7/score/edit").send({ score: "6-3, 3-6, 10-8" });
    expect(res.status).toBe(200);
    expect(repo.saves[0].edit).toMatchObject({ score: "6-3, 3-6, 10-8", winnerId: 10 });
  });

  it("locks after 24 hours, with no admin to point to", async () => {
    const late = new Date("2026-11-09T12:00:01Z");
    for (const data of [discover(), quick()]) {
      const repo = new MemoryRepo(data);
      const res = await supertest(app(repo, late).app).post("/api/me/matches/7/score/edit").send({ score: "6-4, 6-4" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Scores lock 24 hours after they're entered.");
      expect(res.body.error).not.toMatch(/admin/i);
      expect(repo.saves).toEqual([]);
    }
    const detail = await supertest(app(new MemoryRepo(discover()), late).app).get("/api/me/matches/7");
    expect(detail.body.editUntil).toBeNull();
  });

  it("leaves league matches to the league's own edit route", async () => {
    const repo = new MemoryRepo(league());
    const res = await supertest(app(repo).app).post("/api/me/matches/7/score/edit").send({ score: "6-4, 6-4" });
    expect(res.status).toBe(404);
    expect(repo.saves).toEqual([]);
  });

  it("refuses someone who didn't play, a bad score and a match with no score", async () => {
    mockUserId = "user_c";
    expect((await supertest(app(new MemoryRepo(discover())).app).post("/api/me/matches/7/score/edit").send({ score: "6-4, 6-4" })).status).toBe(403);
    mockUserId = "user_a";
    expect((await supertest(app(new MemoryRepo(discover())).app).post("/api/me/matches/7/score/edit").send({ score: "6-6" })).status).toBe(400);
    const unplayed = discover({ status: "scheduled", score: null, winnerId: null, recordedAt: null, recordedByClerkUserId: null });
    expect((await supertest(app(new MemoryRepo(unplayed)).app).post("/api/me/matches/7/score/edit").send({ score: "6-4, 6-4" })).status).toBe(409);
  });

  it("says when the score changed underneath you", async () => {
    const repo = new MemoryRepo(discover());
    repo.saveEdit = async () => null;
    const res = await supertest(app(repo).app).post("/api/me/matches/7/score/edit").send({ score: "6-4, 6-4" });
    expect(res.status).toBe(409);
  });

  it("leaves standings alone: only the match row changes, and no league counts it", async () => {
    const repo = new MemoryRepo(discover());
    await supertest(app(repo).app).post("/api/me/matches/7/score/edit").send({ score: "3-6, 4-6" });
    // The one write is the match's own score, winner and "edited by" fields.
    expect(repo.saves).toHaveLength(1);
    expect(Object.keys(repo.saves[0].edit).sort()).toEqual(["at", "byClerkUserId", "byName", "score", "winnerId"]);
    // And a league's standings never include a match with no league, before or after.
    const players = [
      { id: 10, name: "John Rapiel", leftAt: null },
      { id: 20, name: "Ray Alvarez", leftAt: null },
    ];
    const before = computeStandings(players as never, [discover().match].filter((m) => m.leagueId === 1) as never);
    const edited = { ...discover().match, score: "3-6, 4-6", winnerId: 20 };
    const after = computeStandings(players as never, [edited].filter((m) => m.leagueId === 1) as never);
    expect(after).toEqual(before);
    expect(after.every((r) => r.wins === 0 && r.losses === 0)).toBe(true);
  });
});

describe("profile photos (#199)", () => {
  type Body = { you: { players: { playerId: number; avatarUrl: string | null }[] }; opponents: { players: { playerId: number; avatarUrl: string | null }[] } };
  const photo = (body: Body, id: number) => [...body.you.players, ...body.opponents.players].find((p) => p.playerId === id)?.avatarUrl;

  it("sends each player's photo, none for a placeholder or someone with a block", async () => {
    const doubles = (): MatchDetailData => ({
      ...league(),
      match: row({ player3Id: 30, player4Id: 40 }),
      league: { ...LEAGUE, leagueType: "doubles" },
      players: [
        { ...JOHN, avatarUrl: "/objects/uploads/john" },
        { ...RAY, avatarUrl: "/objects/uploads/ray" },
        { id: 30, name: "Sam", clerkUserId: null, avatarUrl: null },
        { id: 40, name: "Kim", clerkUserId: "user_d", avatarUrl: "/objects/uploads/kim" },
      ],
    });
    const res = await supertest(app(new MemoryRepo(doubles())).app).get("/api/me/matches/7");
    expect(res.status).toBe(200);
    expect(GetMyMatchResponse.safeParse(res.body).success).toBe(true);
    expect(photo(res.body, 10)).toBe("/objects/uploads/john");
    expect(photo(res.body, 20)).toBe("/objects/uploads/ray");
    expect(photo(res.body, 30)).toBeNull();
    expect(photo(res.body, 40)).toBe("/objects/uploads/kim");

    // Kim blocked John (or John blocked Kim): no photo either way.
    const after = await supertest(app(new MemoryRepo(doubles(), new Set(["user_d"]))).app).get("/api/me/matches/7");
    expect(photo(after.body, 40)).toBeNull();
    expect(photo(after.body, 20)).toBe("/objects/uploads/ray");
  });

  it("sends a Discover or Quick opponent's photo, and none across a block", async () => {
    const withPhotos = (data: MatchDetailData): MatchDetailData => ({
      ...data,
      players: [
        { ...JOHN, avatarUrl: "/objects/uploads/john" },
        { ...RAY, avatarUrl: "/objects/uploads/ray" },
      ],
    });
    for (const data of [discover(), quick()]) {
      const open = await supertest(app(new MemoryRepo(withPhotos(data))).app).get("/api/me/matches/7");
      expect(open.status).toBe(200);
      expect(open.body.opponents.players[0]).toMatchObject({ playerId: 20, avatarUrl: "/objects/uploads/ray" });
      expect(open.body.you.players[0].avatarUrl).toBe("/objects/uploads/john");

      const blocked = await supertest(app(new MemoryRepo(withPhotos(data), new Set(["user_b"]))).app).get("/api/me/matches/7");
      expect(blocked.status).toBe(200);
      expect(blocked.body.opponents.players[0]).toMatchObject({ playerId: 20, name: "Ray Alvarez", avatarUrl: null });
    }
  });

  it("never sends a photo for a Quick match placeholder", async () => {
    const res = await supertest(app(new MemoryRepo(quick({}, { id: 30, name: "Sam", clerkUserId: null }))).app).get("/api/me/matches/7");
    expect(res.body.opponents.players[0].avatarUrl).toBeNull();
  });
});
