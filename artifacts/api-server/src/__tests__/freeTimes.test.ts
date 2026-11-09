// Free times (decision 156): conversion from the old hour grid, the shape the
// API accepts, "Free when I'm free" and the card summary, and the routes.

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  freeSummary,
  freeTimesOf,
  hoursFree,
  overlaps,
  parseFreeTimes,
  rangesFromSlots,
  type FreeRange,
} from "@workspace/free-times";
import { slotOf, timesOf } from "../lib/discoverAvailability";
import { areaForZip, type Area } from "../lib/discoverArea";
import { nearbyPlayers, parseFilters, type DiscoverCandidate } from "../lib/discoverPlayers";
import { cardView } from "../lib/playerCard";
import { EMPTY_RELIABILITY } from "../lib/reliability";
import { createDiscoverRouter } from "../routes/discover";
import { MemoryDiscoverRepo } from "./discoverMemoryRepo";

const wappingers = areaForZip("12590")!;
const fishkill = areaForZip("12524")!;
const h = (n: number) => n * 60;
const hours = (day: number, from: number, to: number) => Array.from({ length: to - from }, (_, i) => slotOf(day, from + i));

// The old overlap rule, kept here to prove the new one gives the same answer.
const oldOverlap = (a: number[], b: number[]) => a.length > 0 && b.some((s) => a.includes(s));

describe("converting the old hour grid", () => {
  it("turns a run that exactly covers a block into that block", () => {
    expect(rangesFromSlots(hours(1, 7, 11))).toEqual([{ day: 1, start: h(7), end: h(11) }]);
    expect(rangesFromSlots(hours(5, 12, 16))).toEqual([{ day: 5, start: h(12), end: h(16) }]);
    expect(rangesFromSlots(hours(2, 17, 21))).toEqual([{ day: 2, start: h(17), end: h(21) }]);
  });

  it("keeps anything else exactly, as custom times", () => {
    // 6 to 11 AM, a lone 9 PM hour, and two separate runs on one day.
    expect(rangesFromSlots(hours(0, 6, 11))).toEqual([{ day: 0, start: h(6), end: h(11) }]);
    expect(rangesFromSlots([slotOf(3, 21)])).toEqual([{ day: 3, start: h(21), end: h(22) }]);
    expect(rangesFromSlots([...hours(6, 8, 10), ...hours(6, 13, 15)])).toEqual([
      { day: 6, start: h(8), end: h(10) },
      { day: 6, start: h(13), end: h(15) },
    ]);
  });

  it("doesn't join runs across days, ignores repeats and order", () => {
    expect(rangesFromSlots([slotOf(1, 6), slotOf(0, 21), slotOf(0, 21)])).toEqual([
      { day: 0, start: h(21), end: h(22) },
      { day: 1, start: h(6), end: h(7) },
    ]);
  });

  it("loses no hour: converting back gives the same grid", () => {
    const grid = [...hours(0, 6, 22), ...hours(2, 9, 10), ...hours(4, 17, 21), ...hours(6, 6, 8)];
    const back = rangesFromSlots(grid).flatMap((r) => hours(r.day, r.start / 60, r.end / 60));
    expect(back.sort((a, b) => a - b)).toEqual([...grid].sort((a, b) => a - b));
    expect(hoursFree(rangesFromSlots(grid))).toBe(grid.length);
  });

  it("reads saved times first, and the grid only until they save", () => {
    const saved: FreeRange[] = [{ day: 1, start: h(17), end: h(21) }];
    expect(freeTimesOf({ ranges: saved, slots: hours(0, 7, 11) })).toEqual(saved);
    expect(freeTimesOf({ ranges: [], slots: hours(0, 7, 11) })).toEqual([]);
    expect(freeTimesOf({ ranges: null, slots: hours(0, 7, 11) })).toEqual([{ day: 0, start: h(7), end: h(11) }]);
    expect(timesOf({ slots: hours(0, 7, 11) })).toEqual([{ day: 0, start: h(7), end: h(11) }]);
  });
});

describe("what the API accepts", () => {
  it("takes a list of days with a start before the end, sorted and without repeats", () => {
    expect(
      parseFreeTimes([
        { day: 5, start: h(13), end: h(15) },
        { day: 1, start: h(17), end: h(21) },
        { day: 1, start: h(17), end: h(21) },
      ]),
    ).toEqual([
      { day: 1, start: h(17), end: h(21) },
      { day: 5, start: h(13), end: h(15) },
    ]);
    expect(parseFreeTimes([{ day: 0, start: h(22), end: 1440 }])).toEqual([{ day: 0, start: h(22), end: 1440 }]);
    expect(parseFreeTimes([])).toEqual([]);
  });

  it("refuses anything else in plain words", () => {
    expect(parseFreeTimes("evenings")).toEqual({ error: "Send your free times as a list." });
    for (const bad of [
      { day: 7, start: 0, end: 60 },
      { day: 0, start: h(20), end: h(18) },
      { day: 0, start: h(18), end: h(18) },
      { day: 0, start: -5, end: 60 },
      { day: 0, start: 0, end: 1441 },
      { day: 0, start: 1.5, end: 60 },
      { day: "Monday", start: 0, end: 60 },
    ]) {
      expect(parseFreeTimes([bad])).toEqual({ error: "Each time needs a day, Monday to Sunday, and a start before its end." });
    }
    const tooMany = Array.from({ length: 71 }, (_, i) => ({ day: i % 7, start: i, end: i + 1 }));
    expect(parseFreeTimes(tooMany)).toHaveProperty("error");
  });
});

