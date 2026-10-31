import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";
import { playersTable } from "./players";

// Quick match against someone who isn't on Ball Boi (spec: Ball Boi >
// Recording, Quick match): they become a placeholder player with an invite
// link. Opening the link and joining attaches the placeholder to their
// account. Placeholders are never auto-linked by name, never get an in-app
// notice, and their matches stay out of training until they join.

export const matchInvitesTable = pgTable(
  "match_invites",
  {
    code: text("code").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    placeholderPlayerId: integer("placeholder_player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    claimedByClerkUserId: text("claimed_by_clerk_user_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_match_invites_placeholder").on(table.placeholderPlayerId),
    index("idx_match_invites_created_by").on(table.createdByClerkUserId),
  ],
);

export type MatchInvite = typeof matchInvitesTable.$inferSelect;
