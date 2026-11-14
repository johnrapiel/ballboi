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
  chatTitle,
  groupChatTitle,
  levelRange,
  nearbyOpenMatches,
  openMatchCard,
  parseNewOpenMatch,
  windowLabel,
  type NewOpenMatch,
  type OpenMatchRow,
} from "../lib/openMatch";
import type { JoinResult, OpenMatchRepo } from "../lib/openMatchRepo";
import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MessagingService, type NewMessageEvent } from "../messaging/service";
import { createOpenMatchesRouter, NOT_AVAILABLE, SPOT_FILLED, SPOT_OPEN_AGAIN } from "../routes/openMatches";
import { MemoryDiscoverRepo } from "./discoverMemoryRepo";

const H = 3_600_000;
const T0 = new Date("2026-11-10T15:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * H);
const wappingers = areaForZip("12590")!;
const beacon = areaForZip("12508")!;
const albany = areaForZip("12207")!;
const whitePlains = areaForZip("10601")!; // about 40 miles away

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

  it("names the group chat by day, time, format and court", () => {
    const m = { startsAt: new Date("2026-11-14T14:00:00Z"), format: "doubles", timeZone: "America/New_York", courtName: "Beacon Courts" };
    expect(chatTitle(m)).toBe("Sat 9 AM doubles");
    expect(groupChatTitle(m)).toBe("Sat 9 AM doubles · Beacon Courts");
    expect(groupChatTitle({ ...m, format: "singles", courtName: null, startsAt: new Date("2026-11-14T18:30:00Z") })).toBe("Sat 1:30 PM singles");
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
    expect(counts.find((c) => c.radius === 50)!.count).toBe(2);
  });

  it("reaches posts up to 50 miles away (decision 196)", () => {
    const far = [row({ id: 1, point: whitePlains.point })];
    expect(nearbyOpenMatches("b", wappingers.point, far, 30).matches).toHaveLength(0);
    const at50 = nearbyOpenMatches("b", wappingers.point, far, 50);
    expect(at50.matches.map((m) => m.id)).toEqual([1]);
    expect(at50.counts.find((c) => c.radius === 30)!.count).toBe(0);
    expect(at50.counts.find((c) => c.radius === 50)!.count).toBe(1);
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
  alerts: string[] = [];
  candidates: { clerkUserId: string; point: { latitude: number; longitude: number }; radius: number; rating: number | null; sentToday: number }[] = [];
  /** [blocker, blocked] pairs. */
  blocks: [string, string][] = [];
  /** Posters banned or suspended right now. */
  sanctioned = new Set<string>();
  private blockedWith(a: string, b: string) {
    return this.blocks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }
  // Mirrors the SQL in DrizzleOpenMatchRepo.near: blocks with the poster or anyone in, and sanctioned posters.
  /** The distance the route last read, in miles. */
  nearMiles: number | null = null;
  async near(viewer: string, _point: unknown, miles: number) {
    this.nearMiles = miles;
    return this.rows.filter(
      (r) => r.status === "open" && !this.sanctioned.has(r.posterClerkUserId) && ![r.posterClerkUserId, ...r.joined].some((x) => this.blockedWith(viewer, x)),
    );
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
    if ([r.posterClerkUserId, ...r.joined].some((x) => this.blockedWith(who, x))) return "blocked";
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
    // Mia (c) has no photo.
    return new Map(ids.map((id) => [id, { userId: n[id][0], name: n[id][1], rating: 3.5, avatarUrl: id === "c" ? null : `/objects/uploads/${id}` }]));
  }
  async courtName() {
    return "Beacon Courts";
  }
  async isBlocked(a: string, b: string) {
    return this.blockedWith(a, b);
  }
  async blockedAmong(me: string, others: string[]) {
    return new Set(others.filter((x) => x !== me && this.blockedWith(me, x)));
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
  // The group chat runs on the real messaging service, on in-memory parts (F15).
  let chatRepo: MemoryMessagingRepo;
  let chats: MessagingService;
  let messagePushes: NewMessageEvent[];
  let n = 0;
  const cid = () => `client-${String(++n).padStart(4, "0")}`;
  const as = (u: string) => {
    mockUserId = u;
    const a = express();
    a.use(express.json());
    a.use("/api", createOpenMatchesRouter(repo, discover, push as never, () => T0, chats));
    return supertest(a);
  };
  const block = (pairs: [string, string][]) => {
    repo.blocks = pairs;
    chatRepo.blocks = pairs;
  };
  const chat = async () => (await chats.groupForOpenMatch(1))!;
  const texts = async (who: string) => (await chats.groupThread(who, (await chat()).id)).messages.map((m) => m.text);

  beforeEach(() => {
    repo = new MemoryOpenMatches();
    chatRepo = new MemoryMessagingRepo({ now: () => T0 });
    messagePushes = [];
    chats = new MessagingService({
      repo: chatRepo,
      provider: new MemoryMessagingProvider({ now: () => T0 }),
      filter: new FirstMessageFilter(),
      now: () => T0,
      onNewMessage: (e) => void messagePushes.push(e),
    });
    for (const [id, name] of [["a", "Dana Lindqvist"], ["b", "Theo Brandt"], ["c", "Mia Kowalski"], ["d", "Sam Whitfield"]] as const) {
      chatRepo.names.set(id, { name, playerId: null, userId: id.charCodeAt(0) - 96 });
    }
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
    // Reads out to the widest chip so the 50 mi count is right.
    expect(repo.nearMiles).toBe(50);
  });

  it("lists your open matches with their start time, for Home's date order", async () => {
    await post().expect(201);
    const mine = await as("a").get("/api/open-matches/mine").expect(200);
    expect(mine.body.matches).toHaveLength(1);
    expect(mine.body.matches[0].startsAt).toBe(at(48).toISOString());
  });

  it("lists who else is in and the match it made, for Home's match card (finding 63)", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join").expect(200);
    const half = await as("b").get("/api/open-matches/mine").expect(200);
    expect(half.body.matches[0]).toMatchObject({ matchId: null, spotsLeft: 1, others: [{ name: "Dana Lindqvist", avatarUrl: "/objects/uploads/a" }] });
    await as("c").post("/api/open-matches/1/join").expect(200);
    const full = await as("b").get("/api/open-matches/mine").expect(200);
    expect(full.body.matches[0].matchId).toBe(99);
    // Never you; Mia has no photo.
    expect(full.body.matches[0].others).toEqual([
      { name: "Dana Lindqvist", avatarUrl: "/objects/uploads/a" },
      { name: "Mia Kowalski", avatarUrl: null },
    ]);
    // A block either way leaves them off your card.
    repo.blocks.push(["b", "c"]);
    const blocked = await as("b").get("/api/open-matches/mine").expect(200);
    expect(blocked.body.matches[0].others.map((o: { name: string }) => o.name)).toEqual(["Dana Lindqvist"]);
  });

  it("fills on the last spot, opens the group chat in Messages, and turns away a late join", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join").expect(200);
    expect(await chats.groupForOpenMatch(1)).toBeNull();
    const filled = await as("c").post("/api/open-matches/1/join").expect(200);
    expect(filled.body.status).toBe("full");
    const g = await chat();
    expect(filled.body.chatId).toBe(g.id);
    expect(g.title).toBe("Thu 10 AM doubles");
    expect(push).toHaveBeenLastCalledWith(["a", "b"], "Thu 10 AM doubles is full", expect.any(String), `/conversation/group/${g.id}`);
    expect((await texts("b"))[0]).toMatch(/^All 3 spots filled/);
    await as("d").post("/api/open-matches/1/join").expect(409, { error: SPOT_FILLED, code: "filled" });
    await chats.sendToGroup("b", g.id, { text: "See you Saturday", clientMessageId: cid() });
    expect(messagePushes.map((e) => e.recipientId).sort()).toEqual(["a", "c"]);
    expect(messagePushes[0].groupTitle).toBe(g.title);
    await expect(chats.groupThread("d", g.id)).rejects.toMatchObject({ status: 404 });
    expect((await chats.groups("a"))[0]).toMatchObject({ id: g.id, openMatchId: 1, memberCount: 3 });
  });

  it("takes a player who drops out out of the chat, which waits until the spot fills again", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    await as("c").post("/api/open-matches/1/join");
    const g = await chat();
    const res = await as("b").post("/api/open-matches/1/drop").expect(200);
    expect(res.body).toMatchObject({ status: "open", spotsLeft: 1 });
    expect(push).toHaveBeenLastCalledWith(["a"], expect.stringMatching(/dropped out/), expect.any(String), "/discover");
    await expect(chats.groupThread("b", g.id)).rejects.toMatchObject({ status: 404 });
    const asA = await chats.groupThread("a", g.id);
    expect(asA.group).toMatchObject({ canSend: false, sendBlockedReason: SPOT_OPEN_AGAIN });
    expect(asA.messages.at(-1)?.text).toBe("Theo Brandt dropped out. Their spot is open again in Discover.");
    // Filled again: the new player is in, and the chat opens.
    await as("d").post("/api/open-matches/1/join").expect(200);
    const again = await chats.groupThread("d", g.id);
    expect(again.group.canSend).toBe(true);
    expect((await chatRepo.groupMembers(g.id)).map((m) => m.userId).sort()).toEqual(["a", "c", "d"]);
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
    // Before it filled there's no chat to change.
    expect(await chats.groupForOpenMatch(1)).toBeNull();
  });

  it("takes a removed player out of a full match's chat", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    await as("c").post("/api/open-matches/1/join");
    await as("a").post("/api/open-matches/1/remove").send({ userId: 3 }).expect(200);
    const g = await chat();
    await expect(chats.groupThread("c", g.id)).rejects.toMatchObject({ status: 404 });
    expect((await texts("b")).at(-1)).toBe("Mia Kowalski is out. Their spot is open again in Discover.");
  });

  it("lets only the poster cancel, and tells everyone", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    await as("b").post("/api/open-matches/1/cancel").expect(403);
    await as("a").post("/api/open-matches/1/cancel").expect(200);
    expect(push).toHaveBeenLastCalledWith(["b"], expect.stringMatching(/canceled/), expect.any(String), "/discover");
    await as("b").get("/api/open-matches/1").expect(404);
  });

  it("keeps everyone in a canceled match's chat, read only, with the reason", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    await as("c").post("/api/open-matches/1/join");
    await as("a").post("/api/open-matches/1/cancel").expect(200);
    const thread = await chats.groupThread("c", (await chat()).id);
    expect(thread.group).toMatchObject({ canSend: false, sendBlockedReason: "This match was canceled." });
    expect(thread.messages.at(-1)?.text).toBe("Dana Lindqvist canceled this match. It's off everyone's schedule.");
  });

  it("makes the chat on open if a full match is missing one", async () => {
    await post();
    await as("b").post("/api/open-matches/1/join");
    const failing = chats.syncGroup.bind(chats);
    chats.syncGroup = async () => {
      throw new Error("Stream down");
    };
    await as("c").post("/api/open-matches/1/join").expect(200);
    chats.syncGroup = failing;
    expect(await chats.groupForOpenMatch(1)).toBeNull();
    const res = await as("b").get("/api/open-matches/1").expect(200);
    expect(res.body.chatId).toBe((await chat()).id);
  });

  describe("blocked players", () => {
    it("refuses a join when the joiner and anyone already in have a block, either way", async () => {
      await post();
      await as("b").post("/api/open-matches/1/join").expect(200);
      block([["c", "b"]]);
      await as("c").post("/api/open-matches/1/join").expect(404, { error: NOT_AVAILABLE, code: "unavailable" });
      block([["b", "c"]]);
      await as("c").post("/api/open-matches/1/join").expect(404, { error: NOT_AVAILABLE, code: "unavailable" });
      expect(repo.rows[0].joined).toEqual(["b"]);
      block([["a", "c"]]);
      await as("c").post("/api/open-matches/1/join").expect(404, { error: NOT_AVAILABLE, code: "unavailable" });
      block([]);
      await as("c").post("/api/open-matches/1/join").expect(200);
    });

    it("hides the post from a player with a block with anyone in it, in the list and on open", async () => {
      await post();
      await as("b").post("/api/open-matches/1/join");
      block([["b", "c"]]);
      const list = await as("c").get("/api/open-matches").expect(200);
      expect(list.body.matches).toHaveLength(0);
      await as("c").get("/api/open-matches/1").expect(404);
      const others = await as("d").get("/api/open-matches").expect(200);
      expect(others.body.matches).toHaveLength(1);
    });

    it("leaves alerts for new posts out for players with a block with the poster", async () => {
      block([["d", "a"]]);
      repo.candidates = ["c", "d"].map((clerkUserId) => ({ clerkUserId, point: wappingers.point, radius: 10, rating: 3.5, sentToday: 0 }));
      await post().expect(201);
      expect(repo.alerts).toEqual(["c"]);
      expect(push).toHaveBeenCalledWith(["c"], "New open match near you", expect.any(String), "/discover");
    });

    it("reads \"You\" on your own row but sends your real name and photo for the avatar (finding 62)", async () => {
      await post();
      await as("b").post("/api/open-matches/1/join");
      await as("c").post("/api/open-matches/1/join");
      const asB = await as("b").get("/api/open-matches/1").expect(200);
      const mine = asB.body.players.find((p: { me: boolean }) => p.me);
      expect(mine).toMatchObject({ name: "You", fullName: "Theo Brandt", avatarUrl: "/objects/uploads/b", userId: 2 });
      // Mia has no photo: her own row still gets her real name, so the avatar shows MK, not Y.
      const asC = await as("c").get("/api/open-matches/1").expect(200);
      expect(asC.body.players.find((p: { me: boolean }) => p.me)).toMatchObject({ name: "You", fullName: "Mia Kowalski", avatarUrl: null });
      // Everyone else's name and full name match.
      for (const p of asB.body.players.filter((x: { me: boolean }) => !x.me)) expect(p.fullName).toBe(p.name);
    });

    it("leaves blocked players out of each other's Players and group chat after both joined", async () => {
      await post();
      await as("b").post("/api/open-matches/1/join");
      await as("c").post("/api/open-matches/1/join");
      const g = await chat();
      await chats.sendToGroup("b", g.id, { text: "From Theo", clientMessageId: cid() });
      await chats.sendToGroup("c", g.id, { text: "From Mia", clientMessageId: cid() });
      block([["c", "b"]]);

      const asB = await as("b").get("/api/open-matches/1").expect(200);
      expect(asB.body.players.map((p: { userId: number }) => p.userId)).toEqual([1, 2]);
      expect(asB.body.spotsLeft).toBe(0);
      const asC = await as("c").get("/api/open-matches/1").expect(200);
      expect(asC.body.players.map((p: { userId: number }) => p.userId)).toEqual([1, 3]);
      const asA = await as("a").get("/api/open-matches/1").expect(200);
      expect(asA.body.players).toHaveLength(3);
      // Photos show for everyone left in; nobody gets a blocked player's photo.
      expect(asB.body.players.map((p: { avatarUrl: string | null }) => p.avatarUrl)).toEqual(["/objects/uploads/a", "/objects/uploads/b"]);
      expect(asC.body.players.map((p: { avatarUrl: string | null }) => p.avatarUrl)).toEqual(["/objects/uploads/a", null]);
      expect(asA.body.players.map((p: { avatarUrl: string | null }) => p.avatarUrl)).toEqual(["/objects/uploads/a", "/objects/uploads/b", null]);

      expect(await texts("b")).not.toContain("From Mia");
      expect(await texts("b")).toContain("From Theo");
      expect(await texts("c")).not.toContain("From Theo");
      expect(await texts("a")).toEqual(expect.arrayContaining(["From Theo", "From Mia"]));

      messagePushes = [];
      await chats.sendToGroup("c", g.id, { text: "Hi all", clientMessageId: cid() });
      expect(messagePushes.map((e) => [e.recipientId, e.senderName, e.text])).toEqual([["a", "Mia Kowalski", "Hi all"]]);
    });
  });

  it("leaves posts from banned or suspended players out of the list", async () => {
    await post();
    repo.sanctioned.add("a");
    const list = await as("b").get("/api/open-matches").expect(200);
    expect(list.body.matches).toHaveLength(0);
  });

  it("refuses a time that has passed", async () => {
    await as("a").post("/api/open-matches").send({ startsAt: at(-2).toISOString(), endsAt: at(-1).toISOString(), format: "singles" }).expect(400, { error: PAST_TIME });
  });
});
