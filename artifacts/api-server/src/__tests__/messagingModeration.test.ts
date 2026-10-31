import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));

import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { AutoRestrict, MemoryModerationRepo, RESTRICT_RULES } from "../messaging/moderation";
import { MessagingError, MessagingService, SNAPSHOT_CONTEXT } from "../messaging/service";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let now: Date;
let repo: MemoryMessagingRepo;
let mod: MemoryModerationRepo;
let provider: MemoryMessagingProvider;
let svc: MessagingService;
let n = 0;
const mid = () => `msg-${String(++n).padStart(6, "0")}`;

function person(id: string, playerId: number, name = id) {
  repo.names.set(id, { name, playerId });
  repo.playerAccounts.set(playerId, id);
  repo.createdAt.set(id, new Date(now.getTime() - 90 * DAY));
}

async function errorCode(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  return e instanceof MessagingError ? e.code : null;
}

beforeEach(() => {
  now = new Date("2026-10-29T15:00:00Z");
  n = 0;
  repo = new MemoryMessagingRepo({ now: () => now });
  mod = new MemoryModerationRepo(() => now);
  mod.startedFrom = () =>
    repo.conversations.map((c) => ({ requester: c.requester!, openingHash: c.openingHash!, status: c.status, createdAt: c.createdAt }));
  // The messaging repo reads restrictions from the moderation repo, like production.
  repo.restrictedSet = (ids: string[]) => mod.restrictedSet(ids);
  provider = new MemoryMessagingProvider({ now: () => now });
  svc = new MessagingService({
    repo,
    provider,
    filter: new FirstMessageFilter(),
    now: () => now,
    moderation: { auto: new AutoRestrict(mod, () => now), repo: mod },
  });
  person("spammer", 1, "Sam Spam");
  for (let i = 0; i < 10; i++) person(`p${i}`, 10 + i, `Player ${i}`);
});

describe("auto-restrict: copy-paste openers", () => {
  it(`restricts on the ${RESTRICT_RULES.sameOpener}rd identical first message in a day`, async () => {
    await svc.start("spammer", { playerId: 10, text: "Hey cutie, hit?", clientMessageId: mid() });
    await svc.start("spammer", { playerId: 11, text: "hey  CUTIE, hit?", clientMessageId: mid() });
    expect(await errorCode(svc.start("spammer", { playerId: 12, text: "Hey cutie, hit?", clientMessageId: mid() }))).toBe("restricted");

    expect(mod.restrictions).toHaveLength(1);
    expect(mod.restrictions[0]).toMatchObject({ clerkUserId: "spammer", source: "auto" });
    expect(mod.reports[0]).toMatchObject({ targetType: "account", targetId: "spammer", source: "auto", reporter: null });
    // Pending requests disappear for recipients.
    expect(await svc.list("p0", "requests")).toEqual([]);
  });

  it("doesn't count different openers", async () => {
    for (let i = 0; i < 3; i++) await svc.start("spammer", { playerId: 10 + i, text: `Hi player ${i}`, clientMessageId: mid() });
    expect(mod.restrictions).toHaveLength(0);
  });
});

describe("auto-restrict: unanswered first messages", () => {
  it(`restricts after ${RESTRICT_RULES.unansweredRequests} requests with no reply`, async () => {
    for (let i = 0; i < RESTRICT_RULES.unansweredRequests; i++) {
      await svc.start("spammer", { playerId: 10 + i, text: `Hi ${i}`, clientMessageId: mid() });
      now = new Date(now.getTime() + DAY);
    }
    now = new Date(now.getTime() + 2 * DAY);
    expect(await errorCode(svc.start("spammer", { playerId: 19, text: "Hi again", clientMessageId: mid() }))).toBe("restricted");
  });

  it("doesn't count replied-to requests", async () => {
    for (let i = 0; i < RESTRICT_RULES.unansweredRequests; i++) {
      const { conversationId } = await svc.start("spammer", { playerId: 10 + i, text: `Hi ${i}`, clientMessageId: mid() });
      await svc.send(`p${i}`, conversationId, { text: "Hi back", clientMessageId: mid() });
    }
    now = new Date(now.getTime() + 3 * DAY);
    await expect(svc.start("spammer", { playerId: 19, text: "Hi again", clientMessageId: mid() })).resolves.toBeTruthy();
  });
});

