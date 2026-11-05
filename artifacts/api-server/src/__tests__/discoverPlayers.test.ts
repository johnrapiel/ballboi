import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Discover, Players near you (Wave 2, Session F). Spec: Discover.

let mockUserId: string | null = "me";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), db: {} }));

import { boundingBox, distanceLabel, homeAreaPoint, milesBetween, parseRadius, zipCenter, type Point } from "../lib/discoverArea";
import { fitsLevel, nearbyPlayers, parseDiscoverSettings, parseFilters, DEFAULT_FILTERS, type DiscoverCandidate } from "../lib/discoverPlayers";
import { nearbyLeagues, levelRangeText, type OpenLeagueCandidate } from "../lib/discoverLeagues";
import type { DiscoverLeague, DiscoverMe, DiscoverPerson, DiscoverRepo } from "../lib/discoverRepo";
import { createDiscoverRouter, homeAreaProblem } from "../routes/discover";

// Wappingers Falls, NY (12590) and points roughly north of it.
const HOME: Point = { latitude: 41.6, longitude: -73.89 };
const north = (miles: number): Point => ({ latitude: HOME.latitude + miles / 69, longitude: HOME.longitude });

function candidate(over: Partial<DiscoverCandidate> & { userId: number }): DiscoverCandidate {
  return {
    name: `Player ${over.userId}`,
    avatarUrl: null,
    rating: 3.5,
    ratingSource: "self",
    point: north(2),
    plays: "both",
    freeTimes: ["weekends"],
    played: 0,
    ...over,
  };
}

describe("zip centers and distance", () => {
  it("places a zip at its Census center", () => {
    const p = zipCenter("12590");
    expect(p?.latitude).toBeCloseTo(41.596, 2);
    expect(p?.longitude).toBeCloseTo(-73.889, 2);
  });

  it("has no center for a zip that isn't a real five-digit zip", () => {
    expect(zipCenter("1259")).toBeNull();
    expect(zipCenter("00000")).toBeNull();
    expect(zipCenter(null)).toBeNull();
  });

  it("uses the rounded device point first, then the zip", () => {
    expect(homeAreaPoint({ zip: "12590", latitude: 41.50481, longitude: -73.96967 })).toEqual({ latitude: 41.5, longitude: -73.97 });
    expect(homeAreaPoint({ zip: "12590", latitude: null, longitude: null })).toEqual({ latitude: 41.6, longitude: -73.89 });
  });

  it("measures miles, roughly", () => {
    // Manhattan (10001) to Wappingers Falls is about 55 miles as the crow flies.
    const nyc = zipCenter("10001")!;
    expect(milesBetween(nyc, zipCenter("12590")!)).toBeGreaterThan(50);
    expect(milesBetween(nyc, zipCenter("12590")!)).toBeLessThan(62);
    expect(milesBetween(HOME, north(10))).toBeCloseTo(10, 0);
  });

  it("only ever says approximately how far", () => {
    expect(distanceLabel(0.3)).toBe("Under 1 mi away");
    expect(distanceLabel(4.4)).toBe("~4 mi away");
    expect(distanceLabel(4.6)).toBe("~5 mi away");
  });

  it("boxes every point within the radius", () => {
    const box = boundingBox(HOME, 30);
    const p = north(29.9);
    expect(p.latitude).toBeLessThan(box.maxLat);
    expect(box.minLon).toBeLessThan(HOME.longitude - 0.5);
  });

  it("takes only the four radius steps, 10 by default", () => {
    expect(parseRadius("5")).toBe(5);
    expect(parseRadius("30")).toBe(30);
    expect(parseRadius("50")).toBe(10);
    expect(parseRadius(undefined)).toBe(10);
  });
});

