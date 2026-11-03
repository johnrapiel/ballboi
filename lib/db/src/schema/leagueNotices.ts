import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// One-line in-app notes for a player about a league that's gone, such as
// "Tuesday Flex was deleted by its organizer" (Oct 31 review, C10). Not tied
// to the league row, so they outlive it. The player clears each one.
// Migration 20261101_c_league_end_and_notices.sql.
export const leagueNoticesTable = pgTable(
  "league_notices",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (table) => [index("idx_league_notices_clerk_user_id").on(table.clerkUserId)],
);

export type LeagueNotice = typeof leagueNoticesTable.$inferSelect;
