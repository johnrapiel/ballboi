import { pgTable, text, serial, timestamp, integer, json } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

export const scheduleGenerationLogsTable = pgTable("schedule_generation_logs", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  weekOf: text("week_of").notNull(),
  status: text("status").notNull().default("pending_review"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedByClerkUserId: text("confirmed_by_clerk_user_id"),
  regenerationCount: integer("regeneration_count").default(0),
  matchesGenerated: integer("matches_generated").default(0),
  stats: json("stats").$type<{
    timeSlotsAnalyzed: number;
    playersWithAvailability: number;
    pairsConsidered: number;
    rematches_skipped: number;
    availabilityReminderMissingCount?: number;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ScheduleGenerationLog = typeof scheduleGenerationLogsTable.$inferSelect;
export type InsertScheduleGenerationLog = typeof scheduleGenerationLogsTable.$inferInsert;
