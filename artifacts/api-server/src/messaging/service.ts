// Direct messages. Spec: Messaging and moderation.
//
// There are no Message Requests (John, Nov 6, finding 17): every message goes
// straight to the inbox, and either person can keep sending.
//
// Rules, in the order a send is checked:
// 1. You can't message yourself, or anyone either of you has blocked. A chat
//    with someone you blocked stays in your inbox, read only, so you can
//    unblock them from it; the person you blocked doesn't see it.
// 2. Starting a conversation: accounts a moderator restricted can't, and
//    accounts in their first week can start at most 5 a day. Nothing restricts
//    an account automatically; reports and flags wait for a moderator.
// 3. A first message to someone outside your leagues (no league or match
//    together) can't include links, phone numbers, emails or blocked terms.
// 4. Nobody ever sees whether the other person has read a message (no read
//    receipts).
//
// Conversations made before Nov 6 may still be stored as "request" or
// "declined". Both read as active now; a declined one stays hidden from the
// person who deleted it until a new message arrives.

import { createHash } from "node:crypto";
import { REPORT_REASONS, type ReportReason, type SnapshotMessage } from "@workspace/db";
import type { ModerationRepo } from "./moderation";
import { FILTER_MESSAGES, FirstMessageFilter } from "./filter";
import { SYSTEM_SENDER, type MessagingProvider, type ProviderMessage } from "./provider";
import { pairKeyFor, type ConversationRecord, type GroupMember, type GroupRecord, type MessagingRepo } from "./repo";

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

/** How a conversation looks to one of its two people. Always active now that there are no Message Requests. */
export type ConversationState = "active";

export interface ConversationView {
  id: number;
  state: ConversationState;
  /** You blocked the other person: read only, with Unblock. */
  blocked: boolean;
  other: { name: string; playerId: number | null; userId?: number | null };
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
  /** The direct message conversation, or the group chat when `groupTitle` is set. */
  conversationId: number;
  senderId: string;
  recipientId: string;
  senderName: string;
  text: string;
  /** A group chat message (F15): the chat's title, "Sat 9 AM doubles · Beacon Courts". */
  groupTitle?: string;
}

/** How a group chat looks to one of its members (F15). */
export interface GroupView {
  id: number;
  title: string;
  /** The open match behind it, for Players. */
  openMatchId: number | null;
  /** Everyone in the chat, you included. */
  memberCount: number;
  lastMessage: { text: string; fromMe: boolean; senderName: string | null; at: string } | null;
  unread: number;
  canSend: boolean;
  sendBlockedReason: string | null;
}

export interface GroupMessageView {
  id: string;
  text: string;
  fromMe: boolean;
  at: string;
  /** Null for a line from Ball Boi ("All 4 spots filled"). */
  senderName: string | null;
  /** For Report: the sender's league player, else their account. */
  senderPlayerId: number | null;
  senderUserId: number | null;
}

/** One change to a group chat, from whatever owns it (open matches). */
export interface GroupSync {
  openMatchId: number;
  title: string;
  /** Everyone who should be in the chat now. */
  members: string[];
  open: boolean;
  closedReason?: string | null;
  /** A line from Ball Boi to post with the change. */
  system?: string;
  /** Post `system` only when someone was taken out. */
  systemOnlyIfRemoved?: boolean;
  /** Make the chat if there isn't one yet. Otherwise a missing chat is left alone. */
  create?: boolean;
}

type Visible = { c: ConversationRecord; state: ConversationState; blocked: boolean };

export interface MessagingServiceDeps {
  repo: MessagingRepo;
  provider: MessagingProvider;
  filter?: FirstMessageFilter;
  now?: () => Date;
  /** Push hook: notify.ts sends the message push (Wave 2, Session G). */
  onNewMessage?: (event: NewMessageEvent) => void | Promise<void>;
  /** Development only: sample players reply to you after a few seconds. */
  devAutoReply?: boolean;
  /** Report and restriction storage. Optional so tests can leave it out. */
  moderation?: { repo: ModerationRepo };
}

/** Messages kept in a report snapshot: the reported one and up to this many before it. */
export const SNAPSHOT_CONTEXT = 19;

