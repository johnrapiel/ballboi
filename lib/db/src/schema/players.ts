import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

export const playersTable = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  skillLevel: text("skill_level").notNull().default("3.0"),
  dominantHand: text("dominant_hand").notNull().default("right"),
  bio: text("bio"),
  clerkUserId: text("clerk_user_id"),
  dayBeforeMatchReminderEnabled: boolean("day_before_match_reminder_enabled").notNull().default(true),
  leagueId: integer("league_id").references(() => leaguesTable.id, { onDelete: "set null" }),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  // Set when a player drops out mid-season (decision 27). Their played matches
  // stay; they leave standings and pairings.
  leftAt: timestamp("left_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("idx_players_league_id").on(table.leagueId),
  index("idx_players_clerk_user_id").on(table.clerkUserId),
]);

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true, updatedAt: true, wins: true, losses: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
