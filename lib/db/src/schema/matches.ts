import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { playersTable } from "./players";
import { courtsTable } from "./courts";

export const matchesTable = pgTable("matches", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").references(() => leaguesTable.id, { onDelete: "set null" }),
  player1Id: integer("player1_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  player2Id: integer("player2_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  player3Id: integer("player3_id").references(() => playersTable.id, { onDelete: "set null" }),
  player4Id: integer("player4_id").references(() => playersTable.id, { onDelete: "set null" }),
  winnerId: integer("winner_id").references(() => playersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("scheduled"),
  scheduledAt: text("scheduled_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  location: text("location"),
  score: text("score"),
  notes: text("notes"),
  durationMinutes: integer("duration_minutes"),
  recordedByClerkUserId: text("recorded_by_clerk_user_id"),
  recordedAt: text("recorded_at"),
  // Scheduling system fields
  courtId: integer("court_id").references(() => courtsTable.id, { onDelete: "set null" }),
  weekOf: text("week_of"),
  generatedFrom: text("generated_from").default("manual"),
  estimatedDistanceP1: real("estimated_distance_p1"),
  estimatedDistanceP2: real("estimated_distance_p2"),
  roundId: integer("round_id"),
  playoffBracketId: integer("playoff_bracket_id"),
  playoffRound: text("playoff_round"),
  playoffSlot: integer("playoff_slot"),
  season: text("season"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMatchSchema = createInsertSchema(matchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matchesTable.$inferSelect;
