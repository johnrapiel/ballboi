import { pgTable, text, serial, timestamp, integer, index, uniqueIndex, boolean, jsonb } from "drizzle-orm/pg-core";

// Direct messages between two accounts. Spec: Messaging and moderation.
//
// Message text lives in the messaging provider (Stream Chat in production, an
// in-memory store in development and tests). This table holds what Ball Boi's
// own rules need: who is in the conversation, whether it's still a Message
// Request, the latest message for the Messages list, and unread counts.
// Read state is never shown to the other person (no read receipts).

export const DM_STATUSES = ["active", "request", "declined"] as const;
export type DmStatus = (typeof DM_STATUSES)[number];

export const dmConversationsTable = pgTable(
  "dm_conversations",
  {
    id: serial("id").primaryKey(),
    /** The two Clerk user ids, sorted and joined with ":". One conversation per pair. */
    pairKey: text("pair_key").notNull(),
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    /** active: both can send. request: waiting for the recipient's first reply. declined: recipient deleted the request. */
    status: text("status").notNull().default("active"),
    /** Who sent the first message. With status "request", the person waiting for a reply. */
    requester: text("requester"),
    /** The provider's channel id (Stream channel, or the in-memory store's key). */
    channelId: text("channel_id").notNull(),
    /** Hash of the first message, to spot the same opener pasted to many people. */
    openingHash: text("opening_hash"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessageText: text("last_message_text"),
    lastSender: text("last_sender"),
    aUnread: integer("a_unread").notNull().default(0),
    bUnread: integer("b_unread").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_dm_conversations_pair").on(table.pairKey),
    index("idx_dm_conversations_user_a").on(table.userA),
    index("idx_dm_conversations_user_b").on(table.userB),
    index("idx_dm_conversations_requester").on(table.requester, table.createdAt),
  ],
);

export type DmConversation = typeof dmConversationsTable.$inferSelect;

// Group chats (F15, John, Nov 8): the chat an open match opens when its last
// spot fills runs through the same messaging service as direct messages, with
// any number of members. Text lives in the provider, like direct messages;
// these tables hold who's in, the latest message for the Messages list, and
// each member's unread count. Migration 20261108_f15_message_groups.sql.

export const messageGroupsTable = pgTable(
  "message_groups",
  {
    id: serial("id").primaryKey(),
    /** The provider's channel id. */
    channelId: text("channel_id").notNull(),
    /** The open match this chat belongs to. One chat per open match. */
    openMatchId: integer("open_match_id"),
    /**
     * The league this chat belongs to (Wave 2, decisions 145 and 146). One chat
     * per league; its members are the league's current players and admins.
     * Migration 20261108_h_league_chat.sql.
     */
    leagueId: integer("league_id"),
    /**
     * A doubles league match's chat for all four players (D6). One chat per
     * match. Migration 20261109_x_doubles_partners.sql.
     */
    matchId: integer("match_id"),
    /** Doubles match chats: each member's own title ("You, Sam, Jo and Lee · Week 3"), by account. */
    memberTitles: jsonb("member_titles").$type<Record<string, string>>(),
    /** League chats: up to 3 message ids an admin pinned, oldest pin first. */
    pinnedIds: jsonb("pinned_ids").$type<string[]>().notNull().default([]),
    /** League chats: each player's standings rank (player id to rank) when last posted, to spot moves. */
    standings: jsonb("standings").$type<Record<string, number>>(),
    /** "Sat 9 AM doubles · Beacon Courts" */
    title: text("title").notNull(),
    /** Members can send. Off while a spot is open again, or after a cancel. */
    open: boolean("open").notNull().default(true),
    /** Why the composer is off, in plain words. */
    closedReason: text("closed_reason"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessageText: text("last_message_text"),
    /** Null for a line from Ball Boi ("All 4 spots filled"). */
    lastSender: text("last_sender"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_message_groups_channel").on(table.channelId),
    uniqueIndex("uq_message_groups_open_match").on(table.openMatchId),
    uniqueIndex("uq_message_groups_league").on(table.leagueId),
    uniqueIndex("uq_message_groups_match").on(table.matchId),
  ],
);

export const messageGroupMembersTable = pgTable(
  "message_group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => messageGroupsTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    unread: integer("unread").notNull().default(0),
    /**
     * League chats: unread messages that count on the Messages button, which
     * are @mentions of this person and admin posts (decision 146).
     */
    attention: integer("attention").notNull().default(0),
    /** League chats: this person is one of the league's admins. Kept in step with the league. */
    admin: boolean("admin").notNull().default(false),
    /** League chats: an admin muted this person here, so they can read but not send. */
    mutedAt: timestamp("muted_at", { withTimezone: true }),
    /** Their first message here, for the first-message filter. Null until they send. */
    firstSentAt: timestamp("first_sent_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("uq_message_group_members").on(table.groupId, table.clerkUserId), index("idx_message_group_members_user").on(table.clerkUserId)],
);

export type MessageGroup = typeof messageGroupsTable.$inferSelect;
export type MessageGroupMember = typeof messageGroupMembersTable.$inferSelect;

/**
 * Staging only, until it has Stream keys: the in-memory messaging provider's
 * messages, saved as one JSON snapshot so they survive the API container
 * sleeping or redeploying (John, Nov 10: "My message history disappeared").
 * Production keeps message text in Stream, never here.
 */
export const messagingMemorySnapshotTable = pgTable("messaging_memory_snapshot", {
  /** One row per store; "default" today. */
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
