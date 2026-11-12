import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MessagingError, MessagingService, NEW_ACCOUNT_DAILY_LIMIT, type NewMessageEvent } from "../messaging/service";

const DAY = 86_400_000;
let now = new Date("2026-10-29T15:00:00Z");
let repo: MemoryMessagingRepo;
let provider: MemoryMessagingProvider;
let svc: MessagingService;
let pushed: NewMessageEvent[];
let n = 0;
const mid = () => `msg-${String(++n).padStart(6, "0")}`;

const OLD = new Date(now.getTime() - 60 * DAY);

beforeEach(() => {
  now = new Date("2026-10-29T15:00:00Z");
  n = 0;
  pushed = [];
  repo = new MemoryMessagingRepo({ now: () => now });
  provider = new MemoryMessagingProvider({ now: () => now });
  svc = new MessagingService({
    repo,
    provider,
    filter: new FirstMessageFilter(["badword"]),
    now: () => now,
    onNewMessage: (e) => void pushed.push(e),
  });
  // alex (player 1), blair (2), casey (3). Alex and Blair share a league.
  for (const [id, pid, name] of [
    ["alex", 1, "Alex Kim"],
    ["blair", 2, "Blair Diaz"],
    ["casey", 3, "Casey Fox"],
  ] as const) {
    repo.names.set(id, { name, playerId: pid });
    repo.playerAccounts.set(pid, id);
    repo.createdAt.set(id, OLD);
  }
  repo.connect("alex", "blair");
});

async function expectError(p: Promise<unknown>, code: string, status?: number) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MessagingError);
  expect((err as MessagingError).code).toBe(code);
  if (status) expect((err as MessagingError).status).toBe(status);
}

describe("league mates", () => {
  it("message freely, both ways, and track unread for the recipient only", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    await svc.send("blair", conversationId, { text: "Yes, 9am", clientMessageId: mid() });
    await svc.send("alex", conversationId, { text: "Great", clientMessageId: mid() });

    const [forBlair] = await svc.list("blair");
    expect(forBlair).toMatchObject({ state: "active", unread: 2, canSend: true, other: { name: "Alex Kim", playerId: 1 } });
    expect(forBlair.lastMessage).toMatchObject({ text: "Great", fromMe: false });
    expect(await svc.summary("blair")).toEqual({ unread: 2 });

    const thread = await svc.thread("blair", conversationId);
    expect(thread.messages.map((m) => [m.text, m.fromMe])).toEqual([
      ["Hit Saturday?", false],
      ["Yes, 9am", true],
      ["Great", false],
    ]);
    expect(await svc.summary("blair")).toEqual({ unread: 0 });
    expect(pushed).toHaveLength(3);
  });

  it("aren't filtered", async () => {
    await expect(svc.start("alex", { playerId: 2, text: "Call me 555-123-4567", clientMessageId: mid() })).resolves.toBeTruthy();
  });

  it("reuse the same conversation when messaging again", async () => {
    const a = await svc.start("alex", { playerId: 2, text: "One", clientMessageId: mid() });
    const b = await svc.start("blair", { playerId: 1, text: "Two", clientMessageId: mid() });
    expect(b.conversationId).toBe(a.conversationId);
  });
});

