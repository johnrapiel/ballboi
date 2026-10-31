import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { serverToken, StreamMessagingProvider, verifyWebhookSignature } from "../messaging/streamProvider";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: any;
}

let calls: Call[];
let replies: { status: number; body: unknown }[];

function fakeFetch(url: string, init: RequestInit) {
  calls.push({
    method: init.method ?? "GET",
    url: new URL(url),
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  });
  const r = replies.shift() ?? { status: 200, body: {} };
  return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
}

beforeEach(() => {
  calls = [];
  replies = [];
});

const provider = () => new StreamMessagingProvider("key123", "secret456", fakeFetch);

describe("server token", () => {
  it("is an HS256 JWT signed with the secret", () => {
    const [h, p, sig] = serverToken("secret456").split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({ server: true });
    expect(sig).toBe(createHmac("sha256", "secret456").update(`${h}.${p}`).digest("base64url"));
  });
});

describe("webhook signature", () => {
  it("accepts the HMAC of the raw body and refuses anything else", () => {
    const body = Buffer.from('{"type":"review_queue_item.new"}');
    const good = createHmac("sha256", "s").update(body).digest("hex");
    expect(verifyWebhookSignature(body, good, "s")).toBe(true);
    expect(verifyWebhookSignature(body, good, "other")).toBe(false);
    expect(verifyWebhookSignature(body, undefined, "s")).toBe(false);
    expect(verifyWebhookSignature(body, "abc", "s")).toBe(false);
  });
});

describe("StreamMessagingProvider", () => {
  it("creates users once, then the channel with both members", async () => {
    const p = provider();
    await p.ensureChannel("dm_abc", ["user_a", "user_b"]);
    await p.ensureChannel("dm_abc", ["user_a", "user_b"]);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /users",
      "POST /channels/messaging/dm_abc/query",
      "POST /channels/messaging/dm_abc/query",
    ]);
    expect(calls[0].body).toEqual({ users: { user_a: { id: "user_a" }, user_b: { id: "user_b" } } });
    expect(calls[1].body).toEqual({ data: { members: ["user_a", "user_b"], created_by_id: "user_a" }, state: false });
    expect(calls[0].url.searchParams.get("api_key")).toBe("key123");
    expect(calls[0].headers["stream-auth-type"]).toBe("jwt");
    expect(calls[0].headers.Authorization).toBe(serverToken("secret456"));
  });

  it("sends with Ball Boi's message id and no Stream push", async () => {
    replies.push({ status: 201, body: { message: { id: "dm_abc-m1", text: "Hi", user: { id: "user_a" }, created_at: "2026-10-29T15:00:00Z" } } });
    const m = await provider().sendMessage({ channelId: "dm_abc", messageId: "dm_abc-m1", senderId: "user_a", text: "Hi" });
    expect(calls[0].body).toEqual({ message: { id: "dm_abc-m1", text: "Hi", user_id: "user_a" }, skip_push: true });
    expect(m).toEqual({
      id: "dm_abc-m1",
      channelId: "dm_abc",
      senderId: "user_a",
      text: "Hi",
      createdAt: new Date("2026-10-29T15:00:00Z"),
      hidden: false,
    });
  });

  it("pages messages backwards and reads hidden ones as hidden", async () => {
    replies.push({
      status: 200,
      body: {
        messages: [
          { id: "1", text: "a", user: { id: "u" }, created_at: "2026-10-29T15:00:00Z" },
          { id: "2", text: "b", user: { id: "u" }, created_at: "2026-10-29T15:01:00Z", bb_hidden: true },
        ],
      },
    });
    const list = await provider().listMessages("dm_abc", { limit: 20, before: "9" });
    expect(calls[0].body).toEqual({ state: true, messages: { limit: 20, id_lt: "9" } });
    expect(list.map((m) => [m.id, m.hidden])).toEqual([
      ["1", false],
      ["2", true],
    ]);
  });

  it("finds a message's channel from its cid, and returns null when it's gone", async () => {
    replies.push({ status: 200, body: { message: { id: "x", cid: "messaging:dm_abc", user: { id: "u" }, created_at: "2026-10-29T15:00:00Z" } } });
    replies.push({ status: 404, body: { code: 4, message: "not found" } });
    const p = provider();
    expect((await p.getMessage("x"))?.channelId).toBe("dm_abc");
    expect(await p.getMessage("y")).toBeNull();
  });

  it("hides with a reversible custom field", async () => {
    const p = provider();
    await p.setHidden("x", true);
    await p.setHidden("x", false);
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ["PUT", "/messages/x", { set: { bb_hidden: true } }],
      ["PUT", "/messages/x", { unset: ["bb_hidden"] }],
    ]);
  });

  it("hard-deletes a user and their messages on account deletion", async () => {
    await provider().deleteUserData("user_a");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.pathname).toBe("/users/user_a");
    expect(calls[0].url.searchParams.get("hard_delete")).toBe("true");
    expect(calls[0].url.searchParams.get("mark_messages_deleted")).toBe("true");
  });

  it("surfaces Stream errors", async () => {
    replies.push({ status: 429, body: { code: 9, message: "Too many requests" } });
    await expect(provider().sendMessage({ channelId: "c", messageId: "m", senderId: "u", text: "t" })).rejects.toThrow("Too many requests");
  });
});
