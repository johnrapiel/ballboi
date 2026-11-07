import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { BAD_ADDRESS, findSameCourt, listCourts, parseNewCourt, type CourtRow, type NewCourt } from "../lib/courtDirectory";
import type { CourtRepo } from "../lib/courtRepo";
import { areaForZip } from "../lib/discoverArea";
import { createCourtsRouter } from "../routes/courts";
import { MemoryDiscoverRepo } from "./discoverMemoryRepo";

const wappingers = areaForZip("12590")!;
const beacon = areaForZip("12508")!;
const albany = areaForZip("12207")!;

const row = (id: number, name: string, zip: string, area = beacon): CourtRow => ({
  id,
  name,
  address: `${name}, ${area.town} NY ${zip}`,
  zip,
  town: area.town,
  latitude: area.point.latitude,
  longitude: area.point.longitude,
});

describe("adding a court", () => {
  it("needs a name and an address with a real ZIP", () => {
    expect(parseNewCourt({ name: "B", address: "Memorial Park, Beacon NY 12508" })).toEqual({ error: "Give the court a name." });
    expect(parseNewCourt({ name: "Beacon Courts", address: "Memorial Park, Beacon NY" })).toEqual({ error: BAD_ADDRESS });
    expect(parseNewCourt({ name: "Beacon Courts", address: "Somewhere 00000" })).toEqual({ error: BAD_ADDRESS });
    const ok = parseNewCourt({ name: "  Beacon   Courts ", address: "12 Main St, Beacon NY 12508-1234" }) as NewCourt;
    expect(ok).toMatchObject({ name: "Beacon Courts", zip: "12508", town: "Beacon" });
  });

  it("refuses links and phone numbers", () => {
    expect(parseNewCourt({ name: "Courts www.spam.com", address: "Beacon NY 12508" })).toHaveProperty("error");
    expect(parseNewCourt({ name: "Call 845 555 1234", address: "Beacon NY 12508" })).toHaveProperty("error");
  });

  it("treats the same name in the same ZIP as the same court", () => {
    const existing = [row(1, "Beacon Tennis Courts", "12508")];
    expect(findSameCourt(existing, { name: "beacon courts", zip: "12508" })?.id).toBe(1);
    expect(findSameCourt(existing, { name: "Beacon Courts", zip: "12590" })).toBeNull();
  });
});

describe("the list", () => {
  it("is nearest first, with an approximate distance, and searchable", () => {
    const courts = [row(1, "Albany Courts", "12207", albany), row(2, "Beacon Courts", "12508"), row(3, "Wappingers Park", "12590", wappingers)];
    const list = listCourts(wappingers.point, courts, "");
    expect(list.map((c) => c.name)).toEqual(["Wappingers Park", "Beacon Courts", "Albany Courts"]);
    expect(list[1].distance).toMatch(/^~\d+ mi$/);
    expect(listCourts(wappingers.point, courts, "beacon").map((c) => c.name)).toEqual(["Beacon Courts"]);
    expect(listCourts(null, courts, "")[0].distance).toBeNull();
  });
});

class MemoryCourtRepo implements CourtRepo {
  courts: CourtRow[] = [row(1, "Beacon Courts", "12508")];
  home = new Map<string, number | null>();
  added = 0;
  async near() {
    return this.courts;
  }
  async search(q: string) {
    return this.courts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  }
  async one(id: number) {
    return this.courts.find((c) => c.id === id) ?? null;
  }
  async inZip(zip: string) {
    return this.courts.filter((c) => c.zip === zip);
  }
  async addedToday() {
    return this.added;
  }
  async add(_me: string, c: NewCourt) {
    const r = { id: this.courts.length + 1, name: c.name, address: c.address, zip: c.zip, town: c.town, latitude: c.point.latitude, longitude: c.point.longitude };
    this.courts.push(r);
    return r;
  }
  async setHomeCourt(me: string, id: number | null) {
    this.home.set(me, id);
  }
  async homeCourt(me: string) {
    const id = this.home.get(me);
    return id ? (this.courts.find((c) => c.id === id) ?? null) : null;
  }
}

describe("court routes", () => {
  let courts: MemoryCourtRepo;
  let discover: MemoryDiscoverRepo;
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use("/api", createCourtsRouter(courts, discover));
    return supertest(a);
  };

  beforeEach(() => {
    mockUserId = "me";
    courts = new MemoryCourtRepo();
    discover = new MemoryDiscoverRepo();
    discover.mes.set("me", { userId: 1, clerkUserId: "me", name: "John", rating: 3.5, area: wappingers, homeZip: "12590", hidden: false, plays: null, radius: 10, slots: [] });
  });

  it("lists courts with your home court marked", async () => {
    courts.home.set("me", 1);
    const res = await app().get("/api/courts").expect(200);
    expect(res.body).toMatchObject({ homeCourtId: 1, courts: [{ courtId: 1, name: "Beacon Courts" }] });
  });

  it("adds a court others can find, picks an existing one instead of a copy, and explains a bad address", async () => {
    const added = await app().post("/api/courts").send({ name: "Memorial Park Courts", address: "Memorial Park, Beacon NY 12508" }).expect(201);
    expect(added.body).toMatchObject({ name: "Memorial Park Courts", existing: false });
    const again = await app().post("/api/courts").send({ name: "memorial park", address: "Beacon 12508" }).expect(200);
    expect(again.body).toMatchObject({ courtId: added.body.courtId, existing: true });
    await app().post("/api/courts").send({ name: "Lost Courts", address: "Nowhere" }).expect(400, { error: BAD_ADDRESS });
  });

  it("stops after too many additions in a day", async () => {
    courts.added = 10;
    await app().post("/api/courts").send({ name: "New Courts", address: "Beacon NY 12508" }).expect(429);
  });

  it("sets and clears your home court", async () => {
    const res = await app().put("/api/courts/home").send({ courtId: 1 }).expect(200);
    expect(res.body.court.name).toBe("Beacon Courts");
    await app().put("/api/courts/home").send({ courtId: 99 }).expect(404);
    await app().put("/api/courts/home").send({ courtId: "1" }).expect(400);
    expect((await app().put("/api/courts/home").send({ courtId: null }).expect(200)).body.court).toBeNull();
  });
});
