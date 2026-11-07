import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// When you can play (F7, F8): one generic Monday to Sunday week of hours,
// per player. Powers Discover only ("Free when I'm free" and the player
// card's summary); league pairing doesn't read it. Separate from the old
// per-league, per-week player_availability table, which stays as it is.
//
// Each slot is day * 24 + hour: day 0 is Monday, 6 is Sunday; hours 6 (6 AM)
// to 21 (9 PM), each meaning the hour that starts then.

export const weeklyAvailabilityTable = pgTable("weekly_availability", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  slots: integer("slots").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WeeklyAvailability = typeof weeklyAvailabilityTable.$inferSelect;
