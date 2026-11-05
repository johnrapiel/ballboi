import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Discover, match requests (Wave 2, Session F). Spec: Discover, "From found to playing".

let mockUserId: string | null = "me";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), db: {} }));
vi.mock("./../routes/notifications.js", () => ({ sendPushToUsers: vi.fn() }));

import type { CourtRepo } from "../lib/courtRepo";
import type { DiscoverPerson, DiscoverRepo } from "../lib/discoverRepo";
import type { MatchRequest, MatchRequestRepo, RequestChange } from "../lib/matchRequestRepo";
import { actionsFor, dueReminders, parseMatchRequest, parseWhen, phaseFor, whenLabel, type NewMatchRequest } from "../lib/matchRequests";
import { FirstMessageFilter } from "../messaging/filter";
import { createMatchRequestsRouter, runMatchRequestReminders, type Notify } from "../routes/matchRequests";

const TZ = "America/New_York";
// Wednesday Nov 5, 2026, 10:00 AM in New York.
const NOW = new Date("2026-11-05T15:00:00Z");
const ok = () => true;
const sat = { date: "2026-11-08", windowStart: "09:00", windowEnd: "11:00" };

describe("parseWhen and parseMatchRequest", () => {
  it("takes a half-hour window in the future", () => {
    expect(parseWhen(sat, TZ, NOW)).toEqual(sat);
    expect(parseWhen({ ...sat, windowStart: "09:15" }, TZ, NOW)).toEqual({ error: "Pick a start and end time on the hour or half hour." });
    expect(parseWhen({ ...sat, windowEnd: "08:00" }, TZ, NOW)).toEqual({ error: "The end time has to be after the start time." });
    expect(parseWhen({ ...sat, windowEnd: "16:00" }, TZ, NOW)).toEqual({ error: "Keep the time window to 6 hours." });
    expect(parseWhen({ date: "2026-11-05", windowStart: "09:00", windowEnd: "10:00" }, TZ, NOW)).toEqual({
      error: "Pick a time that hasn't started yet.",
    });
    expect(parseWhen({ ...sat, date: "2027-02-01" }, TZ, NOW)).toEqual({ error: "Pick a day in the next 60 days." });
  });

  it("checks the player, time zone, kind and note", () => {
    const body = { ...sat, toUserId: 2, timeZone: TZ };
    expect(parseMatchRequest(body, ok, NOW)).toEqual({ ...sat, toUserId: 2, timeZone: TZ, courtId: null, kind: "singles", note: null });
    expect(parseMatchRequest({ ...body, toUserId: "2" }, ok, NOW)).toEqual({ error: "Pick a player." });
    expect(parseMatchRequest({ ...body, timeZone: "Mars/Base" }, ok, NOW)).toMatchObject({ error: expect.stringMatching(/time zone/) });
    expect(parseMatchRequest({ ...body, kind: "doubles" }, ok, NOW)).toEqual({ error: "Pick singles or a practice hit." });
    const filter = new FirstMessageFilter();
    expect(parseMatchRequest({ ...body, note: "text me 555-123-4567" }, (t) => filter.check(t).ok, NOW)).toMatchObject({
      error: expect.stringMatching(/phone numbers/),
    });
  });

  it("words the time like a person would", () => {
    expect(whenLabel(sat)).toBe("Sun, Nov 8, 9 to 11 AM");
    expect(whenLabel({ date: "2026-11-07", windowStart: "11:30", windowEnd: "13:00" })).toBe("Sat, Nov 7, 11:30 AM to 1 PM");
    expect(whenLabel({ date: "2026-11-07", windowStart: "18:00", windowEnd: "20:30" })).toBe("Sat, Nov 7, 6 to 8:30 PM");
  });
});

// ─── In-memory repos ───────────────────────────────────────────────────────

