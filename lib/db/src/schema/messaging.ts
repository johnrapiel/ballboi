import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

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