describe("nearbyPlayers", () => {
  const me = { point: HOME, rating: 3.5 };

  it("stays local: nobody past the radius, and a count at every step", () => {
    const list = [candidate({ userId: 1, point: north(3) }), candidate({ userId: 2, point: north(12) }), candidate({ userId: 3, point: north(25) })];
    const r = nearbyPlayers(me, list, DEFAULT_FILTERS);
    expect(r.players.map((p) => p.userId)).toEqual([1]);
    expect(r.counts).toEqual([
      { radius: 5, count: 1 },
      { radius: 10, count: 1 },
      { radius: 15, count: 2 },
      { radius: 30, count: 3 },
    ]);
  });

  it("sorts by distance, then by how close the level is", () => {
    const list = [
      candidate({ userId: 1, point: north(6), rating: 3.5 }),
      candidate({ userId: 2, point: north(2.2), rating: 4.0 }),
      candidate({ userId: 3, point: north(1.9), rating: 3.5 }),
    ];
    const r = nearbyPlayers(me, list, DEFAULT_FILTERS);
    expect(r.players.map((p) => p.userId)).toEqual([3, 2, 1]);
  });

  it("never shows an exact distance", () => {
    const r = nearbyPlayers(me, [candidate({ userId: 1, point: north(3.7) })], DEFAULT_FILTERS);
    expect(r.players[0].distanceLabel).toBe("~4 mi away");
    expect(r.players[0]).not.toHaveProperty("point");
  });

  it("keeps the level within half a point by default, a full point when wider, anything for any", () => {
    const list = [3.0, 3.5, 4.0, 4.5, 2.5].map((rating, i) => candidate({ userId: i + 1, rating }));
    const ids = (level: "near" | "wider" | "any") => nearbyPlayers(me, list, { ...DEFAULT_FILTERS, level }).players.map((p) => p.userId).sort();
    expect(ids("near")).toEqual([1, 2, 3]);
    expect(ids("wider")).toEqual([1, 2, 3, 4, 5]);
    const far = [...list, candidate({ userId: 9, rating: 5.0 }), candidate({ userId: 10, rating: null })];
    expect(nearbyPlayers(me, far, { ...DEFAULT_FILTERS, level: "any" }).players).toHaveLength(7);
  });

  it("shows every level when you haven't set yours", () => {
    expect(fitsLevel(null, 5.0, "near")).toBe(true);
    expect(fitsLevel(3.5, null, "near")).toBe(false);
  });

  it("filters on what they play and when they're free; Both counts for either", () => {
    const list = [
      candidate({ userId: 1, plays: "singles", freeTimes: ["weekday_evenings"] }),
      candidate({ userId: 2, plays: "doubles", freeTimes: ["weekends"] }),
      candidate({ userId: 3, plays: "both", freeTimes: null }),
      candidate({ userId: 4, plays: null, freeTimes: ["weekends", "weekday_evenings"] }),
    ];
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => nearbyPlayers(me, list, { ...DEFAULT_FILTERS, ...f }).players.map((p) => p.userId).sort();
    expect(ids({ plays: "singles" })).toEqual([1, 3]);
    expect(ids({ plays: "doubles" })).toEqual([2, 3]);
    expect(ids({ free: "weekends" })).toEqual([2, 4]);
    expect(ids({})).toEqual([1, 2, 3, 4]);
  });
});

describe("parsing", () => {
  it("falls back to defaults for unknown filters", () => {
    expect(parseFilters({ radius: "15", level: "wider", plays: "doubles", free: "weekends" }, parseRadius)).toEqual({
      radius: 15,
      level: "wider",
      plays: "doubles",
      free: "weekends",
    });
    expect(parseFilters({ level: "pro", plays: "mixed", free: "noon" }, parseRadius)).toEqual(DEFAULT_FILTERS);
  });

  it("checks settings", () => {
    expect(parseDiscoverSettings({ hidden: true })).toEqual({ hidden: true });
    expect(parseDiscoverSettings({ plays: "both", freeTimes: ["weekends", "weekday_mornings", "weekends"] })).toEqual({
      plays: "both",
      freeTimes: ["weekday_mornings", "weekends"],
    });
    expect(parseDiscoverSettings({ plays: null })).toEqual({ plays: null });
    expect(parseDiscoverSettings({ hidden: "yes" })).toEqual({ error: "Choose on or off." });
    expect(parseDiscoverSettings({ plays: "mixed" })).toEqual({ error: "Pick singles, doubles or both." });
    expect(parseDiscoverSettings({ freeTimes: ["noon"] })).toEqual({ error: "Pick from the times shown." });
  });
});

// ─── Routes, on an in-memory repo ──────────────────────────────────────────

class MemoryRepo implements DiscoverRepo {
  users = new Map<string, DiscoverMe>();
  people: DiscoverPerson[] = [];
  blocks: [string, number][] = [];
  async me(id: string) {
    return this.users.get(id) ?? null;
  }
  async near(viewer: string, _point: Point, _miles: number) {
    return this.people.filter((p) => p.clerkUserId !== viewer && !this.blocks.some(([b, u]) => b === viewer && u === p.userId));
  }
  async person(viewer: string, userId: number) {
    return (await this.near(viewer, HOME, 30)).find((p) => p.userId === userId) ?? null;
  }
  async saveSettings(id: string, input: { hidden?: boolean; plays?: string | null; freeTimes?: string[] }) {
    const u = this.users.get(id)!;
    this.users.set(id, {
      ...u,
      hidden: input.hidden ?? u.hidden,
      plays: input.plays !== undefined ? input.plays : u.plays,
      freeTimes: input.freeTimes ?? u.freeTimes,
    });
  }
  async block(viewer: string, userId: number) {
    if (!this.people.some((p) => p.userId === userId)) return false;
    this.blocks.push([viewer, userId]);
    return true;
  }
  async unblock(viewer: string, userId: number) {
    this.blocks = this.blocks.filter(([b, u]) => !(b === viewer && u === userId));
  }
  leagues: DiscoverLeague[] = [];
  async openLeagues() {
    return this.leagues;
  }
  async openLeague(_viewer: string, leagueId: number) {
    return this.leagues.find((l) => l.leagueId === leagueId) ?? null;
  }
}

