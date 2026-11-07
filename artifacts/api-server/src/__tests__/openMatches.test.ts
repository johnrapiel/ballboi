import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "a";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn() }));

import { areaForZip } from "../lib/discoverArea";
import {
  ALERTS_PER_DAY,
  PAST_TIME,
  alertRecipients,
  levelRange,
  nearbyOpenMatches,
  openMatchCard,
  parseNewOpenMatch,
  windowLabel,
  type NewOpenMatch,
  type OpenMatchRow,
} from "../lib/openMatch";
import type { JoinResult, OpenMatchMessage, OpenMatchRepo } from "../lib/openMatchRepo";
import { createOpenMatchesRouter, SPOT_FILLED } from "../routes/openMatches";
import { MemoryDiscoverRepo } from "./discoverMemoryRepo";

const H = 3_600_000;
const T0 = new Date("2026-11-10T15:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * H);
const wappingers = areaForZip("12590")!;
const beacon = areaForZip("12508")!;
const albany = areaForZip("12207")!;

function row(extra: Partial<OpenMatchRow> = {}): OpenMatchRow {
  return {
    id: 1,
    posterClerkUserId: "a",
    posterName: "Dana Lindqvist",
    startsAt: at(48),
    endsAt: at(50),
    timeZone: "America/New_York",
    courtName: "Beacon Courts",
    format: "doubles",
    spots: 3,
    minRating: 3,
    maxRating: 4,
    note: null,
    status: "open",
    point: beacon.point,
    joined: [],
    ...extra,
  };
}

describe("posting", () => {
  it("refuses a time that has passed and checks the window and spots", () => {
    const base = { startsAt: at(24).toISOString(), endsAt: at(26).toISOString(), format: "doubles", spots: 2 };
    expect(parseNewOpenMatch({ ...base, startsAt: at(-1).toISOString() }, T0, 3.5)).toEqual({ error: PAST_TIME });
    expect(parseNewOpenMatch({ ...base, endsAt: at(23).toISOString() }, T0, 3.5)).toHaveProperty("error");
    expect(parseNewOpenMatch({ ...base, endsAt: at(31).toISOString() }, T0, 3.5)).toHaveProperty("error");
    expect(parseNewOpenMatch({ ...base, spots: 4 }, T0, 3.5)).toHaveProperty("error");
    expect(parseNewOpenMatch({ ...base, note: "call 845-555-1234" }, T0, 3.5)).toHaveProperty("error");
    const ok = parseNewOpenMatch({ ...base, format: "singles", spots: 3 }, T0, 3.5) as NewOpenMatch;
    expect(ok).toMatchObject({ format: "singles", spots: 1, minRating: 3, maxRating: 4 });
  });

  it("sets the level range around yours", () => {
    expect(levelRange("close", 3.5)).toEqual({ min: 3, max: 4 });
    expect(levelRange("wider", 3.5)).toEqual({ min: 2.5, max: 4.5 });
    expect(levelRange("any", 3.5)).toEqual({ min: null, max: null });
  });

  it("writes the window in the post's time zone", () => {
    expect(windowLabel(new Date("2026-11-14T14:00:00Z"), new Date("2026-11-14T16:00:00Z"), "America/New_York")).toBe("Sat, Nov 14 · 9 to 11 AM");
    expect(windowLabel(new Date("2026-11-14T16:00:00Z"), new Date("2026-11-14T18:00:00Z"), "America/New_York")).toBe("Sat, Nov 14 · 11 AM to 1 PM");
  });
});

describe("the list", () => {
  it("tags Need N on doubles only, and Your post", () => {
    expect(openMatchCard("b", wappingers.point, row({ joined: ["c"] })).tags).toEqual(["need"]);
    expect(openMatchCard("b", wappingers.point, row({ joined: ["c"] })).need).toBe(2);
    expect(openMatchCard("a", wappingers.point, row()).tags).toEqual(["your_post", "need"]);
    expect(openMatchCard("b", wappingers.point, row({ format: "singles", spots: 1 })).need).toBeNull();
    expect(openMatchCard("b", wappingers.point, row()).where).toMatch(/^Beacon Courts · ~\d+ mi · Dana Lindqvist$/);
  });

  it("keeps posts inside the distance, soonest first, with counts", () => {
    const { matches, counts } = nearbyOpenMatches("b", wappingers.point, [row({ id: 2, startsAt: at(60) }), row({ id: 1 }), row({ id: 3, point: albany.point })], 10);
    expect(matches.map((m) => m.id)).toEqual([1, 2]);
    expect(counts.find((c) => c.radius === 30)!.count).toBe(2);
  });
});

describe("alerts for new posts", () => {
  const person = (id: string, extra = {}) => ({ clerkUserId: id, point: wappingers.point, radius: 10, rating: 3.5, sentToday: 0, ...extra });
  const post = { poster: "a", point: beacon.point, minRating: 3, maxRating: 4 };

  it("goes to players near the post whose level fits, never the poster", () => {
    expect(alertRecipients(post, [person("a"), person("b"), person("c", { rating: 5 }), person("d", { point: albany.point })])).toEqual(["b"]);
  });

  it("stops at 2 a day", () => {
    expect(ALERTS_PER_DAY).toBe(2);
    expect(alertRecipients(post, [person("b", { sentToday: 1 }), person("c", { sentToday: 2 })])).toEqual(["b"]);
  });
});

class MemoryOpenMatches implements OpenMatchRepo {
  rows: (OpenMatchRow & { matchId: number | null })[] = [];
  removed = new Map<string, number[]>();
  msgs: OpenMatchMessage[] = [];
  alerts: string[] = [];
  candidates: { clerkUserId: string; point: { latitude: number; longitude: number }; radius: number; rating: number | null; sentToday: number }[] = [];
  async near() {
    return this.rows.filter((r) => r.status === "open");
  }
  async one(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r, joined: [...r.joined] } : null;
  }
  async create(poster: string, m: NewOpenMatch, courtName: string | null) {
    const id = this.rows.length + 1;
    this.rows.push({ ...row({ id, posterClerkUserId: poster, startsAt: m.startsAt, endsAt: m.endsAt, format: m.format, spots: m.spots, courtName }), matchId: null });
    return id;
  }
  async join(id: number, who: string): Promise<JoinResult> {
    const r = this.rows.find((x) => x.id === id)!;
    if (r.posterClerkUserId === who) return "own";
    if (r.status !== "open" || r.joined.length >= r.spots) return "full";
    r.joined.push(who);
    if (r.joined.length >= r.spots) {
      r.status = "full";
      r.matchId = 99;
      return "filled";
    }
    return "joined";
  }
  async leave(id: number, who: string, how: "dropped" | "removed") {
    const r = this.rows.find((x) => x.id === id)!;
    r.joined = r.joined.filter((x) => x !== who);
    if (r.status === "full") r.status = "open";
    if (how === "removed") this.removed.set(who, [...(this.removed.get(who) ?? []), id]);
    return true;
  }
  async cancel(id: number) {
    this.rows.find((x) => x.id === id)!.status = "canceled";
  }
  async messages(_id: number, after: number) {
    return this.msgs.filter((m) => m.id > after);
  }
  async send(_id: number, sender: string | null, text: string) {
    const m = { id: this.msgs.length + 1, senderClerkUserId: sender, text, createdAt: T0 };
    this.msgs.push(m);
    return m;
  }
  async mine(who: string) {
    return this.rows.filter((r) => r.posterClerkUserId === who || r.joined.includes(who));
  }
  async takeNotices(who: string) {
    const ids = this.removed.get(who) ?? [];
    this.removed.delete(who);
    return this.rows.filter((r) => ids.includes(r.id));
  }
  async people(ids: string[]) {
    const n: Record<string, [number, string]> = { a: [1, "Dana Lindqvist"], b: [2, "Theo Brandt"], c: [3, "Mia Kowalski"], d: [4, "Sam Whitfield"] };
    return new Map(ids.map((id) => [id, { userId: n[id][0], name: n[id][1], rating: 3.5 }]));
  }
  async courtName() {
    return "Beacon Courts";
  }
  async isBlocked() {
    return false;
  }
  async alertCandidates() {
    return this.candidates;
  }
  async logAlerts(ids: string[]) {
    this.alerts.push(...ids);
  }
}

