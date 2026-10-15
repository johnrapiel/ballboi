import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true, updatedAt: true, wins: true, losses: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
