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

import { GetMyPlayerCardResponse } from "@workspace/api-zod";
import { seasonStats, seasonWindow, type CardMatch, type CardPerson, type SeasonWindow } from "../lib/playerCard";
import type { MatchData, PlayerCardRepo } from "../lib/playerCardRepo";
import { createPlayerCardsRouter } from "../routes/playerCards";

// The player card (decisions 138 to 140, John, Nov 8): your own on Profile,
// with This season by F13's rules (decision 121).

const T0 = new Date("2026-11-10T12:00:00Z");
const FALL: SeasonWindow = { name: "Fall 2026", from: "2026-09-01", to: "2026-12-31" };

/** Player rows: 1 is me, 2 and 3 are real players, 9 is a placeholder. */
const OWNER = new Map<number, string | null>([
  [1, "me"],
  [2, "priya"],
  [3, "theo"],
  [9, null],
]);
const m = (id: number, o: Partial<CardMatch>): CardMatch => ({
  id,
  player1Id: 1,
  player2Id: 2,
  player3Id: null,
  player4Id: null,
  winnerId: 1,
  completedAt: "2026-11-01T18:00:00Z",
  ...o,
});

describe("this season", () => {
  it("is the global season running today, else the calendar year", () => {
    const seasons = [
      { name: "Summer 2026", startDate: "2026-05-01", endDate: "2026-08-31" },
      { name: "Fall 2026", startDate: "2026-09-01", endDate: "2026-12-31" },
    ];
    expect(seasonWindow(seasons, "2026-11-10")).toEqual(FALL);
    expect(seasonWindow([seasons[0]], "2026-11-10")).toEqual({ name: "2026", from: "2026-01-01", to: "2026-12-31" });
  });

  it("counts matches against real players this season, with the streak from the latest", () => {
    const s = seasonStats(
      "me",
      [
        m(1, { completedAt: "2026-10-01T18:00:00Z", winnerId: 2 }),
        m(2, { completedAt: "2026-10-20T18:00:00Z", winnerId: 1 }),
        m(3, { completedAt: "2026-11-02T18:00:00Z", winnerId: 1, player2Id: 3 }),
        // Not this season, and a placeholder opponent: neither counts.
        m(4, { completedAt: "2026-08-20T18:00:00Z" }),
        m(5, { player2Id: 9 }),
        // Doubles with me on team 2.
        m(6, { completedAt: "2026-11-05T18:00:00Z", player1Id: 2, player3Id: 3, player2Id: 1, player4Id: 9, winnerId: 2 }),
      ],
      (id) => OWNER.get(id) ?? null,
      FALL,
      1,
    );
    expect(s).toEqual({ wins: 2, losses: 2, played: 4, streak: { won: false, count: 1 }, noShows: 1 });
  });

  it("has no streak before a first result", () => {
    expect(seasonStats("me", [], () => null, FALL, 0)).toEqual({ wins: 0, losses: 0, played: 0, streak: null, noShows: 0 });
  });
});

class MemoryCards implements PlayerCardRepo {
  people = new Map<string, CardPerson & { clerkUserId: string }>();
  matches: CardMatch[] = [];
  noShowCount = 0;
  windows: SeasonWindow[] = [];
  async me(clerkUserId: string) {
    return this.people.get(clerkUserId) ?? null;
  }
  async seasons() {
    return [{ name: "Fall 2026", startDate: "2026-09-01", endDate: "2026-12-31" }];
  }
  async scored() {
    return { matches: this.matches, owner: OWNER };
  }
  async noShows(_who: string, w: SeasonWindow) {
    this.windows.push(w);
    return this.noShowCount;
  }
  async other() {
    return null;
  }
  async blocked() {
    return new Set<string>();
  }
  async matchData(): Promise<MatchData> {
    throw new Error("not used here");
  }
  milestoneRows: { kind: "first_win"; earnedAt: string }[] = [];
  async milestones() {
    return this.milestoneRows;
  }
}

describe("GET /player-cards/me", () => {
  let repo: MemoryCards;
  const as = (u: string | null) => {
    mockUserId = u;
    const a = express();
    a.use("/api", createPlayerCardsRouter(repo, () => T0));
    return supertest(a);
  };

  beforeEach(() => {
    repo = new MemoryCards();
    repo.people.set("me", {
      clerkUserId: "me",
      userId: 11,
      name: "John Rapiel",
      avatarUrl: null,
      rating: 3.5,
      ratingSource: "self",
      town: "Wappingers Falls",
      plays: "singles",
      homeCourt: "Beacon Courts",
      slots: [18 + 24, 18],
    });
    repo.matches = [m(1, {}), m(2, { winnerId: 2, completedAt: "2026-11-03T18:00:00Z" })];
    repo.noShowCount = 0;
  });

  it("sends your card, only what you entered, and This season", async () => {
    const res = await as("me").get("/api/player-cards/me").expect(200);
    expect(GetMyPlayerCardResponse.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      you: true,
      name: "John Rapiel",
      rating: 3.5,
      plays: "singles",
      town: "Wappingers Falls",
      distance: null,
      homeCourt: "Beacon Courts",
      slots: [18, 42],
      season: { name: "Fall 2026", from: "2026-09-01", wins: 1, losses: 1, played: 2, streak: { won: false, count: 1 }, noShows: 0 },
    });
    expect(repo.windows).toEqual([FALL]);
  });

  it("carries the milestones you earned (decision 150)", async () => {
    repo.milestoneRows = [{ kind: "first_win", earnedAt: "2026-10-01T18:00:00.000Z" }];
    const res = await as("me").get("/api/player-cards/me").expect(200);
    expect(GetMyPlayerCardResponse.safeParse(res.body).success).toBe(true);
    expect(res.body.milestones).toEqual([{ kind: "first_win", earnedAt: "2026-10-01T18:00:00.000Z" }]);
  });

  it("asks you to finish your profile first, and needs sign-in", async () => {
    await as("nobody").get("/api/player-cards/me").expect(404);
    await as(null).get("/api/player-cards/me").expect(401);
  });
});
