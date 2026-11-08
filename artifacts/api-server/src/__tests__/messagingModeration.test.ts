import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));

import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MemoryModerationRepo } from "../messaging/moderation";
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
  // The messaging repo reads restrictions from the moderation repo, like production.
  repo.restrictedSet = (ids: string[]) => mod.restrictedSet(ids);
  provider = new MemoryMessagingProvider({ now: () => now });
  svc = new MessagingService({
    repo,
    provider,
    filter: new FirstMessageFilter(),
    now: () => now,
    moderation: { repo: mod },
  });
  person("spammer", 1, "Sam Spam");
  for (let i = 0; i < 10; i++) person(`p${i}`, 10 + i, `Player ${i}`);
});

// John's decision (Nov 4 2026): nothing restricts an account automatically.
// Reports and flags wait for a moderator (John, or the agent after 6 hours).
describe("no automatic restriction", () => {
  it("lets the same opener go to many people", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(svc.start("spammer", { playerId: 10 + i, text: "Hey, hit?", clientMessageId: mid() })).resolves.toBeTruthy();
    }
    expect(mod.restrictions).toHaveLength(0);
    expect(mod.reports).toHaveLength(0);
  });

  it("doesn't restrict after many first messages with no reply", async () => {
    for (let i = 0; i < 6; i++) {
      await svc.start("spammer", { playerId: 10 + i, text: `Hi ${i}`, clientMessageId: mid() });
      now = new Date(now.getTime() + DAY);
    }
    now = new Date(now.getTime() + 3 * DAY);
    await expect(svc.start("spammer", { playerId: 19, text: "Hi again", clientMessageId: mid() })).resolves.toBeTruthy();
    expect(mod.restrictions).toHaveLength(0);
  });

  it("two different people report the same player and nothing happens to the account", async () => {
    for (const p of ["p0", "p1"]) {
      const { conversationId, message } = await svc.start("spammer", { playerId: p === "p0" ? 10 : 11, text: `Hi ${p}`, clientMessageId: mid() });
      await svc.reportMessage(p, conversationId, { messageId: message.id, reason: "harassment", details: null });
    }
    // Both reports wait in the queue.
    expect(mod.reports.map((r) => [r.reporter, r.status])).toEqual([
      ["p0", "open"],
      ["p1", "open"],
    ]);
    expect(mod.restrictions).toHaveLength(0);
    expect(await mod.restrictedSet(["spammer"])).toEqual(new Set());
    // They can still start conversations, and their messages still show.
    await expect(svc.start("spammer", { playerId: 12, text: "Hi p2", clientMessageId: mid() })).resolves.toBeTruthy();
    expect(await svc.list("p2")).toHaveLength(1);
  });

  it("a Stream flag files a report and leaves the account alone", async () => {
    const { message } = await svc.start("spammer", { playerId: 10, text: "Hi", clientMessageId: mid() });
    const reportId = await svc.recordProviderFlag({ messageId: message.id, details: "Flagged · HARASSMENT", reason: "harassment" });
    expect(reportId).toBeTruthy();
    expect(mod.reports[0]).toMatchObject({ source: "stream", subject: "spammer", status: "open" });
    expect(mod.restrictions).toHaveLength(0);
    expect(await svc.list("p0")).toHaveLength(1);
  });

  it("a moderator's restriction still works, and lifting it restores sending", async () => {
    await mod.restrict({ subject: "spammer", reason: "Harassment (report 1)", source: "admin", reportId: 1 });
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
});

describe("hiding a message", () => {
  it("hides it for both people and updates the Messages list preview", async () => {
    repo.connect("spammer", "p0");
    const first = await svc.start("p0", { playerId: 1, text: "Hi", clientMessageId: mid() });
    const bad = await svc.send("spammer", first.conversationId, { text: "something nasty", clientMessageId: mid() });
    expect(await svc.setMessageHidden(bad.message.id, true)).toBe(true);
    expect((await svc.thread("p0", first.conversationId)).messages.map((m) => m.text)).toEqual(["Hi"]);
    expect((await svc.list("p0"))[0].lastMessage?.text).toBe("Hi");
    await svc.setMessageHidden(bad.message.id, false);
    expect((await svc.list("p0"))[0].lastMessage?.text).toBe("something nasty");
    expect(await svc.setMessageHidden("nope", true)).toBe(false);
  });
});
