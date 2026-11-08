import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { availabilitySummary, overlaps, parseSlots, slotOf } from "../lib/discoverAvailability";
import { approxMiles, areaForZip, distanceLabel, milesBetween, parseRadius, ZIP_NOT_FOUND, type Area } from "../lib/discoverArea";
import { fitsLevel, fitsLevels, fitsPlays, levelChip, levelRangeText, nearbyPlayers, parseFilters, parseLevels, type DiscoverCandidate } from "../lib/discoverPlayers";
import { MemoryDiscoverRepo } from "./discoverMemoryRepo";
import { countPlayed, EMPTY_RELIABILITY, reliabilityLine, type Reliability } from "../lib/reliability";
import { createDiscoverRouter } from "../routes/discover";

// Wappingers Falls (12590) and nearby towns, from the real ZIP data.
const wappingers = areaForZip("12590")!;
const fishkill = areaForZip("12524")!;
const beacon = areaForZip("12508")!;
const poughkeepsie = areaForZip("12601")!;
const albany = areaForZip("12207")!;

describe("home area", () => {
  it("places a real ZIP at its center with its town, rounded", () => {
    expect(wappingers.town).toBe("Wappingers Falls");
    expect(wappingers.state).toBe("NY");
    expect(wappingers.point.latitude).toBe(Math.round(wappingers.point.latitude * 100) / 100);
  });

  it("refuses a ZIP that isn't real or isn't five digits", () => {
    expect(areaForZip("00000")).toBeNull();
    expect(areaForZip("1259")).toBeNull();
    expect(areaForZip("abcde")).toBeNull();
    expect(areaForZip(12590)).toBeNull();
    expect(ZIP_NOT_FOUND).toBe("We couldn't find that ZIP. Check it and try again.");
  });

  it("only ever says an approximate whole number of miles", () => {
    expect(distanceLabel(0.2)).toBe("~1 mi");
    expect(distanceLabel(3.6)).toBe("~4 mi");
    expect(approxMiles(14.49)).toBe(14);
  });

  it("keeps a distance between 1 and 30 miles", () => {
    expect(parseRadius("15")).toBe(15);
    expect(parseRadius("0")).toBe(1);
    expect(parseRadius("100")).toBe(30);
    expect(parseRadius("12.4")).toBe(12);
    expect(parseRadius("nope", 5)).toBe(5);
    expect(parseRadius(undefined)).toBe(10);
  });
});

describe("level ranges", () => {
  it("Close to mine is within 0.5, Wider within 1.0, Any is everyone", () => {
    expect(fitsLevel(3.5, 4.0, "close")).toBe(true);
    expect(fitsLevel(3.5, 3.0, "close")).toBe(true);
    expect(fitsLevel(3.5, 4.5, "close")).toBe(false);
    expect(fitsLevel(3.5, 4.5, "wider")).toBe(true);
    expect(fitsLevel(3.5, 2.0, "wider")).toBe(false);
    expect(fitsLevel(3.5, 6.0, "any")).toBe(true);
  });

  it("shows players with no level only under Any, and everyone when you have no level", () => {
    expect(fitsLevel(3.5, null, "close")).toBe(false);
    expect(fitsLevel(3.5, null, "any")).toBe(true);
    expect(fitsLevel(null, 5.0, "close")).toBe(true);
  });

  it("spells the range out", () => {
    expect(levelRangeText(3.5, "close")).toBe("Level 3.0 to 4.0. You're 3.5.");
    expect(levelRangeText(3.5, "wider")).toBe("Level 2.5 to 4.5. You're 3.5.");
    expect(levelRangeText(3.5, "any")).toBe("Every level. You're 3.5.");
  });
});

describe("plays", () => {
  it("keeps players who play that format or both; Either keeps everyone", () => {
    expect(fitsPlays("singles", "singles")).toBe(true);
    expect(fitsPlays("both", "doubles")).toBe(true);
    expect(fitsPlays("doubles", "singles")).toBe(false);
    expect(fitsPlays(null, "singles")).toBe(false);
    expect(fitsPlays(null, "either")).toBe(true);
  });
});

