import { index, integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";
import { playersTable } from "./players";

// Fixed-partner doubles (spec: Leagues > Setup > Play type): two players who
// play every round of the season together. An admin teams players up in
// Manage; anyone still without a partner when a round is drafted is teamed
// with the closest level. Each league player is on at most one team.
// Migration 20261105_doubles_teams.sql.
export const leagueTeamsTable = pgTable(
  "league_teams",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
    player1Id: integer("player1_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    player2Id: integer("player2_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_league_teams_league_id").on(table.leagueId),
    uniqueIndex("uq_league_teams_player1").on(table.player1Id),
    uniqueIndex("uq_league_teams_player2").on(table.player2Id),
  ],
);

export type LeagueTeam = typeof leagueTeamsTable.$inferSelect;