/** Messages per page when opening or scrolling back through a conversation. */
export const THREAD_PAGE = 50;

export const DEV_SAMPLE_PREFIX = "dev_sample_";

const MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function openingHash(text: string): string {
  return createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32);
}

function channelIdFor(pairKey: string): string {
  return `dm_${createHash("sha256").update(pairKey).digest("hex").slice(0, 24)}`;
}

function groupChannelFor(openMatchId: number): string {
  return `grp_${createHash("sha256").update(`open_match:${openMatchId}`).digest("hex").slice(0, 24)}`;
}

const GROUP_NOT_FOUND = "This group chat isn't available.";
/** A group chat closed because someone in it deleted their account. */
export const LEFT_BALL_BOI = "A player left Ball Boi, so this chat is closed.";

export class MessagingService {
  readonly repo: MessagingRepo;
  readonly provider: MessagingProvider;
  private filter: FirstMessageFilter;
  private now: () => Date;
  private onNewMessage?: MessagingServiceDeps["onNewMessage"];
  private devAutoReply: boolean;
  readonly moderation?: MessagingServiceDeps["moderation"];

  constructor(deps: MessagingServiceDeps) {
    this.repo = deps.repo;
    this.provider = deps.provider;
    this.filter = deps.filter ?? new FirstMessageFilter();
    this.now = deps.now ?? (() => new Date());
    this.onNewMessage = deps.onNewMessage;
    this.devAutoReply = deps.devAutoReply ?? false;
    this.moderation = deps.moderation;
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  private stateFor(c: ConversationRecord, me: string): ConversationState | null {
    // An old request deleted by its recipient stays gone for them until a new message.
    if (c.status === "declined" && c.requester !== me) return null;
    return "active";
  }

  private otherOf(c: ConversationRecord, me: string): string {
    return c.userA === me ? c.userB : c.userA;
  }

  /**
   * Conversations this person should see. Someone who blocked you drops out;
   * someone you blocked stays, read only. A conversation with no message yet
   * is still being created.
   */
  private async visibleFor(me: string): Promise<Visible[]> {
    const all = await this.repo.listFor(me);
    const [blocked, mine] = await Promise.all([this.repo.blockedSetFor(me), this.repo.blockedByMe(me)]);
    const out: Visible[] = [];
    for (const c of all) {
      const other = this.otherOf(c, me);
      if (blocked.has(other) && !mine.has(other)) continue;
      const state = this.stateFor(c, me);
      if (!state) continue;
      if (!c.lastMessageAt) continue;
      out.push({ c, state, blocked: mine.has(other) });
    }
    return out.sort((x, y) => (y.c.lastMessageAt?.getTime() ?? 0) - (x.c.lastMessageAt?.getTime() ?? 0));
  }

  private async views(me: string, rows: Visible[]): Promise<ConversationView[]> {
    const people = await this.repo.people(rows.map((r) => this.otherOf(r.c, me)));
    return rows.map(({ c, state, blocked }) => {
      const other = people.get(this.otherOf(c, me)) ?? { name: "Player", playerId: null };
      return {
        id: c.id,
        state,
        blocked,
        other,
        lastMessage:
          c.lastMessageAt && c.lastMessageText !== null
            ? { text: c.lastMessageText, fromMe: c.lastSender === me, at: c.lastMessageAt.toISOString() }
            : null,
        unread: c.userA === me ? c.aUnread : c.bUnread,
        canSend: !blocked,
        sendBlockedReason: blocked ? `You blocked ${other.name}.` : null,
      };
    });
  }

  /** The inbox: every conversation, newest first. */
  async list(me: string): Promise<ConversationView[]> {
    return this.views(me, await this.visibleFor(me));
  }

  /** For the Messages button badge: unread messages everywhere, group chats included. */
  async summary(me: string): Promise<{ unread: number }> {
    const [rows, groups] = await Promise.all([this.visibleFor(me), this.repo.groupsFor(me)]);
    let unread = 0;
    for (const { c } of rows) unread += c.userA === me ? c.aUnread : c.bUnread;
    for (const { group, member } of groups) if (group.lastMessageAt) unread += member.unread;
    return { unread };
  }

  /** A conversation you can open: yours, and not with someone who blocked you. */
  private async conversationFor(me: string, id: number): Promise<Visible> {
    const c = await this.repo.findById(id);
    const state = c && (c.userA === me || c.userB === me) ? this.stateFor(c, me) : null;
    if (!c || !state) throw new MessagingError(404, "not_found", "This conversation isn't available.");
    const other = this.otherOf(c, me);
    const [blocked, mine] = await Promise.all([this.repo.blockedSetFor(me), this.repo.blockedByMe(me)]);
    if (blocked.has(other) && !mine.has(other)) throw new MessagingError(404, "not_found", "This conversation isn't available.");
    return { c, state, blocked: mine.has(other) };
  }

  /**
   * Opens a conversation and marks it read for you. Returns the latest
   * THREAD_PAGE messages, or the page before `before` (a message id) when
   * scrolling back. `olderCursor` is the `before` for the next page back, or
   * null at the first message.
   */
  async thread(
    me: string,
    id: number,
    opts: { before?: string } = {},
  ): Promise<{ conversation: ConversationView; messages: MessageView[]; olderCursor: string | null }> {
    const found = await this.conversationFor(me, id);
    let { c } = found;
    if (c.userA === me && c.aUnread > 0) c = await this.repo.update(c.id, { aUnread: 0 });
    if (c.userB === me && c.bUnread > 0) c = await this.repo.update(c.id, { bUnread: 0 });
    const messages = await this.provider.listMessages(c.channelId, { limit: THREAD_PAGE, before: opts.before });
    // A chat with messages that come back empty lost its channel (the
    // in-memory provider, restarted). Make it again so replies still send.
    if (!messages.length && c.lastMessageAt && !opts.before) await this.provider.ensureChannel(c.channelId, [c.userA, c.userB]);
    const [conversation] = await this.views(me, [{ ...found, c }]);
    return {
      conversation,
      messages: messages.filter((m) => !m.hidden).map((m) => this.messageView(m, me)),
      // A full page means there may be more before it. The cursor is the
      // oldest message fetched, hidden or not, so a page of hidden ones can't stall paging.
      olderCursor: messages.length >= THREAD_PAGE ? messages[0].id : null,
    };
  }

  private messageView(m: ProviderMessage, me: string): MessageView {
    return { id: m.id, text: m.text, fromMe: m.senderId === me, at: m.createdAt.toISOString() };
  }

  /** Your conversation with a player, if there is one you can see. For opening a chat from a player. */
  async conversationWithPlayer(me: string, playerId: unknown): Promise<number | null> {
    return this.conversationWith(me, await this.accountFor({ playerId }));
  }

  /** Your conversation with a Discover player (by user id), if there is one you can see. */
  async conversationWithUser(me: string, userId: unknown): Promise<number | null> {
    return this.conversationWith(me, await this.accountFor({ userId }));
  }

  /** The account for a league player id, or a user id from Discover (someone who may be in no league yet). */
  private async accountFor(input: { playerId?: unknown; userId?: unknown }): Promise<string | null> {
    if (input.userId !== undefined && input.userId !== null) {
      const userId = Number(input.userId);
      return Number.isInteger(userId) ? this.repo.accountForUser(userId) : null;
    }
    const playerId = Number(input.playerId);
    return Number.isInteger(playerId) ? this.repo.accountForPlayer(playerId) : null;
  }

  private async conversationWith(me: string, other: string | null): Promise<number | null> {
    if (!other || other === me) return null;
    const c = await this.repo.findByPair(pairKeyFor(me, other));
    if (!c) return null;
    const visible = await this.visibleFor(me);
    return visible.some((r) => r.c.id === c.id) ? c.id : null;
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
  async start(me: string, input: { playerId?: unknown; userId?: unknown; text: unknown; clientMessageId: unknown }) {
    const text = this.cleanText(input.text);
    const clientId = this.cleanMessageId(input.clientMessageId);
    const other = await this.accountFor(input);
    if (!other) throw new MessagingError(404, "no_account", "This player doesn't have an account yet.");
    if (other === me) throw new MessagingError(400, "self", "You can't message yourself.");

    const existing = await this.repo.findByPair(pairKeyFor(me, other));
    if (existing) return this.sendTo(me, existing, text, clientId);

    const blocked = await this.repo.blockedSetFor(me);
    if (blocked.has(other)) throw new MessagingError(403, "blocked", "You can't message this player.");
    await this.checkCanStart(me);

    await this.checkFirstMessage(me, other, text);

    const pairKey = pairKeyFor(me, other);
    const [userA, userB] = pairKey.split(":") as [string, string];
    const channelId = channelIdFor(pairKey);
    await this.provider.ensureChannel(channelId, [userA, userB]);
    const c = await this.repo.create({
      pairKey,
      userA,
      userB,
      status: "active",
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

  /**
   * The first message to someone outside your leagues (no league or match
   * together) can't carry links, phone numbers, emails or blocked terms (8.3).
   */
  private async checkFirstMessage(me: string, other: string, text: string) {
    if (await this.repo.areConnected(me, other)) return;
    const verdict = this.filter.check(text);
    if (!verdict.ok) throw new MessagingError(422, `filtered_${verdict.reason}`, FILTER_MESSAGES[verdict.reason!]);
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

    // A retry of a message that already went through (the reply was lost on
    // the way back): confirm it, never send it twice.
    const already = await this.provider.getMessage(this.messageIdFor(c, clientId));
    if (already) {
      // It reached Stream but the conversation never recorded it: record it now so the other player sees it.
      if (!c.lastMessageAt) await this.repo.recordMessage(c.id, { sender: already.senderId, text: already.text, at: already.createdAt });
      return { conversationId: c.id, message: this.messageView(already, me) };
    }

    // The conversation was created but its first message never arrived, so
    // nobody can see it yet: this send is that first message, with the same checks.
    if (!c.lastMessageAt) {
      const restricted = await this.repo.restrictedSet([me]);
      if (restricted.has(me)) {
        throw new MessagingError(403, "restricted", "You can't start new conversations right now while we review your account.");
      }
      await this.checkFirstMessage(me, other, text);
    }
    // Stored before Nov 6 as a request, or a declined one: it's a normal conversation now.
    if (c.status !== "active") c = await this.repo.update(c.id, { status: "active", acceptedAt: this.now() });
    return this.deliver(me, c, text, clientId, true);
  }

  private messageIdFor(c: ConversationRecord, clientId: string): string {
    return `${c.channelId}-${clientId}`;
  }

  /** Sends once per client id. `checked`: the caller already looked for an earlier copy. */
  private async deliver(me: string, c: ConversationRecord, text: string, clientId: string, checked = false) {
    const messageId = this.messageIdFor(c, clientId);
    const already = checked ? null : await this.provider.getMessage(messageId);
    if (already) return { conversationId: c.id, message: this.messageView(already, me) };

    const message = await this.provider.sendMessage({ channelId: c.channelId, messageId, senderId: me, text });
    const updated = await this.repo.recordMessage(c.id, { sender: me, text, at: message.createdAt });
    const recipientId = this.otherOf(updated, me);
    const people = await this.repo.people([me]);
    await Promise.resolve(
      this.onNewMessage?.({
        conversationId: c.id,
        senderId: me,
        recipientId,
        senderName: people.get(me)?.name ?? "Player",
        text,
      }),
    ).catch(() => undefined);
    if (this.devAutoReply && recipientId.startsWith(DEV_SAMPLE_PREFIX)) this.scheduleDevReply(recipientId, c.id);
    return { conversationId: c.id, message: this.messageView(message, me) };
  }

  /** Account deletion: out of every group chat, then messages they sent, then every conversation record. */
  async deleteUserData(me: string) {
    await this.leaveAllGroups(me);
    await this.provider.deleteUserData(me);
    await this.repo.deleteAllFor(me);
  }

  // ─── Group chats (F15) ────────────────────────────────────────────────────
  //
  // An open match's chat once its last spot fills (John, Nov 8). Same rules
  // as direct messages, per sender:
  // - Only members read or send, and only while the chat is open.
  // - Someone you have a block with, either way, is left out of your view:
  //   their messages don't show, count as unread or push to you.
  // - Each person's first message in the chat can't carry links, phone
  //   numbers, emails or blocked terms if anyone else in it is outside their
  //   leagues. The chat's own match doesn't count as a connection.
  // - Lines from Ball Boi ("All 4 spots filled") come from SYSTEM_SENDER.

  /**
   * Brings an open match's chat in step: makes it (with `create`), adds and
   * removes members, opens or closes it, and posts Ball Boi's line. Returns
   * null when there's no chat and `create` is off.
   */
  async syncGroup(input: GroupSync): Promise<GroupRecord | null> {
    let group = await this.repo.findGroupByOpenMatch(input.openMatchId);
    const want = [...new Set(input.members)];
    let removed: string[] = [];
    if (!group) {
      if (!input.create) return null;
      const channelId = groupChannelFor(input.openMatchId);
      await this.provider.ensureChannel(channelId, want);
      group = await this.repo.createGroup({ channelId, openMatchId: input.openMatchId, title: input.title });
      // A chat made earlier that lost its members (a retry after a failure) gets them back here.
      await this.provider.addMembers(channelId, want);
      await this.repo.addGroupMembers(group.id, want, this.now());
    } else {
      const have = (await this.repo.groupMembers(group.id)).map((m) => m.userId);
      const added = want.filter((u) => !have.includes(u));
      removed = have.filter((u) => !want.includes(u));
      if (removed.length) {
        await this.provider.removeMembers(group.channelId, removed);
        await this.repo.removeGroupMembers(group.id, removed);
      }
      if (added.length) {
        await this.provider.ensureChannel(group.channelId, want);
        await this.provider.addMembers(group.channelId, added);
        await this.repo.addGroupMembers(group.id, added, this.now());
      }
    }
    group = await this.repo.updateGroup(group.id, {
      title: input.title,
      open: input.open,
      closedReason: input.open ? null : (input.closedReason ?? null),
    });
    if (input.system && (!input.systemOnlyIfRemoved || removed.length)) group = await this.postSystem(group, input.system);
    return group;
  }

  /** The chat for an open match, if it has one. */
  async groupForOpenMatch(openMatchId: number): Promise<GroupRecord | null> {
    return this.repo.findGroupByOpenMatch(openMatchId);
  }

  /** A line from Ball Boi. Counts as unread for everyone; the open match sends its own push. */
  private async postSystem(group: GroupRecord, text: string): Promise<GroupRecord> {
    const id = `${group.channelId}-sys${this.now().getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const message = await this.provider.sendMessage({ channelId: group.channelId, messageId: id, senderId: SYSTEM_SENDER, text, system: true });
    const members = await this.repo.groupMembers(group.id);
    return this.repo.recordGroupMessage(group.id, { sender: null, text, at: message.createdAt, recipients: members.map((m) => m.userId) });
  }

  /** A group chat you're in. */
  private async groupFor(me: string, id: number): Promise<{ group: GroupRecord; member: GroupMember; members: GroupMember[] }> {
    const group = Number.isInteger(id) ? await this.repo.findGroup(id) : null;
    const members = group ? await this.repo.groupMembers(group.id) : [];
    const member = members.find((m) => m.userId === me);
    if (!group || !member) throw new MessagingError(404, "not_found", GROUP_NOT_FOUND);
    return { group, member, members };
  }

  private async groupView(me: string, group: GroupRecord, member: GroupMember, memberCount: number, blocked: Set<string>): Promise<GroupView> {
    let last: GroupView["lastMessage"] = null;
    if (group.lastMessageAt && group.lastMessageText !== null) {
      if (group.lastSender && blocked.has(group.lastSender)) {
        // The latest is from someone you have a block with: show the one before it you can see.
        const recent = (await this.provider.listMessages(group.channelId, { limit: 20 })).filter(
          (m) => !m.hidden && (m.system || !blocked.has(m.senderId)),
        );
        const seen = recent[recent.length - 1];
        if (seen) last = await this.lastFrom(me, seen.system ? null : seen.senderId, seen.text, seen.createdAt);
      } else {
        last = await this.lastFrom(me, group.lastSender, group.lastMessageText, group.lastMessageAt);
      }
    }
    return {
      id: group.id,
      title: group.title,
      openMatchId: group.openMatchId,
      memberCount,
      lastMessage: last,
      unread: member.unread,
      canSend: group.open,
      sendBlockedReason: group.open ? null : (group.closedReason ?? "This chat is closed."),
    };
  }

  private async lastFrom(me: string, sender: string | null, text: string, at: Date): Promise<GroupView["lastMessage"]> {
    const name = sender && sender !== me ? ((await this.repo.people([sender])).get(sender)?.name ?? "Player") : null;
    return { text, fromMe: sender === me, senderName: sender === me ? "You" : name, at: at.toISOString() };
  }

  /** Group chats for Messages, newest first. */
  async groups(me: string): Promise<GroupView[]> {
    const [rows, blocked] = await Promise.all([this.repo.groupsFor(me), this.repo.blockedSetFor(me)]);
    const views = await Promise.all(
      rows
        .filter(({ group }) => group.lastMessageAt)
        .map(async ({ group, member }) => this.groupView(me, group, member, (await this.repo.groupMembers(group.id)).length, blocked)),
    );
    return views.sort((a, b) => (b.lastMessage?.at ?? "").localeCompare(a.lastMessage?.at ?? ""));
  }

  /** Opens a group chat and marks it read for you. Paged like `thread`. */
  async groupThread(
    me: string,
    id: number,
    opts: { before?: string } = {},
  ): Promise<{ group: GroupView; messages: GroupMessageView[]; olderCursor: string | null }> {
    const { group, member, members } = await this.groupFor(me, id);
    if (member.unread > 0) await this.repo.markGroupRead(group.id, me);
    const blocked = await this.repo.blockedSetFor(me);
    const messages = await this.provider.listMessages(group.channelId, { limit: THREAD_PAGE, before: opts.before });
    const shown = messages.filter((m) => !m.hidden && (m.system || !blocked.has(m.senderId)));
    const people = await this.repo.people([...new Set(shown.filter((m) => !m.system && m.senderId !== me).map((m) => m.senderId))]);
    return {
      group: await this.groupView(me, group, { ...member, unread: 0 }, members.length, blocked),
      messages: shown.map((m) => {
        const p = m.system || m.senderId === me ? null : people.get(m.senderId);
        return {
          id: m.id,
          text: m.text,
          fromMe: m.senderId === me,
          at: m.createdAt.toISOString(),
          senderName: m.system ? null : m.senderId === me ? "You" : (p?.name ?? "Player"),
          senderPlayerId: p?.playerId ?? null,
          senderUserId: p?.userId ?? null,
        };
      }),
      olderCursor: messages.length >= THREAD_PAGE ? messages[0].id : null,
    };
  }

  /** Sends in a group chat you're in. Retrying with the same client id never posts twice. */
  async sendToGroup(me: string, id: number, input: { text: unknown; clientMessageId: unknown }) {
    const text = this.cleanText(input.text);
    const clientId = this.cleanMessageId(input.clientMessageId);
    const { group, member, members } = await this.groupFor(me, id);
    const messageId = `${group.channelId}-${clientId}`;
    const already = await this.provider.getMessage(messageId);
    if (already) return { groupId: group.id, message: this.groupMessageView(already, me) };
    if (!group.open) throw new MessagingError(409, "closed", group.closedReason ?? "This chat is closed.");

    const others = members.map((m) => m.userId).filter((u) => u !== me);
    if (!member.firstSentAt) await this.checkFirstGroupMessage(me, others, text);

    const message = await this.provider.sendMessage({ channelId: group.channelId, messageId, senderId: me, text });
    const blocked = await this.repo.blockedSetFor(me);
    const recipients = others.filter((u) => !blocked.has(u));
    await this.repo.recordGroupMessage(group.id, { sender: me, text, at: message.createdAt, recipients });
    const senderName = (await this.repo.people([me])).get(me)?.name ?? "Player";
    for (const recipientId of recipients) {
      await Promise.resolve(
        this.onNewMessage?.({ conversationId: group.id, senderId: me, recipientId, senderName, text, groupTitle: group.title }),
      ).catch(() => undefined);
    }
    return { groupId: group.id, message: this.groupMessageView(message, me) };
  }

  /** The direct message rule, per sender: anyone in the chat outside your leagues means the filter applies. */
  private async checkFirstGroupMessage(me: string, others: string[], text: string) {
    for (const other of others) {
      if (await this.repo.areConnected(me, other, { beyondOpenMatches: true })) continue;
      const verdict = this.filter.check(text);
      if (!verdict.ok) throw new MessagingError(422, `filtered_${verdict.reason}`, FILTER_MESSAGES[verdict.reason!]);
      return;
    }
  }

  private groupMessageView(m: ProviderMessage, me: string): GroupMessageView {
    return {
      id: m.id,
      text: m.text,
      fromMe: m.senderId === me,
      at: m.createdAt.toISOString(),
      senderName: m.system ? null : m.senderId === me ? "You" : "Player",
      senderPlayerId: null,
      senderUserId: null,
    };
  }

  /**
   * Account deletion: out of every group chat they're in. The match lost a
   * player (or its poster, and with them the post), so an open chat closes
   * with a line saying so; the rest keep it, read only.
   */
  async leaveAllGroups(me: string) {
    for (const { group } of await this.repo.groupsFor(me)) {
      await this.provider.removeMembers(group.channelId, [me]);
      await this.repo.removeGroupMembers(group.id, [me]);
      if (group.open) {
        const closed = await this.repo.updateGroup(group.id, { open: false, closedReason: LEFT_BALL_BOI });
        if ((await this.repo.groupMembers(group.id)).length) await this.postSystem(closed, "A player left Ball Boi.");
      }
    }
  }

  // ─── Reports and moderation ───────────────────────────────────────────────

  /**
   * Reports a message from the other person. Stores a snapshot of it and the
   * messages before it, so moderators see what was said even if it's later
   * deleted. The report waits for a moderator; the sender's account is
   * untouched until one acts.
   */
  async reportMessage(me: string, id: number, input: { messageId: unknown; reason: unknown; details: unknown }) {
    const { c } = await this.conversationFor(me, id);
    return this.fileReport(me, c.channelId, c.id, input);
  }

  /** Reports a message in a group chat you're in (F15): the same report, with a snapshot of the chat. */
  async reportGroupMessage(me: string, id: number, input: { messageId: unknown; reason: unknown; details: unknown }) {
    const { group } = await this.groupFor(me, id);
    return this.fileReport(me, group.channelId, null, input);
  }

  private async fileReport(
    me: string,
    channelId: string,
    conversationId: number | null,
    input: { messageId: unknown; reason: unknown; details: unknown },
  ) {
    if (!this.moderation) throw new MessagingError(503, "unavailable", "Reporting isn't available right now.");
    if (typeof input.reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(input.reason)) {
      throw new MessagingError(400, "invalid_reason", "Pick a reason for the report.");
    }
    const reason = input.reason as ReportReason;
    const details = typeof input.details === "string" ? input.details.trim().slice(0, 1000) || undefined : undefined;
    // "Something else" opens a required text field (F9).
    if (reason === "other" && !details) throw new MessagingError(400, "details_required", "Tell us what happened.");
    const messageId = typeof input.messageId === "string" ? input.messageId : "";
    const message = messageId ? await this.provider.getMessage(messageId) : null;
    if (!message || message.channelId !== channelId || message.system) {
      throw new MessagingError(404, "message_not_found", "That message isn't available.");
    }
    if (message.senderId === me) throw new MessagingError(400, "own_message", "You can't report your own message.");

    const snapshot = await this.snapshotFor(channelId, message);

    const reportId = await this.moderation.repo.createReport({
      reporter: me,
      targetType: "message",
      targetId: message.id,
      reason,
      details,
      source: "user",
      subject: message.senderId,
      snapshot: { conversationId, messages: snapshot },
    });
    return { id: reportId };
  }

  /** The reported message and up to SNAPSHOT_CONTEXT before it, hidden ones and Ball Boi's lines included. */
  private async snapshotFor(channelId: string, message: ProviderMessage): Promise<SnapshotMessage[]> {
    const history = await this.provider.listMessages(channelId, { limit: 200 });
    const at = history.findIndex((m) => m.id === message.id);
    const window = at >= 0 ? history.slice(Math.max(0, at - SNAPSHOT_CONTEXT), at + 1) : [message];
    const people = await this.repo.people([...new Set(window.filter((m) => !m.system).map((m) => m.senderId))]);
    return window.map((m) => ({
      id: m.id,
      senderClerkUserId: m.senderId,
      senderName: m.system ? "Ball Boi" : (people.get(m.senderId)?.name ?? "Player"),
      text: m.text,
      at: m.createdAt.toISOString(),
      reported: m.id === message.id,
    }));
  }

  /**
   * A message flagged by the provider's moderation (Stream AI moderation).
   * Files a report with a snapshot into the admin queue for a moderator. The
   * sender's account is untouched until one acts. Returns the report id, or
   * null if the message isn't one of ours.
   */
  async recordProviderFlag(input: { messageId: string; details: string; reason: ReportReason }): Promise<number | null> {
    if (!this.moderation) return null;
    const message = await this.provider.getMessage(input.messageId);
    if (!message || message.system) return null;
    // A direct message, or a group chat message (F15): one admin queue for both.
    const c = await this.repo.findByChannel(message.channelId);
    const group = c ? null : await this.repo.findGroupByChannel(message.channelId);
    if (!c && !group) return null;
    const reportId = await this.moderation.repo.createReport({
      reporter: null,
      targetType: "message",
      targetId: message.id,
      reason: input.reason,
      details: input.details.slice(0, 1000),
      source: "stream",
      subject: message.senderId,
      snapshot: { conversationId: c?.id ?? null, messages: await this.snapshotFor(message.channelId, message) },
    });
    return reportId;
  }

  /** Moderator action: hides or restores a message for both people. */
  async setMessageHidden(messageId: string, hidden: boolean): Promise<boolean> {
    const message = await this.provider.getMessage(messageId);
    if (!message) return false;
    await this.provider.setHidden(messageId, hidden);
    const c = await this.repo.findByChannel(message.channelId);
    if (c) {
      // Keep the Messages list preview in step with what's visible.
      const visible = (await this.provider.listMessages(c.channelId, { limit: 50 })).filter((m) => !m.hidden);
      const last = visible[visible.length - 1];
      await this.repo.update(c.id, {
        lastMessageText: last?.text ?? null,
        lastSender: last?.senderId ?? null,
        lastMessageAt: last?.createdAt ?? c.lastMessageAt,
      });
    } else {
      const group = await this.repo.findGroupByChannel(message.channelId);
      if (group) {
        const visible = (await this.provider.listMessages(group.channelId, { limit: 50 })).filter((m) => !m.hidden);
        const last = visible[visible.length - 1];
        await this.repo.updateGroup(group.id, {
          lastMessageText: last?.text ?? null,
          lastSender: last ? (last.system ? null : last.senderId) : null,
          lastMessageAt: last?.createdAt ?? group.lastMessageAt,
        });
      }
    }
    return true;
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
   * Development only: a chat with Sam (replies to you) and a first message
   * from Jordan, someone outside your leagues, so every screen can be tried
   * with one phone.
   */
  async seedSamples(me: string, names: (id: string, name: string) => Promise<void>) {
    const sam = `${DEV_SAMPLE_PREFIX}sam`;
    const jordan = `${DEV_SAMPLE_PREFIX}jordan`;
    await names(sam, "Sam Rivera");
    await names(jordan, "Jordan Lee");
    const make = async (other: string, text: string) => {
      const pairKey = pairKeyFor(me, other);
      const [userA, userB] = pairKey.split(":") as [string, string];
      const channelId = channelIdFor(pairKey);
      await this.provider.ensureChannel(channelId, [userA, userB]);
      const existing = await this.repo.findByPair(pairKey);
      const c =
        existing ??
        (await this.repo.create({ pairKey, userA, userB, status: "active", requester: other, channelId, openingHash: openingHash(text) }));
      await this.deliver(other, c, text, `seed${Date.now().toString(36)}${other.slice(-3)}`);
    };
    await make(sam, "Still on for Saturday at 9?");
    await make(jordan, "Hi, saw you play at Memorial Park. Up for a hit sometime?");
  }
}
