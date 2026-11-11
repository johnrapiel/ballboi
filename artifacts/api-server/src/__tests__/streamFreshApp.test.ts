// Chat on a brand-new Stream app (Nov 10): staging switched to Stream with
// chats already saved in the database from the in-memory provider. Stream had
// none of their users or channels, so opening a direct chat failed with
// "Something went wrong" and the title fell back to "Player".
//
// A fake Stream server that answers like a fresh app does: users must exist
// before they're used, a channel the server queries without a creator is
// refused, and sending to a channel that was never made is refused.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));

import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MessagingService } from "../messaging/service";
import { StreamApiError, StreamMessagingProvider } from "../messaging/streamProvider";

class FakeStream {
  users = new Set<string>();
  channels = new Map<string, { members: string[]; messages: { id: string; text: string; user: { id: string }; created_at: string; type?: string }[] }>();
  log: string[] = [];

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    this.log.push(`${method} ${u.pathname}`);
    const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status });
    const fail = (status: number, code: number, message: string) => reply(status, { code, message });

    if (method === "GET" && u.pathname === "/app") return reply(200, { app: {} });
    if (method === "POST" && u.pathname === "/users") {
      for (const id of Object.keys(body.users)) this.users.add(id);
      return reply(201, { users: body.users });
    }
    let m = u.pathname.match(/^\/channels\/messaging\/([^/]+)\/query$/);
    if (m && method === "POST") {
      const id = m[1];
      let ch = this.channels.get(id);
      if (!ch) {
        const creator = body.data?.created_by_id;
        if (!creator) {
          return fail(400, 4, 'GetOrCreateChannel failed with error: "either data.created_by or data.created_by_id must be provided when using server side auth."');
        }
        const members: string[] = body.data?.members ?? [];
        const unknown = [creator, ...members].filter((x) => !this.users.has(x));
        if (unknown.length) return fail(400, 4, `GetOrCreateChannel failed with error: "The following users are involved in channel create operation, but don't exist: [${unknown.join(", ")}]"`);
        ch = { members: [...members], messages: [] };
        this.channels.set(id, ch);
      }
      const limit = body.messages?.limit ?? 50;
      return reply(201, { messages: body.state ? ch.messages.slice(-limit) : [] });
    }
    m = u.pathname.match(/^\/channels\/messaging\/([^/]+)\/message$/);
    if (m && method === "POST") {
      const ch = this.channels.get(m[1]);
      if (!ch) return fail(404, 16, `SendMessage failed with error: "channel "messaging:${m[1]}" does not exist"`);
      const msg = body.message;
      if (!this.users.has(msg.user_id)) return fail(400, 4, `SendMessage failed with error: "user ${msg.user_id} doesn't exist"`);
      const out = { id: msg.id, text: msg.text, user: { id: msg.user_id }, created_at: "2026-11-11T15:00:00Z", cid: `messaging:${m[1]}`, ...(msg.type ? { type: msg.type } : {}) };
      ch.messages.push(out);
      return reply(201, { message: out });
    }
    m = u.pathname.match(/^\/messages\/([^/]+)$/);
    if (m && method === "GET") {
      const id = decodeURIComponent(m[1]);
      for (const ch of this.channels.values()) {
        const found = ch.messages.find((x) => x.id === id);
        if (found) return reply(200, { message: found });
      }
      return fail(404, 16, `GetMessage failed with error: "message with id ${id} doesn't exist"`);
    }
    return fail(400, 4, `unexpected ${method} ${u.pathname}`);
  };
}

let repo: MemoryMessagingRepo;
let stream: FakeStream;
let n = 0;
const mid = () => `msg-${String(++n).padStart(6, "0")}`;
const now = () => new Date("2026-11-11T15:00:00Z");

function service(provider: MemoryMessagingProvider | StreamMessagingProvider) {
  return new MessagingService({ repo, provider, filter: new FirstMessageFilter([]), now });
}

beforeEach(() => {
  n = 0;
  repo = new MemoryMessagingRepo({ now });
  stream = new FakeStream();
  for (const [id, pid, name] of [
    ["user_alex", 1, "Alex Kim"],
    ["user_blair", 2, "Blair Diaz"],
    ["user_casey", 3, "Casey Fox"],
    ["user_dana", 4, "Dana Ruiz"],
  ] as const) {
    repo.names.set(id, { name, playerId: pid });
    repo.playerAccounts.set(pid, id);
    repo.createdAt.set(id, new Date("2026-01-01T00:00:00Z"));
  }
  repo.connect("user_alex", "user_blair");
});