describe("no Message Requests (finding 17, John, Nov 6)", () => {
  it("a first message from outside your leagues goes straight to the inbox", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    const [inbox] = await svc.list("casey");
    expect(inbox).toMatchObject({ id: conversationId, state: "active", blocked: false, canSend: true, unread: 1 });
    expect(await svc.summary("casey")).toEqual({ unread: 1 });
    expect(pushed[0]).toMatchObject({ recipientId: "casey" });
    expect(pushed[0]).not.toHaveProperty("isRequest");
  });

  it("lets the sender keep sending without waiting for a reply", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    expect((await svc.list("alex"))[0]).toMatchObject({ state: "active", canSend: true, sendBlockedReason: null });
    await expect(svc.send("alex", conversationId, { text: "Saturday works too", clientMessageId: mid() })).resolves.toBeTruthy();
    await expect(svc.start("alex", { playerId: 3, text: "Or Sunday", clientMessageId: mid() })).resolves.toBeTruthy();
    expect((await svc.thread("casey", conversationId)).messages).toHaveLength(3);
  });

  it("only filters the first message, and only from outside your leagues", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    await expect(svc.send("casey", conversationId, { text: "Sure, call 555-123-4567", clientMessageId: mid() })).resolves.toBeTruthy();
  });

  it("reads conversations stored as requests before Nov 6 as normal ones", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    await repo.update(conversationId, { status: "request" });
    expect((await svc.list("casey"))[0]).toMatchObject({ state: "active" });
    expect((await svc.list("alex"))[0]).toMatchObject({ state: "active", canSend: true });
    await svc.send("alex", conversationId, { text: "Hello again", clientMessageId: mid() });
    expect(repo.conversations[0].status).toBe("active");
  });

  it("keeps an old declined request hidden from the person who deleted it, until a new message", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    await repo.update(conversationId, { status: "declined" });
    expect(await svc.list("casey")).toEqual([]);
    expect(await svc.list("alex")).toHaveLength(1);
    await svc.send("alex", conversationId, { text: "Still keen?", clientMessageId: mid() });
    expect(await svc.list("casey")).toHaveLength(1);
  });

  it.each([
    ["see example.com", "filtered_link"],
    ["call 555-123-4567", "filtered_phone"],
    ["write me at sam@example.com", "filtered_email"],
    ["you badword", "filtered_blocked_term"],
  ])("still stops a first message from outside your leagues with %s", async (text, code) => {
    await expectError(svc.start("alex", { playerId: 3, text, clientMessageId: mid() }), code, 422);
    expect(repo.conversations).toHaveLength(0);
  });
});

describe("new-account throttle", () => {
  it(`allows ${NEW_ACCOUNT_DAILY_LIMIT} new conversations a day in the first week`, async () => {
    repo.createdAt.set("alex", new Date(now.getTime() - 2 * DAY));
    for (let i = 0; i < NEW_ACCOUNT_DAILY_LIMIT; i++) {
      const id = `p${i}`;
      repo.playerAccounts.set(100 + i, id);
      await svc.start("alex", { playerId: 100 + i, text: "Hi there", clientMessageId: mid() });
    }
    repo.playerAccounts.set(200, "late");
    await expectError(svc.start("alex", { playerId: 200, text: "Hi there", clientMessageId: mid() }), "throttled", 429);

    now = new Date(now.getTime() + DAY + 1000);
    await expect(svc.start("alex", { playerId: 200, text: "Hi there", clientMessageId: mid() })).resolves.toBeTruthy();
  });

  it("doesn't apply after the first week, or to existing conversations", async () => {
    for (let i = 0; i < 8; i++) {
      repo.playerAccounts.set(100 + i, `p${i}`);
      await svc.start("alex", { playerId: 100 + i, text: "Hi there", clientMessageId: mid() });
    }
    repo.createdAt.set("blair", new Date(now.getTime() - DAY));
    const withAlex = await svc.start("blair", { playerId: 1, text: "Hi", clientMessageId: mid() });
    for (let i = 0; i < 4; i++) {
      repo.playerAccounts.set(300 + i, `q${i}`);
      await svc.start("blair", { playerId: 300 + i, text: "Hi", clientMessageId: mid() });
    }
    // Over today's limit for new conversations, but replies keep working.
    repo.playerAccounts.set(400, "r");
    await expectError(svc.start("blair", { playerId: 400, text: "Hi", clientMessageId: mid() }), "throttled");
    await expect(svc.send("blair", withAlex.conversationId, { text: "Still here", clientMessageId: mid() })).resolves.toBeTruthy();
  });

  it("treats an account with no known start date as new", async () => {
    repo.createdAt.delete("alex");
    for (let i = 0; i < 5; i++) {
      repo.playerAccounts.set(100 + i, `p${i}`);
      await svc.start("alex", { playerId: 100 + i, text: "Hi", clientMessageId: mid() });
    }
    repo.playerAccounts.set(200, "late");
    await expectError(svc.start("alex", { playerId: 200, text: "Hi", clientMessageId: mid() }), "throttled");
  });
});