describe("Free when I'm free", () => {
  it("matches when two weeks share any time on the same day", () => {
    const evening: FreeRange[] = [{ day: 1, start: h(17), end: h(21) }];
    expect(overlaps(evening, [{ day: 1, start: h(18), end: h(20) }])).toBe(true);
    expect(overlaps(evening, [{ day: 1, start: h(20) + 30, end: h(22) }])).toBe(true);
    // Touching at 9 PM isn't sharing time; nor is another day.
    expect(overlaps(evening, [{ day: 1, start: h(21), end: h(22) }])).toBe(false);
    expect(overlaps(evening, [{ day: 2, start: h(17), end: h(21) }])).toBe(false);
    expect(overlaps([], evening)).toBe(false);
    expect(overlaps(evening, null)).toBe(false);
  });

  it("gives the same results as the old grid for converted times", () => {
    const grids = [
      hours(0, 18, 21),
      hours(0, 6, 9),
      hours(0, 20, 22),
      hours(0, 21, 22),
      [...hours(2, 7, 11), ...hours(5, 12, 16)],
      hours(5, 16, 17),
      [],
      [slotOf(6, 6)],
    ];
    for (const a of grids) {
      for (const b of grids) {
        expect(overlaps(rangesFromSlots(a), rangesFromSlots(b))).toBe(oldOverlap(a, b));
      }
    }
  });

  it("filters Players near you with saved times or converted grids", () => {
    const person = (userId: number, extra: Partial<DiscoverCandidate>): DiscoverCandidate => ({
      userId,
      clerkUserId: `u${userId}`,
      name: `Player ${userId}`,
      avatarUrl: null,
      rating: 3.5,
      ratingSource: "self",
      point: fishkill.point,
      town: fishkill.town,
      plays: "singles",
      slots: [],
      ...extra,
    });
    const people = [
      person(1, { slots: hours(2, 18, 20) }),
      person(2, { freeTimes: [{ day: 2, start: h(19), end: h(20) }] }),
      person(3, { freeTimes: [], slots: hours(2, 18, 20) }),
      person(4, { freeTimes: [{ day: 2, start: h(6), end: h(7) }] }),
    ];
    const me = { point: wappingers.point, rating: 3.5, slots: [], freeTimes: [{ day: 2, start: h(18), end: h(20) }] };
    const names = nearbyPlayers(me, people, parseFilters({ free: "1" }, 10), () => EMPTY_RELIABILITY).players.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Player 1", "Player 2"]));
    expect(names).not.toContain("Player 3");
    expect(names).not.toContain("Player 4");
  });
});

describe("the card summary", () => {
  it("reads the new times", () => {
    const weekdayEvenings = [0, 1, 2, 3, 4].map((day) => ({ day, start: h(17), end: h(21) }));
    expect(freeSummary([...weekdayEvenings, { day: 5, start: h(7), end: h(11) }, { day: 6, start: h(7), end: h(11) }])).toBe(
      "Weekday evenings, weekend mornings",
    );
    expect(freeSummary([{ day: 1, start: h(18), end: h(20) }, { day: 3, start: h(19), end: h(21) }])).toBe(
      "Tuesday and Thursday evenings",
    );
    expect(freeSummary([{ day: 5, start: h(13), end: h(15) }])).toBe("Saturday afternoons");
    // A custom time across noon touches both parts of the day.
    expect(freeSummary([{ day: 0, start: h(11), end: h(13) }])).toBe("Monday mornings, Monday afternoons");
    expect(freeSummary([])).toBeNull();
  });

  it("reads converted grids exactly as before", () => {
    const eveningsMonFri = [0, 1, 2, 3, 4].flatMap((d) => hours(d, 18, 21));
    expect(freeSummary(rangesFromSlots([...eveningsMonFri, slotOf(5, 8), slotOf(6, 9)]))).toBe("Weekday evenings, weekend mornings");
    expect(freeSummary(rangesFromSlots([...eveningsMonFri, slotOf(5, 8)]))).toBe("Weekday evenings, Saturday mornings");
    expect(freeSummary(rangesFromSlots([slotOf(1, 19), slotOf(3, 19)]))).toBe("Tuesday and Thursday evenings");
    expect(freeSummary(rangesFromSlots([slotOf(0, 12)]))).toBe("Monday afternoons");
    expect(freeSummary(rangesFromSlots([slotOf(0, 11)]))).toBe("Monday mornings");
    expect(freeSummary(rangesFromSlots([slotOf(0, 16)]))).toBe("Monday afternoons");
    expect(freeSummary(rangesFromSlots([slotOf(0, 17)]))).toBe("Monday evenings");
  });

  it("puts times and the summary on the player card", () => {
    const view = cardView(
      { userId: 2, name: "Sam", avatarUrl: null, rating: 3.5, ratingSource: "self", town: null, plays: null, homeCourt: null, slots: hours(1, 17, 21) },
      { distance: null, you: false, milestones: [], season: { name: "Fall", wins: 0, losses: 0, played: 0, streak: null, noShows: 0 } as never },
    );
    expect(view.freeTimes).toEqual([{ day: 1, start: h(17), end: h(21) }]);
    expect(view.freeSummary).toBe("Tuesday evenings");
    expect(view.slots).toEqual(hours(1, 17, 21));
  });
});

