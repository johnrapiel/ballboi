// Direct messages and Message Requests. Spec: Messaging and moderation.
//
// Rules, in the order a send is checked:
// 1. You can't message yourself, or anyone either of you has blocked.
// 2. League mates and players who've had a match together message freely.
//    Anyone else's first message lands in the recipient's Message Requests.
// 3. Starting a conversation: restricted accounts can't, and accounts in their
//    first week can start at most 5 a day.
// 4. A first message to a non-connection can't include links, phone numbers or
//    blocked terms, and the sender can't send again until the recipient replies.
// 5. The recipient replying accepts the request. Nobody ever sees whether the
//    other person has read a message (no read receipts).

import { createHash } from "node:crypto";
import { FILTER_MESSAGES, FirstMessageFilter } from "./filter";
import type { MessagingProvider, ProviderMessage } from "./provider";
import { pairKeyFor, type ConversationRecord, type MessagingRepo } from "./repo";

export const MAX_MESSAGE_LENGTH = 2000;
export const NEW_ACCOUNT_DAYS = 7;
export const NEW_ACCOUNT_DAILY_LIMIT = 5;
const DAY_MS = 86_400_000;

export class MessagingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** How a conversation looks to one of its two people. */
export type ConversationState = "active" | "awaiting_reply" | "request";

export interface ConversationView {
  id: number;
  state: ConversationState;
  other: { name: string; playerId: number | null };
  lastMessage: { text: string; fromMe: boolean; at: string } | null;
  unread: number;
  canSend: boolean;
  /** Why the composer is off, in plain words. */
  sendBlockedReason: string | null;
}

export interface MessageView {
  id: string;
  text: string;
  fromMe: boolean;
  at: string;
}

export interface NewMessageEvent {
  conversationId: number;
  recipientId: string;
  senderName: string;
  text: string;
  isRequest: boolean;
}

export interface MessagingServiceDeps {
  repo: MessagingRepo;
  provider: MessagingProvider;
  filter?: FirstMessageFilter;
  now?: () => Date;
  /** Push hook. Messaging push isn't built yet; see notify.ts. */
  onNewMessage?: (event: NewMessageEvent) => void | Promise<void>;
  /** Development only: sample players reply to you after a few seconds. */
  devAutoReply?: boolean;
}

export const DEV_SAMPLE_PREFIX = "dev_sample_";

const MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function openingHash(text: string): string {
  return createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32);
}

function channelIdFor(pairKey: string): string {
  return `dm_${createHash("sha256").update(pairKey).digest("hex").slice(0, 24)}`;
}

export class MessagingService {
  readonly repo: MessagingRepo;
  readonly provider: MessagingProvider;
  private filter: FirstMessageFilter;
  private now: () => Date;
  private onNewMessage?: MessagingServiceDeps["onNewMessage"];
  private devAutoReply: boolean;