describe("blocks and restrictions", () => {
  it("stop messages both ways; the blocker keeps a read-only chat, the blocked player loses it", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: mid() });
    repo.blocks.push(["blair", "alex"]);
    await expectError(svc.send("alex", conversationId, { text: "Hi?", clientMessageId: mid() }), "blocked", 403);
    await expectError(svc.send("blair", conversationId, { text: "Hi?", clientMessageId: mid() }), "blocked", 403);
    expect(await svc.list("alex")).toEqual([]);
    await expectError(svc.thread("alex", conversationId), "not_found", 404);
    // Blair blocked Alex: the chat stays for Blair, read only, so Blair can unblock from it.
    const [forBlair] = await svc.list("blair");
    expect(forBlair).toMatchObject({ id: conversationId, blocked: true, canSend: false, sendBlockedReason: "You blocked Alex Kim." });
    expect((await svc.thread("blair", conversationId)).conversation).toMatchObject({ blocked: true, canSend: false });
    // Unblocking puts everything back.
    repo.blocks = [];
    expect((await svc.list("alex"))[0]).toMatchObject({ blocked: false, canSend: true });
    await expect(svc.send("blair", conversationId, { text: "Sorry, wrong button", clientMessageId: mid() })).resolves.toBeTruthy();
  });

  it("restricted accounts can't start conversations", async () => {
    await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    repo.restricted.add("alex");
    repo.playerAccounts.set(9, "dana");
    await expectError(svc.start("alex", { playerId: 9, text: "Hi", clientMessageId: mid() }), "restricted", 403);
  });
});

describe("sending", () => {
  it("never posts a retried message twice", async () => {
    const id = mid();
    const a = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: id });
    const b = await svc.send("alex", a.conversationId, { text: "Hi", clientMessageId: id });
    expect(b.message.id).toBe(a.message.id);
    expect((await svc.thread("blair", a.conversationId)).messages).toHaveLength(1);
  });

  it("retrying a first message that already went through confirms it, once", async () => {
    const id = mid();
    const first = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: id });
    // The reply was lost; the app retries the same message.
    const again = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: id });
    expect(again).toEqual(first);
    const [inbox] = await svc.list("casey");
    expect(inbox.lastMessage?.text).toBe("Up for a hit?");
    expect((await svc.thread("casey", first.conversationId)).messages).toHaveLength(1);
    expect(pushed).toHaveLength(1);
  });

  it("retrying a first message that never arrived sends it once", async () => {
    const send = provider.sendMessage.bind(provider);
    let fail = true;
    provider.sendMessage = async (input) => {
      if (fail) {
        fail = false;
        throw new Error("timed out");
      }
      return send(input);
    };
    const id = mid();
    await expect(svc.start("alex", { playerId: 3, text: "Free Sat 930-1100?", clientMessageId: id })).rejects.toThrow("timed out");
    // The conversation exists but nobody can see it yet.
    expect(repo.conversations).toHaveLength(1);
    expect(await svc.list("casey")).toEqual([]);

    const retried = await svc.start("alex", { playerId: 3, text: "Free Sat 930-1100?", clientMessageId: id });
    expect(retried.message).toMatchObject({ text: "Free Sat 930-1100?", fromMe: true });
    const inbox = await svc.list("casey");
    expect(inbox).toHaveLength(1);
    expect((await svc.thread("casey", inbox[0].id)).messages.map((m) => m.text)).toEqual(["Free Sat 930-1100?"]);

    // Tapping retry again changes nothing.
    expect((await svc.start("alex", { playerId: 3, text: "Free Sat 930-1100?", clientMessageId: id })).message.id).toBe(retried.message.id);
    expect((await svc.thread("casey", inbox[0].id)).messages).toHaveLength(1);
  });

  it("a first message that never arrived still goes through the filter", async () => {
    const send = provider.sendMessage.bind(provider);
    let fail = true;
    provider.sendMessage = async (input) => {
      if (fail) {
        fail = false;
        throw new Error("timed out");
      }
      return send(input);
    };
    await expect(svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() })).rejects.toThrow();
    await expectError(svc.start("alex", { playerId: 3, text: "call 555-1234", clientMessageId: mid() }), "filtered_phone", 422);
    expect(await svc.list("casey")).toEqual([]);
    // Sending into the empty conversation directly is checked the same way.
    await expectError(svc.send("alex", repo.conversations[0].id, { text: "call 555-1234", clientMessageId: mid() }), "filtered_phone", 422);
  });

  it("a first message that reached Stream but wasn't recorded shows up on retry", async () => {
    const record = repo.recordMessage.bind(repo);
    let fail = true;
    repo.recordMessage = async (...a: Parameters<typeof record>) => {
      if (fail) {
        fail = false;
        throw new Error("database blip");
      }
      return record(...a);
    };
    const id = mid();
    await expect(svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: id })).rejects.toThrow("database blip");
    expect(await svc.list("casey")).toEqual([]);
    await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: id });
    const inbox = await svc.list("casey");
    expect(inbox).toHaveLength(1);
    expect((await svc.thread("casey", inbox[0].id)).messages).toHaveLength(1);
  });

  it("rejects empty, long, self and unknown targets", async () => {
    await expectError(svc.start("alex", { playerId: 2, text: "   ", clientMessageId: mid() }), "invalid_text");
    await expectError(svc.start("alex", { playerId: 2, text: "x".repeat(2001), clientMessageId: mid() }), "too_long");
    await expectError(svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: "x" }), "invalid_id");
    await expectError(svc.start("alex", { playerId: 1, text: "Hi", clientMessageId: mid() }), "self");
    await expectError(svc.start("alex", { playerId: 99, text: "Hi", clientMessageId: mid() }), "no_account", 404);
    await expectError(svc.send("casey", 1, { text: "Hi", clientMessageId: mid() }), "not_found");
  });

  it("pages back through long conversations until the first message", async () => {
    let conversationId = 0;
    for (let i = 0; i < 120; i++) {
      const sender = i % 2 ? "blair" : "alex";
      const r = conversationId
        ? await svc.send(sender, conversationId, { text: `m${i}`, clientMessageId: mid() })
        : await svc.start(sender, { playerId: 2, text: `m${i}`, clientMessageId: mid() });
      conversationId = r.conversationId;
    }
    const latest = await svc.thread("alex", conversationId);
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages[49].text).toBe("m119");
    expect(latest.olderCursor).toBe(latest.messages[0].id);
    const page2 = await svc.thread("alex", conversationId, { before: latest.olderCursor! });
    expect(page2.messages.map((m) => m.text)[0]).toBe("m20");
    expect(page2.olderCursor).toBeTruthy();
    const page3 = await svc.thread("alex", conversationId, { before: page2.olderCursor! });
    expect(page3.messages.map((m) => m.text)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
    expect(page3.olderCursor).toBeNull();
  });

  it("hides moderator-hidden messages from the thread", async () => {
    const { conversationId, message } = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: mid() });
    await provider.setHidden(message.id, true);
    expect((await svc.thread("blair", conversationId)).messages).toEqual([]);
  });
});

