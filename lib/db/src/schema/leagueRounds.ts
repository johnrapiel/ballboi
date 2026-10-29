import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

export const leagueRoundsTable = pgTable("league_rounds", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("active"),
  // Null while an admin reviews the pairings; set when the round goes out
  // to players (decision 29). Migration 20261029_c_league_rules.sql.
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_league_rounds_league_id_status").on(table.leagueId, table.status),
]);

export const insertLeagueRoundSchema = createInsertSchema(leagueRoundsTable).omit({ id: true, createdAt: true });
export type InsertLeagueRound = z.infer<typeof insertLeagueRoundSchema>;
export type LeagueRound = typeof leagueRoundsTable.$inferSelect;
