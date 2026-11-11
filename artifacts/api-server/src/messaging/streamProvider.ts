// Stream Chat as the messaging provider (spec decision 8: Maker plan, headless,
// behind Ball Boi's own interface). Only the API server talks to Stream; the
// app never connects to it, so Stream's concurrent-connection limit never
// applies and every Ball Boi rule runs before a message reaches Stream.
//
// Uses Stream's server REST API with Node's built-in crypto and fetch, so
// there's no SDK to install. Keys: STREAM_API_KEY and STREAM_API_SECRET in
// .env locally and Cloudflare secrets in production. Never commit them.

import { createHmac, timingSafeEqual } from "node:crypto";
import { SYSTEM_SENDER, type MessagingProvider, type ProviderMessage, type SendInput } from "./provider";

const BASE_URL = "https://chat.stream-io-api.com";
const CHANNEL_TYPE = "messaging";
/** Custom field for moderator hides. Reversible, unlike Stream's delete. */
const HIDDEN_FIELD = "bb_hidden";
/** League chats (decision 145): an admin post, and the accounts a message @mentions. */
const ADMIN_FIELD = "bb_admin";
const MENTIONS_FIELD = "bb_mentions";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** A server token: HS256 JWT with `{ server: true }`, signed with the API secret. */
export function serverToken(secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ server: true }));
  const sig = base64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** Stream signs webhooks with HMAC-SHA256 of the raw body, hex, keyed by the API secret. */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

interface StreamMessage {
  id: string;
  text?: string;
  cid?: string;
  user?: { id: string };
  created_at: string;
  type?: string;
  [HIDDEN_FIELD]?: boolean;
  [ADMIN_FIELD]?: boolean;
  [MENTIONS_FIELD]?: unknown;
}

export class StreamApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "StreamApiError";
  }

  /**
   * Stream says the thing asked for isn't there: a 404, or code 16
   * ("does not exist"). Querying a channel that was never made, with no
   * creator, comes back as code 4 asking for created_by: that means missing too.
   */
  get missing(): boolean {
    return this.status === 404 || this.code === 16 || (this.code === 4 && /created_by/i.test(this.message));
  }
}