describe("opening a chat from a player", () => {
  it("finds your existing conversation, and nothing for strangers or old declined requests", async () => {
    expect(await svc.conversationWithPlayer("alex", 2)).toBeNull();
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: mid() });
    expect(await svc.conversationWithPlayer("alex", 2)).toBe(conversationId);
    expect(await svc.conversationWithPlayer("blair", 1)).toBe(conversationId);
    const req = await svc.start("alex", { playerId: 3, text: "Hi", clientMessageId: mid() });
    await repo.update(req.conversationId, { status: "declined" });
    expect(await svc.conversationWithPlayer("casey", 1)).toBeNull();
    expect(await svc.conversationWithPlayer("alex", 3)).toBe(req.conversationId);
    expect(await svc.conversationWithPlayer("alex", "x")).toBeNull();
  });
});

describe("contacts and account deletion", () => {
  it("lists league mates, minus blocks", async () => {
    expect(await svc.contacts("alex")).toEqual([{ name: "Blair Diaz", playerId: 2 }]);
    repo.blocks.push(["alex", "blair"]);
    expect(await svc.contacts("alex")).toEqual([]);
  });

  it("deletes everything a person sent and every conversation they're in", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: mid() });
    await svc.deleteUserData("alex");
    expect(repo.conversations).toHaveLength(0);
    expect(await provider.listMessages(`unused`)).toEqual([]);
    await expectError(svc.thread("blair", conversationId), "not_found");
  });
});

describe("development samples", () => {
  it("creates two chats for the signed-in person", async () => {
    const named: string[] = [];
    await svc.seedSamples("alex", async (_id, name) => void named.push(name));
    expect(named).toEqual(["Sam Rivera", "Jordan Lee"]);
    expect(await svc.summary("alex")).toEqual({ unread: 2 });
    expect(await svc.list("alex")).toHaveLength(2);
  });
});