describe("open match routes", () => {
  let repo: MemoryOpenMatches;
  let discover: MemoryDiscoverRepo;
  let push: ReturnType<typeof vi.fn>;
  const as = (u: string) => {
    mockUserId = u;
    const a = express();
    a.use(express.json());
    a.use("/api", createOpenMatchesRouter(repo, discover, push as never, () => T0));
    return supertest(a);
  };

  beforeEach(() => {
    repo = new MemoryOpenMatches();
    discover = new MemoryDiscoverRepo();
    push = vi.fn().mockResolvedValue(undefined);
    for (const [id, n] of [["a", 1], ["b", 2], ["c", 3], ["d", 4]] as const) {
      discover.mes.set(id, { userId: n, clerkUserId: id, name: id, rating: 3.5, area: wappingers, homeZip: "12590", hidden: false, plays: null, radius: 10, slots: [] });
    }
  });

  const post = () => as("a").post("/api/open-matches").send({ startsAt: at(48).toISOString(), endsAt: at(50).toISOString(), format: "doubles", spots: 2 });

  it("posts, alerts nearby players, and lists it", async () => {
    repo.candidates = [{ clerkUserId: "d", point: wappingers.point, radius: 10, rating: 3.5, sentToday: 0 }];
    const res = await post().expect(201);
    expect(res.body).toMatchObject({ role: "poster", spotsLeft: 2, total: 3 });
    expect(repo.alerts).toEqual(["d"]);
    expect(push).toHaveBeenCalledWith(["d"], "New open match near you", expect.stringMatching(/^Doubles, need 2/), "/discover");
    const list = await as("b").get("/api/open-matches").expect(200);
    expect(list.body.matches[0].tags).toEqual(["need"]);
  });

  it("fills on the last spot, opens the group chat, and turns away a late join", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join").expect(200);
    const filled = await as("c").post("/api/open-matches/1/join").expect(200);
    expect(filled.body.status).toBe("full");
    expect(repo.msgs[0].text).toMatch(/^All 3 spots filled/);
    await as("d").post("/api/open-matches/1/join").expect(409, { error: SPOT_FILLED, code: "filled" });
    const chat = await as("b").get("/api/open-matches/1/messages").expect(200);
    expect(chat.body.open).toBe(true);
    await as("b").post("/api/open-matches/1/messages").send({ text: "See you Saturday" }).expect(201);
    await as("d").get("/api/open-matches/1/messages").expect(404);
  });

  it("reopens a spot when someone drops out, and tells the poster", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    await as("c").post("/api/open-matches/1/join");
    const res = await as("b").post("/api/open-matches/1/drop").expect(200);
    expect(res.body).toMatchObject({ status: "open", spotsLeft: 1 });
    expect(push).toHaveBeenLastCalledWith(["a"], expect.stringMatching(/dropped out/), expect.any(String), "/discover");
  });

  it("lets the poster remove a player, who only hears it filled up", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    await as("c").post("/api/open-matches/1/remove").send({ userId: 2 }).expect(403);
    await as("a").post("/api/open-matches/1/remove").send({ userId: 2 }).expect(200);
    expect(push).toHaveBeenLastCalledWith(["b"], "This match filled up", expect.any(String), "/discover");
    const list = await as("b").get("/api/open-matches").expect(200);
    expect(list.body.notices).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/removed/i);
  });

  it("lets only the poster cancel, and tells everyone", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    await as("b").post("/api/open-matches/1/cancel").expect(403);
    await as("a").post("/api/open-matches/1/cancel").expect(200);
    expect(push).toHaveBeenLastCalledWith(["b"], expect.stringMatching(/canceled/), expect.any(String), "/discover");
    await as("b").get("/api/open-matches/1").expect(404);
  });

  it("refuses a time that has passed", async () => {
    await as("a").post("/api/open-matches").send({ startsAt: at(-2).toISOString(), endsAt: at(-1).toISOString(), format: "singles" }).expect(400, { error: PAST_TIME });
  });
});