let repo: MemoryRepo;

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", createDiscoverRouter(() => repo));
  return supertest(a);
}

const meRow = (over: Partial<DiscoverMe> = {}): DiscoverMe => ({
  userId: 100,
  clerkUserId: "me",
  point: HOME,
  homeZip: "12590",
  rating: 3.5,
  hidden: false,
  plays: null,
  freeTimes: null,
  homeCourt: null,
  ...over,
});

beforeEach(() => {
  mockUserId = "me";
  repo = new MemoryRepo();
  repo.users.set("me", meRow());
  repo.people = [
    { ...candidate({ userId: 1, name: "Theo Brandt", point: north(2), played: 12 }), clerkUserId: "theo" },
    { ...candidate({ userId: 2, name: "Sam Whitfield", point: north(4) }), clerkUserId: "sam" },
    { ...candidate({ userId: 3, name: "Far Away", point: north(28) }), clerkUserId: "far" },
  ];
});

describe("GET /discover/players", () => {
  it("needs sign-in", async () => {
    mockUserId = null;
    await app().get("/api/discover/players").expect(401);
  });

  it("lists players within 10 miles by default, with counts", async () => {
    const res = await app().get("/api/discover/players").expect(200);
    expect(res.body.players.map((p: { name: string }) => p.name)).toEqual(["Theo Brandt", "Sam Whitfield"]);
    expect(res.body.players[0]).toEqual({
      userId: 1,
      name: "Theo Brandt",
      avatarUrl: null,
      rating: 3.5,
      ratingSource: "self",
      distanceLabel: "~2 mi away",
      plays: "both",
      played: 12,
      noShows: 0,
    });
    expect(res.body.counts.at(-1)).toEqual({ radius: 30, count: 3 });
    expect(res.body.filters).toEqual({ radius: 10, level: "near", plays: "any", free: "any" });
  });

  it("widens to 30 miles at most", async () => {
    const res = await app().get("/api/discover/players?radius=30").expect(200);
    expect(res.body.players).toHaveLength(3);
  });

  it("asks for a home area before it shows anyone", async () => {
    repo.users.set("me", meRow({ point: null, homeZip: null }));
    const res = await app().get("/api/discover/players").expect(200);
    expect(res.body.players).toEqual([]);
    expect(res.body.homeAreaProblem).toBe("Add your home area so Discover can show players near you.");
  });

  it("says when a zip can't be placed", () => {
    expect(homeAreaProblem(meRow({ point: null, homeZip: "00000" }))).toMatch(/couldn't place zip code 00000/);
  });

  it("drops a blocked player", async () => {
    await app().post("/api/discover/players/1/block").expect(201);
    const res = await app().get("/api/discover/players").expect(200);
    expect(res.body.players.map((p: { userId: number }) => p.userId)).toEqual([2]);
    await app().delete("/api/discover/players/1/block").expect(204);
    expect((await app().get("/api/discover/players")).body.players).toHaveLength(2);
  });
});

describe("GET /discover/players/:userId", () => {
  it("shows a nearby player with approximate distance only", async () => {
    const res = await app().get("/api/discover/players/2").expect(200);
    expect(res.body).toMatchObject({ userId: 2, name: "Sam Whitfield", distanceLabel: "~4 mi away", freeTimes: ["weekends"] });
    expect(res.body).not.toHaveProperty("point");
    expect(res.body).not.toHaveProperty("clerkUserId");
  });

  it("404s for someone not in your Discover", async () => {
    await app().get("/api/discover/players/99").expect(404);
    await app().get("/api/discover/players/abc").expect(404);
    repo.people[0].point = north(45);
    await app().get("/api/discover/players/1").expect(404);
  });
});

describe("Discover settings", () => {
  it("reads and saves the hidden profile, plays and free times", async () => {
    expect((await app().get("/api/users/me/discover").expect(200)).body).toEqual({ hidden: false, plays: null, freeTimes: [], homeCourt: null });
    const res = await app().put("/api/users/me/discover").send({ hidden: true, plays: "singles", freeTimes: ["weekends"] }).expect(200);
    expect(res.body).toEqual({ hidden: true, plays: "singles", freeTimes: ["weekends"], homeCourt: null });
  });

  it("explains a bad value", async () => {
    const res = await app().put("/api/users/me/discover").send({ plays: "mixed" }).expect(400);
    expect(res.body.error).toBe("Pick singles, doubles or both.");
  });

  it("tells you your own profile is hidden", async () => {
    repo.users.set("me", meRow({ hidden: true }));
    expect((await app().get("/api/discover/players")).body.hidden).toBe(true);
  });
});

// ─── Open leagues (Wave 2, Discover PR 2) ──────────────────────────────────

function league(over: Partial<OpenLeagueCandidate> & { leagueId: number }): DiscoverLeague {
  return {
    name: `League ${over.leagueId}`,
    format: "flex",
    startDate: "2026-11-20",
    endDate: "2027-01-14",
    minRating: "3.0",
    maxRating: "4.0",
    rosterCap: 12,
    point: north(6),
    today: "2026-11-05",
    activePlayers: 9,
    myRequest: null,
    description: null,
    seasonWeeks: 8,
    playoffSize: 0,
    matchDay: null,
    matchTime: null,
    timeZone: "America/New_York",
    adminName: "Dana Lindqvist",
    ...over,
  };
}

describe("nearbyLeagues", () => {
  it("shows distance, level range, format, start date and spots left", () => {
    const [card] = nearbyLeagues(HOME, [league({ leagueId: 1, name: "Riverfront Mixed 3.5" })], 10);
    expect(card).toEqual({
      leagueId: 1,
      name: "Riverfront Mixed 3.5",
      format: "flex",
      levelRange: "3.0 to 4.0",
      startDate: "2026-11-20",
      distanceLabel: "~6 mi away",
      spotsLeft: 3,
      joining: "join",
      myRequest: null,
    });
  });

  it("puts leagues taking requests before full or started ones, then nearest", () => {
    const cards = nearbyLeagues(
      HOME,
      [
        league({ leagueId: 1, point: north(2), activePlayers: 12 }),
        league({ leagueId: 2, point: north(8) }),
        league({ leagueId: 3, point: north(3), startDate: "2026-11-01" }),
        league({ leagueId: 4, point: north(4), rosterCap: null }),
        league({ leagueId: 5, point: north(14) }),
      ],
      10,
    );
    expect(cards.map((c) => [c.leagueId, c.joining, c.spotsLeft])).toEqual([
      [4, "join", null],
      [2, "join", 3],
      [1, "waitlist", 0],
      [3, "waitlist", 3],
    ]);
  });

  it("words open-ended level ranges", () => {
    expect(levelRangeText({ minRating: "3.5", maxRating: null })).toBe("3.5 and up");
    expect(levelRangeText({ minRating: null, maxRating: "4.0" })).toBe("Up to 4.0");
    expect(levelRangeText({ minRating: null, maxRating: null })).toBe("All levels");
  });
});

describe("GET /discover/leagues", () => {
  it("lists Open leagues within the radius", async () => {
    repo.leagues = [league({ leagueId: 1 }), league({ leagueId: 2, point: north(20) })];
    const res = await app().get("/api/discover/leagues").expect(200);
    expect(res.body.radius).toBe(10);
    expect(res.body.leagues.map((l: { leagueId: number }) => l.leagueId)).toEqual([1]);
    const wide = await app().get("/api/discover/leagues?radius=30").expect(200);
    expect(wide.body.leagues).toHaveLength(2);
  });

  it("asks for a home area first", async () => {
    repo.users.set("me", meRow({ point: null, homeZip: null }));
    const res = await app().get("/api/discover/leagues").expect(200);
    expect(res.body).toEqual({ radius: 10, homeAreaProblem: "Add your home area so Discover can show players near you.", leagues: [] });
  });

  it("shows a preview with who runs it and how many play", async () => {
    repo.leagues = [league({ leagueId: 1, myRequest: "request" })];
    const res = await app().get("/api/discover/leagues/1").expect(200);
    expect(res.body).toMatchObject({ leagueId: 1, players: 9, rosterCap: 12, adminName: "Dana Lindqvist", myRequest: "request", seasonWeeks: 8 });
    expect(res.body).not.toHaveProperty("point");
    expect(res.body).not.toHaveProperty("miles");
  });

  it("404s for a league that isn't in your Discover", async () => {
    repo.leagues = [league({ leagueId: 1, point: north(40) })];
    await app().get("/api/discover/leagues/1").expect(404);
    await app().get("/api/discover/leagues/9").expect(404);
  });
});
