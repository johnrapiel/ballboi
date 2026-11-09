import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// When you can play (F7, F8): one generic Monday to Sunday week of hours,
// per player. Powers Discover only ("Free when I'm free" and the player
// card's summary); league pairing doesn't read it. Separate from the old
// per-league, per-week player_availability table, which stays as it is.
//
// Each slot is day * 24 + hour: day 0 is Monday, 6 is Sunday; hours 6 (6 AM)
// to 21 (9 PM), each meaning the hour that starts then.
//
// free_times (Nov 9, decision 156) replaces the grid: { day, start, end }
// with minutes after midnight, end exclusive. NULL until the player saves in
// the new editor; until then the API converts `slots` exactly
// (@workspace/free-times rangesFromSlots). `slots` is kept, not dropped.

export const weeklyAvailabilityTable = pgTable("weekly_availability", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  slots: integer("slots").array().notNull().default([]),
  freeTimes: jsonb("free_times").$type<{ day: number; start: number; end: number }[] | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WeeklyAvailability = typeof weeklyAvailabilityTable.$inferSelect;
