import { pgTable, text, serial, timestamp, integer, numeric, real, index, uniqueIndex } from "drizzle-orm/pg-core";

// Ball Boi Rating history. Spec: Ball Boi Rating ("Rating history: shown as a
// trend line on the profile"). One row per change: the onboarding quiz, a UTR
// link, or an entered score. The current rating lives on `users.rating`.
//
// Keyed by Clerk user ID like the safety tables. Account deletion removes every
// row for that person (lib/accountDeletion.ts).

export const RATING_REASONS = ["self_rated", "verified", "match"] as const;
export type RatingReason = (typeof RATING_REASONS)[number];

export const ratingHistoryTable = pgTable(
  "rating_history",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    /** Rating after this change, NTRP scale, two decimals. */
    rating: numeric("rating", { precision: 4, scale: 2, mode: "number" }).notNull(),
    /** Change from the previous rating. 0 for the first (quiz) row. */
    delta: numeric("delta", { precision: 4, scale: 2, mode: "number" }).notNull().default(0),
    reason: text("reason").notNull(),
    /** The match that caused a `match` change. One row per player per match. */
    matchId: integer("match_id"),
    /** 1 for singles, 0.5 for doubles. */
    weight: real("weight").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_rating_history_user").on(table.clerkUserId, table.createdAt),
    uniqueIndex("uq_rating_history_user_match").on(table.clerkUserId, table.matchId),
  ],
);

export type RatingHistory = typeof ratingHistoryTable.$inferSelect;