describe("Free times routes", () => {
  let repo: MemoryDiscoverRepo;
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use("/api", createDiscoverRouter(repo));
    return supertest(a);
  };
  const me = (extra: { slots?: number[]; freeTimes?: FreeRange[] | null } = {}) =>
    repo.mes.set("me", {
      userId: 1,
      clerkUserId: "me",
      name: "John",
      rating: 3.5,
      area: wappingers as Area,
      homeZip: "12590",
      hidden: false,
      plays: "singles",
      radius: 10,
      slots: [],
      ...extra,
    });

  beforeEach(() => {
    mockUserId = "me";
    repo = new MemoryDiscoverRepo();
    me();
  });

  it("shows an old grid converted, and keeps the grid", async () => {
    me({ slots: [...hours(1, 7, 11), ...hours(3, 18, 20)] });
    const res = await app().get("/api/discover/me").expect(200);
    expect(res.body.freeTimes).toEqual([
      { day: 1, start: h(7), end: h(11) },
      { day: 3, start: h(18), end: h(20) },
    ]);
    expect(res.body.hoursFree).toBe(6);
    expect(res.body.slots).toHaveLength(6);
  });

  it("saves free times without touching the old grid", async () => {
    me({ slots: hours(0, 6, 8) });
    const freeTimes = [
      { day: 1, start: h(7), end: h(11) },
      { day: 2, start: h(18), end: h(20) },
      { day: 2, start: h(21), end: h(22) },
    ];
    const res = await app().put("/api/discover/availability").send({ freeTimes }).expect(200);
    expect(res.body.freeTimes).toEqual(freeTimes);
    expect(res.body.freeSummary).toBe("Tuesday mornings, Wednesday evenings");
    expect(repo.mes.get("me")!.slots).toEqual(hours(0, 6, 8));
  });

  it("clears free times with an empty list", async () => {
    me({ slots: hours(0, 6, 8) });
    const res = await app().put("/api/discover/availability").send({ freeTimes: [] }).expect(200);
    expect(res.body.freeTimes).toEqual([]);
    expect(res.body.freeSummary).toBeNull();
  });

  it("refuses a bad time and saves nothing", async () => {
    await app()
      .put("/api/discover/availability")
      .send({ freeTimes: [{ day: 1, start: h(20), end: h(18) }] })
      .expect(400, { error: "Each time needs a day, Monday to Sunday, and a start before its end." });
    expect(repo.mes.get("me")!.freeTimes ?? null).toBeNull();
  });

  it("still takes the grid from an old app version, which the new times then follow", async () => {
    me({ freeTimes: [{ day: 6, start: h(7), end: h(11) }] });
    const res = await app().put("/api/discover/availability").send({ slots: hours(0, 17, 21) }).expect(200);
    expect(res.body.freeTimes).toEqual([{ day: 0, start: h(17), end: h(21) }]);
  });

  it("uses saved times for Free when I'm free and the card", async () => {
    me({ freeTimes: [{ day: 0, start: h(18), end: h(19) }] });
    repo.people = [
      { userId: 2, clerkUserId: "u2", name: "Sam", avatarUrl: null, rating: 3.5, ratingSource: "self", point: fishkill.point, town: fishkill.town, plays: "singles", slots: hours(0, 18, 19) },
      { userId: 3, clerkUserId: "u3", name: "Priya", avatarUrl: null, rating: 3.5, ratingSource: "self", point: fishkill.point, town: fishkill.town, plays: "singles", slots: [], freeTimes: [{ day: 0, start: h(6), end: h(7) }] },
    ];
    const res = await app().get("/api/discover/players?free=1").expect(200);
    expect(res.body.players.map((p: { name: string }) => p.name)).toEqual(["Sam"]);
    const card = await app().get("/api/discover/players/3").expect(200);
    expect(card.body.freeSummary).toBe("Monday mornings");
  });
});
