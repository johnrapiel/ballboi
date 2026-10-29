import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";

// Spec (Ball Boi > Recording): Ball Boi is disabled on doubles matches, and
// "views are counted as a demand signal" for doubles analysis. One row per
// person per doubles match they saw the disabled state on.

export const ballBoiDoublesViewsTable = pgTable(
  "ball_boi_doubles_views",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    matchId: integer("match_id").references(() => matchesTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("uq_ball_boi_doubles_views_user_match").on(table.clerkUserId, table.matchId)],
);

export type BallBoiDoublesView = typeof ballBoiDoublesViewsTable.$inferSelect;
