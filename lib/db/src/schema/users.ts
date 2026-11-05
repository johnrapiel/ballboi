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
   * Ball Boi Rating: the player's level for matching, NTRP scale. Null until the
   * onboarding quiz or a UTR link sets it. Results don't move it; the player can
   * change it anytime. Spec: Ball Boi Rating.
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
  /**
   * The point Discover measures distance from: the rounded "Use my location"
   * point, else the home zip's center. Set whenever the home area is saved
   * (migration 20261105_f_discover_players.sql). Approximate, never exact.
   */
  areaLatitude: real("area_latitude"),
  areaLongitude: real("area_longitude"),
  /** Hidden profile (spec: Discover): out of Players near you; leagues and Ball Boi stay. */
  discoverHidden: boolean("discover_hidden").notNull().default(false),
  /** What they play, for the Discover filter: singles | doubles | both. Null = not said. */
  plays: text("plays"),
  /** When they're usually free, for the Discover filter: weekday_mornings, weekday_evenings, weekends. Null = not said. */
  freeTimes: text("free_times").array(),
  /**
   * Single-choice answer from the first onboarding version. Kept for the dev
   * walkthrough seed; new answers go in `intents`.
   */
  intent: text("intent"),
  /**
   * "What do you want to do on Ball Boi?" picks: run_league, join_league,
   * find_matches, record. Null = never answered; empty = skipped or nothing
   * picked. Research data for the team, never shown back to the player.
   */
  intents: text("intents").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
