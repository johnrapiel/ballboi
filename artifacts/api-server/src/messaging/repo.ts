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
}

/** Everything MessagingService reads or writes outside the provider. */
export interface MessagingRepo {
  findByPair(pairKey: string): Promise<ConversationRecord | null>;
  findById(id: number): Promise<ConversationRecord | null>;
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
  /** League mates or players with a match together message freely. */
  areConnected(a: string, b: string): Promise<boolean>;
  /** Accounts hidden from this person, whichever side blocked. */
  blockedSetFor(userId: string): Promise<Set<string>>;
  /** Accounts that can't start new conversations right now (auto-restrict). */
  restrictedSet(userIds: string[]): Promise<Set<string>>;
  people(userIds: string[]): Promise<Map<string, PersonSummary>>;
  accountForPlayer(playerId: number): Promise<string | null>;
  /** People this person can message freely (league mates), for New message. */
  contactsFor(userId: string): Promise<{ userId: string; name: string; playerId: number | null }[]>;
  /** Account deletion: removes every conversation record they're in. */
  deleteAllFor(userId: string): Promise<void>;
}

export function pairKeyFor(a: string, b: string): string {
  return [a, b].sort().join(":");
}
