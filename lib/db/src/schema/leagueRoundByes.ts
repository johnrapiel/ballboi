import { serial, timestamp, integer, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { leagueRoundsTable } from "./leagueRounds";
import { playersTable } from "./players";

// A player sitting out a round: the odd one out, or an admin's choice.
// Migration 20261029_league_rules.sql.
export const leagueRoundByesTable = pgTable(
  "league_round_byes",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id").notNull().references(() => leagueRoundsTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("uq_league_round_byes_player").on(table.roundId, table.playerId)],
);

export type LeagueRoundBye = typeof leagueRoundByesTable.$inferSelect;
