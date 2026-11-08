import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage.js", () => ({ ObjectStorageService: class {}, ObjectNotFoundError: class extends Error {} }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: { select: () => { throw new Error("No database in this test"); } } };
});

import { GetPlayerCardResponse, GetPlayerMatchesResponse } from "@workspace/api-zod";
import type { CardPerson } from "../lib/playerCard";
import type { MatchData, PlayerCardRepo } from "../lib/playerCardRepo";
import { playerMatches, type PMMatch, type PMPlayer } from "../lib/playerMatches";
import { createPlayerCardsRouter } from "../routes/playerCards";

// Other players' cards show their matches (decision 143, John, Nov 8):
// Upcoming matches and Results like your own Profile, with the winner mark
// and head-to-head. Every privacy rule in the brief has a test here.

const T0 = new Date("2026-11-10T12:00:00Z");

// Player rows. "priya" is the card's owner; "me" is looking at it.
const PLAYERS: PMPlayer[] = [
  { id: 1, name: "Priya Shah", clerkUserId: "priya" },
  { id: 2, name: "John Rapiel", clerkUserId: "me" },
  { id: 3, name: "Theo Brandt", clerkUserId: "theo" },
  { id: 4, name: "Sam Lee", clerkUserId: null }, // a placeholder, not on Ball Boi
  { id: 5, name: "Mike Okafor", clerkUserId: "mike" },
  // A stranger's Quick match before "Was that you?" Yes: an unlinked stand-in.
  { id: 6, name: "Priya Shah", clerkUserId: null },
  { id: 7, name: "Dana Lindqvist", clerkUserId: "dana" },
];

const match = (id: number, o: Partial<PMMatch>): PMMatch => ({
  id,
  leagueId: 10,
  roundId: 100,
  playoffBracketId: null,
  player1Id: 1,
  player2Id: 3,
  player3Id: null,
  player4Id: null,
  status: "completed",
  score: "6-4, 6-3",
  winnerId: 1,
  scheduledAt: null,
  completedAt: "2026-11-01T18:00:00Z",
  location: "Beacon Courts · Court 3",
  voidedAt: null,
  ...o,
});

function data(matches: PMMatch[], extra: Partial<MatchData> = {}): MatchData {
  return {
    matches,
    players: new Map(PLAYERS.map((p) => [p.id, p])),
    leagues: new Map([
      [10, { id: 10, name: "Tuesday Flex 3.5", visibility: "open", endedAt: null, timeZone: "America/New_York" }],
      [11, { id: 11, name: "Saturday Club", visibility: "private", endedAt: null, timeZone: "America/New_York" }],
    ]),
    rounds: new Map([
      [100, { id: 100, publishedAt: new Date("2026-10-26T12:00:00Z"), startDate: "2026-10-26", endDate: "2026-11-01" }],
      [101, { id: 101, publishedAt: new Date("2026-11-09T12:00:00Z"), startDate: "2026-11-09", endDate: "2026-11-15" }],
      [102, { id: 102, publishedAt: null, startDate: "2026-11-09", endDate: "2026-11-15" }],
    ]),
    plans: [],
    viewerLeagueIds: new Set([10]),
    userIds: new Map([
      ["priya", 21],
      ["me", 22],
      ["theo", 23],
      ["mike", 25],
      ["dana", 27],
    ]),
    ...extra,
  };
}

const run = (d: MatchData, blocked: string[] = []) => playerMatches({ ...d, target: "priya", viewer: "me", now: T0, blocked: new Set(blocked) });

describe("their matches", () => {
  it("lists results with both names, the winner and the score as stored, newest first", () => {
    const out = run(data([match(1, {}), match(2, { completedAt: "2026-11-05T18:00:00Z", player1Id: 3, player2Id: 1, winnerId: 3, score: "6-2, 6-2" })]));
    expect(out.results.map((r) => r.matchId)).toEqual([2, 1]);
    expect(out.results[0]).toMatchObject({ player1Name: "Theo Brandt", player2Name: "Priya Shah", winner: 1, score: "6-2, 6-2", context: "Tuesday Flex 3.5", player1UserId: 23 });
  });

  it("lists upcoming league matches in an open round, and Discover matches, in date order", () => {
    const out = run(
      data([match(3, { roundId: 101, status: "scheduled", score: null, winnerId: null, completedAt: null, scheduledAt: "2026-11-12T23:00:00Z" })], {
        plans: [{ id: 9, startsAt: new Date("2026-11-11T14:00:00Z"), otherClerkUserId: "mike", otherName: "Mike Okafor", score: null }],
      }),
    );
    expect(out.upcoming.map((u) => u.key)).toEqual(["plan-9", "m-3"]);
    expect(out.upcoming[0]).toMatchObject({ kind: "discover", context: "Discover", opponentName: "Mike Okafor", opponentUserId: 25, location: null });
    expect(out.upcoming[1]).toMatchObject({ kind: "league", opponentName: "Theo Brandt", playBy: "2026-11-15" });
  });

  it("shows head-to-head when you've played them", () => {
    const out = run(
      data([
        match(1, { player2Id: 2, winnerId: 1 }),
        match(2, { player2Id: 2, winnerId: 2, completedAt: "2026-11-02T18:00:00Z" }),
        match(3, { player2Id: 2, winnerId: 2, completedAt: "2026-11-03T18:00:00Z" }),
        match(4, {}),
      ]),
    );
    expect(out.headToHead).toEqual({ you: 2, them: 1 });
    expect(out.results.filter((r) => r.mine)).toHaveLength(3);
    expect(run(data([match(4, {})])).headToHead).toBeNull();
  });
});

