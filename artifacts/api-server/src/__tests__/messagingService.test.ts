import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));

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

    const [forBlair] = await svc.list("blair", "messages");
    expect(forBlair).toMatchObject({ state: "active", unread: 2, canSend: true, other: { name: "Alex Kim", playerId: 1 } });
    expect(forBlair.lastMessage).toMatchObject({ text: "Great", fromMe: false });
    expect(await svc.summary("blair")).toEqual({ unread: 2, requests: 0 });

    const thread = await svc.thread("blair", conversationId);
    expect(thread.messages.map((m) => [m.text, m.fromMe])).toEqual([
      ["Hit Saturday?", false],
      ["Yes, 9am", true],
      ["Great", false],
    ]);
    expect(await svc.summary("blair")).toEqual({ unread: 0, requests: 0 });
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

describe("Message Requests", () => {
  it("land in the recipient's Requests, and the sender waits for a reply", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });

    expect(await svc.list("casey", "messages")).toEqual([]);
    const [req] = await svc.list("casey", "requests");
    expect(req).toMatchObject({ id: conversationId, state: "request", canSend: true });
    expect(await svc.summary("casey")).toEqual({ unread: 0, requests: 1 });

    const [mine] = await svc.list("alex", "messages");
    expect(mine).toMatchObject({ state: "awaiting_reply", canSend: false, sendBlockedReason: "You can send more once Casey Fox replies." });
    await expectError(svc.send("alex", conversationId, { text: "Hello?", clientMessageId: mid() }), "awaiting_reply", 409);
    expect(pushed[0]).toMatchObject({ recipientId: "casey", isRequest: true });
  });

  it("are accepted when the recipient replies", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    await svc.send("casey", conversationId, { text: "Sure, check bit.ly/x", clientMessageId: mid() });
    expect((await svc.list("casey", "messages"))[0]).toMatchObject({ state: "active" });
    await svc.send("alex", conversationId, { text: "Great", clientMessageId: mid() });
  });

  it("can be deleted by the recipient; the sender isn't told and still can't send", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    await svc.decline("casey", conversationId);
    expect(await svc.list("casey", "requests")).toEqual([]);
    expect((await svc.list("alex", "messages"))[0]).toMatchObject({ state: "awaiting_reply" });
    await expectError(svc.start("alex", { playerId: 3, text: "Again?", clientMessageId: mid() }), "awaiting_reply");
    await expectError(svc.decline("alex", conversationId), "not_request");
  });

  it("upgrade to a normal conversation once the two become league mates", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    repo.connect("alex", "casey");
    await svc.send("alex", conversationId, { text: "We're in the same league now", clientMessageId: mid() });
    expect((await svc.list("casey", "messages"))[0]).toMatchObject({ state: "active" });
  });

  it.each([
    ["see example.com", "filtered_link"],
    ["call 555-123-4567", "filtered_phone"],
    ["you badword", "filtered_blocked_term"],
  ])("block a first message with %s", async (text, code) => {
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
  it("stop messages both ways and hide the conversation", async () => {
    const { conversationId } = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: mid() });
    repo.blocks.push(["blair", "alex"]);
    await expectError(svc.send("alex", conversationId, { text: "Hi?", clientMessageId: mid() }), "blocked", 403);
    await expectError(svc.send("blair", conversationId, { text: "Hi?", clientMessageId: mid() }), "blocked", 403);
    expect(await svc.list("alex", "messages")).toEqual([]);
    expect(await svc.list("blair", "messages")).toEqual([]);
    await expectError(svc.thread("alex", conversationId), "not_found", 404);
  });

  it("restricted accounts can't start conversations, and their pending requests are hidden", async () => {
    await svc.start("alex", { playerId: 3, text: "Up for a hit?", clientMessageId: mid() });
    repo.restricted.add("alex");
    expect(await svc.list("casey", "requests")).toEqual([]);
    expect(await svc.summary("casey")).toEqual({ unread: 0, requests: 0 });
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

  it("rejects empty, long, self and unknown targets", async () => {
    await expectError(svc.start("alex", { playerId: 2, text: "   ", clientMessageId: mid() }), "invalid_text");
    await expectError(svc.start("alex", { playerId: 2, text: "x".repeat(2001), clientMessageId: mid() }), "too_long");
    await expectError(svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: "x" }), "invalid_id");
    await expectError(svc.start("alex", { playerId: 1, text: "Hi", clientMessageId: mid() }), "self");
    await expectError(svc.start("alex", { playerId: 99, text: "Hi", clientMessageId: mid() }), "no_account", 404);
    await expectError(svc.send("casey", 1, { text: "Hi", clientMessageId: mid() }), "not_found");
  });

  it("hides moderator-hidden messages from the thread", async () => {
    const { conversationId, message } = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: mid() });
    await provider.setHidden(message.id, true);
    expect((await svc.thread("blair", conversationId)).messages).toEqual([]);
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
  it("creates a chat and a Message Request for the signed-in person", async () => {
    const named: string[] = [];
    await svc.seedSamples("alex", async (_id, name) => void named.push(name));
    expect(named).toEqual(["Sam Rivera", "Jordan Lee"]);
    expect(await svc.summary("alex")).toEqual({ unread: 1, requests: 1 });
  });
});