describe("When you can play", () => {
  const eveningsMonFri = [0, 1, 2, 3, 4].flatMap((d) => [18, 19, 20].map((h) => slotOf(d, h)));

  it("accepts hours from 6 AM to 9 PM, Monday to Sunday, sorted without repeats", () => {
    expect(parseSlots([slotOf(6, 21), slotOf(0, 6), slotOf(0, 6)])).toEqual([slotOf(0, 6), slotOf(6, 21)]);
    expect(parseSlots([slotOf(0, 5)])).toHaveProperty("error");
    expect(parseSlots([slotOf(0, 22)])).toHaveProperty("error");
    expect(parseSlots([slotOf(7, 8)])).toHaveProperty("error");
    expect(parseSlots("Monday")).toHaveProperty("error");
    expect(parseSlots([])).toEqual([]);
  });

  it("matches players who share at least one free hour", () => {
    expect(overlaps(eveningsMonFri, [slotOf(2, 19)])).toBe(true);
    expect(overlaps(eveningsMonFri, [slotOf(2, 8)])).toBe(false);
    expect(overlaps([], [slotOf(2, 19)])).toBe(false);
    expect(overlaps(eveningsMonFri, null)).toBe(false);
  });

  it("summarizes a week the way the player card says it", () => {
    expect(availabilitySummary([])).toBeNull();
    expect(availabilitySummary([...eveningsMonFri, slotOf(5, 8), slotOf(6, 9)])).toBe("Weekday evenings, weekend mornings");
    expect(availabilitySummary([...eveningsMonFri, slotOf(5, 8)])).toBe("Weekday evenings, Saturday mornings");
    expect(availabilitySummary([slotOf(1, 19), slotOf(3, 19)])).toBe("Tuesday and Thursday evenings");
    expect(availabilitySummary([slotOf(0, 12)])).toBe("Monday afternoons");
  });
});

describe("reliability (F12, F13)", () => {
  const owner = (id: number) => ({ 1: "me", 2: "sam", 3: null, 4: "priya", 5: "me" })[id] ?? null;
  const match = (p1: number, p2: number, winner: number | null, p3: number | null = null, p4: number | null = null) => ({
    player1Id: p1,
    player2Id: p2,
    player3Id: p3,
    player4Id: p4,
    winnerId: winner,
  });

  it("counts scored matches against real Ball Boi players, with wins and losses", () => {
    expect(countPlayed("me", [match(1, 2, 1), match(2, 5, 2)], owner)).toEqual({ played: 2, wins: 1, losses: 1 });
  });

  it("doesn't count a match against a placeholder with no account", () => {
    expect(countPlayed("me", [match(1, 3, 1)], owner)).toEqual({ played: 0, wins: 0, losses: 0 });
  });

  it("counts doubles when anyone on the other side is a real player", () => {
    expect(countPlayed("me", [match(1, 3, 3, null, 4)], owner)).toEqual({ played: 1, wins: 0, losses: 1 });
  });

  it("says New to Ball Boi until there's something to show", () => {
    expect(reliabilityLine({ played: 0, noShows: 0 })).toBe("New to Ball Boi");
    expect(reliabilityLine({ played: 14, noShows: 1 })).toBe("Played 14 · 1 no-show");
    expect(reliabilityLine({ played: 12, noShows: 0 })).toBe("Played 12 · 0 no-shows");
  });
});

function candidate(userId: number, name: string, area: Area, extra: Partial<DiscoverCandidate> = {}): DiscoverCandidate {
  return {
    userId,
    clerkUserId: `u${userId}`,
    name,
    avatarUrl: null,
    rating: 3.5,
    ratingSource: "self",
    point: area.point,
    town: area.town,
    plays: "singles",
    slots: [],
    ...extra,
  };
}