describe("after the API restarts (in-memory provider)", () => {
  // Phone review, Nov 6: chats listed with their preview but opened blank,
  // because the conversation is in the database and the messages were only in memory.
  const restart = (file?: string) =>
    new MessagingService({ repo, provider: new MemoryMessagingProvider({ now: () => now, file }), filter: new FirstMessageFilter(), now: () => now });

  it("keeps the full history when messages are saved to a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ballboi-msg-"));
    const file = join(dir, "messages.json");
    const before = restart(file);
    const { conversationId } = await before.start("alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    await before.send("blair", conversationId, { text: "Yes, 9am", clientMessageId: mid() });

    const after = restart(file);
    const thread = await after.thread("alex", conversationId);
    expect(thread.messages.map((m) => [m.text, m.fromMe])).toEqual([
      ["Hit Saturday?", true],
      ["Yes, 9am", false],
    ]);
    expect(thread.messages[0].at).toBe(now.toISOString());
    await after.send("alex", conversationId, { text: "See you there", clientMessageId: mid() });
    expect((await restart(file).thread("blair", conversationId)).messages).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets both players send again in a chat whose history was lost", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    const after = restart();
    const thread = await after.thread("blair", conversationId);
    expect(thread.messages).toEqual([]);
    // The preview follows the chat: nothing to show (finding 1).
    expect(thread.conversation.lastMessage).toBeNull();
    await after.send("blair", conversationId, { text: "Yes, 9am", clientMessageId: mid() });
    await after.send("alex", conversationId, { text: "Great", clientMessageId: mid() });
    expect((await after.thread("alex", conversationId)).messages.map((m) => m.text)).toEqual(["Yes, 9am", "Great"]);
  });
});

describe("the Messages list preview matches the chat (Wave 2 finding 1)", () => {
  // Staging, Nov 10: the list showed "Are you around this weekend?" for a chat
  // with Ross whose messages were lost, because the preview is stored separately.
  const restart = () => new MessagingService({ repo, provider: new MemoryMessagingProvider({ now: () => now }), filter: new FirstMessageFilter(), now: () => now });

  it("shows no preview, and nothing unread, for a chat whose messages are gone", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Are you around this weekend?", clientMessageId: mid() });
    const after = restart();
    const [row] = await after.list("blair");
    expect(row.id).toBe(conversationId);
    expect(row.lastMessage).toBeNull();
    expect(row.unread).toBe(0);
    expect(await after.summary("blair")).toEqual({ unread: 0 });
    // The stored preview is corrected too, so the other player's list agrees.
    expect((await repo.findById(conversationId))?.lastMessageText).toBeNull();
    expect((await after.list("alex"))[0].lastMessage).toBeNull();
  });

  it("shows the chat's real last message when the stored preview disagrees", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    await svc.send("blair", conversationId, { text: "Yes, 9am", clientMessageId: mid() });
    await repo.update(conversationId, { lastMessageText: "Are you around this weekend?", lastSender: "alex" });
    const [row] = await svc.list("alex");
    expect(row.lastMessage).toMatchObject({ text: "Yes, 9am", fromMe: false });
    const thread = await svc.thread("alex", conversationId);
    expect(thread.conversation.lastMessage?.text).toBe(thread.messages.at(-1)?.text);
  });

  it("agrees after sending, leaving and coming back", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    await svc.thread("alex", conversationId);
    await svc.send("alex", conversationId, { text: "Court 3 at 9", clientMessageId: mid() });
    const [row] = await svc.list("alex");
    const thread = await svc.thread("alex", conversationId);
    expect(row.lastMessage).toMatchObject({ text: "Court 3 at 9", fromMe: true });
    expect(thread.messages.at(-1)?.text).toBe("Court 3 at 9");
  });

  it("keeps the stored preview when the chat can't be read", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    vi.spyOn(provider, "listMessages").mockRejectedValue(new Error("provider down"));
    const [row] = await svc.list("blair");
    expect(row.lastMessage?.text).toBe("Hit Saturday?");
    expect((await repo.findById(conversationId))?.lastMessageText).toBe("Hit Saturday?");
  });
});
