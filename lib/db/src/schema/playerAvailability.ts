import { pgTable, text, serial, timestamp, integer, json, index } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { leaguesTable } from "./leagues";

// slots: array of { dayOfWeek: 0-6, hour: 6-21 }
export const playerAvailabilityTable = pgTable("player_availability", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  weekOf: text("week_of").notNull(),
  slots: json("slots").$type<Array<{ dayOfWeek: number; hour: number }>>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_player_availability_league_id_week_of").on(table.leagueId, table.weekOf),
  index("idx_player_availability_player_id").on(table.playerId),
]);

export type PlayerAvailability = typeof playerAvailabilityTable.$inferSelect;
export type InsertPlayerAvailability = typeof playerAvailabilityTable.$inferInsert;
