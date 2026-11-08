import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";

// Career milestones (spec decisions 149 and 150, John, Nov 8): earned once per
// player, stored with the date. Launch set: first_win, first_ball_boi,
// win_streak_5, win_streak_10. seen_at is when the app played the milestone
// moment; null means it plays the next time you open the app.
// Migration: scripts/migrations/20261108_h_player_milestones.sql.
export const playerMilestonesTable = pgTable(
  "player_milestones",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    kind: text("kind").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(),
    matchId: integer("match_id").references(() => matchesTable.id, { onDelete: "set null" }),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("player_milestones_user_kind_unique").on(table.clerkUserId, table.kind),
    index("idx_player_milestones_user").on(table.clerkUserId),
  ],
);

export type PlayerMilestone = typeof playerMilestonesTable.$inferSelect;
