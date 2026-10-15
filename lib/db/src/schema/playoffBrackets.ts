import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

export interface PlayoffSeeding {
  seed: number;
  playerId: number;
  playerName: string;
  winRate: number;
}

export const playoffBracketsTable = pgTable("playoff_brackets", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  seedings: jsonb("seedings").notNull().default([]).$type<PlayoffSeeding[]>(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_playoff_brackets_league_id").on(table.leagueId),
]);
