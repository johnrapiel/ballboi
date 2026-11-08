import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "a";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("./notifications.js", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("../routes/notifications.js", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("../routes/notifications", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("../messaging/index.js", () => ({ getMessagingService: vi.fn() }));

import type { MatchPlan } from "@workspace/db";
import { PAST_TIME, noShowCounts, pairKeyOf, parseNewPlan, planEvents, refusal } from "../lib/matchPlan";
import type { MatchPlanRepo, PlanRow } from "../lib/matchPlanRepo";
import { createMatchPlansRouter } from "../routes/matchPlans";
import { runMatchPlanJobs } from "../services/discover/matchPlanJobs";

const H = 3_600_000;
const T0 = new Date("2026-11-10T12:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * H);

function plan(extra: Partial<MatchPlan> = {}): MatchPlan {
  return {
    id: 1,
    pairKey: pairKeyOf("a", "b"),
    proposerClerkUserId: "a",
    recipientClerkUserId: "b",
    startsAt: at(48),
    timeZone: "America/New_York",
    courtId: null,
    courtName: "Fishkill Rec Park",
    kind: "singles",
    status: "proposed",
    matchId: null,
    respondedAt: null,
    endedAt: null,
    endedByClerkUserId: null,
    proposerStillOnAt: null,
    recipientStillOnAt: null,
    dayBeforeSentAt: null,
    reminderSentAt: null,
    didItHappenSentAt: null,
    noShowReporterClerkUserId: null,
    noShowClerkUserId: null,
    noShowReportedAt: null,
    noShowStatus: null,
    noShowAnsweredAt: null,
    noShowExpirySentAt: null,
    createdAt: T0,
    ...extra,
  };
}
const noMatch = { matchId: null, score: null };
const added = (extra: Partial<MatchPlan> = {}) => plan({ status: "accepted", respondedAt: at(0.05), matchId: 9, ...extra });
const actions = (p: MatchPlan, who: string, now: Date, m: { matchId: number | null; score: string | null } = { matchId: 9, score: null }) =>
  planEvents(p, m, who, now).flatMap((e) => e.actions);

describe("a new card", () => {
  it("needs a time in the future", () => {
    expect(parseNewPlan({ startsAt: at(-1).toISOString() }, T0)).toEqual({ error: PAST_TIME });
    expect(parseNewPlan({ startsAt: "soon" }, T0)).toHaveProperty("error");
    expect(parseNewPlan({ startsAt: at(24 * 61).toISOString() }, T0)).toHaveProperty("error");
    expect(parseNewPlan({ startsAt: at(24).toISOString(), kind: "practice", courtId: 3 }, T0)).toMatchObject({ kind: "practice", courtId: 3 });
  });
});

describe("what each player sees", () => {
  it("asks the other player, and the sender waits", () => {
    expect(actions(plan(), "b", at(1), noMatch)).toEqual(["accept", "decline"]);
    expect(actions(plan(), "a", at(1), noMatch)).toEqual([]);
  });

  it("lets only the latest card be added (brief item 29)", () => {
    expect(refusal("accept", plan({ id: 1 }), noMatch, "b", at(1), 2)).toBe("A newer card replaced this one.");
    expect(refusal("accept", plan({ id: 2 }), noMatch, "b", at(1), 2)).toBeNull();
    expect(planEvents(plan({ status: "replaced" }), noMatch, "b", at(1))[0]).toMatchObject({ state: "replaced", actions: [] });
  });

  it("offers Undo for 10 minutes, then Can't make it", () => {
    expect(actions(added(), "a", at(0.1))).toEqual(["undo"]);
    expect(actions(added(), "a", at(1))).toEqual(["cancel"]);
  });

  it("asks the day before; no answer means still on", () => {
    const events = planEvents(added(), { matchId: 9, score: null }, "a", at(30));
    expect(events.map((e) => e.type)).toEqual(["proposed", "added", "day_before"]);
    expect(events[2].actions).toEqual(["still_on", "cancel"]);
    const answered = planEvents(added({ recipientStillOnAt: at(25) }), { matchId: 9, score: null }, "a", at(30))[2];
    expect(answered).toMatchObject({ themIn: true, meIn: false });
  });

  it("never counts a canceled match as a no-show", () => {
    const p = added({ status: "canceled", endedAt: at(30), endedByClerkUserId: "b" });
    expect(planEvents(p, noMatch, "a", at(60)).at(-1)).toMatchObject({ type: "canceled", by: "them" });
    expect(noShowCounts([{ plan: p, match: noMatch }], at(200)).size).toBe(0);
  });

  it("asks Did it happen? 3 hours after the start", () => {
    expect(actions(added(), "a", at(50))).toEqual([]);
    expect(actions(added(), "a", at(51))).toEqual(["score", "no_show", "not_played"]);
    expect(planEvents(added(), { matchId: 9, score: "6-3, 6-4" }, "a", at(51)).at(-1)!.type).toBe("scored");
  });
});

describe("no-shows (F12, F13)", () => {
  const reported = (extra: Partial<MatchPlan> = {}) =>
    added({ noShowReporterClerkUserId: "a", noShowClerkUserId: "b", noShowReportedAt: at(51), noShowStatus: "pending", ...extra });

  it("gives the reported player 48 hours and three answers", () => {
    const e = planEvents(reported(), { matchId: 9, score: null }, "b", at(52)).at(-1)!;
    expect(e).toMatchObject({ type: "no_show_reported", about: "me", actions: ["score", "dispute", "admit"] });
    expect(e.deadline).toBe(at(99).toISOString());
  });

  it("counts after 48 hours with no answer", () => {
    expect(noShowCounts([{ plan: reported(), match: noMatch }], at(98)).get("b")).toBeUndefined();
    expect(noShowCounts([{ plan: reported(), match: noMatch }], at(99)).get("b")).toBe(1);
    expect(refusal("dispute", reported(), noMatch, "b", at(100), null)).toBe("The time to answer has passed.");
  });

  it("counts I couldn't make it, never a dispute, and never once there's a score", () => {
    expect(noShowCounts([{ plan: reported({ noShowStatus: "confirmed" }), match: noMatch }], at(60)).get("b")).toBe(1);
    expect(noShowCounts([{ plan: reported({ noShowStatus: "disputed" }), match: noMatch }], at(200)).size).toBe(0);
    expect(noShowCounts([{ plan: reported(), match: { matchId: 9, score: "6-4, 6-4" } }], at(200)).size).toBe(0);
    const ev = planEvents(reported({ noShowStatus: "disputed", noShowAnsweredAt: at(60) }), noMatch, "a", at(61));
    expect(ev.at(-1)).toMatchObject({ type: "no_show_disputed" });
  });
});

class MemoryPlans implements MatchPlanRepo {
  rows: PlanRow[] = [];
  reports: unknown[] = [];
  blocked = false;
  claims = new Set<string>();
  async forPair(a: string, b: string) {
    return this.rows.filter((r) => r.plan.pairKey === pairKeyOf(a, b));
  }
  async one(id: number) {
    return this.rows.find((r) => r.plan.id === id) ?? null;
  }
  async latestProposedId(key: string) {
    return [...this.rows].reverse().find((r) => r.plan.pairKey === key && r.plan.status === "proposed")?.plan.id ?? null;
  }
  async create(a: string, b: string, p: { startsAt: Date; timeZone: string; courtId: number | null; kind: string }, courtName: string | null) {
    for (const r of this.rows) if (r.plan.pairKey === pairKeyOf(a, b) && r.plan.status === "proposed") r.plan.status = "replaced";
    const row = plan({ id: this.rows.length + 1, proposerClerkUserId: a, recipientClerkUserId: b, startsAt: p.startsAt, courtName, kind: p.kind, createdAt: now });
    this.rows.push({ plan: row, match: { matchId: null, score: null } });
    return row;
  }
  async update(id: number, set: Partial<MatchPlan>) {
    Object.assign(this.rows.find((r) => r.plan.id === id)!.plan, set);
  }
  async accept(id: number, t: Date) {
    const r = this.rows.find((x) => x.plan.id === id)!;
    Object.assign(r.plan, { status: "accepted", respondedAt: t, matchId: 50 + id });
    r.match.matchId = 50 + id;
  }
  async voidMatch() {}
  async isBlocked() {
    return this.blocked;
  }
  async accountForUser(id: number) {
    return id === 2 ? { clerkUserId: "b", name: "Sam" } : id === 1 ? { clerkUserId: "a", name: "John" } : null;
  }
  async name(id: string) {
    return id === "a" ? "John" : "Sam";
  }
  async userIdOf(id: string) {
    return id === "a" ? 1 : 2;
  }
  async courtName() {
    return "Fishkill Rec Park";
  }
  async upcomingFor() {
    return this.rows.filter((r) => r.plan.status === "accepted");
  }
  async noShowCounts() {
    return new Map<string, number>();
  }
  async due() {
    return this.rows;
  }
  async claim(id: number, col: string) {
    const k = `${id}:${col}`;
    if (this.claims.has(k)) return false;
    this.claims.add(k);
    return true;
  }
  async file(input: unknown) {
    this.reports.push(input);
  }
}

let now = T0;

describe("match card routes", () => {
  let repo: MemoryPlans;
  let push: ReturnType<typeof vi.fn>;
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use("/api", createMatchPlansRouter(repo, push as never, () => now, async () => {}));
    return supertest(a);
  };
  const as = (u: string) => {
    mockUserId = u;
    return app();
  };

  beforeEach(() => {
    now = T0;
    repo = new MemoryPlans();
    push = vi.fn().mockResolvedValue(undefined);
  });

  it("sends a card, replaces it with a newer one, and only the latest can be added", async () => {
    const first = await as("a").post("/api/match-plans").send({ userId: 2, startsAt: at(48).toISOString(), kind: "singles" }).expect(201);
    expect(push).toHaveBeenCalledWith(["b"], "John sent a match", expect.stringMatching(/^Add this match\?/), "/messages");
    await as("a").post("/api/match-plans").send({ userId: 2, startsAt: at(50).toISOString() }).expect(201);
    await as("b").post(`/api/match-plans/${first.body.id}/accept`).expect(409);
    const ok = await as("b").post("/api/match-plans/2/accept").expect(200);
    expect(ok.body.matchId).toBe(52);
    const cards = await as("a").get("/api/match-plans/with/2").expect(200);
    expect(cards.body.plans.map((p: { events: { state?: string }[] }) => p.events[0].state)).toEqual(["replaced", "added"]);
  });

  it("refuses a time that has passed, and cards with a blocked player", async () => {
    await as("a").post("/api/match-plans").send({ userId: 2, startsAt: at(-2).toISOString() }).expect(400, { error: PAST_TIME });
    repo.blocked = true;
    await as("a").post("/api/match-plans").send({ userId: 2, startsAt: at(5).toISOString() }).expect(403);
  });

  it("logs a dispute for moderators and leaves it off both cards", async () => {
    await as("a").post("/api/match-plans").send({ userId: 2, startsAt: at(48).toISOString() });
    await as("b").post("/api/match-plans/1/accept").expect(200);
    now = at(52);
    await as("a").post("/api/match-plans/1/no-show").expect(200);
    expect(push).toHaveBeenLastCalledWith(["b"], "John says you didn't show", expect.any(String), "/messages");
    const res = await as("b").post("/api/match-plans/1/dispute").expect(200);
    expect(res.body.events.at(-1).type).toBe("no_show_disputed");
    // Logged against both players, so a pattern from either one shows up for moderators (F12).
    expect(repo.reports).toHaveLength(2);
    expect((repo.reports as { subject: string; planId: number }[]).map((r) => r.subject).sort()).toEqual(["a", "b"]);
    expect(new Set((repo.reports as { planId: number }[]).map((r) => r.planId))).toEqual(new Set([1]));
    await as("b").post("/api/match-plans/1/admit").expect(409);
  });

  it("sends each reminder once", async () => {
    await as("a").post("/api/match-plans").send({ userId: 2, startsAt: at(48).toISOString() });
    await as("b").post("/api/match-plans/1/accept").expect(200);
    push.mockClear();
    expect(await runMatchPlanJobs(repo, push as never, at(25))).toBe(1);
    expect(await runMatchPlanJobs(repo, push as never, at(25))).toBe(0);
    expect(push).toHaveBeenCalledWith(["a"], expect.stringMatching(/^Still on for tomorrow at/), expect.any(String), "/messages");
    // The 2-hour reminder is a match day reminder now (decision 127, matchReminders.test.ts).
    expect(await runMatchPlanJobs(repo, push as never, at(46.5))).toBe(0);
    expect(await runMatchPlanJobs(repo, push as never, at(51.5))).toBe(1);
  });
});
