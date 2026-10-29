import { pgTable, text, serial, timestamp, boolean, numeric, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  skillLevel: text("skill_level").notNull().default("intermediate"),
  dominantHand: text("dominant_hand").notNull().default("right"),
  bio: text("bio"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  /**
   * Ball Boi Rating, NTRP scale (2.5 to 7.0), two decimals. Null until the
   * onboarding quiz or a UTR link sets it. Spec: Ball Boi Rating.
   */
  rating: numeric("rating", { precision: 4, scale: 2, mode: "number" }),
  /** "self" (quiz, shown as Self-rated) or "verified" (linked UTR). */
  ratingSource: text("rating_source"),
  /** Home area (spec: Discover > Home area anchor). Five-digit US zip. */
  homeZip: text("home_zip"),
  /**
   * Approximate home location, only when the player used "Use my location".
   * Rounded to two decimals (about a kilometer) so we never hold an exact spot.
   */
  homeLatitude: real("home_latitude"),
  homeLongitude: real("home_longitude"),
  /** "What brings you here?" answer: run_league, join_league, find_matches, record. */
  intent: text("intent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
