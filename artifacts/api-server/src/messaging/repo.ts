import type { DmStatus } from "@workspace/db";

/** A conversation record, as MessagingService sees it. */
export interface ConversationRecord {
  id: number;
  pairKey: string;
  userA: string;
  userB: string;
  status: DmStatus;
  /** Who sent the first message. */
  requester: string | null;
  channelId: string;
  openingHash: string | null;
  lastMessageAt: Date | null;
  lastMessageText: string | null;
  lastSender: string | null;
  aUnread: number;
  bUnread: number;
  createdAt: Date;
  acceptedAt: Date | null;
}

export type NewConversation = Pick<ConversationRecord, "pairKey" | "userA" | "userB" | "status" | "requester" | "channelId" | "openingHash">;
export type ConversationPatch = Partial<Omit<ConversationRecord, "id" | "pairKey" | "userA" | "userB" | "channelId" | "createdAt">>;

export interface PersonSummary {
  name: string;
  /** A player record for this account, used by report and block. Null if they have none. */
  playerId: number | null;
  /** Their account's user id (users.id), for report and block when they have no player record yet (a Discover player). */
  userId?: number | null;
  /** Their profile photo ("/objects/..."), if they set one. */
  avatarUrl?: string | null;
}

/**
 * A group chat: an open match's chat once its last spot fills (F15), or a
 * league's chat (decisions 145 and 146). Exactly one of openMatchId and
 * leagueId is set.
 */
export interface GroupRecord {
  id: number;
  channelId: string;
  openMatchId: number | null;
  leagueId: number | null;
  /** A doubles league match's chat for all four players (D6). */
  matchId?: number | null;
  /** Doubles match chats: each member's own title ("You, Sam, Jo and Lee · Week 3"). */
  memberTitles?: Record<string, string> | null;
  /** League chats: up to 3 pinned message ids, oldest pin first. */
  pinnedIds: string[];
  /** League chats: player id to standings rank, as of the last result. */
  standings: Record<string, number> | null;
  title: string;
  /** Members can send. */
  open: boolean;
  /** Why the composer is off, in plain words. */
  closedReason: string | null;
  lastMessageAt: Date | null;
  lastMessageText: string | null;
  /** Null for a line from Ball Boi. */
  lastSender: string | null;
  createdAt: Date;
}

export interface GroupMember {
  groupId: number;
  userId: string;
  unread: number;
  /** League chats: unread @mentions of this person and admin posts, the ones the Messages button counts. */
  attention: number;
  /** League chats: one of the league's admins. */
  admin: boolean;
  /** League chats: muted here by an admin (reads, can't send). */
  mutedAt: Date | null;
  /** Their first message in this chat, for the first-message filter. */
  firstSentAt: Date | null;
  joinedAt: Date;
}

export type NewGroup = Pick<GroupRecord, "channelId" | "openMatchId" | "title"> & { leagueId?: number | null; matchId?: number | null };
export type GroupPatch = Partial<
  Pick<
    GroupRecord,
    "title" | "open" | "closedReason" | "lastMessageAt" | "lastMessageText" | "lastSender" | "pinnedIds" | "standings" | "memberTitles"
  >
>;
export type GroupMemberPatch = Partial<Pick<GroupMember, "admin" | "mutedAt">>;

/** Group chat storage (F15). Part of MessagingRepo. */
export interface GroupRepo {
  findGroup(id: number): Promise<GroupRecord | null>;
  findGroupByChannel(channelId: string): Promise<GroupRecord | null>;
  findGroupByOpenMatch(openMatchId: number): Promise<GroupRecord | null>;
  findGroupByLeague(leagueId: number): Promise<GroupRecord | null>;
  /** A doubles league match's chat (D6). */
  findGroupByMatch(matchId: number): Promise<GroupRecord | null>;
  /** Creates the group, or returns the existing one for this channel. */
  createGroup(input: NewGroup): Promise<GroupRecord>;
  updateGroup(id: number, patch: GroupPatch): Promise<GroupRecord>;
  groupMembers(id: number): Promise<GroupMember[]>;
  addGroupMembers(id: number, userIds: string[], at: Date): Promise<void>;
  removeGroupMembers(id: number, userIds: string[]): Promise<void>;
  updateGroupMember(id: number, userId: string, patch: GroupMemberPatch): Promise<void>;
  /**
   * Records the latest message, adds one to each recipient's unread count (and
   * to `attention` for those in it, a subset of recipients), and notes the
   * sender's first message (a person, not Ball Boi).
   */
  recordGroupMessage(
    id: number,
    input: { sender: string | null; text: string; at: Date; recipients: string[]; attention?: string[] },
  ): Promise<GroupRecord>;
  markGroupRead(id: number, userId: string): Promise<void>;
  /** Groups this person is in, with their own member row. */
  groupsFor(userId: string): Promise<{ group: GroupRecord; member: GroupMember }[]>;
}

/** Everything MessagingService reads or writes outside the provider. */
export interface MessagingRepo extends GroupRepo {
  findByPair(pairKey: string): Promise<ConversationRecord | null>;
  findById(id: number): Promise<ConversationRecord | null>;
  findByChannel(channelId: string): Promise<ConversationRecord | null>;
  /** Creates the conversation, or returns the existing one if the pair already has one. */
  create(input: NewConversation): Promise<ConversationRecord>;
  update(id: number, patch: ConversationPatch): Promise<ConversationRecord>;
  /** Adds one to the recipient's unread count and records the latest message. */
  recordMessage(id: number, input: { sender: string; text: string; at: Date }): Promise<ConversationRecord>;
  listFor(userId: string): Promise<ConversationRecord[]>;
  /** Conversations this person started since a time (the new-account throttle). */
  countStartedSince(userId: string, since: Date): Promise<number>;
  /** When the account was created, or null if unknown (treated as new). */
  accountCreatedAt(userId: string): Promise<Date | null>;
  /**
   * League mates or players with a match together message freely. Group chats
   * pass `beyondOpenMatches`: a match an open match put on the schedule only
   * counts once it has a score, so the chat's own match never lifts the filter.
   */
  areConnected(a: string, b: string, opts?: { beyondOpenMatches?: boolean }): Promise<boolean>;
  /** Accounts hidden from this person, whichever side blocked. */
  blockedSetFor(userId: string): Promise<Set<string>>;
  /** Accounts this person blocked (their chats stay, with Unblock). */
  blockedByMe(userId: string): Promise<Set<string>>;
  /** Accounts that can't start new conversations right now (restricted by a moderator or the agent, banned or suspended). */
  restrictedSet(userIds: string[]): Promise<Set<string>>;
  people(userIds: string[]): Promise<Map<string, PersonSummary>>;
  accountForPlayer(playerId: number): Promise<string | null>;
  /** The account behind a user id (users.id): messaging a Discover player who isn't in a league. */
  accountForUser(userId: number): Promise<string | null>;
  /** People this person can message freely (league mates), for New message. */
  contactsFor(userId: string): Promise<{ userId: string; name: string; playerId: number | null }[]>;
  /** Account deletion: removes every conversation record they're in. */
  deleteAllFor(userId: string): Promise<void>;
}

export function pairKeyFor(a: string, b: string): string {
  return [a, b].sort().join(":");
}
