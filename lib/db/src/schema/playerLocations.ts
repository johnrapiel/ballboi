import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { leaguesTable } from "./leagues";

export const playerLocationsTable = pgTable("player_locations", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  homeZipCode: text("home_zip_code"),
  city: text("city"),
  state: text("state"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  canTravelUpTo: integer("can_travel_up_to").default(30),
  preferredTimes: text("preferred_times"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerLocation = typeof playerLocationsTable.$inferSelect;
export type InsertPlayerLocation = typeof playerLocationsTable.$inferInsert;