class MemoryRequests implements MatchRequestRepo {
  rows: MatchRequest[] = [];
  matches = new Map<number, { scored: boolean; cancelled: boolean }>();
  names = new Map([
    ["me", { userId: 1, name: "Jo Rivera" }],
    ["theo", { userId: 2, name: "Theo Brandt" }],
    ["sam", { userId: 3, name: "Sam Whitfield" }],
  ]);
  clock = 0;
  async create(from: string, to: string, input: Omit<NewMatchRequest, "toUserId">) {
    const r: MatchRequest = {
      id: this.rows.length + 1,
      fromClerkUserId: from,
      toClerkUserId: to,
      ...input,
      status: "pending",
      waitingOnClerkUserId: to,
      counters: 0,
      matchId: null,
      fromConfirmedAt: null,
      toConfirmedAt: null,
      confirmPromptSentAt: null,
      reminderSentAt: null,
      noShowClerkUserId: null,
      cancelledByClerkUserId: null,
      createdAt: new Date(NOW.getTime() + this.clock++),
      updatedAt: new Date(NOW.getTime() + this.clock++),
    };
    this.rows.push(r);
    return r;
  }
  async byId(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async mine(id: string) {
    return this.rows.filter((r) => r.fromClerkUserId === id || r.toClerkUserId === id).reverse();
  }
  async openBetween(a: string, b: string) {
    return this.rows.filter(
      (r) =>
        ["pending", "accepted"].includes(r.status) &&
        ((r.fromClerkUserId === a && r.toClerkUserId === b) || (r.fromClerkUserId === b && r.toClerkUserId === a)),
    );
  }
  async sentSince(id: string) {
    return this.rows.filter((r) => r.fromClerkUserId === id).length;
  }
  async update(r: MatchRequest, change: RequestChange) {
    const i = this.rows.findIndex((x) => x.id === r.id);
    const cur = this.rows[i];
    if (cur.status !== r.status || cur.updatedAt.getTime() !== r.updatedAt.getTime()) return null;
    this.rows[i] = { ...cur, ...change, updatedAt: new Date(NOW.getTime() + 1000 + this.clock++) };
    return this.rows[i];
  }
  async makeMatch() {
    const id = 500 + this.matches.size;
    this.matches.set(id, { scored: false, cancelled: false });
    return id;
  }
  async cancelMatch(id: number) {
    this.matches.get(id)!.cancelled = true;
  }
  async people(ids: string[]) {
    return new Map(ids.filter((i) => this.names.has(i)).map((i) => [i, this.names.get(i)!]));
  }
  async courtNames(ids: number[]) {
    return new Map(ids.filter((i) => i === 7).map((i) => [i, "Kent Park"]));
  }
  async scored(ids: number[]) {
    return new Set(ids.filter((i) => this.matches.get(i)?.scored));
  }
  async acceptedAround() {
    return this.rows.filter((r) => r.status === "accepted");
  }
  async claim(id: number, field: "confirmPromptSentAt" | "reminderSentAt") {
    const r = this.rows.find((x) => x.id === id)!;
    if (r[field]) return false;
    r[field] = new Date();
    return true;
  }
  async noShowCounts() {
    return new Map<string, number>();
  }
}

const person = (userId: number, clerkUserId: string, name: string): DiscoverPerson => ({
  userId,
  clerkUserId,
  name,
  avatarUrl: null,
  rating: 3.5,
  ratingSource: "self",
  point: { latitude: 41.6, longitude: -73.9 },
  plays: null,
  freeTimes: null,
  played: 0,
});

let requests: MatchRequestRepo & MemoryRequests;
let now: Date;
let blocked: Set<string>;
let notify: ReturnType<typeof vi.fn<Notify>>;

function app() {
  const a = express();
  a.use(express.json());
  const discover = {
    person: async (_v: string, id: number) => [person(2, "theo", "Theo Brandt"), person(3, "sam", "Sam Whitfield")].find((p) => p.userId === id) ?? null,
  } as unknown as DiscoverRepo;
  const courts = { byId: async (id: number) => (id === 7 ? { id: 7 } : null) } as unknown as CourtRepo;
  a.use(
    "/api",
    createMatchRequestsRouter({
      requests: () => requests,
      discover: () => discover,
      courts: () => courts,
      blocked: async () => blocked,
      notify,
      filter: new FirstMessageFilter(),
      now: () => now,
    }),
  );
  return supertest(a);
}

const send = (over: Record<string, unknown> = {}) =>
  app()
    .post("/api/match-requests")
    .send({ ...sat, toUserId: 2, timeZone: TZ, courtId: 7, kind: "singles", note: "Bring balls?", ...over });

beforeEach(() => {
  mockUserId = "me";
  requests = new MemoryRequests();
  now = NOW;
  blocked = new Set();
  notify = vi.fn<Notify>().mockResolvedValue(undefined);
});

describe("sending a match request", () => {
  it("needs sign-in", async () => {
    mockUserId = null;
    await app().get("/api/match-requests").expect(401);
  });

  it("sends one and tells the other player", async () => {
    const res = await send().expect(201);
    expect(res.body).toMatchObject({
      requestId: 1,
      phase: "waiting_on_them",
      actions: ["withdraw"],
      when: "Sun, Nov 8, 9 to 11 AM",
      court: { courtId: 7, name: "Kent Park" },
      other: { userId: 2, name: "Theo Brandt" },
      sentByMe: true,
    });
    expect(notify).toHaveBeenCalledWith(["theo"], "Match request from Jo Rivera", "Singles, Sun, Nov 8, 9 to 11 AM at Kent Park.", "/match-requests/1");
  });

  it("only goes to players in your Discover", async () => {
    await send({ toUserId: 9 }).expect(404);
  });

  it("keeps one open request between two players", async () => {
    await send().expect(201);
    const res = await send().expect(409);
    expect(res.body).toMatchObject({ requestId: 1, error: expect.stringMatching(/already have a match request with Theo Brandt/) });
    mockUserId = "theo";
    requests.names.set("theo", { userId: 2, name: "Theo Brandt" });
  });

  it("rejects a court that isn't in the directory", async () => {
    await send({ courtId: 99 }).expect(400);
  });
});

describe("answering", () => {
  it("goes request, counter, accept, confirm, then score or no-show", async () => {
    await send().expect(201);

    mockUserId = "theo";
    let res = await app().get("/api/match-requests/1").expect(200);
    expect(res.body).toMatchObject({ phase: "waiting_on_you", actions: ["accept", "counter", "decline"], sentByMe: false });

    res = await app()
      .post("/api/match-requests/1/counter")
      .send({ date: "2026-11-08", windowStart: "10:00", windowEnd: "12:00" })
      .expect(200);
    expect(res.body).toMatchObject({ phase: "waiting_on_them", when: "Sun, Nov 8, 10 AM to 12 PM", counters: 1 });
    expect(notify).toHaveBeenLastCalledWith(["me"], "Theo Brandt suggested a new time", expect.any(String), "/match-requests/1");

    mockUserId = "me";
    res = await app().post("/api/match-requests/1/accept").expect(200);
    expect(res.body).toMatchObject({ phase: "upcoming", actions: ["cancel"], matchId: 500 });

    // Saturday morning, the day before: both confirm.
    now = new Date("2026-11-07T13:00:00Z");
    res = await app().get("/api/match-requests/1").expect(200);
    expect(res.body).toMatchObject({ phase: "to_confirm", actions: ["confirm", "cancel"] });
    res = await app().post("/api/match-requests/1/confirm").expect(200);
    expect(res.body).toMatchObject({ phase: "upcoming", youConfirmed: true, theyConfirmed: false });
    mockUserId = "theo";
    expect((await app().get("/api/match-requests/1")).body).toMatchObject({ phase: "to_confirm", theyConfirmed: true });

    // Sunday after 10: started. Theo says Jo didn't show.
    now = new Date("2026-11-08T16:00:00Z");
    res = await app().get("/api/match-requests/1").expect(200);
    expect(res.body).toMatchObject({ phase: "started", actions: ["no_show"] });
    res = await app().post("/api/match-requests/1/no-show").expect(200);
    expect(res.body).toMatchObject({ noShow: "them", actions: [] });
    mockUserId = "me";
    expect((await app().get("/api/match-requests/1")).body.noShow).toBe("you");
  });

  it("won't take a no-show once a score is in", async () => {
    await send().expect(201);
    mockUserId = "theo";
    await app().post("/api/match-requests/1/accept").expect(200);
    requests.matches.get(500)!.scored = true;
    now = new Date("2026-11-08T16:00:00Z");
    const res = await app().get("/api/match-requests/1").expect(200);
    expect(res.body).toMatchObject({ scoreEntered: true, actions: [] });
    await app().post("/api/match-requests/1/no-show").expect(409);
  });

  it("only takes answers that fit where it stands", async () => {
    await send().expect(201);
    await app().post("/api/match-requests/1/accept").expect(409);
    mockUserId = "sam";
    await app().post("/api/match-requests/1/accept").expect(404);
  });

  it("declines, withdraws and cancels", async () => {
    await send().expect(201);
    await app().post("/api/match-requests/1/withdraw").expect(200);
    expect(requests.rows[0].status).toBe("withdrawn");

    await send().expect(201);
    mockUserId = "theo";
    await app().post("/api/match-requests/2/decline").expect(200);
    expect(notify).toHaveBeenLastCalledWith(["me"], "Theo Brandt can't make it", expect.any(String), "/match-requests/2");

    mockUserId = "me";
    await send().expect(201);
    mockUserId = "theo";
    await app().post("/api/match-requests/3/accept").expect(200);
    await app().post("/api/match-requests/3/cancel").expect(200);
    expect(requests.rows[2]).toMatchObject({ status: "cancelled", cancelledByClerkUserId: "theo" });
    expect(requests.matches.get(500)!.cancelled).toBe(true);
  });

  it("stops after three counters", async () => {
    await send().expect(201);
    const times = ["10:00", "11:00", "12:00"];
    for (const [i, t] of times.entries()) {
      mockUserId = i % 2 === 0 ? "theo" : "me";
      await app().post("/api/match-requests/1/counter").send({ date: "2026-11-08", windowStart: t, windowEnd: "14:00" }).expect(200);
    }
    mockUserId = "me";
    expect((await app().get("/api/match-requests/1")).body.actions).toEqual(["accept", "decline"]);
  });

  it("hides requests with someone you blocked", async () => {
    await send().expect(201);
    blocked = new Set(["theo"]);
    expect((await app().get("/api/match-requests")).body.requests).toEqual([]);
    await app().get("/api/match-requests/1").expect(404);
  });

  it("expires a request nobody answered in time", async () => {
    await send().expect(201);
    now = new Date("2026-11-08T15:00:00Z");
    expect((await app().get("/api/match-requests/1")).body).toMatchObject({ phase: "expired", actions: [] });
  });
});

describe("reminders", () => {
  const accepted = async () => {
    await send().expect(201);
    mockUserId = "theo";
    await app().post("/api/match-requests/1/accept").expect(200);
    notify.mockClear();
  };

  it("finds the confirm prompt from 8 AM the day before, and the reminder 2 hours out", () => {
    const r = { ...requests.rows[0] };
    void r;
    const base = {
      id: 1,
      fromClerkUserId: "me",
      toClerkUserId: "theo",
      ...sat,
      timeZone: TZ,
      status: "accepted" as const,
      waitingOnClerkUserId: "theo",
      counters: 0,
      matchId: 500,
      fromConfirmedAt: null,
      toConfirmedAt: null,
      noShowClerkUserId: null,
      confirmPromptSentAt: null,
      reminderSentAt: null,
    };
    expect(dueReminders([base], new Date("2026-11-07T12:59:00Z"))).toEqual({ confirm: [], remind: [] });
    expect(dueReminders([base], new Date("2026-11-07T13:00:00Z"))).toEqual({ confirm: [1], remind: [] });
    expect(dueReminders([base], new Date("2026-11-08T12:00:00Z"))).toEqual({ confirm: [1], remind: [1] });
    expect(dueReminders([{ ...base, reminderSentAt: new Date() }], new Date("2026-11-08T12:00:00Z")).remind).toEqual([]);
    expect(dueReminders([base], new Date("2026-11-08T14:00:00Z"))).toEqual({ confirm: [], remind: [] });
  });

  it("sends each push to both players once", async () => {
    await accepted();
    const deps = { requests: () => requests, notify, now: () => now };
    now = new Date("2026-11-07T13:05:00Z");
    expect(await runMatchRequestReminders(deps)).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(["me"], "Still on for tomorrow?", "Confirm your match with Theo Brandt, Sun, Nov 8, 9 to 11 AM.", "/match-requests/1");
    expect(await runMatchRequestReminders(deps)).toBe(0);

    now = new Date("2026-11-08T12:10:00Z");
    expect(await runMatchRequestReminders(deps)).toBe(1);
    expect(notify).toHaveBeenLastCalledWith(
      ["theo"],
      "Match with Jo Rivera soon",
      "Sun, Nov 8, 9 to 11 AM. At Kent Park. Enter the score after you play.",
      "/match-requests/1",
    );
    expect(await runMatchRequestReminders(deps)).toBe(0);
  });
});

describe("phaseFor and actionsFor", () => {
  it("lets either player cancel an accepted match before it starts", () => {
    const r = {
      fromClerkUserId: "me",
      toClerkUserId: "theo",
      ...sat,
      timeZone: TZ,
      status: "accepted" as const,
      waitingOnClerkUserId: "theo",
      counters: 0,
      matchId: 1,
      fromConfirmedAt: null,
      toConfirmedAt: null,
      noShowClerkUserId: null,
    };
    expect(phaseFor(r, "theo", NOW)).toBe("upcoming");
    expect(actionsFor(r, "theo", NOW)).toEqual(["cancel"]);
    expect(actionsFor(r, "me", new Date("2026-11-11T15:00:00Z"))).toEqual([]);
  });
});
