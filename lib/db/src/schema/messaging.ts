import { pgTable, text, serial, timestamp, integer, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";

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
  (table) => [uniqueIndex("uq_message_groups_channel").on(table.channelId), uniqueIndex("uq_message_groups_open_match").on(table.openMatchId)],
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
    /** Their first message here, for the first-message filter. Null until they send. */
    firstSentAt: timestamp("first_sent_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("uq_message_group_members").on(table.groupId, table.clerkUserId), index("idx_message_group_members_user").on(table.clerkUserId)],
);

export type MessageGroup = typeof messageGroupsTable.$inferSelect;
export type MessageGroupMember = typeof messageGroupMembersTable.$inferSelect;