/** Stream's upsert users call takes at most 100 users at a time. */
const USERS_PER_CALL = 100;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class StreamMessagingProvider implements MessagingProvider {
  readonly name = "stream" as const;
  private token: string;
  private knownUsers = new Set<string>();

  constructor(
    private apiKey: string,
    secret: string,
    private fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {
    this.token = serverToken(secret);
  }

  private async call<T>(method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams({ api_key: this.apiKey, ...query });
    const res = await this.fetchImpl(`${BASE_URL}${path}?${params}`, {
      method,
      headers: {
        Authorization: this.token,
        "stream-auth-type": "jwt",
        "Content-Type": "application/json",
        "X-Stream-Client": "ballboi-api",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
    if (!res.ok) {
      // Says which call failed and Stream's own reason, so the API logs explain it. Never the keys.
      const reason = json.message ?? "no reason given";
      throw new StreamApiError(
        res.status,
        json.code,
        `Stream ${method} ${path} failed (HTTP ${res.status}${json.code !== undefined ? `, code ${json.code}` : ""}): ${reason}`,
      );
    }
    return json;
  }

  private toMessage(m: StreamMessage, channelId?: string): ProviderMessage {
    const cid = m.cid ?? "";
    return {
      id: m.id,
      channelId: channelId ?? cid.slice(cid.indexOf(":") + 1),
      senderId: m.user?.id ?? "",
      text: m.text ?? "",
      createdAt: new Date(m.created_at),
      hidden: m[HIDDEN_FIELD] === true || m.type === "deleted",
      ...(m.type === "system" ? { system: true } : {}),
      ...(m[ADMIN_FIELD] === true ? { admin: true } : {}),
      ...(Array.isArray(m[MENTIONS_FIELD]) ? { mentions: (m[MENTIONS_FIELD] as unknown[]).filter((u): u is string => typeof u === "string") } : {}),
    };
  }

  /**
   * Checks the keys at startup with Stream's get app settings call, so a wrong
   * key or secret shows in the API logs right away, not on someone's first chat.
   */
  async check(): Promise<void> {
    await this.call("GET", "/app");
  }

  /** Stream users are just ids here; names and photos stay in Ball Boi. */
  private async ensureUsers(ids: string[]) {
    const missing = [...new Set(ids)].filter((id) => !this.knownUsers.has(id));
    for (let i = 0; i < missing.length; i += USERS_PER_CALL) {
      const batch = missing.slice(i, i + USERS_PER_CALL);
      await this.call("POST", "/users", { users: Object.fromEntries(batch.map((id) => [id, { id }])) });
      batch.forEach((id) => this.knownUsers.add(id));
    }
  }

  /**
   * Makes the Stream users, then gets or creates the channel with them in it.
   * A channel needs a creator when the server makes it; with no members yet
   * (a chat everyone left) Ball Boi's own user makes it.
   */
  async ensureChannel(channelId: string, members: string[]): Promise<void> {
    const unique = [...new Set(members)];
    const creator = unique[0] ?? SYSTEM_SENDER;
    await this.ensureUsers(unique.length ? unique : [SYSTEM_SENDER]);
    await this.call("POST", `/channels/${CHANNEL_TYPE}/${channelId}/query`, {
      data: { members: unique, created_by_id: creator },
      state: false,
    });
  }

  /** Group chats (F15): Stream's update channel call, with add_members. */
  async addMembers(channelId: string, userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    await this.ensureUsers(userIds);
    await this.call("POST", `/channels/${CHANNEL_TYPE}/${channelId}`, { add_members: userIds.map((user_id) => ({ user_id })) });
  }

  async removeMembers(channelId: string, userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    try {
      await this.call("POST", `/channels/${CHANNEL_TYPE}/${channelId}`, { remove_members: userIds });
    } catch (e) {
      if (e instanceof StreamApiError && e.missing) return; // channel already gone
      throw e;
    }
  }

  async sendMessage(input: SendInput): Promise<ProviderMessage> {
    const system = input.system === true && input.senderId === SYSTEM_SENDER;
    // Ball Boi's lines go out as Stream system messages from one server-side user.
    if (system) await this.ensureUsers([SYSTEM_SENDER]);
    const res = await this.call<{ message: StreamMessage }>("POST", `/channels/${CHANNEL_TYPE}/${input.channelId}/message`, {
      message: {
        id: input.messageId,
        text: input.text,
        user_id: input.senderId,
        ...(system ? { type: "system" } : {}),
        // League chats (decision 145): custom fields Stream keeps on the message.
        ...(!system && input.admin ? { [ADMIN_FIELD]: true } : {}),
        ...(!system && input.mentions?.length ? { [MENTIONS_FIELD]: input.mentions } : {}),
      },
      // Ball Boi sends its own push (messaging/notify.ts).
      skip_push: true,
    });
    return this.toMessage(res.message, input.channelId);
  }

  /** A channel Stream doesn't have yet has no messages, so it reads as empty instead of failing. */
  async listMessages(channelId: string, opts: { limit?: number; before?: string } = {}): Promise<ProviderMessage[]> {
    try {
      const res = await this.call<{ messages?: StreamMessage[] }>("POST", `/channels/${CHANNEL_TYPE}/${channelId}/query`, {
        state: true,
        messages: { limit: opts.limit ?? 50, ...(opts.before ? { id_lt: opts.before } : {}) },
      });
      return (res.messages ?? []).map((m) => this.toMessage(m, channelId));
    } catch (e) {
      if (e instanceof StreamApiError && e.missing) return [];
      throw e;
    }
  }

  async getMessage(messageId: string): Promise<ProviderMessage | null> {
    try {
      const res = await this.call<{ message: StreamMessage }>("GET", `/messages/${encodeURIComponent(messageId)}`);
      return this.toMessage(res.message);
    } catch (e) {
      if (e instanceof StreamApiError && e.missing) return null;
      throw e;
    }
  }

  async setHidden(messageId: string, hidden: boolean): Promise<void> {
    await this.call(
      "PUT",
      `/messages/${encodeURIComponent(messageId)}`,
      hidden ? { set: { [HIDDEN_FIELD]: true } } : { unset: [HIDDEN_FIELD] },
    );
  }

  async deleteUserData(userId: string): Promise<void> {
    try {
      await this.call("DELETE", `/users/${encodeURIComponent(userId)}`, undefined, {
        hard_delete: "true",
        mark_messages_deleted: "true",
      });
    } catch (e) {
      if (e instanceof StreamApiError && e.missing) return; // never messaged
      throw e;
    }
    this.knownUsers.delete(userId);
  }
}