describe("a fresh Stream app with chats already in the database", () => {
  it("opens a direct chat made on the memory provider, with the other player's name, and sends in it", async () => {
    // Before the switch: Alex and Blair talk on the memory provider.
    const before = service(new MemoryMessagingProvider({ now }));
    const { conversationId } = await before.start("user_alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });

    // After the switch: same database, empty Stream app.
    const after = service(new StreamMessagingProvider("key", "secret", stream.fetch));
    const thread = await after.thread("user_blair", conversationId);
    expect(thread.conversation.other.name).toBe("Alex Kim");
    // History from the memory provider doesn't move to Stream.
    expect(thread.messages).toEqual([]);
    // Users made first, then the channel with both in it.
    expect(stream.log.slice(0, 2)).toEqual(["POST /users", expect.stringMatching(/^POST \/channels\/messaging\/dm_[0-9a-f]+\/query$/)]);
    expect([...stream.channels.values()][0].members.sort()).toEqual(["user_alex", "user_blair"]);

    const sent = await after.send("user_blair", conversationId, { text: "Yes, 9am", clientMessageId: mid() });
    expect(sent.message).toMatchObject({ text: "Yes, 9am", fromMe: true });
    const again = await after.thread("user_alex", conversationId);
    expect(again.messages.map((m) => [m.text, m.fromMe])).toEqual([["Yes, 9am", false]]);
  });

  it("sends in an old chat without opening it first", async () => {
    const before = service(new MemoryMessagingProvider({ now }));
    const { conversationId } = await before.start("user_alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    const after = service(new StreamMessagingProvider("key", "secret", stream.fetch));
    await expect(after.send("user_blair", conversationId, { text: "Sure", clientMessageId: mid() })).resolves.toMatchObject({
      message: { text: "Sure" },
    });
  });

  it("makes the channel once per chat, not on every open", async () => {
    const before = service(new MemoryMessagingProvider({ now }));
    const { conversationId } = await before.start("user_alex", { playerId: 2, text: "Hi", clientMessageId: mid() });
    const after = service(new StreamMessagingProvider("key", "secret", stream.fetch));
    await after.thread("user_alex", conversationId);
    await after.thread("user_alex", conversationId);
    await after.thread("user_blair", conversationId);
    const creates = stream.log.filter((l) => l.startsWith("POST /channels/") && l.endsWith("/query"));
    // One create, then one read per open.
    expect(creates).toHaveLength(4);
    expect(stream.log.filter((l) => l === "POST /users")).toHaveLength(1);
  });

  it("starts a brand-new direct chat on Stream", async () => {
    const svc = service(new StreamMessagingProvider("key", "secret", stream.fetch));
    const { conversationId } = await svc.start("user_alex", { playerId: 2, text: "Hit Saturday?", clientMessageId: mid() });
    const thread = await svc.thread("user_blair", conversationId);
    expect(thread.conversation.other.name).toBe("Alex Kim");
    expect(thread.messages.map((m) => m.text)).toEqual(["Hit Saturday?"]);
  });

  it("opens and sends in a group chat made on the memory provider", async () => {
    const before = service(new MemoryMessagingProvider({ now }));
    const group = (await before.syncGroup({
      openMatchId: 7,
      title: "Doubles Saturday",
      members: ["user_alex", "user_blair", "user_casey", "user_dana"],
      open: true,
      create: true,
    } as Parameters<MessagingService["syncGroup"]>[0]))!;
    const after = service(new StreamMessagingProvider("key", "secret", stream.fetch));
    const thread = await after.groupThread("user_casey", group.id);
    expect(thread.messages).toEqual([]);
    const ch = [...stream.channels.values()][0];
    expect(ch.members.sort()).toEqual(["user_alex", "user_blair", "user_casey", "user_dana"]);
    await expect(after.sendToGroup("user_casey", group.id, { text: "See you at 9", clientMessageId: mid() })).resolves.toMatchObject({
      message: { text: "See you at 9" },
    });
  });
});

describe("Stream errors in the logs", () => {
  it("name the call and Stream's code and reason, never the key", async () => {
    const p = new StreamMessagingProvider("key_abc", "secret", async () =>
      new Response(JSON.stringify({ code: 5, message: "api_key not valid" }), { status: 401 }),
    );
    const err = await p.check().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StreamApiError);
    expect((err as Error).message).toBe("Stream GET /app failed (HTTP 401, code 5): api_key not valid");
    expect((err as Error).message).not.toContain("key_abc");
  });

  it("reads a channel Stream doesn't have yet as empty", async () => {
    const p = new StreamMessagingProvider("key", "secret", stream.fetch);
    await expect(p.listMessages("dm_never_made")).resolves.toEqual([]);
    expect(await p.getMessage("nope")).toBeNull();
  });
});