  constructor(deps: MessagingServiceDeps) {
    this.repo = deps.repo;
    this.provider = deps.provider;
    this.filter = deps.filter ?? new FirstMessageFilter();
    this.now = deps.now ?? (() => new Date());
    this.onNewMessage = deps.onNewMessage;
    this.devAutoReply = deps.devAutoReply ?? false;
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  private stateFor(c: ConversationRecord, me: string): ConversationState | null {
    if (c.status === "active") return "active";
    if (c.requester === me) return "awaiting_reply";
    return c.status === "request" ? "request" : null; // declined: gone for the recipient
  }

  private otherOf(c: ConversationRecord, me: string): string {
    return c.userA === me ? c.userB : c.userA;
  }

  /** Conversations this person should see: blocked pairs and restricted senders' requests drop out. */
  private async visibleFor(me: string): Promise<{ c: ConversationRecord; state: ConversationState }[]> {
    const all = await this.repo.listFor(me);
    const blocked = await this.repo.blockedSetFor(me);
    const requesters = all.filter((c) => c.status === "request" && c.requester !== me).map((c) => c.requester!);
    const restricted = await this.repo.restrictedSet([...new Set(requesters)]);
    const out: { c: ConversationRecord; state: ConversationState }[] = [];
    for (const c of all) {
      if (blocked.has(this.otherOf(c, me))) continue;
      const state = this.stateFor(c, me);
      if (!state) continue;
      if (state === "request" && restricted.has(c.requester!)) continue;
      // A request with no message yet is still being created.
      if (state !== "active" && !c.lastMessageAt) continue;
      out.push({ c, state });
    }
    return out.sort((x, y) => (y.c.lastMessageAt?.getTime() ?? 0) - (x.c.lastMessageAt?.getTime() ?? 0));
  }

  private async views(me: string, rows: { c: ConversationRecord; state: ConversationState }[]): Promise<ConversationView[]> {
    const people = await this.repo.people(rows.map((r) => this.otherOf(r.c, me)));
    return rows.map(({ c, state }) => {
      const other = people.get(this.otherOf(c, me)) ?? { name: "Player", playerId: null };
      const awaiting = state === "awaiting_reply";
      return {
        id: c.id,
        state,
        other,
        lastMessage:
          c.lastMessageAt && c.lastMessageText !== null
            ? { text: c.lastMessageText, fromMe: c.lastSender === me, at: c.lastMessageAt.toISOString() }
            : null,
        unread: c.userA === me ? c.aUnread : c.bUnread,
        canSend: !awaiting,
        sendBlockedReason: awaiting ? `You can send more once ${other.name} replies.` : null,
      };
    });
  }

  /** Messages: active conversations and requests you sent. Requests: first messages waiting for you. */
  async list(me: string, box: "messages" | "requests"): Promise<ConversationView[]> {
    const rows = (await this.visibleFor(me)).filter((r) => (box === "requests" ? r.state === "request" : r.state !== "request"));
    return this.views(me, rows);
  }

  /** For the Messages button badge and the Requests count. */
  async summary(me: string): Promise<{ unread: number; requests: number }> {
    const rows = await this.visibleFor(me);
    let unread = 0;
    let requests = 0;
    for (const { c, state } of rows) {
      if (state === "request") requests += 1;
      else unread += c.userA === me ? c.aUnread : c.bUnread;
    }
    return { unread, requests };
  }

  private async conversationFor(me: string, id: number): Promise<{ c: ConversationRecord; state: ConversationState }> {
    const c = await this.repo.findById(id);
    const state = c && (c.userA === me || c.userB === me) ? this.stateFor(c, me) : null;
    if (!c || !state) throw new MessagingError(404, "not_found", "This conversation isn't available.");
    const blocked = await this.repo.blockedSetFor(me);
    if (blocked.has(this.otherOf(c, me))) throw new MessagingError(404, "not_found", "This conversation isn't available.");
    return { c, state };
  }

  /** Opens a conversation and marks it read for you. */
  async thread(me: string, id: number, opts: { before?: string } = {}): Promise<{ conversation: ConversationView; messages: MessageView[] }> {
    let { c, state } = await this.conversationFor(me, id);
    if (c.userA === me && c.aUnread > 0) c = await this.repo.update(c.id, { aUnread: 0 });
    if (c.userB === me && c.bUnread > 0) c = await this.repo.update(c.id, { bUnread: 0 });
    const messages = await this.provider.listMessages(c.channelId, { limit: 50, before: opts.before });
    const [conversation] = await this.views(me, [{ c, state }]);
    return {
      conversation,
      messages: messages.filter((m) => !m.hidden).map((m) => this.messageView(m, me)),
    };
  }

  private messageView(m: ProviderMessage, me: string): MessageView {
    return { id: m.id, text: m.text, fromMe: m.senderId === me, at: m.createdAt.toISOString() };
  }

  /** League mates you can message freely, for New message. */
  async contacts(me: string) {
    const [contacts, blocked] = await Promise.all([this.repo.contactsFor(me), this.repo.blockedSetFor(me)]);
    return contacts.filter((p) => !blocked.has(p.userId)).map(({ name, playerId }) => ({ name, playerId }));
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  private cleanText(raw: unknown): string {
    if (typeof raw !== "string") throw new MessagingError(400, "invalid_text", "Write a message first.");
    const text = raw.trim();
    if (!text) throw new MessagingError(400, "invalid_text", "Write a message first.");
    if (text.length > MAX_MESSAGE_LENGTH) throw new MessagingError(400, "too_long", `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
    return text;
  }

  private cleanMessageId(raw: unknown): string {
    if (typeof raw !== "string" || !MESSAGE_ID.test(raw)) throw new MessagingError(400, "invalid_id", "Missing message id.");
    return raw;
  }

  /** The first message to a player: finds or creates the conversation, then sends. */
  async start(me: string, input: { playerId: unknown; text: unknown; clientMessageId: unknown }) {
    const text = this.cleanText(input.text);
    const clientId = this.cleanMessageId(input.clientMessageId);
    const playerId = Number(input.playerId);
    const other = Number.isInteger(playerId) ? await this.repo.accountForPlayer(playerId) : null;
    if (!other) throw new MessagingError(404, "no_account", "This player doesn't have an account yet.");
    if (other === me) throw new MessagingError(400, "self", "You can't message yourself.");

    const existing = await this.repo.findByPair(pairKeyFor(me, other));
    if (existing) return this.sendTo(me, existing, text, clientId);

    const blocked = await this.repo.blockedSetFor(me);
    if (blocked.has(other)) throw new MessagingError(403, "blocked", "You can't message this player.");
    await this.checkCanStart(me);

    const connected = await this.repo.areConnected(me, other);
    if (!connected) {
      const verdict = this.filter.check(text);
      if (!verdict.ok) throw new MessagingError(422, `filtered_${verdict.reason}`, FILTER_MESSAGES[verdict.reason!]);
    }

    const pairKey = pairKeyFor(me, other);
    const [userA, userB] = pairKey.split(":") as [string, string];
    const channelId = channelIdFor(pairKey);
    await this.provider.ensureChannel(channelId, [userA, userB]);
    const c = await this.repo.create({
      pairKey,
      userA,
      userB,
      status: connected ? "active" : "request",
      requester: me,
      channelId,
      openingHash: openingHash(text),
    });
    return this.deliver(me, c, text, clientId);
  }

  /** Sends in an existing conversation. */
  async send(me: string, id: number, input: { text: unknown; clientMessageId: unknown }) {
    const text = this.cleanText(input.text);
    const clientId = this.cleanMessageId(input.clientMessageId);
    const c = await this.repo.findById(id);
    if (!c || (c.userA !== me && c.userB !== me)) throw new MessagingError(404, "not_found", "This conversation isn't available.");
    return this.sendTo(me, c, text, clientId);
  }

  /** Accounts that are restricted, or new and over today's limit, can't start conversations. */
  async checkCanStart(me: string) {
    const restricted = await this.repo.restrictedSet([me]);
    if (restricted.has(me)) {
      throw new MessagingError(403, "restricted", "You can't start new conversations right now while we review your account.");
    }
    const created = await this.repo.accountCreatedAt(me);
    const now = this.now();
    const isNew = !created || now.getTime() - created.getTime() < NEW_ACCOUNT_DAYS * DAY_MS;
    if (isNew) {
      const started = await this.repo.countStartedSince(me, new Date(now.getTime() - DAY_MS));
      if (started >= NEW_ACCOUNT_DAILY_LIMIT) {
        throw new MessagingError(
          429,
          "throttled",
          `New accounts can start ${NEW_ACCOUNT_DAILY_LIMIT} conversations a day for the first week. Try again tomorrow.`,
        );
      }
    }
  }

  private async sendTo(me: string, c: ConversationRecord, text: string, clientId: string) {
    const other = this.otherOf(c, me);
    const blocked = await this.repo.blockedSetFor(me);
    if (blocked.has(other)) throw new MessagingError(403, "blocked", "You can't message this player.");

    if (c.status !== "active") {
      if (c.requester === me) {
        // Becoming league mates after the request upgrades it; otherwise wait.
        if (!(await this.repo.areConnected(me, other))) {
          const people = await this.repo.people([other]);
          const name = people.get(other)?.name ?? "this player";
          throw new MessagingError(409, "awaiting_reply", `You can send more once ${name} replies.`);
        }
      }
      c = await this.repo.update(c.id, { status: "active", acceptedAt: this.now() });
    }
    return this.deliver(me, c, text, clientId);
  }

  private async deliver(me: string, c: ConversationRecord, text: string, clientId: string) {
    const messageId = `${c.channelId}-${clientId}`;
    const already = await this.provider.getMessage(messageId);
    if (already) return { conversationId: c.id, message: this.messageView(already, me) };

    const message = await this.provider.sendMessage({ channelId: c.channelId, messageId, senderId: me, text });
    const updated = await this.repo.recordMessage(c.id, { sender: me, text, at: message.createdAt });
    const recipientId = this.otherOf(updated, me);
    const people = await this.repo.people([me]);
    await Promise.resolve(
      this.onNewMessage?.({
        conversationId: c.id,
        recipientId,
        senderName: people.get(me)?.name ?? "Player",
        text,
        isRequest: updated.status === "request",
      }),
    ).catch(() => undefined);
    if (this.devAutoReply && recipientId.startsWith(DEV_SAMPLE_PREFIX)) this.scheduleDevReply(recipientId, c.id);
    return { conversationId: c.id, message: this.messageView(message, me) };
  }

  /** The recipient deletes a request. The sender isn't told and still can't send. */
  async decline(me: string, id: number) {
    const { c, state } = await this.conversationFor(me, id);
    if (state !== "request") throw new MessagingError(400, "not_request", "Only Message Requests can be deleted.");
    await this.repo.update(c.id, c.userA === me ? { status: "declined", aUnread: 0 } : { status: "declined", bUnread: 0 });
  }

  /** Account deletion: messages they sent, then every conversation record. */
  async deleteUserData(me: string) {
    await this.provider.deleteUserData(me);
    await this.repo.deleteAllFor(me);
  }

  // ─── Development samples ──────────────────────────────────────────────────

  private scheduleDevReply(sampleId: string, conversationId: number) {
    const timer = setTimeout(() => {
      void (async () => {
        const c = await this.repo.findById(conversationId);
        if (!c || c.status !== "active") return;
        const id = `dev${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await this.deliver(sampleId, c, "Sounds good. See you on court.", id);
      })().catch(() => undefined);
    }, 3000);
    timer.unref?.();
  }

  /**
   * Development only: one chat with Sam (active, replies to you) and one
   * Message Request from Jordan, so every screen can be tried with one phone.
   */
  async seedSamples(me: string, names: (id: string, name: string) => Promise<void>) {
    const sam = `${DEV_SAMPLE_PREFIX}sam`;
    const jordan = `${DEV_SAMPLE_PREFIX}jordan`;
    await names(sam, "Sam Rivera");
    await names(jordan, "Jordan Lee");
    const make = async (other: string, status: "active" | "request", text: string) => {
      const pairKey = pairKeyFor(me, other);
      const [userA, userB] = pairKey.split(":") as [string, string];
      const channelId = channelIdFor(pairKey);
      await this.provider.ensureChannel(channelId, [userA, userB]);
      const existing = await this.repo.findByPair(pairKey);
      const c =
        existing ??
        (await this.repo.create({ pairKey, userA, userB, status, requester: other, channelId, openingHash: openingHash(text) }));
      await this.deliver(other, c, text, `seed${Date.now().toString(36)}${status}`);
    };
    await make(sam, "active", "Still on for Saturday at 9?");
    await make(jordan, "request", "Hi, saw you play at Memorial Park. Up for a hit sometime?");
  }
}