describe("Players near you", () => {
  const me = { point: wappingers.point, rating: 3.5, slots: [slotOf(0, 18)] };
  const none = () => EMPTY_RELIABILITY;

  it("keeps everyone inside the distance and counts each chip", () => {
    const people = [
      candidate(1, "Fishkill Fran", fishkill),
      candidate(2, "Beacon Bo", beacon),
      candidate(3, "Pough Pat", poughkeepsie),
      candidate(4, "Albany Al", albany),
    ];
    const near = milesBetween(wappingers.point, fishkill.point);
    expect(near).toBeLessThan(10);
    const result = nearbyPlayers(me, people, parseFilters({ radius: "10" }, 10), none);
    expect(result.players.every((p) => Number(p.distance.replace(/\D/g, "")) <= 10)).toBe(true);
    expect(result.players.map((p) => p.name)).not.toContain("Albany Al");
    const counts = Object.fromEntries(result.counts.map((c) => [c.radius, c.count]));
    expect(counts[30]).toBeGreaterThanOrEqual(counts[15]);
    expect(counts[15]).toBeGreaterThanOrEqual(counts[10]);
    expect(counts[10]).toBeGreaterThanOrEqual(counts[5]);
    expect(counts[30]).toBe(3);
  });

  it("adds a count for a custom distance", () => {
    const result = nearbyPlayers(me, [candidate(1, "A", fishkill)], parseFilters({ radius: "12" }, 10), none);
    expect(result.counts.map((c) => c.radius)).toEqual([5, 10, 12, 15, 30]);
  });

  it("puts the nearest first, then the closest level", () => {
    const people = [
      candidate(1, "Same place, far level", wappingers, { rating: 4.0 }),
      candidate(2, "Same place, my level", wappingers, { rating: 3.5 }),
      candidate(3, "Farther", poughkeepsie, { rating: 3.5 }),
    ];
    const names = nearbyPlayers(me, people, parseFilters({ radius: "30" }, 10), none).players.map((p) => p.name);
    expect(names).toEqual(["Same place, my level", "Same place, far level", "Farther"]);
  });

  it("filters by level, plays and Free when I'm free", () => {
    const people = [
      candidate(1, "Close", wappingers, { rating: 3.0, plays: "both", slots: [slotOf(0, 18)] }),
      candidate(2, "Far level", wappingers, { rating: 4.5, plays: "singles" }),
      candidate(3, "Doubles only", wappingers, { rating: 3.5, plays: "doubles" }),
    ];
    const pick = (q: Record<string, unknown>) => nearbyPlayers(me, people, parseFilters(q, 10), none).players.map((p) => p.name);
    expect(pick({ level: "close" })).toEqual(["Doubles only", "Close"]);
    expect(pick({ level: "wider" })).toEqual(["Doubles only", "Close", "Far level"]);
    expect(pick({ level: "any", plays: "singles" })).toEqual(["Close", "Far level"]);
    expect(pick({ level: "any", free: "1" })).toEqual(["Close"]);
  });

  it("gives each row one line for VoiceOver and its reliability", () => {
    const r: Reliability = { played: 14, noShows: 1, wins: 9, losses: 5 };
    const [row] = nearbyPlayers(me, [candidate(1, "Sam Whitfield", fishkill)], parseFilters({}, 10), () => r).players;
    expect(row.reliability).toBe("Played 14 · 1 no-show");
    expect(row.spoken).toMatch(/^Sam Whitfield, level 3\.5, about \d+ miles? away, singles, played 14, 1 no-show$/);
  });
});

