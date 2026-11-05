import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Discover, Court directory and home court (Wave 2, Session F). Spec: Discover.

let mockUserId: string | null = "me";
let mockAdmin = false;

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), db: {} }));
vi.mock("../middlewares/requireAdmin.js", () => ({
  requireAdmin: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) =>
    mockAdmin ? next() : res.status(403).json({ error: "Forbidden: admin access required" }),
}));

import { DAILY_COURT_LIMIT, findSameCourt, nearbyCourts, parseNewCourt, type CourtRow, type NewCourt } from "../lib/courtDirectory";
import type { CourtRepo } from "../lib/courtRepo";
import { milesBetween, zipCenter, type Point } from "../lib/discoverArea";
import type { DiscoverMe, DiscoverRepo } from "../lib/discoverRepo";
import { FirstMessageFilter } from "../messaging/filter";
import { createCourtsRouter } from "../routes/courts";

const HOME: Point = zipCenter("12590")!;
const north = (miles: number): Point => ({ latitude: HOME.latitude + miles / 69, longitude: HOME.longitude });
const ok = () => true;

const row = (over: Partial<CourtRow> & { id: number }): CourtRow => ({
  name: `Court ${over.id}`,
  place: null,
  zip: "12590",
  ...north(1),
  access: "public",
  surface: "hard",
  lights: true,
  courtCount: 4,
  ...over,
});

