import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@workspace/db", () => ({ db: {}, messagingMemorySnapshotTable: {} }));

import { MemoryMessagingProvider, type MemorySnapshot, type MemoryStore } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { FirstMessageFilter } from "../messaging/filter";
import { MessagingService } from "../messaging/service";
import { createProvider } from "../messaging";

// John, Nov 10: "My message history disappeared." Staging kept messages on
// the API container's disk, which is wiped each time the container sleeps or
// deploys, so every chat came back empty. These cover the fix: messages saved
// to a store outside the container come back after a restart.

class FakeStore implements MemoryStore {
  saved: MemorySnapshot | null = null;
  saves = 0;
  failLoads = 0;
  async load() {
    if (this.failLoads > 0) {
      this.failLoads -= 1;
      throw new Error("database asleep");
    }
    return this.saved ? (JSON.parse(JSON.stringify(this.saved)) as MemorySnapshot) : null;
  }
  async save(snapshot: MemorySnapshot) {
    this.saves += 1;
    this.saved = JSON.parse(JSON.stringify(snapshot)) as MemorySnapshot;
  }
}

const quiet = { warn: () => undefined, info: () => undefined };

describe("MemoryMessagingProvider with a store", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it("keeps a chat's history across a restart", async () => {
    const before = new MemoryMessagingProvider({ store, log: quiet });
    await before.ensureChannel("dm-a-b", ["a", "b"]);
    for (let i = 0; i < 60; i += 1) {
      await before.sendMessage({ channelId: "dm-a-b", messageId: `m${i}`, senderId: i % 2 ? "a" : "b", text: `hello ${i}` });
    }
    await before.flush();

    // The container slept: a new process starts from the store.
    const after = new MemoryMessagingProvider({ store, log: quiet });
    const latest = await after.listMessages("dm-a-b", { limit: 50 });
    expect(latest).toHaveLength(50);
    expect(latest[49].text).toBe("hello 59");
    const older = await after.listMessages("dm-a-b", { limit: 50, before: latest[0].id });
    expect(older.map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `hello ${i}`));
    expect(latest[0].createdAt).toBeInstanceOf(Date);
    // Replies still send into the same chat.
    await after.sendMessage({ channelId: "dm-a-b", messageId: "m60", senderId: "a", text: "Sounds good!" });
    expect((await after.listMessages("dm-a-b")).at(-1)?.text).toBe("Sounds good!");
  });

  it("folds quick saves together and keeps the latest state", async () => {
    const p = new MemoryMessagingProvider({ store, log: quiet });
    await p.ensureChannel("c", ["a", "b"]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => p.sendMessage({ channelId: "c", messageId: `x${i}`, senderId: "a", text: `${i}` })));
    await p.flush();
    expect(store.saved?.c.messages).toHaveLength(20);
    expect(store.saves).toBeLessThan(21);
  });

  it("tries the store again when it can't be read at first", async () => {
    store.saved = { c: { members: ["a", "b"], messages: [{ id: "old", channelId: "c", senderId: "a", text: "earlier", createdAt: new Date(0).toISOString(), hidden: false }] } };
    store.failLoads = 2;
    const p = new MemoryMessagingProvider({ store, log: quiet, retryDelayMs: 1 });
    expect((await p.listMessages("c")).map((m) => m.text)).toEqual(["earlier"]);
  });

  it("never saves over history it couldn't load", async () => {
    store.saved = { c: { members: ["a", "b"], messages: [{ id: "old", channelId: "c", senderId: "a", text: "earlier", createdAt: new Date(0).toISOString(), hidden: false }] } };
    store.failLoads = 99;
    const p = new MemoryMessagingProvider({ store, log: quiet, retryDelayMs: 1 });
    await p.ensureChannel("d", ["a", "b"]);
    await p.sendMessage({ channelId: "d", messageId: "new", senderId: "a", text: "hi" });
    await p.flush();
    expect(store.saves).toBe(0);
    expect(store.saved.c.messages[0].text).toBe("earlier");
  });
});

describe("a direct chat after the API restarts", () => {
  it("opens the same conversation with its full history and pages back to the first message", async () => {
    const store = new FakeStore();
    const repo = new MemoryMessagingRepo();
    for (const [id, pid, name] of [
      ["john", 1, "John R."],
      ["ross", 2, "Ross B."],
    ] as const) {
      repo.names.set(id, { name, playerId: pid });
      repo.playerAccounts.set(pid, id);
      repo.createdAt.set(id, new Date("2026-01-01T00:00:00Z"));
    }
    repo.connect("john", "ross");
    const make = () => new MessagingService({ repo, provider: new MemoryMessagingProvider({ store, log: quiet }), filter: new FirstMessageFilter() });

    const first = make();
    const { conversationId } = await first.start("john", { playerId: 2, text: "Hit tomorrow?", clientMessageId: "client-000" });
    for (let i = 1; i < 55; i += 1) await first.send(i % 2 ? "ross" : "john", conversationId, { text: `msg ${i}`, clientMessageId: `client-${String(i).padStart(3, "0")}` });
    await (first.provider as MemoryMessagingProvider).flush();

    const second = make();
    const latest = await second.thread("john", conversationId);
    expect(latest.messages).toHaveLength(50);
    expect(latest.olderCursor).not.toBeNull();
    const older = await second.thread("john", conversationId, { before: latest.olderCursor! });
    expect(older.messages.map((m) => m.text)).toEqual(["Hit tomorrow?", "msg 1", "msg 2", "msg 3", "msg 4"]);
    expect(older.olderCursor).toBeNull();
  });
});

describe("createProvider", () => {
  it("uses Stream when both keys are set and the provider is auto or unset", () => {
    expect(createProvider({ MESSAGING_PROVIDER: "auto", STREAM_API_KEY: "k", STREAM_API_SECRET: "s" }).name).toBe("stream");
    expect(createProvider({ STREAM_API_KEY: "k", STREAM_API_SECRET: "s" }).name).toBe("stream");
  });

  it("uses memory without keys, saving to the database when asked", () => {
    const store = new FakeStore();
    const p = createProvider({ MESSAGING_PROVIDER: "auto", MESSAGING_MEMORY_STORE: "database", NODE_ENV: "production" }, () => store);
    expect(p.name).toBe("memory");
  });

  it("keeps an explicit memory choice even with keys", () => {
    expect(createProvider({ MESSAGING_PROVIDER: "memory", STREAM_API_KEY: "k", STREAM_API_SECRET: "s", MESSAGING_MEMORY_FILE: "/tmp/ballboi-test-none.json" }).name).toBe("memory");
  });
});