describe("Discover routes", () => {
  let repo: MemoryDiscoverRepo;
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use("/api", createDiscoverRouter(repo));
    return supertest(a);
  };

  beforeEach(() => {
    mockUserId = "me";
    repo = new MemoryDiscoverRepo();
    repo.mes.set("me", {
      userId: 1,
      clerkUserId: "me",
      name: "John",
      rating: 3.5,
      area: wappingers,
      homeZip: "12590",
      hidden: false,
      plays: "singles",
      radius: 10,
      slots: [],
    });
    repo.people = [candidate(2, "Sam Whitfield", fishkill, { slots: [slotOf(0, 18)] })];
    repo.accounts.set(2, "u2");
  });

  it("needs a sign-in", async () => {
    mockUserId = null;
    await app().get("/api/discover/players").expect(401);
  });

  it("returns your area with its town", async () => {
    const res = await app().get("/api/discover/me").expect(200);
    expect(res.body.area).toEqual({ zip: "12590", town: "Wappingers Falls", state: "NY" });
    expect(res.body.freeSummary).toBeNull();
  });

  it("changes your area, and refuses a ZIP it can't find without changing anything", async () => {
    await app().put("/api/discover/area").send({ zip: "00000" }).expect(400, { error: ZIP_NOT_FOUND });
    expect(repo.mes.get("me")!.homeZip).toBe("12590");
    const res = await app().put("/api/discover/area").send({ zip: "12524" }).expect(200);
    expect(res.body.area.town).toBe("Fishkill");
  });

  it("ignores Free when I'm free until you've set times (F11)", async () => {
    const res = await app().get("/api/discover/players?free=1").expect(200);
    expect(res.body.players).toHaveLength(1);
  });

  it("lists players with a count per chip, and saves a distance only when asked", async () => {
    const res = await app().get("/api/discover/players?radius=15").expect(200);
    expect(res.body.players[0]).toMatchObject({ name: "Sam Whitfield", reliability: "Played 3 · 0 no-shows" });
    expect(res.body.counts.map((c: { radius: number }) => c.radius)).toEqual([5, 10, 15, 30]);
    expect(repo.mes.get("me")!.radius).toBe(10);
    await app().put("/api/discover/settings").send({ radius: 15 }).expect(200);
    expect(repo.mes.get("me")!.radius).toBe(15);
  });

  it("asks for an area first when you have none", async () => {
    repo.mes.set("me", { ...repo.mes.get("me")!, area: null });
    const res = await app().get("/api/discover/players").expect(200);
    expect(res.body).toMatchObject({ players: [], needsArea: true });
  });

  it("saves the grid and summarizes it", async () => {
    const slots = [0, 1, 2, 3, 4].flatMap((d) => [18, 19, 20].map((h) => slotOf(d, h)));
    const res = await app().put("/api/discover/availability").send({ slots }).expect(200);
    expect(res.body.hoursFree).toBe(15);
    expect(res.body.freeSummary).toBe("Weekday evenings");
    await app().put("/api/discover/availability").send({ slots: [slotOf(0, 23)] }).expect(400);
  });

  it("hides you from Discover and shows you again", async () => {
    const res = await app().put("/api/discover/settings").send({ hidden: true }).expect(200);
    expect(res.body.hidden).toBe(true);
    await app().put("/api/discover/settings").send({ hidden: "yes" }).expect(400);
  });

  it("shows a player card with an approximate distance only", async () => {
    const res = await app().get("/api/discover/players/2").expect(200);
    expect(res.body).toMatchObject({ name: "Sam Whitfield", town: "Fishkill", wins: 2, losses: 1, played: 3, noShows: 0, freeSummary: "Monday evenings" });
    expect(res.body.distance).toMatch(/^~\d+ mi away$/);
    expect(res.body).not.toHaveProperty("point");
    await app().get("/api/discover/players/99").expect(404);
  });

  it("reports with the F9 reasons, needs a note for Something else, and can block in the same step", async () => {
    await app().post("/api/discover/players/2/report").send({ reason: "impersonation" }).expect(400);
    await app().post("/api/discover/players/2/report").send({ reason: "other" }).expect(400, { error: "Tell us what happened." });
    const res = await app().post("/api/discover/players/2/report").send({ reason: "unsafe", block: true }).expect(201);
    expect(res.body).toMatchObject({ status: "open", blocked: true });
    expect(repo.blocks).toEqual([["me", "u2"]]);
    await app().delete("/api/discover/players/2/block").expect(204);
    expect(repo.blocks).toEqual([]);
    await app().post("/api/discover/players/2/block").expect(204);
    expect(repo.blocks).toEqual([["me", "u2"]]);
  });

  it("can't report yourself", async () => {
    repo.accounts.set(1, "me");
    await app().post("/api/discover/players/1/report").send({ reason: "spam" }).expect(404);
  });
});

describe("Level chips (John, Nov 7: every level listed, yours selected by default)", () => {
  it("reads the levels picked in Filters", () => {
    expect(parseLevels("mine")).toBe("mine");
    expect(parseLevels("3.0,3.5,9")).toEqual([3, 3.5]);
    expect(parseLevels("")).toEqual([]);
    expect(parseLevels(undefined)).toBeNull();
  });

  it("rounds a rating onto the 2.5 to 5.0 chips", () => {
    expect(levelChip(3.4)).toBe(3.5);
    expect(levelChip(2.0)).toBe(2.5);
    expect(levelChip(6.0)).toBe(5);
  });

  it("shows only your level by default", () => {
    expect(fitsLevels(3.5, 3.5, "mine")).toBe(true);
    expect(fitsLevels(3.5, 4.0, "mine")).toBe(false);
    expect(fitsLevels(null, 4.0, "mine")).toBe(true);
  });

  it("shows any picked level, and every level when none is picked", () => {
    expect(fitsLevels(3.5, 4.0, [3.5, 4.0])).toBe(true);
    expect(fitsLevels(3.5, 4.5, [3.5, 4.0])).toBe(false);
    expect(fitsLevels(3.5, 4.5, [])).toBe(true);
    expect(fitsLevels(3.5, null, [3.5])).toBe(false);
    expect(fitsLevels(3.5, null, [])).toBe(true);
  });

  it("keeps the older Close / Wider / Any filter when no levels are sent", () => {
    expect(parseFilters({ level: "wider" }, 10).levels).toBeNull();
    expect(parseFilters({ levels: "mine" }, 10).levels).toBe("mine");
  });
});