describe("privacy", () => {
  it("leaves off a match against someone blocked with you", () => {
    const out = run(
      data([match(1, {}), match(2, { player2Id: 7 })], {
        plans: [{ id: 9, startsAt: new Date("2026-11-11T14:00:00Z"), otherClerkUserId: "dana", otherName: "Dana Lindqvist", score: null }],
      }),
      ["dana"],
    );
    expect(out.results.map((r) => r.matchId)).toEqual([1]);
    expect(out.upcoming).toEqual([]);
  });

  it("keeps a Quick match off their card until they answer Yes to Was that you?", () => {
    // Before Yes, the match sits on an unlinked stand-in row (6), so it isn't theirs.
    const before = run(data([match(5, { leagueId: null, roundId: null, player1Id: 5, player2Id: 6, winnerId: 5 })]));
    expect(before.results).toEqual([]);
    // After Yes, the row is theirs (1), and it shows as a Quick match.
    const after = run(data([match(5, { leagueId: null, roundId: null, player1Id: 5, player2Id: 1, winnerId: 5 })]));
    expect(after.results[0]).toMatchObject({ context: "Quick match", player1Name: "Mike Okafor", winner: 1 });
  });

  it("shows a placeholder opponent by name with no link", () => {
    const out = run(data([match(1, { player2Id: 4 })]));
    expect(out.results[0]).toMatchObject({ player2Name: "Sam Lee", player2UserId: null });
    const up = run(data([match(2, { roundId: 101, player2Id: 4, status: "scheduled", score: null, winnerId: null, completedAt: null })]));
    expect(up.upcoming[0]).toMatchObject({ opponentName: "Sam Lee", opponentUserId: null });
  });

  it("never shows cancelled or voided matches, or draft pairings", () => {
    const out = run(
      data([
        match(1, { status: "cancelled" }),
        match(2, { voidedAt: new Date("2026-11-02T00:00:00Z") }),
        match(3, { roundId: 102, status: "scheduled", score: null, winnerId: null, completedAt: null }),
      ]),
    );
    expect(out.results).toEqual([]);
    expect(out.upcoming).toEqual([]);
  });

  it("names a private league only to its members, and shows a court only in your own leagues", () => {
    const upcoming = (leagueId: number) =>
      run(data([match(1, { leagueId, roundId: 101, status: "scheduled", score: null, winnerId: null, completedAt: null })])).upcoming[0];
    expect(upcoming(10)).toMatchObject({ context: "Tuesday Flex 3.5", location: "Beacon Courts · Court 3" });
    expect(upcoming(11)).toMatchObject({ context: "League", location: null });
  });
});

class MemoryCards implements PlayerCardRepo {
  people = new Map<number, CardPerson & { clerkUserId: string; hidden?: boolean }>();
  blocks: [string, string][] = [];
  matches: PMMatch[] = [];
  async me() {
    return null;
  }
  async seasons() {
    return [{ name: "Fall 2026", startDate: "2026-09-01", endDate: "2026-12-31" }];
  }
  async scored() {
    return { matches: [], owner: new Map<number, string | null>() };
  }
  async noShows() {
    return 0;
  }
  async other(_viewer: string, userId: number) {
    const p = this.people.get(userId);
    return p ? { person: p, hidden: !!p.hidden, distance: "~4 mi away" } : null;
  }
  async blocked(who: string) {
    return new Set(this.blocks.flatMap(([a, b]) => (a === who ? [b] : b === who ? [a] : [])));
  }
  async matchData() {
    return data(this.matches);
  }
}

describe("player card routes", () => {
  let repo: MemoryCards;
  const as = (u: string) => {
    mockUserId = u;
    const a = express();
    a.use("/api", createPlayerCardsRouter(repo, () => T0));
    return supertest(a);
  };
  const priya = (o: Partial<CardPerson & { hidden: boolean }> = {}) => ({
    clerkUserId: "priya",
    userId: 21,
    name: "Priya Shah",
    avatarUrl: null,
    rating: 3.5,
    ratingSource: "self",
    town: "Fishkill",
    plays: "both",
    homeCourt: null,
    slots: [],
    ...o,
  });

  beforeEach(() => {
    repo = new MemoryCards();
    repo.people.set(21, priya());
    repo.matches = [match(1, { player2Id: 2, winnerId: 2 })];
  });

  it("sends their card with the distance, and their matches", async () => {
    const card = await as("me").get("/api/player-cards/21").expect(200);
    expect(GetPlayerCardResponse.safeParse(card.body).success).toBe(true);
    expect(card.body).toMatchObject({ you: false, name: "Priya Shah", town: "Fishkill", distance: "~4 mi away", plays: "both" });
    const res = await as("me").get("/api/player-cards/21/matches").expect(200);
    expect(GetPlayerMatchesResponse.safeParse(res.body).success).toBe(true);
    expect(res.body.headToHead).toEqual({ you: 1, them: 0 });
  });

  it("never shows a player who blocked you, or whom you blocked", async () => {
    repo.blocks = [["priya", "me"]];
    await as("me").get("/api/player-cards/21").expect(404);
    await as("me").get("/api/player-cards/21/matches").expect(404);
    repo.blocks = [["me", "priya"]];
    await as("me").get("/api/player-cards/21/matches").expect(404);
  });

  it("keeps a hidden profile hidden", async () => {
    repo.people.set(21, priya({ hidden: true }));
    const res = await as("me").get("/api/player-cards/21/matches").expect(404);
    expect(res.body.error).toBe("This player isn't in Discover right now.");
    await as("me").get("/api/player-cards/99").expect(404);
  });

  it("turns away a bad id", async () => {
    await as("me").get("/api/player-cards/abc/matches").expect(400);
  });
});