describe("auto-restrict: reports and blocks", () => {
  it("restricts once 2 different people report, not when one person reports twice", async () => {
    const auto = new AutoRestrict(mod, () => now);
    const report = (reporter: string) =>
      mod.createReport({ reporter, targetType: "player", targetId: "1", reason: "harassment", source: "user", subject: "spammer" });
    await report("p0");
    await report("p0");
    expect(await auto.evaluate("spammer", { kind: "report" })).toBe(false);
    await report("p1");
    expect(await auto.evaluate("spammer", { kind: "report" })).toBe(true);
    expect(mod.restrictions[0].reason).toBe("Reported by 2 different people");
  });

  it("ignores dismissed reports", async () => {
    const auto = new AutoRestrict(mod, () => now);
    for (const r of ["p0", "p1"]) {
      await mod.createReport({ reporter: r, targetType: "player", targetId: "1", reason: "spam", source: "user", subject: "spammer" });
    }
    mod.reports.forEach((r) => (r.status = "dismissed"));
    expect(await auto.evaluate("spammer", { kind: "report" })).toBe(false);
  });

  it(`restricts after ${RESTRICT_RULES.blockers} blocks within ${RESTRICT_RULES.blockWindowDays} days`, async () => {
    const auto = new AutoRestrict(mod, () => now);
    mod.blocks.push({ blocker: "p0", blocked: "spammer", at: new Date(now.getTime() - 40 * DAY) });
    mod.blocks.push({ blocker: "p1", blocked: "spammer", at: now }, { blocker: "p2", blocked: "spammer", at: now });
    expect(await auto.evaluate("spammer", { kind: "block" })).toBe(false);
    mod.blocks.push({ blocker: "p3", blocked: "spammer", at: now });
    expect(await auto.evaluate("spammer", { kind: "block" })).toBe(true);
  });

  it("restricts at once on a moderation flag, and lifting restores sending", async () => {
    const auto = new AutoRestrict(mod, () => now);
    expect(await auto.evaluate("spammer", { kind: "flag", details: "harassment", reason: "harassment" })).toBe(true);
    expect(mod.restrictions[0].source).toBe("stream");
    expect(await errorCode(svc.start("spammer", { playerId: 10, text: "Hi", clientMessageId: mid() }))).toBe("restricted");
    await mod.lift("spammer");
    await expect(svc.start("spammer", { playerId: 10, text: "Hi", clientMessageId: mid() })).resolves.toBeTruthy();
  });
});

describe("reporting a message", () => {
  it("stores a snapshot of the reported message and the ones before it", async () => {
    repo.connect("spammer", "p0");
    const { conversationId } = await svc.start("p0", { playerId: 1, text: "Hi", clientMessageId: mid() });
    let reported = "";
    for (let i = 0; i < 25; i++) {
      const sender = i % 2 ? "p0" : "spammer";
      const { message } = await svc.send(sender, conversationId, { text: `m${i}`, clientMessageId: mid() });
      if (i === 22) reported = message.id;
    }
    const { id } = await svc.reportMessage("p0", conversationId, { messageId: reported, reason: "harassment", details: " rude " });
    const report = mod.reports.find((r) => r.id === id)!;
    expect(report).toMatchObject({ reporter: "p0", targetType: "message", targetId: reported, subject: "spammer", details: "rude" });
    const snap = report.snapshot!.messages;
    expect(snap).toHaveLength(SNAPSHOT_CONTEXT + 1);
    expect(snap[snap.length - 1]).toMatchObject({ id: reported, text: "m22", reported: true, senderName: "Sam Spam" });
    expect(snap.filter((m) => m.reported)).toHaveLength(1);
  });

  it("rejects your own messages, other conversations and bad reasons", async () => {
    repo.connect("spammer", "p0");
    const a = await svc.start("spammer", { playerId: 10, text: "Hi", clientMessageId: mid() });
    const b = await svc.start("p1", { playerId: 1, text: "Hey", clientMessageId: mid() });
    expect(await errorCode(svc.reportMessage("spammer", a.conversationId, { messageId: a.message.id, reason: "spam", details: null }))).toBe("own_message");
    expect(await errorCode(svc.reportMessage("p0", a.conversationId, { messageId: b.message.id, reason: "spam", details: null }))).toBe("message_not_found");
    expect(await errorCode(svc.reportMessage("p0", a.conversationId, { messageId: a.message.id, reason: "meh", details: null }))).toBe("invalid_reason");
    expect(await errorCode(svc.reportMessage("p5", a.conversationId, { messageId: a.message.id, reason: "spam", details: null }))).toBe("not_found");
  });

  it("restricts the sender after two people report their messages", async () => {
    repo.connect("spammer", "p0");
    repo.connect("spammer", "p1");
    for (const p of ["p0", "p1"]) {
      const { conversationId, message } = await svc.start("spammer", { playerId: p === "p0" ? 10 : 11, text: `Hi ${p}`, clientMessageId: mid() });
      await svc.reportMessage(p, conversationId, { messageId: message.id, reason: "harassment", details: null });
    }
    expect(await mod.restrictedSet(["spammer"])).toEqual(new Set(["spammer"]));
  });
});

describe("hiding a message", () => {
  it("hides it for both people and updates the Messages list preview", async () => {
    repo.connect("spammer", "p0");
    const first = await svc.start("p0", { playerId: 1, text: "Hi", clientMessageId: mid() });
    const bad = await svc.send("spammer", first.conversationId, { text: "something nasty", clientMessageId: mid() });
    expect(await svc.setMessageHidden(bad.message.id, true)).toBe(true);
    expect((await svc.thread("p0", first.conversationId)).messages.map((m) => m.text)).toEqual(["Hi"]);
    expect((await svc.list("p0", "messages"))[0].lastMessage?.text).toBe("Hi");
    await svc.setMessageHidden(bad.message.id, false);
    expect((await svc.list("p0", "messages"))[0].lastMessage?.text).toBe("something nasty");
    expect(await svc.setMessageHidden("nope", true)).toBe(false);
  });
});