describe("parseNewCourt", () => {
  it("cleans a court and places it at the zip's center", () => {
    const c = parseNewCourt({ name: "  Rudd   Pond Courts ", zip: "12590" }, ok);
    expect(c).toEqual({
      name: "Rudd Pond Courts",
      place: null,
      zip: "12590",
      point: HOME,
      access: "public",
      surface: null,
      lights: null,
      courtCount: null,
    });
  });

  it("uses the phone's location when it's near the zip", () => {
    const here = north(2);
    expect((parseNewCourt({ name: "Here", zip: "12590", ...here }, ok) as NewCourt).point).toEqual(here);
  });

  it("ignores a phone location far from the zip", () => {
    expect((parseNewCourt({ name: "Here", zip: "12590", ...north(60) }, ok) as NewCourt).point).toEqual(HOME);
  });

  it("says what's wrong in the player's words", () => {
    expect(parseNewCourt({ name: "A", zip: "12590" }, ok)).toEqual({ error: "Give the court a name." });
    expect(parseNewCourt({ name: "Park", zip: "125" }, ok)).toEqual({ error: "Enter the court's 5-digit zip code." });
    expect(parseNewCourt({ name: "Park", zip: "00000" }, ok)).toMatchObject({ error: expect.stringMatching(/couldn't place/) });
    expect(parseNewCourt({ name: "Park", zip: "12590", surface: "sand" }, ok)).toEqual({ error: "Pick hard, clay, grass or other." });
    expect(parseNewCourt({ name: "Park", zip: "12590", courtCount: 0 }, ok)).toEqual({ error: "Courts must be a number from 1 to 60." });
    expect(parseNewCourt({ name: "Park", zip: "12590", access: "private" }, ok)).toEqual({ error: "Pick public or club." });
  });

  it("runs names through the text filter", () => {
    const filter = new FirstMessageFilter();
    const textOk = (t: string) => filter.check(t).ok;
    expect(parseNewCourt({ name: "Courts www.example.com", zip: "12590" }, textOk)).toEqual({
      error: "Court names and places can't include links, phone numbers or slurs.",
    });
  });
});

describe("findSameCourt and nearbyCourts", () => {
  it("treats the same name a few hundred yards away as the same court", () => {
    const existing = [row({ id: 1, name: "Rudd Pond Tennis Courts", ...HOME })];
    expect(findSameCourt(existing, { name: "rudd pond", point: north(0.1) })?.id).toBe(1);
    expect(findSameCourt(existing, { name: "rudd pond", point: north(1) })).toBeNull();
    expect(findSameCourt(existing, { name: "Kent Park", point: HOME })).toBeNull();
  });

  it("lists courts nearest first, within the radius, with approximate distance", () => {
    const list = nearbyCourts(HOME, [row({ id: 1, ...north(6) }), row({ id: 2, ...north(2) }), row({ id: 3, ...north(14) })], 10);
    expect(list.map((c) => c.courtId)).toEqual([2, 1]);
    expect(list[0]).toEqual({
      courtId: 2,
      name: "Court 2",
      place: null,
      access: "public",
      surface: "hard",
      lights: true,
      courtCount: 4,
      distanceLabel: "~2 mi away",
    });
  });
});

// ─── Routes, on in-memory repos ────────────────────────────────────────────

class MemoryCourts implements CourtRepo {
  courts: (CourtRow & { by: string; hidden: boolean; at: Date })[] = [];
  homes = new Map<string, number | null>();
  async near(point: Point, miles: number) {
    return this.courts.filter((c) => !c.hidden && milesBetween(point, c) <= miles);
  }
  async byId(id: number) {
    return this.courts.find((c) => c.id === id && !c.hidden) ?? null;
  }
  async addedSince(by: string, since: Date) {
    return this.courts.filter((c) => c.by === by && c.at > since).length;
  }
  async create(by: string, c: NewCourt) {
    const created = { id: this.courts.length + 1, ...c, ...c.point, by, hidden: false, at: new Date() };
    this.courts.push(created);
    return created;
  }
  async setHomeCourt(id: string, courtId: number | null) {
    if (courtId !== null && !(await this.byId(courtId))) return false;
    this.homes.set(id, courtId);
    return true;
  }
  async setHidden(courtId: number, hidden: boolean) {
    const c = this.courts.find((x) => x.id === courtId);
    if (!c) return false;
    c.hidden = hidden;
    return true;
  }
}

let courts: MemoryCourts;
let me: DiscoverMe | null;

function app() {
  const a = express();
  a.use(express.json());
  const discover = { me: async () => me } as unknown as DiscoverRepo;
  a.use("/api", createCourtsRouter(() => courts, () => discover, new FirstMessageFilter()));
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "me";
  mockAdmin = false;
  courts = new MemoryCourts();
  me = {
    userId: 100,
    clerkUserId: "me",
    point: HOME,
    homeZip: "12590",
    rating: 3.5,
    hidden: false,
    plays: null,
    freeTimes: null,
    homeCourt: null,
  };
});

describe("GET /courts", () => {
  it("needs sign-in", async () => {
    mockUserId = null;
    await app().get("/api/courts").expect(401);
  });

  it("lists courts near your home area and your home court", async () => {
    await courts.create("x", parseNewCourt({ name: "Kent Park", zip: "12590", ...north(3) }, ok) as NewCourt);
    await courts.create("x", parseNewCourt({ name: "Far Club", zip: "12590", ...north(20) }, ok) as NewCourt);
    me!.homeCourt = { courtId: 1, name: "Kent Park" };
    const res = await app().get("/api/courts").expect(200);
    expect(res.body.homeCourtId).toBe(1);
    expect(res.body.courts.map((c: { name: string }) => c.name)).toEqual(["Kent Park"]);
    expect((await app().get("/api/courts?radius=30")).body.courts).toHaveLength(2);
  });

  it("asks for a home area first", async () => {
    me = { ...me!, point: null, homeZip: null };
    const res = await app().get("/api/courts").expect(200);
    expect(res.body).toMatchObject({ courts: [], homeAreaProblem: "Add your home area so Discover can show players near you." });
  });
});

describe("POST /courts", () => {
  it("adds a missing court", async () => {
    const res = await app().post("/api/courts").send({ name: "Rudd Pond", zip: "12590", surface: "clay", courtCount: 2 }).expect(201);
    expect(res.body).toMatchObject({ courtId: 1, name: "Rudd Pond", surface: "clay", courtCount: 2, existing: false });
    expect(courts.courts[0].by).toBe("me");
  });

  it("returns the existing court instead of a duplicate", async () => {
    await app().post("/api/courts").send({ name: "Rudd Pond Courts", zip: "12590" }).expect(201);
    const res = await app().post("/api/courts").send({ name: "rudd pond", zip: "12590" }).expect(200);
    expect(res.body).toMatchObject({ courtId: 1, existing: true });
    expect(courts.courts).toHaveLength(1);
  });

  it("rejects a bad court", async () => {
    const res = await app().post("/api/courts").send({ name: "Call 555-123-4567", zip: "12590" }).expect(400);
    expect(res.body.error).toMatch(/links, phone numbers/);
  });

  it("stops at the daily limit", async () => {
    for (let i = 0; i < DAILY_COURT_LIMIT; i++) {
      await app().post("/api/courts").send({ name: `Court number ${i}`, zip: "12590", ...north(i * 0.5) }).expect(201);
    }
    const res = await app().post("/api/courts").send({ name: "One more", zip: "12590" }).expect(429);
    expect(res.body.error).toMatch(/courts a day/);
  });
});

describe("PUT /users/me/home-court", () => {
  it("sets and clears your home court", async () => {
    await app().post("/api/courts").send({ name: "Kent Park", zip: "12590" }).expect(201);
    await app().put("/api/users/me/home-court").send({ courtId: 1 }).expect(200, { homeCourtId: 1 });
    expect(courts.homes.get("me")).toBe(1);
    await app().put("/api/users/me/home-court").send({ courtId: null }).expect(200, { homeCourtId: null });
    expect(courts.homes.get("me")).toBeNull();
  });

  it("404s for a court that isn't there", async () => {
    await app().put("/api/users/me/home-court").send({ courtId: 9 }).expect(404);
    await app().put("/api/users/me/home-court").send({ courtId: "1" }).expect(400);
  });
});

describe("hiding a reported court", () => {
  it("is for moderators only, and hides it from the list", async () => {
    await app().post("/api/courts").send({ name: "Kent Park", zip: "12590" }).expect(201);
    await app().post("/api/admin/courts/1/hide").expect(403);
    mockAdmin = true;
    await app().post("/api/admin/courts/1/hide").expect(200, { courtId: 1, hidden: true });
    expect((await app().get("/api/courts")).body.courts).toEqual([]);
    await app().delete("/api/admin/courts/1/hide").expect(200, { courtId: 1, hidden: false });
    expect((await app().get("/api/courts")).body.courts).toHaveLength(1);
    await app().post("/api/admin/courts/9/hide").expect(404);
  });
});
