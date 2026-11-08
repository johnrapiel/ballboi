import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";
import { matchInvitesTable } from "./placeholders";

// Settings › Notifications (Wave 2, Session G). One row per account, made the
// first time a switch changes; no row means every default.
// - messagePreviews (decision 128): message pushes show the sender and the
//   text. Off, they read "New message from [name]". iOS's own Show Previews
//   setting still applies on top.

export const notificationSettingsTable = pgTable("notification_settings", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  messagePreviews: boolean("message_previews").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationSettingsRow = typeof notificationSettingsTable.$inferSelect;

// Opponent notice and "Was that you?" (Wave 2, Session G; decision 124).
// - opponent_notices: "Ball Boi is recording your match", at most once per
//   match and person (league mates, accepted Discover matches, and Quick
//   matches against someone you already play).
// - opponent_requests: a Quick match against a stranger. The match is made
//   against an unlinked stand-in player with an invite code the recorder
//   never sees; the stranger gets "[Name] recorded a match with you. Was that
//   you?". Yes attaches the stand-in to their account like an invite; Not me
//   takes their name off the match; no answer leaves it unlinked.

export const opponentNoticesTable = pgTable(
  "opponent_notices",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("opponent_notices_match_user_unique").on(table.matchId, table.clerkUserId)],
);

export const OPPONENT_REQUEST_STATUSES = ["pending", "yes", "not_me"] as const;
export type OpponentRequestStatus = (typeof OPPONENT_REQUEST_STATUSES)[number];

export const opponentRequestsTable = pgTable(
  "opponent_requests",
  {
    code: text("code")
      .primaryKey()
      .references(() => matchInvitesTable.code, { onDelete: "cascade" }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    recorderClerkUserId: text("recorder_clerk_user_id").notNull(),
    /** The only account that can answer. */
    opponentClerkUserId: text("opponent_clerk_user_id").notNull(),
    status: text("status").$type<OpponentRequestStatus>().notNull().default("pending"),
    /** When the push went out (at most once, when recording starts). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_opponent_requests_match").on(table.matchId),
    index("idx_opponent_requests_opponent").on(table.opponentClerkUserId),
  ],
);

export type OpponentRequest = typeof opponentRequestsTable.$inferSelect;
