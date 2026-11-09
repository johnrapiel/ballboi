import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { areaForZip } from "../lib/discoverArea";
import { leagueCard, leagueState, levelText, nearbyLeagues, outsideLevel, type OpenLeagueCandidate } from "../lib/discoverLeagues";
import { createDiscoverRouter } from "../routes/discover";
import { MemoryDiscoverRepo } from "./discoverMemoryRepo";

const wappingers = areaForZip("12590")!;
const fishkill = areaForZip("12524")!;
const albany = areaForZip("12207")!;

function league(id: number, extra: Partial<OpenLeagueCandidate & { member: boolean }> = {}): OpenLeagueCandidate & { member: boolean } {
  return {
    leagueId: id,
    name: `League ${id}`,
    format: "flex",
    leagueType: "singles",
    location: "Riverfront Park",
    startDate: "2026-11-22",
    seasonWeeks: 8,
    minRating: "3.0",
    maxRating: "4.0",
    rosterCap: 16,
    organizerName: "Dave Moreno",
    point: fishkill.point,
    today: "2026-11-07",
    activePlayers: 13,
    myRequest: null,
    member: false,
    ...extra,
  };
}

describe("Open league rules", () => {
  it("spells the level range", () => {
    expect(levelText({ minRating: "3.0", maxRating: "4.0" })).toBe("Level 3.0 to 4.0");
    expect(levelText({ minRating: "3.5", maxRating: null })).toBe("Level 3.5 and up");
    expect(levelText({ minRating: null, maxRating: null })).toBe("All levels");
  });

  it("says outside your level, but never stops you asking", () => {
    expect(outsideLevel({ minRating: "4.0", maxRating: "4.5" }, 3.5)).toBe(true);
    expect(outsideLevel({ minRating: "3.0", maxRating: "4.0" }, 4.0)).toBe(false);
    expect(outsideLevel({ minRating: "3.0", maxRating: "4.0" }, null)).toBe(false);
  });

  it("takes requests before the season, and waitlists once it's started or full", () => {
    expect(leagueState(league(1))).toMatchObject({ left: 3, started: false, full: false, joining: "request" });
    expect(leagueState(league(1, { activePlayers: 16 }))).toMatchObject({ full: true, joining: "waitlist" });
    expect(leagueState(league(1, { startDate: "2026-11-01" }))).toMatchObject({ started: true, joining: "waitlist" });
    expect(leagueState(league(1, { rosterCap: null }))).toMatchObject({ left: null, joining: "request" });
  });

  it("builds the card lines and tags", () => {
    const c = leagueCard(wappingers.point, 3.5, league(1));
    expect(c.detail).toMatch(/^~\d+ mi · Flex · Singles · Level 3\.0 to 4\.0$/);
    expect(c.status).toBe("Starts Sun, Nov 22 · 3 spots left");
    expect(c.tags).toEqual([]);
    expect(leagueCard(wappingers.point, 3.5, league(2, { activePlayers: 16 })).status).toBe("Full · Waitlist for next season");
    expect(leagueCard(wappingers.point, 3.5, league(3, { minRating: "4.0", maxRating: "4.5", startDate: "2026-11-01" })).tags).toEqual([
      "outside_level",
      "started",
    ]);
  });

  it("keeps leagues inside the distance and counts each chip", () => {
    const { leagues, counts } = nearbyLeagues(wappingers.point, 3.5, [league(1), league(2, { point: albany.point })], 10);
    expect(leagues.map((l) => l.leagueId)).toEqual([1]);
    expect(counts.find((c) => c.radius === 30)!.count).toBe(1);
  });
});

describe("Open league routes", () => {
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
      plays: null,
      radius: 10,
      slots: [],
    });
    repo.leagues = [league(1), league(2, { member: true }), league(3, { myRequest: { kind: "waitlist", status: "pending" } })];
  });

  it("lists Open leagues you're not in", async () => {
    const res = await app().get("/api/discover/leagues").expect(200);
    expect(res.body.leagues.map((l: { leagueId: number }) => l.leagueId)).toEqual([1, 3]);
    expect(res.body.leagues[1].spoken).toMatch(/you're on the waitlist/);
  });

  it("D8: the Format filter shows only singles or only doubles, with a Doubles pill and partners named", async () => {
    repo.leagues = [league(1), league(4, { leagueType: "doubles", partnerMode: "fixed" }), league(5, { leagueType: "doubles", partnerMode: "rotating" })];
    const all = await app().get("/api/discover/leagues").expect(200);
    expect(all.body.leagues.map((l: { leagueId: number; doubles: boolean }) => [l.leagueId, l.doubles])).toEqual([[1, false], [4, true], [5, true]]);
    expect(all.body.leagues[1].spoken).toMatch(/flex, doubles, fixed partners/i);
    const doubles = await app().get("/api/discover/leagues?play=doubles").expect(200);
    expect(doubles.body.leagues.map((l: { leagueId: number }) => l.leagueId)).toEqual([4, 5]);
    expect(doubles.body.total).toBe(2);
    expect(doubles.body.counts.every((c: { count: number }) => c.count <= 2)).toBe(true);
    const singles = await app().get("/api/discover/leagues?play=singles").expect(200);
    expect(singles.body.leagues.map((l: { leagueId: number }) => l.leagueId)).toEqual([1]);
    const one = await app().get("/api/discover/leagues/5").expect(200);
    expect(one.body).toMatchObject({ type: "Doubles", partners: "Rotating partners" });
  });

  it("shows one league with where you stand", async () => {
    const res = await app().get("/api/discover/leagues/1").expect(200);
    expect(res.body).toMatchObject({ organizerName: "Dave Moreno", spotsLeft: 3, spotsTaken: 13, joining: "request", outsideLevel: false, startLabel: "Sun, Nov 22" });
    await app().get("/api/discover/leagues/99").expect(404);
  });
});
